# hoodstrut

Benchmark real Claude Code configurations with reproducible, isolated test runs.

hoodstrut runs coding tasks against Claude Code inside disposable Docker
containers, captures real token/cost/duration metrics from the Agent SDK,
verifies changes against explicit test evidence, ranks repeated trials with
correctness-first statistics, and generates auditable Markdown reports.

**What makes it different:** point it at your *actual* `~/.claude` setup with
`hoodstrut profile scan` and benchmark the configuration you really use — not a
hypothetical one.

Hoodstrut is a public beta focused on Claude Code. The runner and result format
are usable today, but the bundled task corpus is still intentionally small and
the profile/task schemas may evolve before 1.0. See the [roadmap](ROADMAP.md).

---

## Prerequisites

- **Node.js ≥ 20**
- **Docker** — Docker Desktop (or a compatible engine) must be running. Every
  run executes in a throwaway container.
- **An Anthropic API key** as `ANTHROPIC_API_KEY`. hoodstrut reads it from a
  `.env` file in the current directory automatically (or from a real
  environment variable, which takes precedence) — no `source`/`export` needed.

Scaffolding and validation are offline. `run` and `benchmark` make paid
Anthropic API calls; repetitions multiply that usage.

---

## Install

Install the CLI from npm:

```bash
npm install --global hoodstrut
hoodstrut --version
```

To work from source instead:

```bash
git clone https://github.com/alexrowe12/hoodstrut.git
cd hoodstrut
npm ci
npm run build
npm link             # optional: puts `hoodstrut` on your PATH
```

Without `npm link`, invoke it as `node dist/cli/index.js <command>`.

---

## Quickstart

```bash
# 1. Create an empty project and scaffold the bundled examples.
mkdir hoodstrut-demo && cd hoodstrut-demo
hoodstrut init --with-examples

# 2. These checks are offline and do not require Docker or an API key.
hoodstrut profile validate profiles/examples/default.yaml
hoodstrut task validate tasks/examples/fix-todo-persistence.md

# 3. If you skipped the interactive key prompt, add your key by hand.
cp .env.example .env        # then edit .env and set ANTHROPIC_API_KEY

# 4. Optional: turn your real Claude Code setup into a profile.
hoodstrut profile scan --name my-setup

# 5. Run a real bugfix task. This starts Docker and uses the Anthropic API.
hoodstrut run \
  --profile profiles/examples/default.yaml \
  --task tasks/examples/fix-todo-persistence.md

# 6. Read the report.
cat results/report.md
```

The `fix-todo-persistence` task ships with a real example bug: the example todo-app
never writes todos to disk, so its persistence test fails until the assistant
fixes it. A no-op run **fails** — the benchmark actually discriminates.

---

## Commands

### `hoodstrut init`
Scaffold `profiles/`, `tasks/`, `benchmarks/`, `results/`, and a `.env.example`.
When run in an interactive terminal it also prompts for your `ANTHROPIC_API_KEY`
and writes it to `.env` (leave the prompt blank to skip; it's skipped
automatically when stdin isn't a TTY). It also creates or updates the root
`.gitignore` so `.env`, local environment files, results, and telemetry logs
cannot be committed accidentally. Existing files and ignore rules are preserved.

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
| `--repetitions <count>` | Independent runs per profile/task pair (default: 1) |
| `--parallel <count>` | Number of concurrent containers (default: 1) |
| `--name <name>` | Benchmark name (used in the output directory) |
| `--timeout <seconds>` | Per-run timeout override |
| `--telemetry <endpoint>` / `--telemetry-headers <headers>` | OTEL export |

Precedence is **flags > config > discovery**. With no flags or config,
hoodstrut discovers `./profiles/*.yaml` and `./tasks/**/*.md`. Results land in
`results/benchmark-<name>-<timestamp>/` with `benchmark.json` and `report.md`.

One repetition keeps quick starts inexpensive, but it cannot estimate variance
or support a winner claim. Use at least three repetitions while tuning a suite
and at least five before publishing comparative claims. Repetitions multiply
API usage: `profiles × tasks × repetitions` is the number of agent runs.

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
`scan` flags: `-n/--name`, `-p/--path <dir>`, `-o/--output` (default
`./profiles`), `--project`, `--dry-run`, and `--validate`. With no scope flags,
the scanner reads only user configuration from `~/.claude` and
`~/.claude.json`. `--path` replaces that user config directory exactly.
`--project` reads only the cwd project, while `--project --path <dir>` uses
`<dir>` as the exact project root. Scans never merge in configuration from a
different home directory or project.

Generated profiles snapshot complete skill directories beside the profile YAML.
MCP environment and header secrets are replaced with `${VAR}` references and
never copied into the YAML. Set every required variable in `.env` or the host
environment before running the profile.

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
Prints a colorized results matrix and correctness-first profile ranking, then
writes the same analysis to `report.md`. Repeated samples are aggregated by
task and profile with coverage, success confidence intervals, cost, duration,
and variance. `--compare` writes a side-by-side `comparison.md` and warns when
task sets, repetition counts, or result coverage are incompatible.

---

## Profile schema

Profiles are portable snapshots of behavior-affecting Claude Code configuration,
not copies of UI preferences such as theme or terminal settings. Hoodstrut
applies the profile on top of the benchmark repository without replacing the
repository's own Claude configuration. Fields (see `src/core/types.ts`):

```yaml
name: default                 # required, unique identifier
description: "..."            # optional
model: claude-sonnet-5        # required, model id (see src/metrics/pricing.ts)
effort: medium                # low | medium | high | max (default: medium)
system_prompt: |              # appended to the Claude Code system-prompt preset
  You are an expert engineer...
mcp_servers:                  # optional
  - name: filesystem
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem"]
    env: { TOKEN: "${TOKEN}" }
  - name: remote
    type: http
    url: https://example.com/mcp
    headers: { Authorization: "Bearer ${MCP_TOKEN}" }
skills:                       # optional
  - name: deploy
    source: my-profile.assets/skills/deploy # relative to this YAML
settings:                     # optional
  max_turns: 100
  timeout: 600                # seconds
  allowed_tools: ["Bash", "Edit"]       # SDK auto-approval rules
  disallowed_tools: ["WebFetch"]        # always denied
  env: { FOO: "bar" }
```

Profile values map directly to Agent SDK options: `model`, `effort`,
`maxTurns`, `allowedTools`, `disallowedTools`, and `mcpServers`. Runs use the
Claude Code system-prompt and tool presets; `system_prompt` is appended to that
preset. Skills are loaded from an isolated user config directory, while the
fixture's user-independent project and local instructions remain available.
`allowed_tools` does not restrict the available tool set; use
`disallowed_tools` to block tools.

Timeout precedence is CLI or benchmark override, then task timeout, then profile
timeout, then the 300-second default.

## Task schema

Tasks are Markdown with YAML frontmatter:

```yaml
---
id: fix-todo-persistence      # required
title: Todos don't persist    # required
repo: ./repos/todo-app        # required (local path or public git URL)
branch: main                  # mutable; default when commit is omitted
# commit: 0123456789abcdef0123456789abcdef01234567 # immutable alternative
# Explicit verification — required, pick one type:
verification:
  type: command               # command | pattern | ai_judge
  command: npm test           # exit 0 = success
timeout: 300                  # seconds (overrides profile)
working_dir: subdir           # working dir relative to repo root
setup_commands: ["npm install"]
tags: [bugfix, storage]
difficulty: easy              # easy | medium | hard | expert
estimated_tokens: 25000       # optional task metadata; not used for ranking
expected_time: 150            # optional task metadata; not used for ranking
---

## Description
Markdown body — written like a Jira ticket.
```

`branch` and `commit` are mutually exclusive. Published benchmark suites should
pin remote or local Git repositories with a full 40- or 64-character `commit`:

```yaml
repo: https://github.com/example/project.git
commit: 0123456789abcdef0123456789abcdef01234567
```

Hoodstrut fetches that object directly, checks it out detached, and verifies that
the resolved `HEAD` is an exact match. Branch-based tasks remain supported, but
branches are mutable; each run records the commit that the branch resolved to.
Plain local directories are working-tree snapshots and are identified by a
deterministic content checksum.

Pattern verification runs a command and matches only its output, never the
assistant conversation:

```yaml
verification:
  type: pattern
  command: node hello.js
  patterns: ["^Hello, World!$"]
  match: all                  # all (default) | any
```

AI judging requires both test evidence and explicit criteria. The judge receives
the repository patch, hashed file manifest, and evidence-command transcript:

```yaml
verification:
  type: ai_judge
  evidence_command: npm test
  criteria: |
    The due-date feature is wired through the public API and preserves existing behavior.
```

Legacy `success_command` tasks are normalized automatically. Legacy pattern-only
tasks must add a command because conversational claims are not verification.

---

## Benchmark methodology

Hoodstrut uses the versioned `lexicographic-v2` methodology. There is no blended
point score: correctness always dominates efficiency.

1. Rank complete profiles by verified passes, descending.
2. Break exact correctness ties by total cost per verified pass, ascending.
3. Break remaining ties by total duration per verified pass, ascending.

`passed`, `failed`, and `timed_out` are valid benchmark outcomes. Agent,
verifier, judge, metrics, and infrastructure errors are unusable samples. A
missing or unusable expected sample makes the affected profile ineligible and
prevents the benchmark from declaring a winner. Reports may still show a
provisional leader so partial data remains inspectable.

Success rates include Wilson 95% confidence intervals. Cost and duration report
sample variance, standard deviation, and a 95% confidence interval for the
mean when at least two samples exist. Hoodstrut declares a winner only when all
profiles are complete, there are multiple repetitions and competitors, and the
leader's relevant confidence interval does not overlap every competitor's.
Otherwise it reports an incomplete, tied, insufficient, or inconclusive result.

Legacy numeric `score` fields remain readable in historical result files but are
not produced, backfilled, or used by current rankings.

---

## Output layout

```
results/
├── run-<timestamp>/
│   ├── run-result.json   # outcome plus repository, image, runtime, and tool provenance
│   ├── stdout.log
│   ├── stderr.log
│   ├── changes.patch     # binary-safe diff of agent changes
│   ├── files-manifest.json # changed paths with before/after hashes
│   ├── metrics.json      # raw Agent SDK metrics
│   ├── verifier.log      # verification/evidence command transcript
│   └── judge-result.json # raw + parsed AI judgment, for judge tasks
├── report.md             # aggregate report across all runs
└── benchmark-<name>-<timestamp>/
    ├── benchmark.json     # expected coverage, statistics, eligibility, and decision
    ├── report.md
    └── comparison.md      # only when `report --compare` is used
```

`results/` is gitignored by default.

---

## How a run works

1. **Prepare** — copy a local working tree, resolve a branch, or fetch an exact commit into a normalized source snapshot. Record the resolved commit and a checksum before setup changes it. Source Git metadata is not reused; `.gitignore`, `.github`, and other project files are preserved.
2. **Build** — build a content-addressed `hoodstrut-runner:<version>-<hash>` image from digest-pinned Node, frozen Debian repositories, and npm lockfiles. Unchanged build inputs reuse the cached image.
3. **Configure** — materialize profile skills and a non-secret runtime config in an isolated Claude home; leave fixture configuration untouched.
4. **Set up** — run `setup_commands`, then commit the configured workspace as a clean benchmark-owned Git baseline.
5. **Execute** — run via the Agent SDK with explicit profile options and the Claude Code prompt/tool presets.
6. **Capture** — retain a binary-safe patch and hashed file manifest before verifier-generated files can alter the workspace evidence.
7. **Verify** — run the required verification command, match patterns only against its transcript, or give the patch and test evidence to the AI judge.
8. **Cleanup** — force-remove the containers and temporary workspace (containers are named `hoodstrut-*`).

Metrics always come from the Agent SDK response. The `--telemetry` flag only
adds OTEL export for your own observability backend; it does not affect metrics.
Hoodstrut-owned metrics and telemetry files live outside the measured workspace
and are never reported as agent changes.

### Reproducibility metadata

Every new `run-result.json` contains a `provenance` object with:

- Hoodstrut version and the SHA-256 of all runner build inputs.
- Actual Docker image ID, image tag, platform, and Docker Engine/API versions.
- Requested branch or commit, resolved commit, immutability status, and prepared-tree checksum.
- Node, npm, Git, Python, Claude Code, and Agent SDK versions observed inside the image.

For the strongest comparison, require matching runner build hashes, repository
content hashes, platforms, and tool versions. A matching image tag alone is not
treated as proof: Hoodstrut validates the image labels and records its actual ID.

---

## Troubleshooting

- **`metrics: null` / "Metrics file not found"** — the SDK didn't produce usage
  data. Common cause: the profile's `model` is one your API key can't access.
  Check the profile's `model`, your key's entitlements, and the retained stderr.
- **"Not logged in" / auth errors** — `ANTHROPIC_API_KEY` isn't set. Make sure
  it's in a `.env` file in the directory you're running from (hoodstrut loads it
  automatically), or exported in your shell.
- **`Profile "..." requires VAR for MCP server "..."`** — a scanned MCP server
  references an environment variable that is not available. Add it to the
  current project's `.env` file or export it in the host environment. Do not put
  the literal secret in the profile YAML.
- **Docker errors** — ensure the daemon is running (`docker ps`). Runner asset
  changes automatically produce a new content-addressed tag; use `--build` to
  force a clean rebuild of the current inputs.
- **Leftover containers** — hoodstrut names containers `hoodstrut-*` and
  force-removes them, including on Ctrl-C. If you kill it with `SIGKILL`, sweep
  with `docker ps -a --filter name=hoodstrut- -q | xargs docker rm -f`.

---

## Development

```bash
npm run check         # lint, typecheck, unit tests, clean build, artifact checks
npm run test:package  # install the packed tarball and run the offline quickstart
npm run test:docker   # build the runner and run Docker integration tests
npm run test:watch    # re-run unit tests on change
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report
suspected vulnerabilities through the private process in
[SECURITY.md](SECURITY.md). Maintainer release steps are in
[RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE)
