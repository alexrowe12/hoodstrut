import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dir as tmpDir } from 'tmp-promise';
import { injectConfig, buildEnvVars } from '../config-injector.js';
import type { Profile } from '../../core/types.js';

describe('config-injector', () => {
  let workspaceDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await tmpDir({ unsafeCleanup: true });
    workspaceDir = tmp.path;
    cleanup = tmp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('injectConfig', () => {
    it('writes CLAUDE.md from system_prompt', async () => {
      const profile: Profile = {
        name: 'test',
        model: 'claude-sonnet-4-20250514',
        system_prompt: '# Custom Instructions\n\nBe helpful.',
      };

      await injectConfig(profile, workspaceDir);

      const content = await readFile(join(workspaceDir, 'CLAUDE.md'), 'utf-8');
      expect(content).toBe('# Custom Instructions\n\nBe helpful.');
    });

    it('writes settings.local.json with model and effort', async () => {
      const profile: Profile = {
        name: 'test',
        model: 'claude-opus-4-20250514',
        effort: 'high',
      };

      await injectConfig(profile, workspaceDir);

      const content = await readFile(
        join(workspaceDir, '.claude', 'settings.local.json'),
        'utf-8'
      );
      const settings = JSON.parse(content);
      expect(settings.model).toBe('claude-opus-4-20250514');
      expect(settings.effortLevel).toBe('high');
    });

    it('writes .mcp.json with MCP servers', async () => {
      const profile: Profile = {
        name: 'test',
        model: 'claude-sonnet-4-20250514',
        mcp_servers: [
          {
            name: 'filesystem',
            command: 'npx',
            args: ['-y', '@anthropic/mcp-server-filesystem'],
          },
          {
            name: 'github',
            command: 'npx',
            args: ['-y', '@anthropic/mcp-server-github'],
            env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
          },
        ],
      };

      await injectConfig(profile, workspaceDir);

      const content = await readFile(join(workspaceDir, '.mcp.json'), 'utf-8');
      const mcp = JSON.parse(content);
      expect(mcp.mcpServers.filesystem).toEqual({
        command: 'npx',
        args: ['-y', '@anthropic/mcp-server-filesystem'],
        env: {},
      });
      expect(mcp.mcpServers.github.env).toEqual({ GITHUB_TOKEN: '${GITHUB_TOKEN}' });
    });

    it('does not write files when profile has no optional fields', async () => {
      const profile: Profile = {
        name: 'minimal',
        model: 'claude-sonnet-4-20250514',
      };

      await injectConfig(profile, workspaceDir);

      await expect(
        readFile(join(workspaceDir, 'CLAUDE.md'), 'utf-8')
      ).rejects.toThrow();

      await expect(
        readFile(join(workspaceDir, '.mcp.json'), 'utf-8')
      ).rejects.toThrow();

      const settings = await readFile(
        join(workspaceDir, '.claude', 'settings.local.json'),
        'utf-8'
      );
      expect(JSON.parse(settings)).toEqual({ model: 'claude-sonnet-4-20250514' });
    });
  });

  describe('buildEnvVars', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv, ANTHROPIC_API_KEY: 'test-key' };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('includes ANTHROPIC_API_KEY from environment', () => {
      const profile: Profile = {
        name: 'test',
        model: 'claude-sonnet-4-20250514',
      };

      const env = buildEnvVars(profile, '/workspace/.otel');
      expect(env.ANTHROPIC_API_KEY).toBe('test-key');
    });

    it('includes model as ANTHROPIC_MODEL', () => {
      const profile: Profile = {
        name: 'test',
        model: 'claude-opus-4-20250514',
      };

      const env = buildEnvVars(profile, '/workspace/.otel');
      expect(env.ANTHROPIC_MODEL).toBe('claude-opus-4-20250514');
    });

    it('sets OTEL env vars', () => {
      const profile: Profile = {
        name: 'test',
        model: 'claude-sonnet-4-20250514',
      };

      const env = buildEnvVars(profile, '/workspace/.otel');
      expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('file:///workspace/.otel');
      expect(env.OTEL_TRACES_EXPORTER).toBe('otlp');
      expect(env.OTEL_METRICS_EXPORTER).toBe('otlp');
    });

    it('includes custom env vars from profile settings', () => {
      const profile: Profile = {
        name: 'test',
        model: 'claude-sonnet-4-20250514',
        settings: {
          env: {
            DEBUG: 'true',
            NODE_ENV: 'test',
          },
        },
      };

      const env = buildEnvVars(profile, '/workspace/.otel');
      expect(env.DEBUG).toBe('true');
      expect(env.NODE_ENV).toBe('test');
    });
  });
});
