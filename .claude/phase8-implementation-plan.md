# Phase 8 Implementation Plan — Example Content & Polish

**Date**: 2026-07-11
**Author**: prep for implementation (post-Phase 7)
**Status**: Planned. Phases 1–7 complete and committed (`2516ece`). Working tree clean.

## Goal

Make hoodstrut usable and credible out of the box: a real example app whose
flagship task can actually be passed or failed, a working `init` command that
scaffolds a usable project, correct model defaults, honest metrics (the SDK must
actually run the configured model), no leaked containers, and real docs.

Completes MVP success criteria #7 (examples runnable out of the box) and #8
(README explains install/config/usage), and closes the two correctness bugs
flagged in the Phase 7 handoff.

## Confirmed decisions (from Alex, 2026-07-11)

1. **Todo-app**: rebuild into a real app with file-based storage, an API layer,
   and a test that genuinely **fails until the persistence bug is fixed**.
2. **`init --with-examples`**: bundle example content in the npm package and copy
   it out — must work via `npx hoodstrut init` in an arbitrary empty directory.
3. **README**: full docs (install, quickstart, all commands, schemas, scoring,
   prerequisites, troubleshooting).
4. **Hardening**: fix **both** pre-existing bugs — SDK ignoring the profile model,
   and SIGTERM orphaning `--rm` containers.

---

## Workstream A — Correctness fixes (do FIRST; examples depend on these)

These gate everything else. If the model isn't honored and models IDs are stale,
every example run is either invalid or fails instantly.

### A1. Model-selection bug (SDK ignores profile model)

**Root cause**: `src/docker/scripts/run-sdk.mjs:79-82` passes the model as
`sdkOptions.settings = { model: ... }`. The Agent SDK's `query()` selects the
model from a **top-level `options.model`** field; `settings` is not an inline
model carrier. Result: the profile model is dropped and the SDK uses its default
routing (observed: an opus-configured profile ran haiku).

**Fix**:
- In `run-sdk.mjs`, set `sdkOptions.model = process.env.ANTHROPIC_MODEL` (top
  level) instead of `sdkOptions.settings = { model }`. Keep the log line.
- **Verify against the installed SDK** before finalizing: read
  `node_modules/@anthropic-ai/claude-agent-sdk` type defs to confirm the exact
  option name (`model`, and whether `fallbackModel` exists). Do NOT guess — the
  whole point is that the wrong field name is the current bug.
- Decide whether to keep `ANTHROPIC_MODEL` env + `.claude/settings.local.json`
  `model` as belt-and-suspenders. Keep them (harmless, helps the bundled CLI),
  but the top-level option is the authoritative fix.
- Re-check `effortLevel` in `config-injector.ts:33` — confirm that's a real
  Claude Code settings key; if not, either map it correctly or drop it so we're
  not writing dead config. (Lower priority; note in code if unverified.)

**Verification**: run a single `run` with an opus profile and a haiku profile
against `hello-world`; assert `metrics.model` in `run-result.json` matches the
profile in each case. This is the acceptance test for A1.

### A2. Stale model IDs (breaks the headline `profile scan` feature + examples)

Stale IDs (`claude-sonnet-4-20250514`, `claude-opus-4-20250514`) appear in:
- `src/scanner/profile-generator.ts:24,28,29` — **this is a real bug**: scanned
  profiles (feature #1) are pinned to models the current key may not access.
- `profiles/examples/default.yaml:3`, `profiles/examples/aggressive.yaml:3`.
- `profiles/test-scan.yaml:6` (smoke artifact — see A2b).

**Fix**:
- Update `profile-generator.ts` alias map + fallback to current IDs:
  `opus` → `claude-opus-4-8`, `sonnet` → `claude-sonnet-5`,
  `haiku` → `claude-haiku-4-5-20251001`; default → `claude-sonnet-5`.
- Update example profiles: `default.yaml` → `claude-sonnet-5`,
  `aggressive.yaml` → `claude-sonnet-5` (or opus if we want the demo to contrast
  cost — see Open Questions). Pricing table already knows all current IDs, so
  cost/score stay correct.
- Leave the legacy IDs in `MODEL_PRICING` (back-compat) — no change there.
- Test fixtures under `src/**/__tests__` that use old IDs are arbitrary strings
  the schema accepts; **do not churn them** unless a test asserts a specific
  generated value. Only `scanner/__tests__/profile-generator.test.ts` asserts
  generated model IDs — update those expected values to match the new map.

**A2b. `profiles/test-scan.yaml`**: this is a personal smoke-test artifact
(references `/Users/alexrowe/.claude`). **Delete it** from the repo and update
`benchmarks/example-suite.yaml` / any docs that reference `test-scan`. It is not
curated example content and pins a personal path.

### A3. Container-orphan / timeout hardening

**Root causes** in `src/docker/executor.ts`:
- Line 202: `containerId = docker-${proc.pid}` is fabricated — the real
  container ID is never captured, so `cleanup()` (line 385) can never target it.
- Lines 156-162 + 207-209: `docker run --rm` + `proc.kill('SIGTERM')` on
  **timeout** kills the docker *client*, not the container. With `--rm`, the
  container keeps running; nothing removes it. Ctrl-C during a benchmark leaks
  every in-flight container the same way.

**Fix**:
- Give each run a deterministic name: `--name hoodstrut-<short-uuid>` in
  `buildDockerArgs`. Thread the name back so it's the real handle.
- On timeout, run `docker kill <name>` (then `docker rm -f <name>` for safety);
  don't rely on killing the client. Record that the run timed out so the result
  reflects it (exit code / warning), rather than looking like a clean failure.
- Maintain a module-level `Set<string>` of active container names. Install one
  process-level `SIGINT`/`SIGTERM` handler (idempotent) that best-effort
  `docker rm -f` every active name before exiting — this covers Ctrl-C during
  `benchmark` with `--parallel N`.
- Keep `--rm` for the happy path (auto-cleanup on normal exit).

**Verification**: start a run with a 5s timeout on a task that sleeps; confirm
`docker ps -a` shows no leftover `hoodstrut-*` container afterward. Ctrl-C a
2-container benchmark mid-run; confirm no orphans.

---

## Workstream B — Example content

### B1. Rebuild `repos/todo-app` into a real, testable app

**Why**: current app is a 24-line in-memory stub (`src/index.js` = `const todos = []`).
`test.js` only checks in-memory add/list, so `fix-todo-persistence`'s
`success_command: npm test` **passes with zero changes** — the flagship task
cannot discriminate a real fix. This is the single biggest credibility gap.

**Target shape** (keep dependency-free — plain Node, `node --test` or the
existing lightweight test harness — so the Docker image needs no extra install):
```
repos/todo-app/
├── package.json         # scripts: test, start; type module or cjs (pick one, be consistent)
├── src/
│   ├── index.js         # CLI/entry
│   ├── todo.js          # add/list/complete logic
│   ├── storage.js       # file-based persistence (the buggy unit)
│   └── api.js           # thin function API surface
├── test/
│   ├── todo.test.js
│   └── persistence.test.js   # FAILS until the bug is fixed
└── README.md
```

**The seeded bug (must be genuine and test-detectable)**:
- `storage.js` has a `save()` that (e.g.) writes to a temp path but `load()`
  reads a different/absent path — or `save()` is never called on mutation — so
  todos are lost across a fresh process.
- `persistence.test.js` writes todos via one module instance, then re-requires /
  spawns a fresh load and asserts they're still present. **Red until fixed.**
- `todo.test.js` (basic CRUD) stays green throughout, so a broken "fix" that
  regresses CRUD is also caught.
- Verify locally: `npm test` in a clean `repos/todo-app` **exits non-zero**
  before any fix, and exits 0 after the intended one-file fix. If it passes
  before the fix, the task is still a dud — this is the acceptance gate for B1.

**Difficulty calibration**: keep the fix genuinely "easy" (one wrong path / one
missing call) so a competent run succeeds and a weak run plausibly fails —
that's what makes the benchmark discriminate.

### B2. Example tasks (align to the rebuilt app)

- **`fix-todo-persistence.md`** (flagship, `success_command: npm test`, easy) —
  now actually verifiable. Keep the Jira-ticket tone; keep the notes vague.
- **`add-due-dates.md`** (NEW, medium, `success_command: npm test`) — from the
  MVP plan; ships with a test the agent must make pass (add optional due date +
  filter). Demonstrates a feature-add, not just a bugfix.
- **Keep** `add-feature-ai-judge.md` (exercises the AI-judge path — judge model
  is already `claude-sonnet-5`, good) but re-point/reword to the rebuilt app.
- **hello-world / hello-world-patterns**: these are smoke tests, not showcase
  content. Move them out of `tasks/examples/` into something like
  `tasks/smoke/` (or drop from the curated set) so `init` examples are all
  "realistic ticket" tasks. Keep at least one for pattern-match coverage docs.
- Ensure every example task's `success_command` is actually satisfiable inside
  the container against the bundled repo (no external network, no missing deps).

### B3. Example profiles

- `default.yaml` (sonnet-5, medium) and `aggressive.yaml` (sonnet-5 or opus,
  high, custom prompt) — updated per A2.
- Consider adding a third contrasting profile (e.g. `haiku` fast/cheap) so the
  benchmark comparison output is interesting out of the box. Optional; see Open
  Questions.
- `benchmarks/example-suite.yaml`: update task/profile lists to the curated set
  above; drop `test-scan` and any hello-world references if those move.

---

## Workstream C — `init` command + packaging

### C1. Packaging fix (blocks C2 for published/`npx` use)

- `package.json` has **no `files` field** and `dist/` is gitignored. `npm pack`
  falls back to `.gitignore`, so `dist/` (the compiled `bin`) is **excluded** —
  a published package would have a broken `hoodstrut` binary and no bundled
  examples. Fix by adding:
  ```json
  "files": ["dist", "profiles/examples", "tasks/examples", "repos/todo-app", "benchmarks/example-suite.yaml", "README.md"]
  ```
  (adjust to final curated paths). This makes the example content the single
  source of truth that both the repo and the bundled CLI use — no duplication.
- Sanity-check with `npm pack --dry-run` that `dist/cli/index.js` and the example
  dirs are in the tarball.

### C2. Implement `init` (replace the stub at `src/cli/commands/init.ts`)

Current file is a stub that prints "Phase 6". Implement:
- `hoodstrut init` — create `profiles/`, `tasks/`, `benchmarks/`, `results/`
  (with `.gitkeep`), and a starter `.env.example` (documents `ANTHROPIC_API_KEY`,
  and the `set -a && source .env && set +a` gotcha in a comment). Do **not**
  overwrite existing files; report what was created vs skipped.
- `hoodstrut init --with-examples` — additionally copy the bundled example
  profiles, tasks, `repos/todo-app`, and `benchmarks/example-suite.yaml` into the
  cwd.
- **Resolving bundled content**: from `dist/cli/commands/init.js`, resolve the
  package root via `fileURLToPath(import.meta.url)` → up three levels, then read
  the bundled example dirs listed in `files`. Must work both from a git checkout
  (`node dist/...`) and an installed package (`npx hoodstrut`). Add an explicit
  check + clear error if bundled examples aren't found (helps diagnose packaging
  regressions).
- Idempotent and safe: never clobber; print a summary table (created / skipped).
- Wire is already done in `src/cli/index.ts:22` — just the action changes.

**Verification**: run `hoodstrut init --with-examples` in an empty temp dir
(both from checkout and from `npm pack` tarball install), then run the wow-demo
end-to-end from that dir.

---

## Workstream D — README & full docs

Replace the 1-line `README.md`. Sections:
1. **What it is** + the differentiator (test YOUR real setup via `profile scan`).
2. **Prerequisites**: Node ≥20, Docker Desktop running, `ANTHROPIC_API_KEY`.
   Call out the two gotchas explicitly: `.env` has no `export` → use
   `set -a && source .env && set +a`; `npm test` runs vitest in **watch** mode →
   use `npm run test:run`.
3. **Install / build**: clone + `npm install` + `npm run build` (+ `npm link`
   for a global `hoodstrut`), and the eventual `npx hoodstrut` path.
4. **Quickstart / the wow demo**: `init --with-examples` → `profile scan` →
   `run` → read `results/.../report.md`. Show real, current commands.
5. **Commands reference**: `run`, `benchmark` (incl. `--parallel`, `--config`),
   `profile` (+ `scan`), `task`, `report` (+ `--compare`), `init`. Match actual
   implemented flags — audit each command file, don't copy the MVP plan's
   aspirational flag lists.
6. **Profile schema** and **Task schema** — generated from the Zod schemas in
   `src/core/types.ts` so they're accurate (not the MVP-plan wishlist).
7. **Scoring** explanation (cost-based + difficulty multipliers; point at
   `src/core/scorer.ts`).
8. **Output layout**: `results/run-*/` and `results/benchmark-*/` contents,
   `report.md`, `comparison.md`.
9. **Troubleshooting**: model-access errors, Docker not running, metrics `null`
   warnings, container cleanup.
10. **Roadmap** (link phases) + **License** (MIT, per package.json).

Keep it honest: document only what's implemented; mark clearly-future items as
future. Verify every command block by running it.

---

## Sequencing

1. **A1 + A2 + A3** (correctness) — nothing downstream is trustworthy until the
   configured model actually runs, IDs are current, and containers don't leak.
2. **B1** (rebuild todo-app) — verify the fail→fix gate locally before wiring
   tasks.
3. **B2 + B3** (tasks/profiles/suite) against the rebuilt app.
4. **C1 → C2** (packaging then init).
5. **D** (README) last, so every documented command reflects final behavior.
6. Full end-to-end verification pass (below), then commit.

## Verification / acceptance (run before commit)

Env: `set -a && source .env && set +a`. Docker up. One-shot tests:
`npm run test:run` (not `npm test`), `npm run lint`, `npm run typecheck`.

End-to-end (real Docker, costs tokens):
- A1: opus vs haiku profile on `hello-world` → `metrics.model` matches each.
- B1: `npm test` in fresh `repos/todo-app` fails; after the intended fix, passes.
- Wow-demo from a clean `init --with-examples` dir:
  `run --profile default --task fix-todo-persistence` → real success, non-null
  metrics, score, `report.md`.
- `benchmark --config benchmarks/example-suite.yaml --parallel 2` → completes,
  writes `benchmark.json` + `report.md`; Ctrl-C mid-run leaves **no** orphaned
  `hoodstrut-*` containers (`docker ps -a`).
- `npm pack --dry-run` includes `dist/cli/index.js` + example dirs; install the
  tarball in a temp dir and run `hoodstrut init --with-examples` + the wow-demo.

Update `.claude/MVP_plan.md` Phase 8 checkboxes as items land.

## Risks & honest caveats

- **Every e2e verification burns real tokens.** Budget for it; the model bug (A1)
  specifically can only be confirmed with live runs.
- **A1 fix depends on the installed SDK's option shape** — must read the SDK
  types, not assume. If the SDK genuinely has no top-level `model` option in the
  pinned version, fall back to whatever the types expose and document it.
- **`--with-examples` copies a whole `repos/todo-app`** into the user's cwd;
  make sure `.gitkeep`/`results/` handling doesn't dump large artifacts.
- **Container-name registry + signal handler** must be idempotent and not
  swallow the real exit code; get the ordering right so normal `--rm` cleanup
  still wins on the happy path.
- Scope creep risk on the todo-app: keep it minimal-but-real. A sprawling example
  app is not the goal; a *discriminating* one is.

## Open questions (non-blocking — will default if unanswered)

1. **Aggressive profile model**: keep on sonnet-5, or make it opus-4-8 so the
   example benchmark visibly contrasts cost/score? Default: sonnet-5 for both,
   add an optional `haiku` profile for cheap contrast.
2. **hello-world tasks**: move to `tasks/smoke/` vs delete. Default: move (keep
   one pattern-match example for docs).
3. **todo-app module system**: CJS (matches current) vs ESM. Default: keep CJS to
   minimize churn and Docker surprises.
