import { describe, it, expect } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { URL } from 'node:url';
import { dir as tmpDir } from 'tmp-promise';
import { loadProfile } from '../../core/profile.js';
import { prepareProfileRuntime } from '../config-injector.js';

describe('end-to-end profile consumption', () => {
  it('carries a full YAML profile into the SDK query options without changing the fixture', async () => {
    const tmp = await tmpDir({ unsafeCleanup: true });
    const originalCwd = process.cwd();
    const originalEnv = process.env;
    try {
      const profileDir = join(tmp.path, 'profiles');
      const skillDir = join(profileDir, 'assets', 'skills', 'review');
      const runtimeDir = join(tmp.path, 'runtime-claude');
      const workspace = join(tmp.path, 'workspace');
      await mkdir(skillDir, { recursive: true });
      await mkdir(workspace);
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: review\n---\nReview carefully.');
      await writeFile(join(skillDir, 'checklist.md'), 'Check tests.');
      await writeFile(join(workspace, 'CLAUDE.md'), 'Fixture instructions');
      const profilePath = join(profileDir, 'full.yaml');
      await writeFile(profilePath, `
name: full
model: claude-opus-4-8
effort: max
system_prompt: Profile instructions
settings:
  max_turns: 17
  timeout: 45
  allowed_tools: [Read, Bash]
  disallowed_tools: [WebFetch]
  env: { PROFILE_FLAG: enabled }
mcp_servers:
  - name: local
    type: stdio
    command: node
    args: [server.js]
    env: { API_TOKEN: "\${API_TOKEN}" }
  - name: remote
    type: http
    url: https://example.test/mcp
    headers: { Authorization: "Bearer \${API_TOKEN}" }
skills:
  - name: review
    source: assets/skills/review
`);

      const profile = await loadProfile(profilePath);
      const runtimePath = await prepareProfileRuntime(profile, runtimeDir);
      const runtime = JSON.parse(await readFile(runtimePath, 'utf-8'));
      const moduleUrl = new URL('../scripts/run-sdk.mjs', import.meta.url);
      const runner = await import(moduleUrl.href);
      process.env = { ...originalEnv, API_TOKEN: 'resolved-token' };
      let captured: Record<string, unknown> | undefined;
      async function* fakeQuery(input: Record<string, unknown>) {
        captured = input;
        yield {
          type: 'result', subtype: 'success', total_cost_usd: 0,
          usage: {}, modelUsage: {},
        };
      }
      const exitCode = await runner.runAgent({
        taskPrompt: 'Implement the task', profile: runtime, workingDir: workspace,
        metricsFile: join(tmp.path, 'metrics.json'), query: fakeQuery,
      });

      expect(exitCode).toBe(0);
      expect(captured).toMatchObject({
        prompt: 'Implement the task',
        options: {
          cwd: workspace,
          model: 'claude-opus-4-8',
          effort: 'max',
          maxTurns: 17,
          allowedTools: ['Read', 'Bash'],
          disallowedTools: ['WebFetch'],
          systemPrompt: { type: 'preset', preset: 'claude_code', append: 'Profile instructions' },
          tools: { type: 'preset', preset: 'claude_code' },
          settingSources: ['user', 'project', 'local'],
          mcpServers: {
            local: { env: { API_TOKEN: 'resolved-token' } },
            remote: { headers: { Authorization: 'Bearer resolved-token' } },
          },
        },
      });
      expect(await readFile(join(runtimeDir, 'skills', 'review', 'checklist.md'), 'utf-8'))
        .toBe('Check tests.');
      expect(await readFile(join(workspace, 'CLAUDE.md'), 'utf-8')).toBe('Fixture instructions');
    } finally {
      process.chdir(originalCwd);
      process.env = originalEnv;
      await tmp.cleanup();
    }
  });
});
