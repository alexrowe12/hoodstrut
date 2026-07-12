import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve, isAbsolute, relative, sep } from 'node:path';
import { execa } from 'execa';
import type { PrepareRepoOptions } from './types.js';

function isGitUrl(repo: string): boolean {
  return (
    repo.startsWith('http://') ||
    repo.startsWith('https://') ||
    repo.startsWith('git@') ||
    repo.startsWith('git://') ||
    repo.startsWith('file://')
  );
}

export async function prepareRepo(options: PrepareRepoOptions): Promise<string> {
  const { repo, branch, destDir } = options;

  await mkdir(destDir, { recursive: true });

  if (isGitUrl(repo)) {
    await cloneRepo(repo, branch, destDir);
    await rm(resolve(destDir, '.git'), { recursive: true, force: true });
  } else {
    await copyLocalRepo(repo, destDir);
  }

  return destDir;
}

export async function cloneRepo(url: string, branch: string, destDir: string): Promise<void> {
  try {
    await execa(
      'git',
      ['clone', '--depth', '1', '--branch', branch, '--', url, destDir],
      { timeout: 120000 }
    );
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr).trim()
        : '';
    const message = stderr || (error instanceof Error ? error.message : String(error));
    throw new Error(`Failed to clone repository: ${message}`);
  }
}

async function copyLocalRepo(repoPath: string, destDir: string): Promise<void> {
  const sourcePath = isAbsolute(repoPath) ? repoPath : resolve(process.cwd(), repoPath);

  try {
    await cp(sourcePath, destDir, {
      recursive: true,
      filter: (src) => {
        const sourceRelativePath = relative(sourcePath, src);
        return !sourceRelativePath.split(sep).includes('.git');
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to copy local repository: ${message}`);
  }
}

export async function cleanupRepo(destDir: string): Promise<void> {
  try {
    await rm(destDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}
