I’d group the work into these batches:

  1. Security blockers, one implementation
      - Generated root .gitignore
      - MCP secret redaction/reference handling
      - Replace shell-interpolated Git clone with argument-based execution
      - Security regression tests

  2. Artifact and change integrity
      - Preserve .gitignore/.github
      - Establish a clean baseline after setup/configuration
      - Exclude hoodstrut artifacts such as .metrics.json
      - Retain changes.patch, file manifest, and verifier output
      - Make local and remote repositories behave consistently

  3. Verification correctness
      - Remove prose-only pattern false positives
      - Give AI judge the patch and test evidence
      - Require explicit verification for benchmark tasks
      - Improve timeout/setup/judge failure classification

  4. Profile fidelity
      - Define exactly what a profile represents
      - Correct scanner scope and --path
      - Map timeout, turns, tools, effort, MCP, skills, and prompt explicitly
      - Use the Claude Code SDK preset
      - Add an end-to-end profile-consumption test

  5. Reproducibility
      - Pin Docker and SDK dependencies
      - Content-address/version the runner image
      - Support immutable Git refs
      - Record runtime/tool versions in results

  6. Benchmark methodology
      - Redesign success versus efficiency scoring
      - Add repetitions
      - Report variance/confidence
      - Handle missing and errored runs without creating misleading winners

  7. Public release polish
      - Package metadata, license, CI, contribution/security files
      - Clean build output and repository scratch files
      - Replace placeholder documentation
      - Add package-install and quickstart tests

ORIGINAL PROMPT


Verdict
  This is a promising alpha with a sensible internal structure. It is not yet ready
  to be promoted as a trustworthy benchmarking tool or as a cornerstone example of
  production engineering.

  The problem is not excessive convolution. The source is generally approachable. The
  problem is that the product currently presents results with more confidence than
  the execution, verification, safety, and reproducibility support.

  Critical Findings

  1. init can lead users to commit their API key.
     src/cli/commands/init.ts:69 writes .env but does not create or update a
     root .gitignore. The clean-project smoke test confirmed there was no
     root .gitignore, despite the README claiming results are ignored by default.

  2. Profile scanning can copy secrets into committed YAML.
     src/scanner/mcp.ts:57 copies MCP environment values verbatim, and src/scanner/
     profile-generator.ts:55 serializes them. This contradicts the README’s claim
     that values are never copied. Real tokens in .claude.json could land in
     profiles/*.yaml.

  3. A malicious task can execute commands on the host.
     src/docker/repo-preparer.ts:32 interpolates task-controlled branch, URL, and
     destination values into a shell command passed to exec. Docker does not protect
     this step. Use execFile/spawn with an argument array and validate repository
     references.

  4. The example suite contains a proven false positive.
     src/core/success.ts:30 matches patterns against assistant prose. In the saved
     hello-world-patterns result, the assistant claimed it created a file, the
     verifier matched “Hello World,” and the run passed even though files_created
     contained only .metrics.json. The benchmark currently rewards claims, not
     necessarily work.

  5. Results are not auditable.
     The workspace is deleted in src/docker/executor.ts:178, while results retain
     only filenames and logs. There is no patch, final tree, verifier transcript, or
     test artifact. The AI judge in src/core/judge.ts:45 sees logs and filenames, not
     source changes. One saved judgment explicitly said it had not inspected the
     code.

  High-Priority Findings
  6. Change tracking is contaminated and unreliable.
  The baseline is captured before configuration injection and setup. Injected
  CLAUDE.md, .mcp.json, dependencies, and .metrics.json can appear as agent work. All
  observed recent results reported .metrics.json as a created file. Tracking by
  modification time is also weaker than a Git diff.

  7. Local repository preparation damages fixtures.
     The filter at src/docker/repo-preparer.ts:47 excludes any path containing .git,
     not just .git/. The smoke test confirmed it drops .gitignore; it also
     drops .github. Local fixtures lose Git history while remote fixtures retain it,
     producing inconsistent environments.

  8. Several advertised profile controls do not reach the correct SDK options.
     settings.timeout is ignored by src/docker/executor.ts:102. max_turns and
     allowed_tools are written as filesystem settings even though the installed SDK
     exposes them as query options. The runner also omits the Claude Code
     system-prompt preset, so it uses the SDK’s minimal default rather than
     faithfully reproducing Claude Code behavior. Anthropic documents that
     distinction (https://code.claude.com/docs/en/agent-sdk/migration-guide).

  9. The scanner is not yet a faithful representation of “my actual setup.”
     Custom --path handling still reads global settings from the real home directory.
     Default scanning captures the current project’s CLAUDE.md, not the user-level
     ~/.claude/CLAUDE.md. Permissions are scanned but discarded, remote MCP server
     properties are lost, and skills always come from the real home directory.
     Anthropic distinguishes user and project instruction scopes explicitly in its
     CLAUDE.md documentation (https://code.claude.com/docs/en/memory).

  10. Reproducibility is currently weak.
     The Dockerfile installs the latest Claude CLI and Agent SDK without pinned
     versions. The fixed hoodstrut-runner:latest image is reused merely if it exists,
     so upgrading hoodstrut can silently retain an old runtime. Git branches are
     mutable, local branches are ignored, tasks have no commit/checksum, and
     benchmarks run each combination only once.

  11. The scoring methodology can mislead users.
     Expected cost is calculated using each profile’s own model pricing, which
     normalizes away much of the absolute cost advantage while the README says
     cheaper runs score higher. Fast failures can tie slow successful runs. Winners
     are based on one nondeterministic sample, with no variance, repetitions, or
     confidence interval. Success should dominate efficiency lexicographically or
     through a stronger penalty.

  Public-Repo Gaps

  - README.md:27 still contains git clone <repo-url>.
  - package.json has no repository, homepage, bugs, or author metadata, and main
    points to missing dist/index.js.

  - There is no LICENSE file, CI workflow, contribution guide, security policy,
    release process, or issue templates.

  - Builds do not clean dist; the package dry run included obsolete sdk-runner files.
  - Tracked .claude/settings.local.json contains personal paths and permissions. The
    numerous phase/debug documents make the public tree look like a development
    scratchpad.

  - The current corpus is one small todo application. That is suitable for a demo,
    not yet “real-world tasks” across ecosystems and task types.

  What Is Good

  - The module boundaries are clear: CLI, core orchestration, Docker, scanner,
    metrics, and output.

  - run and benchmark share a pipeline instead of duplicating runtime logic.
  - Zod validation, concurrency pooling, cleanup handling, and collected matrix-
    resolution errors are good foundations.

  - The shared report model and separate terminal/Markdown renderers are well
    designed.

  - The README is readable, the CLI help is understandable, and init --with-examples
    scaffolds successfully.

  - The persistence fixture genuinely discriminates between a no-op and a working
    fix.

  - Build and lint pass; all 159 tests pass; production dependency audit reports zero
    vulnerabilities.

  One correction to my interim update: the installed Agent SDK 0.3.207 loads
  filesystem setting sources by default. The earlier concern that all injected
  settings were ignored does not apply to this version. The profile-fidelity issues
  above still apply.

  Path To Promotion

  1. Fix secret handling and host command injection immediately.
  2. Make verification evidence-based and retain a patch plus verifier artifacts.
  3. Define a canonical profile model and map every field explicitly to supported SDK
     options.

  4. Pin and content-address the runner, repositories, task versions, and tool
     dependencies.

  5. Redesign scoring around repeated trials, success-first ranking, and uncertainty.
  6. Add end-to-end Docker tests, package-install tests, CI, public metadata, and a
     broader task corpus.

  After the first four items, I would be comfortable describing hoodstrut as a public
  beta. After methodology work and a credible task corpus, it can become the project
  you are describing. No repository files were changed during this review.
