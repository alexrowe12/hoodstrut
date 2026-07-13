import { describe, it, expect } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dir as tmpDir } from 'tmp-promise';
import { generateProfile } from '../profile-generator.js';
import { writeGeneratedProfile } from '../profile-writer.js';
import { loadProfile } from '../../core/profile.js';
import type { ScanResult } from '../index.js';

describe('writeGeneratedProfile', () => {
  it('snapshots complete skills and writes profile-relative sources', async () => {
    const tmp = await tmpDir({ unsafeCleanup: true });
    try {
      const source = join(tmp.path, 'source-skills', 'review');
      const output = join(tmp.path, 'profiles');
      await mkdir(source, { recursive: true });
      await writeFile(join(source, 'SKILL.md'), '---\nname: review\n---');
      await writeFile(join(source, 'notes.md'), 'supporting asset');
      const scan: ScanResult = {
        sourcePath: join(tmp.path, '.claude'), scope: 'user',
        settings: { base: {}, local: {}, merged: {} },
        mcpServers: { servers: [], requiredEnvVars: [], warnings: [] },
        prompt: null,
        skills: [{ name: 'review', sourcePath: source }],
        env: { claudeCodeVars: [] },
      };

      const outputPath = await writeGeneratedProfile(generateProfile(scan, 'portable'), output);
      const yaml = await readFile(outputPath, 'utf-8');
      const loaded = await loadProfile(outputPath);
      expect(yaml).toContain('source: portable.assets/skills/review');
      expect(await readFile(join(output, 'portable.assets', 'skills', 'review', 'notes.md'), 'utf-8'))
        .toBe('supporting asset');
      expect(loaded.skills?.[0].source).toBe(join(output, 'portable.assets', 'skills', 'review'));
    } finally {
      await tmp.cleanup();
    }
  });
});
