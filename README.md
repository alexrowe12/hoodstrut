# hoodstrut

Benchmark LLM coding assistants with reproducible, isolated test runs.

hoodstrut runs coding tasks against Claude Code inside disposable Docker
containers, captures real token/cost/duration metrics from the Agent SDK,
determines success (command exit code, output patterns, or an AI judge), scores
each run, and generates Markdown reports.

**What makes it different:** point it at your *actual* `~/.claude` setup with
`hoodstrut profile scan` and benchmark the configuration you really use — not a
hypothetical one.

---

## Prerequisites

- **Node.js ≥ 20**
- **Docker** — Docker Desktop (or a compatible engine) must be running. Every
  run executes in a throwaway container.
- **An Anthropic API key** as `ANTHROPIC_API_KEY`. hoodstrut reads it from a
  `.env` file in the current directory automatically (or from a real
  environment variable, which takes precedence) — no `source`/`export` needed.

> **Gotcha — running tests:** `npm test` runs vitest in **watch** mode (never
> exits). Use `npm run test:run` for a one-shot run.

---

## Install

hoodstrut is a TypeScript CLI. From a clone:

```bash
git clone <repo-url> hoodstrut
cd hoodstrut
npm install
npm run build        # compiles to dist/ and copies the Docker assets
npm link             # optional: puts `hoodstrut` on your PATH
```

Without `npm link`, invoke it as `node dist/cli/index.js <command>`.

---

## Quickstart (the wow demo)

```bash
# 1. Scaffold a project with runnable examples in the current directory.
#    init prompts for your ANTHROPIC_API_KEY and writes it to .env for you.
hoodstrut init --with-examples

# 2. (only if you skipped the prompt) add your key by hand
cp .env.example .env        # then edit .env and set ANTHROPIC_API_KEY

# 3. Optional: turn your real Claude Code setup into a profile
hoodstrut profile scan --name my-setup

# 4. Run a real bugfix task and see how the config performs
hoodstrut run \
  --profile profiles/examples/default.yaml \
  --task tasks/examples/fix-todo-persistence.md

# 5. Read the report
cat results/report.md
```

The `fix-todo-persistence` task ships with a genuine bug: the example todo-app
never writes todos to disk, so its persistence test fails until the assistant
fixes it. A no-op run **fails** — the benchmark actually discriminates.

---

## Commands

### `hoodstrut init`
Scaffold `profiles/`, `tasks/`, `benchmarks/`, `results/`, and a `.env.example`.
When run in an interactive terminal it also prompts for your `ANTHROPIC_API_KEY`
and writes it to `.env` (leave the prompt blank to skip; it's skipped
automatically when stdin isn't a TTY). Never overwrites existing files.

| Flag | Description |
|------|-------------|
| `--with-examples` | Also copy the example profiles, tasks, and the todo-app repo |

### `hoodstrut run`
Execute a single profile against a single task.

| Flag | Description |
|------|-------------|
| `-p, --profile <profile>` | **(required)** Profile name or path |
| `-t, --task <task>` | **(required)** Task ID or path |
| `-o, --output <dir>` | Output directory for results |
| `-v, --verbose` | Stream detailed container output |
| `--timeout <seconds>` | Override the task/profile timeout |
| `--build` | Force a rebuild of the Docker runner image |
| `--telemetry <endpoint>` | Export OTEL traces/metrics to a collector |
| `--telemetry-headers <headers>` | OTEL auth headers, e.g. `"x-honeycomb-team=KEY"` |

Bare names resolve against `./profiles/<name>.yaml` and `./tasks/<id>.md`;
paths are used as-is.

### `hoodstrut benchmark`
Run multiple profiles against multiple tasks (cartesian product).

| Flag | Description |
|------|-------------|
| `-p, --profiles <list>` | Comma-separated profile names or paths |
| `-t, --tasks <list>` | Comma-separated task IDs or paths |
| `-c, --config <file>` | Benchmark YAML config file |
| `--parallel <count>` | Number of concurrent containers (default: 1) |
| `--name <name>` | Benchmark name (used in the output directory) |
| `--timeout <seconds>` | Per-run timeout override |
| `--telemetry <endpoint>` / `--telemetry-headers <headers>` | OTEL export |

Precedence is **flags > config > discovery**. With no flags or config,
hoodstrut discovers `./profiles/*.yaml` and `./tasks/**/*.md`. Results land in
`results/benchmark-<name>-<timestamp>/` with `benchmark.json` and `report.md`.

The benchmark exits `0` when orchestration completes — individual task failures
are data, not errors. It exits `1` only on a config/infrastructure failure.

```bash
hoodstrut benchmark --config benchmarks/example-suite.yaml --parallel 2
```

### `hoodstrut profile`
```bash
hoodstrut profile list                     # list profiles in ./profiles
hoodstrut profile show default             # show a profile's details
hoodstrut profile validate ./my.yaml       # validate against the schema
hoodstrut profile scan --name my-setup     # import your ~/.claude config
```
`scan` flags: `-n/--name`, `-p/--path <dir>` (default `~/.claude`), `-o/--output`
(default `./profiles`), `--project` (scan `.claude/` in the cwd), `--dry-run`,
`--validate`. Environment variables are referenced (`${VAR}`), never copied.

### `hoodstrut task`
```bash
hoodstrut task list                        # list tasks in ./tasks
hoodstrut task show fix-todo-persistence   # show a task's details
hoodstrut task validate ./my-task.md       # validate against the schema
```

### `hoodstrut report`
```bash
hoodstrut report ./results                          # (re)generate report.md
hoodstrut report ./results/benchmark-x --compare ./results/benchmark-y
```
`--compare` writes a side-by-side `comparison.md` with signed deltas
(success rate, cost, tokens, score).

---

## Profile schema

Profiles are YAML. Fields (see `src/core/types.ts` for the source of truth):

```yaml
name: default                 # required, unique identifier
description: "..."            # optional
model: claude-sonnet-5        # required, model id (see src/metrics/pricing.ts)
effort: medium                # low | medium | high (default: medium)
system_prompt: |              # optional, written to CLAUDE.md in the container
  You are an expert engineer...
mcp_servers:                  # optional
  - name: filesystem
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem"]
    env: { KEY: "value" }
skills:                       # optional
  - name: deploy
    source: /path/to/SKILL.md
settings:                     # optional
  max_turns: 100
  timeout: 600                # seconds
  allowed_tools: ["Bash", "Edit"]
  env: { FOO: "bar" }
```

## Task schema

Tasks are Markdown with YAML frontmatter:

```yaml
---
id: fix-todo-persistence      # required
title: Todos don't persist    # required
repo: ./repos/todo-app        # required (local path or public git URL)
branch: main                  # default: main
# Success determination — pick one:
success_command: npm test     # exit 0 = success
success_patterns:             # any regex match in output = success
  - "Hello.*World"
ai_judge: true                # let an AI judge decide
ai_judge_criteria: |          # criteria for the judge
  The task is successful if...
timeout: 300                  # seconds (overrides profile)
working_dir: subdir           # working dir relative to repo root
setup_commands: ["npm install"]
tags: [bugfix, storage]
difficulty: easy              # easy | medium | hard | expert
estimated_tokens: 25000       # scoring baseline (default: 25000)
expected_time: 150            # seconds, scoring baseline (default: 150)
---

## Description
Markdown body — written like a Jira ticket.
```

---

## Scoring

Each run with metrics gets a numeric score (runs with no metrics score `null`):

```
score = round( (success_bonus + cost_score + time_score) * difficulty_multiplier )

success_bonus         = 500 if success else 0
cost_score            = max(0, 300 - 100 * actual_cost / expected_cost)
time_score            = max(0, 200 - 100 * actual_time / expected_time)
difficulty_multiplier = easy 0.8 | medium 1.0 | hard 1.3 | expert 1.6
```

`expected_cost` is derived from the task's `estimated_tokens` (40% input / 60%
output) priced at the profile's model. So a cheaper, faster, successful run on a
harder task scores highest. See `src/core/scorer.ts`.

---

## Output layout

```
results/
├── run-<timestamp>/
│   ├── run-result.json   # metrics, success, score, file changes, warnings
│   ├── stdout.log
│   └── stderr.log
├── report.md             # aggregate report across all runs
└── benchmark-<name>-<timestamp>/
    ├── benchmark.json     # summary + per-run results
    ├── report.md
    └── comparison.md      # only when `report --compare` is used
```

`results/` is gitignored by default.

---

## How a run works

1. **Prepare** — copy the local repo (or `git clone` a public URL) into a temp workspace.
2. **Build** — build the `hoodstrut-runner` Docker image once (cached across runs).
3. **Configure** — inject the profile (CLAUDE.md, `.claude/settings.local.json`, `.mcp.json`, skills).
4. **Execute** — run Claude Code via the Agent SDK inside the container.
5. **Capture** — stream stdout/stderr to files; read metrics from the SDK result.
6. **Verify** — run `success_command` / match patterns / call the AI judge.
7. **Cleanup** — force-remove the container (containers are named `hoodstrut-*`).

Metrics always come from the Agent SDK response. The `--telemetry` flag only
adds OTEL export for your own observability backend; it does not affect metrics.

---

## Troubleshooting

- **`metrics: null` / "Metrics file not found"** — the SDK didn't produce usage
  data. Common cause: the profile's `model` is one your API key can't access.
  Check `model` against `src/metrics/pricing.ts` and your key's entitlements.
- **"Not logged in" / auth errors** — `ANTHROPIC_API_KEY` isn't set. Make sure
  it's in a `.env` file in the directory you're running from (hoodstrut loads it
  automatically), or exported in your shell.
- **Docker errors** — ensure the daemon is running (`docker ps`). Use `--build`
  to force an image rebuild after changing the Docker assets.
- **Leftover containers** — hoodstrut names containers `hoodstrut-*` and
  force-removes them, including on Ctrl-C. If you kill it with `SIGKILL`, sweep
  with `docker ps -a --filter name=hoodstrut- -q | xargs docker rm -f`.

---

## Development

```bash
npm run build       # compile + copy Docker assets to dist/
npm run test:run    # one-shot tests (NOT `npm test`, which watches)
npm run lint
npm run typecheck
```

See `.claude/MVP_plan.md` for the full vision and phase history.

## License

MIT
