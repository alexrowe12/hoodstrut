# Phase 7 Implementation Plan: Parallel Execution & Benchmarks

**Date**: 2026-07-11
**Prerequisite**: Phase 6 complete (commit before starting — working tree currently has uncommitted Phase 6 changes)

## Goals (from MVP plan)

- [ ] Concurrent container execution (`--parallel N`)
- [ ] Resource management (concurrency semaphore — no container pooling, per design decision)
- [ ] Benchmark orchestration (multiple profiles × multiple tasks)
- [ ] Aggregated benchmark results
- [ ] Comparison reports (`hoodstrut report --compare`)

## Design Decisions (confirmed with Alex)

1. **Results layout**: Each benchmark gets its own directory `results/benchmark-<name>-<timestamp>/` containing run subdirectories, `benchmark.json` (config + summary), and `report.md`. Single `hoodstrut run` keeps the current flat `results/run-<timestamp>/` layout.
2. **Concurrency model**: Fresh container per run (isolation preserved), capped at N concurrent via a simple semaphore/worker pool. No container reuse, no repo caching. Docker image is pre-built once before workers start.
3. **Config**: Both CLI flags (`--profiles`, `--tasks`, `--parallel`) and a YAML benchmark config file (`--config ./benchmarks/suite.yaml`). Flags override config values.
4. **Compare**: `hoodstrut report <dirA> --compare <dirB>` compares two results directories side-by-side with deltas.

---

## Current State (what Phase 7 builds on)

| Area | State | Phase 7 impact |
|------|-------|----------------|
| `src/cli/commands/run.ts` | All run logic (execute → evaluate → score → persist → report) is inline in the Commander action | Must be extracted into a reusable function so `benchmark` can call it |
| `src/cli/commands/benchmark.ts` | Stub ("not yet implemented") | Full implementation |
| `src/docker/executor.ts` | `runContainer()` calls `buildRunnerImage()` internally per run; fresh tmp workspace per run; `docker run --rm` | Concurrent first-time builds would race — needs a build memo/pre-build |
| Run IDs | `run-${Date.now()}` | Collides under parallelism; benchmark runs need deterministic names |
| `src/cli/commands/report.ts` | `loadRunResults()` scans one level of `run-*` dirs; `generateReport()` writes `report.md` | Reused as-is for the benchmark dir; gains `--compare` |
| `src/output/markdown.ts` | `generateAggregateReport(results, generatedAt)` | Reused as-is inside benchmark dirs; comparison generator added alongside |
| Verbose output | `pipeWithLogging` prints raw container output | Must stay off during parallel runs (interleaving); logs still captured to files |

---

## New & Modified Files

### 1. NEW `src/core/run-pipeline.ts` — extracted single-run pipeline

The core refactor. Pull everything between "load profile/task" and "write run-result.json" out of `run.ts` into:

```typescript
export interface ExecuteRunOptions {
  profile: Profile;
  task: Task;
  runId: string;
  outputDir: string;          // absolute; created if missing
  timeout?: number;
  verbose?: boolean;          // forced false by benchmark
  telemetry?: TelemetryConfig;
}

export interface ExecuteRunResult {
  runResult: RunResult;       // fully populated, score included
  outputDir: string;
}

export async function executeRun(options: ExecuteRunOptions): Promise<ExecuteRunResult>
```

Responsibilities (moved verbatim from `run.ts:88-233`):
- `runContainer()` → `evaluateSuccess()` → `calculateScore()` → assemble `RunResult` → write `run-result.json` to `outputDir`.
- **No console output and no auto-report** — display and report generation stay in the CLI commands. This is what makes it safe to run N in parallel.
- Throws on infrastructure errors (Docker missing, repo prep failure); a *task* failure (success=false) is a normal return, not a throw.

`run.ts` becomes: parse flags → load profile/task → print header → `executeRun()` → print the existing summary/metrics/score display (unchanged output) → `generateReport(dirname(outputDir))` → exit code.

### 2. NEW `src/core/pool.ts` — concurrency limiter

No new dependency; ~20 lines:

```typescript
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]>
```

- Preserves input order in results.
- Never rejects early: each `fn` result is captured as settled value or error (`{ ok: true, value } | { ok: false, error }`) — a crashed run must not abort the benchmark. (Alternatively return `PromiseSettledResult<R>[]`; pick whichever reads cleaner.)
- Clamps `limit` to `[1, items.length]`.

### 3. NEW `src/core/benchmark.ts` — orchestration + config schema

**Config schema** (zod, in this file; type exported via `core/types.ts` re-export if preferred):

```yaml
# benchmarks/example-suite.yaml
name: full-suite            # optional; default: "benchmark"
profiles:                   # names (resolved via ./profiles/<name>.yaml) or paths
  - default
  - ./profiles/test-scan.yaml
tasks:                      # ids (resolved via ./tasks/<id>.md) or paths
  - tasks/examples/hello-world.md
  - fix-todo-persistence
parallel: 2                 # optional; default 1
timeout: 300                # optional per-run override, seconds
output: ./results           # optional base results dir
```

```typescript
export const BenchmarkConfigSchema = z.object({
  name: z.string().default('benchmark'),
  profiles: z.array(z.string()).min(1),
  tasks: z.array(z.string()).min(1),
  parallel: z.number().int().min(1).default(1),
  timeout: z.number().optional(),
  output: z.string().default('./results'),
});
```

**Orchestration**:

```typescript
export interface BenchmarkRunSpec {
  profile: Profile;
  task: Task;
  runId: string;              // "run-<profile-slug>--<task-slug>"
  outputDir: string;
}

export interface BenchmarkProgress {
  completed: number;
  total: number;
  spec: BenchmarkRunSpec;
  result?: RunResult;         // present on success
  error?: string;             // present on infrastructure failure
}

export async function runBenchmark(
  config: BenchmarkConfig,
  opts: { telemetry?: TelemetryConfig; onProgress?: (p: BenchmarkProgress) => void }
): Promise<BenchmarkSummary>
```

Flow:
1. Resolve + load all profiles and tasks up front (reuse `resolveProfilePath`/`resolveTaskPath` — **move these two helpers from `run.ts` into `run-pipeline.ts`** and import in both commands). Fail fast with a clear message listing every unresolvable profile/task before running anything.
2. Build matrix: cartesian product profiles × tasks. Reject duplicate profile names / task ids in the matrix (they'd collide on run dir names).
3. Create `results/benchmark-<name>-<YYYY-MM-DD-HHmmss>/`.
4. Run ID per cell: `run-<slugify(profile.name)>--<slugify(task.id)>` where `slugify` lowercases and replaces anything outside `[a-z0-9-]` with `-`. Note: dir must keep the `run-` prefix so the existing `loadRunResults()` scanner picks it up.
5. `await buildRunnerImage()` **once** before dispatching workers (existing race: parallel first-builds inside `runContainer` would collide; pre-building makes the internal call a no-op via `imageExists`).
6. `mapWithConcurrency(matrix, config.parallel, spec => executeRun({...spec, verbose: false, timeout: config.timeout, telemetry}))`.
7. Each settled run fires `onProgress`. Infrastructure errors are recorded as failed cells (a synthetic entry in `benchmark.json`'s `errors` array), not thrown.
8. Write `benchmark.json`:

```typescript
export const BenchmarkSummarySchema = z.object({
  name: z.string(),
  timestamp: z.string(),
  config: BenchmarkConfigSchema,        // as resolved (post-flag-merge)
  duration_seconds: z.number(),
  total_runs: z.number(),
  successful_runs: z.number(),
  failed_runs: z.number(),
  errored_runs: z.number(),             // infra errors, no run-result.json
  total_cost_usd: z.number(),
  total_score: z.number(),
  errors: z.array(z.object({ run_id: z.string(), message: z.string() })),
});
```

9. Call existing `generateReport(benchmarkDir)` — it already scans `run-*` subdirs and writes `report.md`. No changes needed to `markdown.ts` for this.

### 4. MODIFIED `src/cli/commands/benchmark.ts` — full implementation

```
hoodstrut benchmark [options]
  -p, --profiles <list>    Comma-separated profile names/paths
  -t, --tasks <list>       Comma-separated task ids/paths
  -c, --config <file>      Benchmark YAML config
  --parallel <n>           Concurrent runs (default: 1, or config value)
  --name <name>            Benchmark name (default: config name or "benchmark")
  --timeout <seconds>      Per-run timeout override
  --telemetry <endpoint>   OTEL export (passed through to each run)
  --telemetry-headers <h>
```

- Precedence: CLI flag > config file > schema default.
- With no `--profiles`/`--tasks` and no config: **discover all** — every `*.yaml` in `./profiles` (including `examples/`? **No — top-level `./profiles/*.yaml` only**, examples are opt-in by path) and every `*.md` under `./tasks` (including `tasks/examples/`, since that's where all current tasks live). Print the matrix and total run count before starting.
- Requires `ANTHROPIC_API_KEY` (same check as `run`).
- Progress output (one line per completed run, no container output):

```
Benchmark: full-suite (2 profiles × 3 tasks = 6 runs, parallel: 2)
Output: results/benchmark-full-suite-2026-07-11-143012

[1/6] ✓ default × hello-world           $0.0312   45s   score 612
[2/6] ✗ aggressive × fix-todo-persist…  $0.1104  102s   score 96
[3/6] ⚠ default × add-due-dates         infrastructure error: <msg>
...

=== Benchmark Complete ===
Runs: 6 (4 passed, 1 failed, 1 errored)   Cost: $0.94   Duration: 8m 12s
Report: results/benchmark-full-suite-2026-07-11-143012/report.md
```

- Exit code: `0` if orchestration completed (task failures are data, not errors), `1` only if the benchmark itself couldn't run (bad config, no API key, Docker unavailable, or **every** cell errored).
- A settled-but-errored cell keeps its partially-written output dir (stdout/stderr logs) for debugging.

### 5. MODIFIED `src/cli/commands/report.ts` — `--compare`

```
hoodstrut report <dirA> --compare <dirB>
```

- Loads both directories with existing `loadRunResults` + `backfillScore`.
- Calls new `generateComparisonReport(a, b)` (see §6).
- Writes `comparison.md` into `dirA` and prints it. Plain `hoodstrut report <dir>` behavior unchanged.
- Label each side by its directory basename (e.g. `benchmark-full-suite-2026-07-11` vs `benchmark-full-suite-2026-07-12`).

### 6. NEW `src/output/comparison.ts` — comparison report generator

```typescript
export interface ComparisonSide {
  label: string;              // dir basename
  results: RunResult[];
}
export function generateComparisonReport(a: ComparisonSide, b: ComparisonSide, generatedAt: string): string
```

Structure of `comparison.md`:

```markdown
# Comparison: <A> vs <B>

## Summary
| Metric | <A> | <B> | Δ |
|---|---|---|---|
| Runs | 6 | 6 | — |
| Success Rate | 67% | 83% | +16pp |
| Total Cost | $0.94 | $0.71 | -$0.23 (-24%) |
| Total Tokens | 148,220 | 121,904 | -26,316 |
| Total Score | 3,412 | 4,105 | +693 |

## By Task
Rows matched on (task.id, profile.name); Δ columns for success, cost, score.
Unmatched rows shown with "—" on the missing side (marked "only in <A>/<B>").

## By Profile
Same treatment aggregated per profile.
```

Formatting: reuse `formatCost`/`formatDuration`/`formatPercent` — **export them from `markdown.ts`** instead of duplicating. Deltas: green/positive framing is score-up / cost-down; render signed numbers (`+`/`-`), percentages as percentage-point deltas (`pp`).

### 7. MODIFIED `src/core/types.ts`

- Add `BenchmarkConfigSchema`, `BenchmarkSummarySchema` (or keep them in `core/benchmark.ts` and re-export types — either is fine, but zod schemas for persisted JSON have so far lived in `types.ts`, so follow that convention).
- No changes to `RunResultSchema` (per-benchmark directories make a `benchmark_id` field unnecessary).

### 8. MODIFIED `src/docker/executor.ts` (small)

- Memoize in-flight build: module-level `let buildPromise: Promise<string> | null` inside `buildRunnerImage` so concurrent callers share one build. Belt-and-suspenders on top of the benchmark pre-build; also fixes the latent race for anyone running two `hoodstrut run` processes... (process-level only, but good enough).

---

## Testing Plan (vitest, alongside existing 106 tests)

| File | Coverage |
|------|----------|
| `src/core/__tests__/pool.test.ts` | Order preservation; limit respected (track max in-flight via counters); one rejection doesn't stop others; limit clamping; empty input |
| `src/core/__tests__/benchmark.test.ts` | Config schema defaults/validation; flag-over-config precedence merge; matrix construction; run-id slugification (spaces, unicode, case, collisions rejected); summary aggregation math |
| `src/output/__tests__/comparison.test.ts` | Summary deltas (signs, pp, percent); matched rows; rows only in A / only in B; empty side; null-metrics runs (metrics extraction failed) render `-` |
| Existing `run` behavior | `run-pipeline.ts` extraction is a refactor — existing scorer/judge/success tests keep passing; add one test that `executeRun` writes a schema-valid `run-result.json` (mock `runContainer`) |

Manual verification (needs Docker + API key):
```bash
source .env && npm run build
node dist/cli/index.js benchmark \
  -p test-scan,examples/default \
  -t tasks/examples/hello-world.md,tasks/examples/hello-world-patterns.md \
  --parallel 2
node dist/cli/index.js report results/benchmark-<x> --compare results/benchmark-<y>
# regression: single run still works and still auto-updates results/report.md
node dist/cli/index.js run --task tasks/examples/hello-world.md --profile profiles/test-scan.yaml
```

---

## Implementation Order

1. **Commit Phase 6** (blocking precondition — working tree is dirty).
2. `pool.ts` + tests (isolated, no deps).
3. Extract `run-pipeline.ts` from `run.ts`; move `resolveProfilePath`/`resolveTaskPath` there; verify `npm test` + a real single run (regression gate — same console output as before).
4. `benchmark.ts` core (config schema, matrix, slugs) + tests.
5. `benchmark` CLI command + `benchmark.json` + report generation; manual run with parallel 2.
6. `comparison.ts` + tests; `report --compare` wiring.
7. Update `.claude/MVP_plan.md` Phase 7 checkboxes; run lint/build/tests.

## Risks & Notes

- **API rate limits**: N parallel runs multiply token throughput. Default `parallel: 1`; docs should suggest 2–4. Not adding backoff in Phase 7.
- **Ctrl-C during benchmark**: killing the CLI kills the `docker run` client processes; `--rm` containers stop with them in the common case, but orphaned containers are possible. Out of scope for Phase 7; note in README (Phase 8).
- **Timeout kill is soft**: existing `proc.kill('SIGTERM')` on the docker client may leave the container running. Pre-existing behavior, unchanged — worth a Phase 8 hardening pass (`docker run --name` + `docker kill`).
- **Model config sometimes ignored** (known issue from Phase 6 handoff): unchanged; benchmark results inherit this variance. Comparison reports may show model drift — the per-run `metrics.model` field is already captured if we want to surface it later.
- **Top-level `results/report.md`** won't include benchmark subdirectory runs (scanner is one level deep). Intentional: benchmark dirs are self-contained units with their own `report.md`.
