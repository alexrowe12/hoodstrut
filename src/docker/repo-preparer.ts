import { exec } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve, isAbsolute } from 'node:path';
import type { PrepareRepoOptions } from './types.js';

const execAsync = promisify(exec);

function isGitUrl(repo: string): boolean {
  return (
    repo.startsWith('http://') ||
    repo.startsWith('https://') ||
    repo.startsWith('git@') ||
    repo.startsWith('git://')
  );
}

export async function prepareRepo(options: PrepareRepoOptions): Promise<string> {
  const { repo, branch, destDir } = options;

  await mkdir(destDir, { recursive: true });

  if (isGitUrl(repo)) {
    await cloneRepo(repo, branch, destDir);
  } else {
    await copyLocalRepo(repo, destDir);
  }

  return destDir;
}

async function cloneRepo(url: string, branch: string, destDir: string): Promise<void> {
  const cmd = `git clone --depth 1 --branch ${branch} ${url} ${destDir}`;

  try {
    await execAsync(cmd, { timeout: 120000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to clone repository: ${message}`);
  }
}

async function copyLocalRepo(repoPath: string, destDir: string): Promise<void> {
  const sourcePath = isAbsolute(repoPath) ? repoPath : resolve(process.cwd(), repoPath);

  try {
    await cp(sourcePath, destDir, {
      recursive: true,
      filter: (src) => !src.includes('.git'),
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
