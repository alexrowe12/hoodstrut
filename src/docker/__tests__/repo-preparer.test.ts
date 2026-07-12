import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execa } from 'execa';
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

    it('preserves files and directories whose names only contain .git', async () => {
      await mkdir(join(sourceDir, '.github', 'workflows'), { recursive: true });
      await mkdir(join(sourceDir, 'docs', '.git-notes'), { recursive: true });
      await writeFile(join(sourceDir, '.gitignore'), 'node_modules/\n');
      await writeFile(join(sourceDir, '.gitmodules'), '[submodule "example"]\n');
      await writeFile(join(sourceDir, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
      await writeFile(join(sourceDir, 'docs', '.git-notes', 'README.md'), 'notes\n');

      const targetDir = join(destDir, 'workspace');
      await prepareRepo({ repo: sourceDir, branch: 'main', destDir: targetDir });

      await expect(readFile(join(targetDir, '.gitignore'), 'utf-8')).resolves.toBe('node_modules/\n');
      await expect(readFile(join(targetDir, '.gitmodules'), 'utf-8')).resolves.toContain('submodule');
      await expect(readFile(join(targetDir, '.github', 'workflows', 'ci.yml'), 'utf-8')).resolves.toBe('name: CI\n');
      await expect(readFile(join(targetDir, 'docs', '.git-notes', 'README.md'), 'utf-8')).resolves.toBe('notes\n');
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

  describe('prepareRepo with Git URL', () => {
    it('preserves project Git files but removes source repository metadata', async () => {
      await execa('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: sourceDir });
      await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: sourceDir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: sourceDir });
      await mkdir(join(sourceDir, '.github', 'workflows'), { recursive: true });
      await writeFile(join(sourceDir, '.gitignore'), 'node_modules/\n');
      await writeFile(join(sourceDir, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
      await execa('git', ['add', '--all'], { cwd: sourceDir });
      await execa('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: sourceDir });

      const targetDir = join(destDir, 'workspace');
      await prepareRepo({
        repo: pathToFileURL(sourceDir).href,
        branch: 'main',
        destDir: targetDir,
      });

      await expect(readFile(join(targetDir, '.gitignore'), 'utf-8')).resolves.toBe('node_modules/\n');
      await expect(readFile(join(targetDir, '.github', 'workflows', 'ci.yml'), 'utf-8')).resolves.toBe('name: CI\n');
      await expect(readFile(join(targetDir, '.git', 'HEAD'), 'utf-8')).rejects.toThrow();
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
