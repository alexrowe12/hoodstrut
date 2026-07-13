import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dir as tmpDir } from 'tmp-promise';
import { resolveScanScope, scanClaudeConfig } from '../index.js';

describe('scanner scope', () => {
  it('treats --path as an exact user config directory', async () => {
    const tmp = await tmpDir({ unsafeCleanup: true });
    try {
      const config = join(tmp.path, 'custom-claude');
      await mkdir(join(config, 'skills', 'user-skill'), { recursive: true });
      await writeFile(join(config, 'settings.json'), JSON.stringify({ model: 'opus' }));
      await writeFile(join(config, 'CLAUDE.md'), 'User instructions');
      await writeFile(join(config, 'skills', 'user-skill', 'SKILL.md'), '---\nname: user-skill\n---');
      await writeFile(join(tmp.path, '.claude.json'), JSON.stringify({
        mcpServers: { user: { command: 'node', args: ['server.js'] } },
      }));

      const scope = resolveScanScope({ path: config });
      const result = await scanClaudeConfig({ path: config });
      expect(scope).toMatchObject({ type: 'user', root: config });
      expect(result.scope).toBe('user');
      expect(result.settings.merged.model).toBe('opus');
      expect(result.prompt?.content).toBe('User instructions');
      expect(result.skills.map(skill => skill.name)).toEqual(['user-skill']);
      expect(result.mcpServers.servers[0].name).toBe('user');
    } finally {
      await tmp.cleanup();
    }
  });

  it('uses only project paths and applies local settings over shared settings', async () => {
    const tmp = await tmpDir({ unsafeCleanup: true });
    try {
      await mkdir(join(tmp.path, '.claude', 'skills', 'project-skill'), { recursive: true });
      await writeFile(join(tmp.path, '.claude', 'settings.json'), JSON.stringify({
        model: 'sonnet', permissions: { allow: ['Read'] },
      }));
      await writeFile(join(tmp.path, '.claude', 'settings.local.json'), JSON.stringify({
        model: 'opus', permissions: { deny: ['WebFetch'] },
      }));
      await writeFile(join(tmp.path, '.claude', 'CLAUDE.md'), 'Project instructions');
      await writeFile(join(tmp.path, '.claude', 'skills', 'project-skill', 'SKILL.md'),
        '---\nname: project-skill\n---');
      await writeFile(join(tmp.path, '.mcp.json'), JSON.stringify({
        mcpServers: { project: { command: 'node' } },
      }));

      const result = await scanClaudeConfig({ project: true, path: tmp.path });
      expect(result.scope).toBe('project');
      expect(result.settings.merged).toMatchObject({
        model: 'opus', permissions: { allow: ['Read'], deny: ['WebFetch'] },
      });
      expect(result.prompt?.content).toBe('Project instructions');
      expect(result.skills[0].name).toBe('project-skill');
      expect(result.mcpServers.servers[0].name).toBe('project');
    } finally {
      await tmp.cleanup();
    }
  });
});
