# hoodstrut MVP Plan

> An open-source benchmarking tool for comparing LLM coding assistant configurations with reproducible, isolated test runs.

## Vision

There's no consistent, repeatable technology for measuring how different model setups burn tokens. Existing benchmarks are convoluted, unclear in their setup, and not customizable to a user's specific needs.

**hoodstrut** solves this by providing:
- **Auto-scanning of existing setups**: Point at your `~/.claude` folder and instantly create a testable profile
- Hotswappable "profiles" with configurable model, system prompt, effort level, MCP servers, and skills
- Isolated Docker execution for reproducible results
- Realistic task definitions (like Jira tickets, not synthetic benchmarks)
- Token/cost tracking with a scoring system for competitive benchmarking
- Easy bring-your-own-tasks against your own repositories

**Key differentiator**: Unlike other benchmarking tools, hoodstrut lets you test YOUR actual setup—not hypothetical configurations. Scan your real Claude Code config, run it against tasks, and see exactly how it performs.

---

## MVP Scope

### In Scope
- **CLI Tool**: Claude Code only (other tools in future releases)
- **Interface**: CLI only (TypeScript/Node.js)
- **Isolation**: Docker containers
- **Profiles**: Full configuration (model, system prompt, effort, MCP, skills)
- **Profile Scanning**: Auto-detect and import user's existing Claude Code setup
- **Tasks**: Markdown files mimicking Jira tickets
- **Metrics**: Tokens, success/fail, time, cost, rudimentary score
- **Output**: JSON results + Markdown summary reports
- **Example Content**: Sample tasks + toy repository for immediate testing

### Out of Scope (Future)
- Support for Codex CLI, Copilot CLI, Gemini CLI
- Web dashboard for results visualization
- Cloud execution / distributed runs
- CI/CD integrations
- Leaderboard / community task sharing

---

## Core Concepts

### Profile
A complete configuration for how Claude Code should be set up for a run:

```yaml
# profiles/aggressive-coder.yaml
name: aggressive-coder
description: "High effort, minimal guardrails"

model: claude-sonnet-4-20250514
effort: high
system_prompt: |
  You are an expert software engineer. Be concise and direct.
  Prioritize working code over explanations.

mcp_servers:
  - name: filesystem
    command: npx
    args: ["-y", "@anthropic/mcp-server-filesystem"]

skills:
  - name: test-runner
    path: ./skills/test-runner.md
```

### Profile Scanning (Key Feature)

The core differentiator: **automatically scan a user's actual Claude Code setup** and convert it into a hoodstrut profile. No manual YAML writing required.

```bash
# Scan default Claude Code config location
hoodstrut profile scan

# Scan specific directory
hoodstrut profile scan --path ~/.claude

# Scan and save with a name
hoodstrut profile scan --name "my-current-setup"

# Scan multiple setups for comparison
hoodstrut profile scan --path ~/.claude --name "work-setup"
hoodstrut profile scan --path ~/personal/.claude --name "personal-setup"
```

**What gets scanned:**

| Source | What We Extract |
|--------|-----------------|
| `~/.claude/settings.json` | Model preferences, effort level, allowed/denied tools |
| `~/.claude/settings.local.json` | Local overrides |
| `~/.claude/.clauderc` | Project-specific settings |
| `~/.claude/mcp_servers.json` | MCP server configurations |
| `~/.claude/CLAUDE.md` | Custom system prompt / instructions |
| `~/.claude/commands/` | Custom slash commands (skills) |
| Environment variables | `ANTHROPIC_MODEL`, `CLAUDE_CODE_*` vars |

**Scan output:**

```yaml
# Generated profile: my-current-setup.yaml
# Scanned from: /Users/alex/.claude
# Scanned at: 2025-01-15T10:30:00Z

name: my-current-setup
description: "Auto-generated from ~/.claude"
source: scanned
source_path: /Users/alex/.claude

model: claude-sonnet-4-20250514
effort: high

system_prompt: |
  # Imported from ~/.claude/CLAUDE.md
  You are a senior engineer at Acme Corp...

mcp_servers:
  - name: github
    command: npx
    args: ["-y", "@anthropic/mcp-server-github"]
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"  # Reference, not value
  - name: filesystem
    command: npx
    args: ["-y", "@anthropic/mcp-server-filesystem"]

skills:
  - name: deploy
    source: /Users/alex/.claude/commands/deploy.md
```

**Important considerations:**

1. **No secrets captured**: Environment variables are referenced (`${VAR}`), not copied
2. **Diff-able**: Generated profiles are clean YAML that can be version-controlled
3. **Editable**: Users can tweak the scanned profile before benchmarking
4. **Reproducible**: Profile includes `source_path` and timestamp for traceability

### Task
A realistic work item defined in Markdown, similar to a Jira ticket:

```markdown
<!-- tasks/fix-auth-bug.md -->
---
id: fix-auth-bug
title: Fix authentication timeout issue
repo: https://github.com/example/webapp
# OR for local: repo: ./my-local-project
branch: main
success_command: npm test
timeout: 300  # seconds
tags: [bugfix, auth, backend]
---

## Description

Users are reporting intermittent logouts. The session seems to expire
earlier than the configured 24-hour timeout.

## Acceptance Criteria

- Sessions should persist for 24 hours of inactivity
- Add logging to track session lifecycle
- Existing tests should pass

## Notes

Check the Redis session store configuration. Might be a TTL mismatch.
```

### Run
A single execution of one profile against one task. Produces:
- Execution logs
- Token consumption metrics
- Time elapsed
- Success/failure determination
- Cost estimate
- Score (rudimentary)

### Benchmark
A collection of runs: one or more profiles against one or more tasks.

---

## Architecture Overview

```
hoodstrut/
├── src/
│   ├── cli/              # CLI entry point and commands
│   │   ├── index.ts
│   │   ├── commands/
│   │   │   ├── run.ts        # Run single profile/task
│   │   │   ├── benchmark.ts  # Run full benchmark suite
│   │   │   ├── profile.ts    # Manage profiles
│   │   │   ├── task.ts       # Manage tasks
│   │   │   └── report.ts     # Generate reports
│   │   └── utils/
│   ├── core/
│   │   ├── profile.ts        # Profile parsing/validation
│   │   ├── task.ts           # Task parsing/validation
│   │   ├── runner.ts         # Orchestrates Docker execution
│   │   ├── metrics.ts        # Token/cost/time tracking
│   │   ├── scorer.ts         # Scoring algorithm
│   │   └── judge.ts          # AI judge for success evaluation
│   ├── scanner/
│   │   ├── index.ts          # Main scanner orchestration
│   │   ├── claude-config.ts  # Parse Claude Code settings.json
│   │   ├── mcp-config.ts     # Parse MCP server configurations
│   │   ├── prompts.ts        # Extract CLAUDE.md and custom prompts
│   │   ├── skills.ts         # Discover custom commands/skills
│   │   └── env.ts            # Environment variable detection
│   ├── docker/
│   │   ├── executor.ts       # Docker container management
│   │   ├── templates/        # Dockerfile templates
│   │   └── scripts/          # Scripts run inside container
│   └── output/
│       ├── json.ts           # JSON output formatter
│       └── markdown.ts       # Markdown report generator
├── profiles/                 # User profile definitions
│   └── examples/
├── tasks/                    # User task definitions
│   └── examples/
├── repos/                    # Example repositories for testing
│   └── todo-app/             # Simple example app
├── results/                  # Output directory for run results
├── docker/
│   └── Dockerfile.runner     # Base image for task execution
├── package.json
├── tsconfig.json
└── README.md
```

---

## CLI Commands

### `hoodstrut run`
Execute a single profile against a single task.

```bash
# Basic usage
hoodstrut run --profile aggressive-coder --task fix-auth-bug

# With options
hoodstrut run \
  --profile ./profiles/my-profile.yaml \
  --task ./tasks/my-task.md \
  --output ./results/run-001 \
  --verbose

# With OTEL telemetry export to Jaeger
hoodstrut run --profile my-setup --task my-task \
  --telemetry http://localhost:4318

# With OTEL telemetry to Honeycomb
hoodstrut run --profile my-setup --task my-task \
  --telemetry https://api.honeycomb.io:443 \
  --telemetry-headers "x-honeycomb-team=YOUR_API_KEY"
```

### `hoodstrut benchmark`
Run multiple profiles against multiple tasks.

```bash
# Run all profiles against all tasks
hoodstrut benchmark

# Specific profiles and tasks
hoodstrut benchmark \
  --profiles aggressive-coder,conservative-coder \
  --tasks fix-auth-bug,add-feature-x \
  --parallel 2

# Use a benchmark definition file
hoodstrut benchmark --config ./benchmarks/full-suite.yaml
```

### `hoodstrut profile`
Manage profiles.

```bash
hoodstrut profile list                    # List all profiles
hoodstrut profile show aggressive-coder   # Show profile details
hoodstrut profile validate ./my-profile.yaml
hoodstrut profile create                  # Interactive profile creation
```

### `hoodstrut profile scan`
**Key command**: Auto-detect and import existing Claude Code configuration.

```bash
# Scan default location (~/.claude)
hoodstrut profile scan

# Scan with custom name
hoodstrut profile scan --name "my-work-setup"

# Scan specific directory
hoodstrut profile scan --path /path/to/.claude --name "custom-setup"

# Scan and immediately validate
hoodstrut profile scan --name "new-setup" --validate

# Scan in dry-run mode (show what would be extracted)
hoodstrut profile scan --dry-run

# Scan project-specific config (from current directory)
hoodstrut profile scan --project
```

**Flags:**
- `--name, -n`: Name for the generated profile (default: auto-generated timestamp)
- `--path, -p`: Path to Claude config directory (default: `~/.claude`)
- `--project`: Scan project-local config (`.claude/` in current directory)
- `--output, -o`: Output directory for generated profile (default: `./profiles/`)
- `--dry-run`: Show what would be extracted without writing
- `--validate`: Validate the generated profile after creation
- `--include-env`: Include current environment variables in profile

### `hoodstrut task`
Manage tasks.

```bash
hoodstrut task list                       # List all tasks
hoodstrut task show fix-auth-bug          # Show task details
hoodstrut task validate ./my-task.md
hoodstrut task create                     # Interactive task creation
```

### `hoodstrut report`
Generate reports from results.

```bash
hoodstrut report ./results/benchmark-001  # Generate markdown report
hoodstrut report ./results/benchmark-001 --format json
hoodstrut report ./results/benchmark-001 --compare ./results/benchmark-002
```

### `hoodstrut init`
Initialize a new hoodstrut setup.

```bash
hoodstrut init                            # Create default directories and examples
hoodstrut init --with-examples            # Include example profiles/tasks/repo
```

---

## Profile Schema

```yaml
# Full profile configuration
name: string                    # Required: unique identifier
description: string             # Optional: human-readable description

# Claude Code configuration
model: string                   # Required: model identifier
                               # e.g., claude-sonnet-4-20250514, claude-opus-4-20250514
effort: low | medium | high     # Optional: reasoning effort level (default: medium)

system_prompt: string           # Optional: custom system prompt
                               # Can be inline or file reference: file://./prompts/my-prompt.md

# MCP Server configuration
mcp_servers:                    # Optional: list of MCP servers
  - name: string               # Server identifier
    command: string            # Command to run
    args: string[]             # Command arguments
    env: object                # Environment variables

# Skills configuration
skills:                         # Optional: list of skills
  - name: string               # Skill identifier
    path: string               # Path to skill definition

# Execution settings
settings:
  max_turns: number            # Optional: max conversation turns (default: 50)
  timeout: number              # Optional: per-task timeout in seconds (default: 300)
  allowed_tools: string[]      # Optional: restrict available tools
  env: object                  # Optional: environment variables
```

---

## Task Schema

Tasks are Markdown files with YAML frontmatter:

```yaml
---
# Required fields
id: string                     # Unique task identifier
title: string                  # Human-readable title

# Repository configuration (one of these required)
repo: string                   # Git URL or local path
branch: string                 # Branch to use (default: main)

# Success determination (at least one recommended)
success_command: string        # Command that must exit 0 for success
                              # e.g., "npm test", "pytest", "make check"
success_patterns: string[]     # Patterns to look for in output (any match = success)
ai_judge: boolean             # Use AI to evaluate success (default: false)
ai_judge_criteria: string     # Custom criteria for AI judge

# Execution settings
timeout: number               # Task-specific timeout (overrides profile)
working_dir: string           # Working directory relative to repo root
setup_commands: string[]      # Commands to run before task (e.g., npm install)

# Metadata
tags: string[]                # For filtering/organizing
difficulty: easy | medium | hard | expert
estimated_tokens: number      # Expected token usage (for scoring baseline)
---

## Description

[Markdown content describing the task - like a Jira ticket body]

## Acceptance Criteria

[What needs to be true for this to be considered complete]

## Additional Context

[Any helpful information, but kept vague to test realistic scenarios]
```

---

## Output Formats

### Run Result (JSON)

```json
{
  "id": "run-2025-01-15-001",
  "timestamp": "2025-01-15T10:30:00Z",
  "profile": {
    "name": "aggressive-coder",
    "model": "claude-sonnet-4-20250514",
    "effort": "high"
  },
  "task": {
    "id": "fix-auth-bug",
    "title": "Fix authentication timeout issue",
    "difficulty": "medium"
  },
  "metrics": {
    "input_tokens": 15420,
    "output_tokens": 8230,
    "cache_read_tokens": 5000,
    "cache_write_tokens": 2000,
    "total_tokens": 23650,
    "cost_usd": 0.142,
    "duration_seconds": 87,
    "turns": 12,
    "model": "claude-sonnet-4-20250514"
  },
  "result": {
    "success": true,
    "success_method": "command",  // "command" | "pattern" | "ai_judge" | "manual"
    "exit_code": 0,
    "files_modified": ["src/auth/session.ts", "src/config/redis.ts"],
    "files_created": [],
    "files_deleted": []
  },
  "score": {
    "value": 847,
    "breakdown": {
      "success_bonus": 500,
      "token_efficiency": 180,
      "time_bonus": 120,
      "difficulty_multiplier": 1.2
    }
  },
  "logs": {
    "stdout": "path/to/stdout.log",
    "stderr": "path/to/stderr.log",
    "conversation": "path/to/conversation.json"
  }
}
```

### Benchmark Summary (Markdown)

```markdown
# Benchmark Report: full-suite-2025-01-15

## Overview

| Metric | Value |
|--------|-------|
| Profiles Tested | 3 |
| Tasks Run | 10 |
| Total Runs | 30 |
| Total Duration | 45m 32s |
| Total Cost | $4.27 |

## Results by Profile

### aggressive-coder
- **Success Rate**: 8/10 (80%)
- **Avg Tokens**: 24,500
- **Avg Cost**: $0.15
- **Total Score**: 7,240

### conservative-coder
- **Success Rate**: 9/10 (90%)
- **Avg Tokens**: 31,200
- **Avg Cost**: $0.19
- **Total Score**: 7,890

## Results by Task

| Task | aggressive-coder | conservative-coder |
|------|-----------------|-------------------|
| fix-auth-bug | PASS (847) | PASS (792) |
| add-feature-x | PASS (923) | PASS (856) |
| refactor-api | FAIL | PASS (634) |

## Token Consumption

[Chart/table showing token usage breakdown]

## Recommendations

Based on this benchmark:
- `conservative-coder` has higher success rate but uses more tokens
- `aggressive-coder` is more token-efficient but fails on complex refactors
```

---

## Scoring System (MVP)

The scoring system rewards:
1. **Success** - Did the task complete successfully?
2. **Token Efficiency** - Less tokens for same result = better
3. **Time Efficiency** - Faster completion = better
4. **Difficulty** - Harder tasks worth more

### Formula (MVP)

```
score = (success_bonus + token_score + time_score) * difficulty_multiplier

Where:
- success_bonus = 500 if success, 0 if fail
- token_score = max(0, 300 - (tokens_used / expected_tokens * 100))
- time_score = max(0, 200 - (time_seconds / expected_time * 50))
- difficulty_multiplier = { easy: 0.8, medium: 1.0, hard: 1.3, expert: 1.6 }
```

This is intentionally simple for MVP. Future versions can incorporate:
- Code quality metrics
- Test coverage delta
- Lint/type error changes
- Number of retries needed
- Human review scores

---

## Example Repository

Ship with a simple "todo-app" for immediate testing:

```
repos/todo-app/
├── src/
│   ├── index.ts
│   ├── todo.ts
│   ├── storage.ts
│   └── api.ts
├── tests/
│   └── todo.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

A minimal but realistic TypeScript project with:
- Basic CRUD operations
- File-based storage
- Simple API endpoints
- Existing test suite
- Some intentional bugs/issues for tasks to fix

---

## Example Tasks

### Task 1: Fix Bug
```markdown
---
id: fix-todo-persistence
title: Todos don't persist after restart
repo: ./repos/todo-app
success_command: npm test
difficulty: easy
---

## Description

Users report that their todos disappear when the server restarts.

## Acceptance Criteria

- Todos should persist between server restarts
- Existing tests should pass
```

### Task 2: Add Feature
```markdown
---
id: add-due-dates
title: Add due date support for todos
repo: ./repos/todo-app
success_command: npm test
difficulty: medium
---

## Description

Product wants to add due dates to todos so users can track deadlines.

## Acceptance Criteria

- Todos can have an optional due date
- API should support filtering by due date
- Add tests for new functionality
```

### Task 3: Refactor
```markdown
---
id: refactor-to-sqlite
title: Migrate from file storage to SQLite
repo: ./repos/todo-app
success_command: npm test
difficulty: hard
---

## Description

The file-based storage is causing issues at scale. Migrate to SQLite.

## Acceptance Criteria

- Replace file storage with SQLite
- Maintain backwards compatibility with existing API
- Include migration script for existing data
- All tests passing
```

---

## Metrics & Telemetry Architecture

### Primary: Agent SDK for Metrics

All runs use the `@anthropic-ai/claude-agent-sdk` to execute Claude Code. The SDK streams structured messages, and the final `result` message includes complete metrics:

```typescript
// From SDK result message
{
  total_cost_usd: 0.142,
  usage: {
    input_tokens: 15420,
    output_tokens: 8230,
    cache_read_input_tokens: 5000,
    cache_creation_input_tokens: 2000,
  },
  modelUsage: {
    'claude-sonnet-4-20250514': {
      inputTokens: 15420,
      outputTokens: 8230,
      cacheReadInputTokens: 5000,
      cacheCreationInputTokens: 2000,
      costUSD: 0.142,
    }
  }
}
```

This approach is reliable, structured, and requires no file parsing.

### Optional: OTEL Telemetry Export

For users who want detailed traces/spans in their observability backend (Honeycomb, Datadog, Grafana, Jaeger), use the `--telemetry` flag:

```bash
# Export to local Jaeger
hoodstrut run -p my-profile -t my-task \
  --telemetry http://localhost:4318

# Export to Honeycomb
hoodstrut run -p my-profile -t my-task \
  --telemetry https://api.honeycomb.io:443 \
  --telemetry-headers "x-honeycomb-team=YOUR_API_KEY"
```

This sets the following env vars in the container:
- `CLAUDE_CODE_ENABLE_TELEMETRY=1`
- `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`
- `OTEL_TRACES_EXPORTER=otlp`
- `OTEL_METRICS_EXPORTER=otlp`
- `OTEL_LOGS_EXPORTER=otlp`
- `OTEL_EXPORTER_OTLP_ENDPOINT=<user-provided>`

OTEL telemetry provides:
- `claude_code.interaction` spans for each turn
- `claude_code.llm_request` spans with latency and tokens
- `claude_code.tool` spans for tool invocations
- Metrics counters for tokens, cost, sessions

**Note:** The `--telemetry` flag is for observability export only. Metrics extraction always uses the SDK response stream, regardless of this flag.

---

## Docker Execution Flow

1. **Prepare**: Copy local repo into temp directory (public URLs via git clone, local paths via copy)
2. **Build**: Create Docker image with Claude Code CLI + Agent SDK
3. **Configure**: Inject profile settings (system prompt, MCP, skills, telemetry env vars if --telemetry)
4. **Execute**: Run Claude Code via Agent SDK `query()` with task prompt
5. **Capture**: Stream stdout/stderr to files, collect metrics from SDK response
6. **Verify**: Run success_command in same container
7. **Cleanup**: Remove container, preserve results with metrics

### Dockerfile.runner

```dockerfile
FROM node:20-slim

# Install Claude Code CLI and Agent SDK
RUN npm install -g @anthropic-ai/claude-code @anthropic-ai/claude-agent-sdk

# Install common dev tools
RUN apt-get update && apt-get install -y git python3 make gcc g++

# Working directory
WORKDIR /workspace

# TypeScript entrypoint that uses SDK for metrics
COPY scripts/run-sdk.ts /run-sdk.ts
RUN npx tsc /run-sdk.ts --outDir /scripts --esModuleInterop --module NodeNext --moduleResolution NodeNext

ENTRYPOINT ["node", "/scripts/run-sdk.js"]
```

---

## Development Phases

### Phase 1: Foundation ✅
- [x] Project setup (TypeScript, ESLint, testing)
- [x] Profile schema and parser
- [x] Task schema and parser
- [x] Basic CLI structure with Commander.js

### Phase 2: Profile Scanner ✅
- [x] Claude Code config detection (`~/.claude/` structure)
- [x] Settings parser (`settings.json`, `settings.local.json`)
- [x] MCP server config parser
- [x] CLAUDE.md / system prompt extraction
- [x] Custom commands/skills discovery
- [x] Environment variable detection (reference, not capture)
- [x] Profile YAML generation from scanned data
- [x] `hoodstrut profile scan` command

### Phase 3: Docker Integration
- [ ] Docker executor (build, run, cleanup)
- [ ] Repo copying and isolation (public repos + local paths only)
- [ ] Claude Code invocation inside container (single-shot `--print` mode)
- [ ] Profile config injection (CLAUDE.md, settings, MCP servers)
- [ ] Output capture and streaming (stdout, stderr, conversation)
- [ ] Success command execution (runs in same container after Claude Code)
- [ ] API key passed via `ANTHROPIC_API_KEY` env var from host

### Phase 4: Metrics via Agent SDK + Optional Telemetry
- [ ] Add `@anthropic-ai/claude-agent-sdk` dependency
- [ ] Create `src/metrics/types.ts` with TokenMetrics, RunMetrics, MetricsResult
- [ ] Create `src/metrics/pricing.ts` with all current Claude models (easily editable)
- [ ] Create `src/docker/sdk-runner.ts` - wrapper to run Claude via Agent SDK
- [ ] Create `src/docker/scripts/run-sdk.ts` - TypeScript container entrypoint
- [ ] Update `Dockerfile.runner` to include SDK and compile TS entrypoint
- [ ] Refactor `executor.ts` to use SDK runner instead of `claude --print`
- [ ] Extract metrics from SDK `result` message (tokens, cost, turns, model_usage)
- [ ] Add `--telemetry <endpoint>` flag to export OTEL to user's collector
- [ ] Add `--telemetry-headers <headers>` flag for auth headers
- [ ] **Loud warnings** when metrics extraction fails (metrics are the point!)
- [ ] Graceful degradation: run succeeds with `metrics: null` + warnings array
- [ ] Update run.ts to display metrics or show warning banner
- [ ] Tests for pricing config and metrics extraction

### Phase 5: Success Determination & Results
- [ ] Success determination (command exit code, pattern matching, AI judge)
- [ ] JSON result output with full metrics
- [ ] File change tracking (modified, created, deleted)
- [ ] Run result persistence to `results/` directory

### Phase 6: Scoring & Reporting
- [ ] Scoring algorithm implementation
- [ ] Markdown report generation
- [ ] Comparison reports
- [ ] Result aggregation for benchmarks

### Phase 7: Parallel Execution & Benchmarks
- [ ] Concurrent container execution (`--parallel N`)
- [ ] Resource management and container pooling
- [ ] Benchmark orchestration (multiple profiles × multiple tasks)
- [ ] Aggregated benchmark results

### Phase 8: Example Content & Polish
- [ ] Example profiles (including one scanned from real setup)
- [ ] Example tasks
- [ ] Example todo-app repository
- [ ] README and documentation
- [ ] `hoodstrut init` command

---

## Success Criteria for MVP

The MVP is complete when:

1. **Profile Scanning Works**: User can run `hoodstrut profile scan` and get an accurate profile from their existing Claude Code setup
2. **Basic Flow Works**: A user can run `hoodstrut run --profile X --task Y` and get results
3. **Isolation**: Tasks run in Docker with no host system side effects
4. **Metrics**: Token count, cost, time, and success are accurately tracked
5. **Scoring**: A numeric score is calculated for each run
6. **Reporting**: JSON and Markdown outputs are generated
7. **Examples**: User can run examples out of the box with `hoodstrut init --with-examples`
8. **Documentation**: README explains installation, configuration, and usage

**The "wow" demo:**
```bash
# User's first experience should be this simple:
hoodstrut profile scan --name "my-setup"
hoodstrut init --with-examples
hoodstrut run --profile my-setup --task fix-todo-persistence
# → See exactly how their setup performs, with token/cost/score metrics
```

---

## Future Roadmap (Post-MVP)

1. **Multi-Tool Support**: Add Codex CLI, Copilot CLI, Gemini CLI, Aider
2. **Web Dashboard**: Visualize results, compare runs, track trends
3. **CI Integration**: GitHub Actions, GitLab CI support
4. **Private Repo Support**: Authentication for private Git repositories
5. **Task Library**: Community-contributed task collections
6. **Leaderboard**: Optional public scoring/comparison
7. **Custom Judges**: Pluggable evaluation criteria
8. **Cost Optimization**: Recommendations based on results
