import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dir as tmpDir } from 'tmp-promise';
import {
  buildEnvVars,
  buildProfileRuntime,
  prepareProfileRuntime,
} from '../config-injector.js';
import { resolveRunTimeout } from '../executor.js';
import type { Profile } from '../../core/types.js';

const minimalProfile: Profile = {
  name: 'test', model: 'claude-sonnet-5', effort: 'medium',
};

describe('profile runtime preparation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('maps every programmatic SDK control', () => {
    const runtime = buildProfileRuntime({
      ...minimalProfile,
      model: 'claude-opus-4-8',
      effort: 'max',
      system_prompt: 'Be exact.',
      settings: {
        max_turns: 42,
        timeout: 90,
        allowed_tools: ['Read', 'Bash'],
        disallowed_tools: ['WebFetch'],
      },
      mcp_servers: [{
        name: 'remote', type: 'http', url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer ${TOKEN}' }, timeout: 10,
      }],
    });
    expect(runtime).toEqual({
      model: 'claude-opus-4-8', effort: 'max', systemPrompt: 'Be exact.', maxTurns: 42,
      allowedTools: ['Read', 'Bash'], disallowedTools: ['WebFetch'],
      mcpServers: { remote: {
        type: 'http', url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer ${TOKEN}' }, timeout: 10,
      } },
    });
  });

  it('copies complete skill directories and writes runtime JSON', async () => {
    const source = await tmpDir({ unsafeCleanup: true });
    const target = await tmpDir({ unsafeCleanup: true });
    try {
      const skillDir = join(source.path, 'deploy');
      await mkdir(skillDir);
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: deploy\n---');
      await writeFile(join(skillDir, 'helper.sh'), 'echo deploy');
      const runtimePath = await prepareProfileRuntime({
        ...minimalProfile, skills: [{ name: 'deploy', source: skillDir }],
      }, target.path);
      expect(JSON.parse(await readFile(runtimePath, 'utf-8')).model).toBe('claude-sonnet-5');
      expect(await readFile(join(target.path, 'skills', 'deploy', 'helper.sh'), 'utf-8'))
        .toBe('echo deploy');
    } finally {
      await source.cleanup();
      await target.cleanup();
    }
  });

  it('normalizes a legacy direct skill file to SKILL.md', async () => {
    const source = await tmpDir({ unsafeCleanup: true });
    const target = await tmpDir({ unsafeCleanup: true });
    try {
      const legacyFile = join(source.path, 'legacy-skill.md');
      await writeFile(legacyFile, 'legacy skill');
      await prepareProfileRuntime({
        ...minimalProfile, skills: [{ name: 'legacy', source: legacyFile }],
      }, target.path);
      expect(await readFile(join(target.path, 'skills', 'legacy', 'SKILL.md'), 'utf-8'))
        .toBe('legacy skill');
    } finally {
      await source.cleanup();
      await target.cleanup();
    }
  });

  it('fails for missing and duplicate skill sources', async () => {
    const target = await tmpDir({ unsafeCleanup: true });
    try {
      await expect(prepareProfileRuntime({
        ...minimalProfile, skills: [{ name: 'missing', source: '/missing/skill' }],
      }, target.path)).rejects.toThrow('Skill source does not exist');
      const source = await tmpDir({ unsafeCleanup: true });
      try {
        await writeFile(join(source.path, 'SKILL.md'), 'skill');
        await expect(prepareProfileRuntime({
          ...minimalProfile,
          skills: [
            { name: 'same', source: source.path },
            { name: 'same', source: source.path },
          ],
        }, target.path)).rejects.toThrow('Duplicate skill name');
      } finally {
        await source.cleanup();
      }
    } finally {
      await target.cleanup();
    }
  });

  it('resolves environment references for MCP env, URLs, and headers', () => {
    process.env.TOKEN = 'runtime-token';
    process.env.HOST = 'mcp.example.test';
    const env = buildEnvVars({
      ...minimalProfile,
      mcp_servers: [{
        name: 'remote', type: 'http', url: 'https://${HOST}/mcp',
        headers: { Authorization: 'Bearer ${TOKEN}' },
      }],
    });
    expect(env).toMatchObject({ TOKEN: 'runtime-token', HOST: 'mcp.example.test' });
    expect(env.ANTHROPIC_MODEL).toBeUndefined();
  });

  it('fails clearly for an unresolved MCP reference and accepts defaults', () => {
    delete process.env.MISSING_TOKEN;
    expect(() => buildEnvVars({
      ...minimalProfile,
      mcp_servers: [{
        name: 'remote', type: 'http', url: 'https://example.test',
        headers: { Authorization: 'Bearer ${MISSING_TOKEN}' },
      }],
    })).toThrow('requires MISSING_TOKEN for MCP server "remote"');
    expect(() => buildEnvVars({
      ...minimalProfile,
      mcp_servers: [{
        name: 'remote', type: 'http', url: 'https://${MISSING_TOKEN:-example.test}',
      }],
    })).not.toThrow();
  });

  it('includes telemetry and explicit profile environment variables', () => {
    const env = buildEnvVars({
      ...minimalProfile, settings: { env: { NODE_ENV: 'test' } },
    }, { endpoint: 'http://localhost:4318', headers: 'Authorization=token' });
    expect(env).toMatchObject({
      ANTHROPIC_API_KEY: 'test-key', NODE_ENV: 'test',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=token',
    });
  });

  it('uses override, task, profile, and default timeout precedence', () => {
    expect(resolveRunTimeout(10, 20, 30)).toBe(10);
    expect(resolveRunTimeout(undefined, 20, 30)).toBe(20);
    expect(resolveRunTimeout(undefined, undefined, 30)).toBe(30);
    expect(resolveRunTimeout()).toBe(300);
  });
});
