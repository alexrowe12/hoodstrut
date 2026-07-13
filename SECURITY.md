# Security Policy

## Supported versions

Before the 1.0 release, security fixes are made on the latest published minor
version only. Upgrade to the newest release before reporting a problem that may
already have been fixed.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/alexrowe12/hoodstrut/security/advisories/new).
Do not disclose the issue in a public GitHub issue, discussion, benchmark
artifact, or pull request.

Include, when available:

- The affected hoodstrut version or commit.
- Operating system, Node version, and Docker version.
- A minimal reproduction using fake credentials and a harmless repository.
- The expected and observed security boundary.
- Whether credentials, host commands, repository contents, or result artifacts
  may have been exposed.

Never send a real API key or MCP secret. If a credential may have leaked, revoke
or rotate it before preparing the report.

Reports will be acknowledged and investigated as project capacity allows. A fix
and disclosure timeline will be coordinated through the private advisory.
