import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanSettings } from '../settings.js';

describe('scanSettings', () => {
  const testDir = join(tmpdir(), 'hoodstrut-test-settings');
  const projectDir = join(testDir, 'project');

  beforeEach(async () => {
    await mkdir(join(projectDir, '.claude'), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should return empty project settings when no project config exists', async () => {
    const result = await scanSettings(projectDir);

    // Global settings come from real ~/.claude/settings.json (may have values)
    // Project settings should be empty since we created an empty project dir
    expect(result.project).toEqual({});
  });

  it('should parse project settings.local.json', async () => {
    await writeFile(
      join(projectDir, '.claude', 'settings.local.json'),
      JSON.stringify({
        model: 'opus',
        effortLevel: 'high',
        permissions: {
          allow: ['Bash(npm:*)'],
        },
      })
    );

    const result = await scanSettings(projectDir);

    expect(result.project.model).toBe('opus');
    expect(result.project.effortLevel).toBe('high');
    expect(result.project.permissions?.allow).toContain('Bash(npm:*)');
  });

  it('should ignore invalid effort levels', async () => {
    await writeFile(
      join(projectDir, '.claude', 'settings.local.json'),
      JSON.stringify({
        effortLevel: 'invalid',
      })
    );

    const result = await scanSettings(projectDir);

    expect(result.project.effortLevel).toBeUndefined();
  });

  it('should handle malformed JSON gracefully', async () => {
    await writeFile(
      join(projectDir, '.claude', 'settings.local.json'),
      'not valid json'
    );

    const result = await scanSettings(projectDir);

    expect(result.project).toEqual({});
  });
});
