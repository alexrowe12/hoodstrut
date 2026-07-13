import { describe, it, expect } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dir as tmpDir } from 'tmp-promise';
import { scanSettings } from '../settings.js';

describe('scanSettings', () => {
  it('reads only the supplied settings files and applies local precedence', async () => {
    const tmp = await tmpDir({ unsafeCleanup: true });
    try {
      const base = join(tmp.path, 'settings.json');
      const local = join(tmp.path, 'settings.local.json');
      await writeFile(base, JSON.stringify({
        model: 'sonnet', effortLevel: 'low', permissions: { allow: ['Read'], deny: ['WebFetch'] },
      }));
      await writeFile(local, JSON.stringify({
        model: 'opus', effortLevel: 'high', permissions: { allow: ['Bash'], deny: ['WebSearch'] },
      }));

      const result = await scanSettings({ base, local });
      expect(result.base.model).toBe('sonnet');
      expect(result.local.model).toBe('opus');
      expect(result.merged).toMatchObject({
        model: 'opus',
        effortLevel: 'high',
        permissions: { allow: ['Read', 'Bash'], deny: ['WebFetch', 'WebSearch'] },
      });
    } finally {
      await tmp.cleanup();
    }
  });

  it('returns empty settings for missing or malformed files', async () => {
    const tmp = await tmpDir({ unsafeCleanup: true });
    try {
      const malformed = join(tmp.path, 'settings.json');
      await writeFile(malformed, 'not json');
      expect(await scanSettings({ base: malformed })).toEqual({ base: {}, local: {}, merged: {} });
      expect(await scanSettings({ base: join(tmp.path, 'missing.json') })).toEqual({
        base: {}, local: {}, merged: {},
      });
    } finally {
      await tmp.cleanup();
    }
  });

  it('ignores invalid effort values and accepts max and xhigh', async () => {
    const tmp = await tmpDir({ unsafeCleanup: true });
    try {
      await mkdir(tmp.path, { recursive: true });
      const path = join(tmp.path, 'settings.json');
      await writeFile(path, JSON.stringify({ effortLevel: 'invalid' }));
      expect((await scanSettings({ base: path })).merged.effortLevel).toBeUndefined();
      await writeFile(path, JSON.stringify({ effortLevel: 'max' }));
      expect((await scanSettings({ base: path })).merged.effortLevel).toBe('max');
    } finally {
      await tmp.cleanup();
    }
  });
});
