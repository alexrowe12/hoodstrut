import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dir as tmpDir } from 'tmp-promise';
import { scanSkills } from '../skills.js';

describe('scanSkills', () => {
  it('scans only the supplied directory and retains the full skill directory path', async () => {
    const tmp = await tmpDir({ unsafeCleanup: true });
    try {
      const skillDir = join(tmp.path, 'skills', 'deploy');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: deploy\ndescription: Deploy safely\n---\n');
      await writeFile(join(skillDir, 'helper.sh'), 'echo deploy');
      expect(await scanSkills(join(tmp.path, 'skills'))).toEqual([{
        name: 'deploy', description: 'Deploy safely', sourcePath: skillDir,
      }]);
      expect(await scanSkills(join(tmp.path, 'elsewhere'))).toEqual([]);
    } finally {
      await tmp.cleanup();
    }
  });
});
