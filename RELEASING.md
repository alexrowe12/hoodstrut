# Releasing hoodstrut

Hoodstrut follows semantic versioning. During `0.x`, minor releases may contain
documented breaking changes; patch releases must remain compatible.

## Prerequisites

- Maintainer access to the GitHub repository and npm package.
- npm trusted publishing configured for `.github/workflows/release.yml`.
- A clean `main` branch with all required CI checks passing.

The package must exist before its trusted publisher can be configured. For the
first release only, publish from a clean tagged checkout with a short-lived,
least-privilege granular npm token and provenance enabled. Configure the GitHub
trusted publisher immediately afterward, revoke the token, and use the workflow
for every subsequent release. Do not store the bootstrap token in the repository
or as a long-lived GitHub secret.

## Release checklist

1. Update `version` in `package.json` and `package-lock.json` together.
2. Update user-facing documentation for changed commands, schemas, or results.
3. Run the complete local gates:

   ```bash
   npm ci
   npm run check
   npm run test:package
   npm run test:docker
   npm audit
   git diff --check
   ```

4. Inspect `npm pack --dry-run --json`. It must contain the CLI, runner assets,
   examples, README, and license, and no source scratch files or results.
5. Merge the version change to `main` and create an annotated `vX.Y.Z` tag at
   that exact commit.
6. Push the tag. The release workflow verifies that the tag and package version
   match, reruns the release gates, and publishes with npm provenance.
7. Install the published version in an empty directory and rerun the README's
   offline quickstart before creating GitHub release notes.

After the one-time package bootstrap, do not publish manually or with a
long-lived npm token. If trusted publishing is unavailable, stop and repair the
release configuration rather than bypassing the provenance gate. Trusted
publishing requirements are documented by
[npm](https://docs.npmjs.com/trusted-publishers/).
