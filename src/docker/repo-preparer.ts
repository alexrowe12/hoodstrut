import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, readlink, rm } from 'node:fs/promises';
import { join, resolve, isAbsolute, relative, sep } from 'node:path';
import { URL } from 'node:url';
import { execa } from 'execa';
import type { PreparedRepository, PrepareRepoOptions } from './types.js';

function isGitUrl(repo: string): boolean {
  return (
    repo.startsWith('http://') ||
    repo.startsWith('https://') ||
    repo.startsWith('git@') ||
    repo.startsWith('git://') ||
    repo.startsWith('file://')
  );
}

export async function prepareRepo(options: PrepareRepoOptions): Promise<PreparedRepository> {
  const { repo, branch, commit, destDir } = options;

  await mkdir(destDir, { recursive: true });

  const remote = isGitUrl(repo);
  let sourceType: PreparedRepository['sourceType'];
  let resolvedCommit: string | undefined;

  if (commit) {
    await checkoutCommit(repo, commit, destDir);
    resolvedCommit = await resolveGitHead(destDir);
    if (resolvedCommit !== commit.toLowerCase()) {
      throw new Error(`Resolved repository commit ${resolvedCommit} does not match requested commit ${commit}`);
    }
    sourceType = remote ? 'remote_git' : 'local_git';
    await rm(resolve(destDir, '.git'), { recursive: true, force: true });
  } else if (remote) {
    await cloneRepo(repo, branch ?? 'main', destDir);
    resolvedCommit = await resolveGitHead(destDir);
    sourceType = 'remote_git';
    await rm(resolve(destDir, '.git'), { recursive: true, force: true });
  } else {
    await copyLocalRepo(repo, destDir);
    resolvedCommit = await tryResolveLocalHead(repo);
    sourceType = resolvedCommit ? 'local_git' : 'local_snapshot';
  }

  return {
    path: destDir,
    source: sanitizeRepositorySource(repo),
    sourceType,
    requestedBranch: remote && !commit ? branch : undefined,
    requestedCommit: commit?.toLowerCase(),
    resolvedCommit,
    immutable: Boolean(commit),
    contentSha256: await hashPreparedTree(destDir),
  };
}

export function sanitizeRepositorySource(repo: string): string {
  if (!repo.startsWith('http://') && !repo.startsWith('https://')) return repo;
  try {
    const url = new URL(repo);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return repo;
  }
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

export async function checkoutCommit(
  repo: string,
  commit: string,
  destDir: string
): Promise<void> {
  const source = isGitUrl(repo) || isAbsolute(repo) ? repo : resolve(process.cwd(), repo);
  try {
    await execa('git', ['init', '--quiet', destDir], { timeout: 120000 });
    await execa('git', ['-C', destDir, 'remote', 'add', 'origin', source], { timeout: 120000 });
    await execa('git', ['-C', destDir, 'fetch', '--depth', '1', 'origin', commit], { timeout: 120000 });
    await execa('git', ['-C', destDir, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], { timeout: 120000 });
  } catch (error) {
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error
      ? String(error.stderr).trim()
      : '';
    const message = stderr || (error instanceof Error ? error.message : String(error));
    throw new Error(`Failed to check out repository commit ${commit}: ${message}`);
  }
}

async function resolveGitHead(repoDir: string): Promise<string> {
  const { stdout } = await execa('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { timeout: 120000 });
  return stdout.trim().toLowerCase();
}

async function tryResolveLocalHead(repoPath: string): Promise<string | undefined> {
  const source = isAbsolute(repoPath) ? repoPath : resolve(process.cwd(), repoPath);
  try {
    return await resolveGitHead(source);
  } catch {
    return undefined;
  }
}

export async function hashPreparedTree(root: string): Promise<string> {
  const hash = createHash('sha256');

  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const absolute = join(dir, entry.name);
      const path = relative(root, absolute).split(sep).join('/');
      const stats = await lstat(absolute);
      const executable = stats.mode & 0o111 ? 'x' : '-';

      if (entry.isDirectory()) {
        hash.update(`d\0${path}\0${executable}\0`);
        await visit(absolute);
      } else if (entry.isSymbolicLink()) {
        hash.update(`l\0${path}\0${executable}\0${await readlink(absolute)}\0`);
      } else if (entry.isFile()) {
        const content = await readFile(absolute);
        hash.update(`f\0${path}\0${executable}\0${content.byteLength}\0`);
        hash.update(content);
      }
    }
  }

  await visit(root);
  return hash.digest('hex');
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
