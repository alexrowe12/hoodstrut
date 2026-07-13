# Contributing to hoodstrut

Hoodstrut is a benchmarking tool, so changes must preserve the integrity of the
environment, evidence, and conclusions it produces. Bug fixes, documentation,
new fixtures, and focused improvements are welcome.

## Development setup

Prerequisites:

- Node.js 20 or newer
- npm 10 or newer
- Git
- Docker for runner integration tests and real benchmark runs

Install and run the standard checks:

```bash
npm ci
npm run check
npm run test:package
```

`npm run check` runs linting, type checking, unit tests, a clean build, and the
compiled-artifact checks. `npm run test:package` packs and installs the same
tarball that would be published to npm, then exercises the offline quickstart.

Docker integration tests do not call Anthropic, but they build the pinned runner
image and can take several minutes:

```bash
npm run test:docker
```

Do not commit `.env`, API keys, MCP credentials, benchmark results, telemetry
logs, or local agent settings. Tests that need credentials must use obvious fake
values and must not make live model calls in CI.

## Pull requests

Keep changes focused and include tests appropriate to the behavioral risk. In
the pull request, explain the user-visible effect, verification performed, and
any compatibility or reproducibility implications.

Changes to profiles must document how every new field reaches the Claude Code
SDK. Changes to tasks must use explicit verification. Changes to benchmark
analysis must include cases for missing, errored, and repeated runs and must not
allow incomplete data to produce a winner.

When adding a benchmark fixture:

- Keep the repository small enough to install and test reliably.
- Pin remote repositories to an immutable commit when practical.
- Include a meaningful failing baseline and deterministic verifier.
- Avoid network-dependent verification.
- Document the task's purpose and expected difficulty.

## Reporting security issues

Do not open a public issue for a suspected vulnerability or leaked credential.
Follow [SECURITY.md](SECURITY.md) instead.
