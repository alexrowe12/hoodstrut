import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dir as tmpDir } from 'tmp-promise';
import { prepareRepo, cleanupRepo } from '../repo-preparer.js';

describe('repo-preparer', () => {
  let sourceDir: string;
  let destDir: string;
  let cleanupSource: () => Promise<void>;
  let cleanupDest: () => Promise<void>;

  beforeEach(async () => {
    const source = await tmpDir({ unsafeCleanup: true });
    const dest = await tmpDir({ unsafeCleanup: true });
    sourceDir = source.path;
    destDir = dest.path;
    cleanupSource = source.cleanup;
    cleanupDest = dest.cleanup;
  });

  afterEach(async () => {
    await cleanupSource();
    await cleanupDest();
  });

  describe('prepareRepo with local path', () => {
    it('copies local directory to destination', async () => {
      await mkdir(join(sourceDir, 'src'), { recursive: true });
      await writeFile(join(sourceDir, 'package.json'), '{"name": "test"}');
      await writeFile(join(sourceDir, 'src', 'index.ts'), 'console.log("hello")');

      const targetDir = join(destDir, 'workspace');
      await prepareRepo({
        repo: sourceDir,
        branch: 'main',
        destDir: targetDir,
      });

      const pkg = await readFile(join(targetDir, 'package.json'), 'utf-8');
      expect(pkg).toBe('{"name": "test"}');

      const src = await readFile(join(targetDir, 'src', 'index.ts'), 'utf-8');
      expect(src).toBe('console.log("hello")');
    });

    it('excludes .git directory when copying', async () => {
      await mkdir(join(sourceDir, '.git'), { recursive: true });
      await writeFile(join(sourceDir, '.git', 'config'), 'git config');
      await writeFile(join(sourceDir, 'README.md'), '# Hello');

      const targetDir = join(destDir, 'workspace');
      await prepareRepo({
        repo: sourceDir,
        branch: 'main',
        destDir: targetDir,
      });

      const readme = await readFile(join(targetDir, 'README.md'), 'utf-8');
      expect(readme).toBe('# Hello');

      await expect(
        readFile(join(targetDir, '.git', 'config'), 'utf-8')
      ).rejects.toThrow();
    });

    it('throws error for non-existent local path', async () => {
      await expect(
        prepareRepo({
          repo: '/nonexistent/path',
          branch: 'main',
          destDir: join(destDir, 'workspace'),
        })
      ).rejects.toThrow('Failed to copy local repository');
    });
  });

  describe('cleanupRepo', () => {
    it('removes directory', async () => {
      const targetDir = join(destDir, 'to-remove');
      await mkdir(targetDir, { recursive: true });
      await writeFile(join(targetDir, 'file.txt'), 'content');

      await cleanupRepo(targetDir);

      await expect(
        readFile(join(targetDir, 'file.txt'), 'utf-8')
      ).rejects.toThrow();
    });

    it('does not throw for non-existent directory', async () => {
      await expect(
        cleanupRepo('/nonexistent/directory')
      ).resolves.not.toThrow();
    });
  });
});
