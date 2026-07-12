import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';

const INTERNAL_PATHSPECS = [
  ':(top,exclude).metrics.json',
  ':(top,exclude).otel',
  ':(top,exclude).otel/**',
];

export interface FileChanges {
  modified: string[];
  created: string[];
  deleted: string[];
}

export interface WorkspaceBaseline {
  commit: string;
  gitDir: string;
}

interface FileState {
  sha256: string;
  size: number;
  mode: string;
  binary: boolean;
}

interface ManifestEntry {
  path: string;
  status: 'modified' | 'created' | 'deleted';
  before: FileState | null;
  after: FileState | null;
}

export interface ArtifactCollection {
  filesChanged: FileChanges;
  patchPath: string;
  manifestPath: string;
}

function gitArgs(gitDir: string, workspaceDir: string, args: string[]): string[] {
  return ['--git-dir', gitDir, '--work-tree', workspaceDir, ...args];
}

export async function establishWorkspaceBaseline(
  workspaceDir: string,
  protectedGitDir: string
): Promise<WorkspaceBaseline> {
  try {
    await execa('git', ['init', '--quiet'], { cwd: workspaceDir });
    await execa('git', ['config', 'user.email', 'hoodstrut@localhost'], { cwd: workspaceDir });
    await execa('git', ['config', 'user.name', 'hoodstrut'], { cwd: workspaceDir });
    await execa('git', ['add', '--all'], { cwd: workspaceDir });
    await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'hoodstrut baseline'], {
      cwd: workspaceDir,
    });

    const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: workspaceDir });
    const commit = stdout.trim();

    await rm(protectedGitDir, { recursive: true, force: true });
    await cp(join(workspaceDir, '.git'), protectedGitDir, { recursive: true });

    const { stdout: status } = await execa(
      'git',
      gitArgs(protectedGitDir, workspaceDir, ['status', '--porcelain'])
    );
    if (status !== '') {
      throw new Error(`baseline is not clean: ${status}`);
    }

    return { commit, gitDir: protectedGitDir };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to establish workspace baseline: ${message}`);
  }
}

function parseNameStatus(output: string): FileChanges {
  const modified: string[] = [];
  const created: string[] = [];
  const deleted: string[] = [];
  const fields = output.split('\0').filter(Boolean);

  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!path) continue;

    if (status === 'A') created.push(path);
    else if (status === 'D') deleted.push(path);
    else modified.push(path);
  }

  return {
    modified: modified.sort(),
    created: created.sort(),
    deleted: deleted.sort(),
  };
}

function describeContent(content: Buffer, mode: string): FileState {
  return {
    sha256: createHash('sha256').update(content).digest('hex'),
    size: content.byteLength,
    mode,
    binary: content.includes(0),
  };
}

async function readBaselineState(
  baseline: WorkspaceBaseline,
  workspaceDir: string,
  path: string
): Promise<FileState> {
  const commonArgs = gitArgs(baseline.gitDir, workspaceDir, []);
  const [{ stdout: rawContent }, { stdout: rawTree }] = await Promise.all([
    execa('git', [...commonArgs, 'show', `${baseline.commit}:${path}`], {
      encoding: 'buffer',
      stripFinalNewline: false,
    }),
    execa('git', [...commonArgs, 'ls-tree', '-z', baseline.commit, '--', path]),
  ]);
  const mode = rawTree.split(' ')[0] || '100644';
  return describeContent(Buffer.from(rawContent), mode);
}

async function readFinalState(workspaceDir: string, path: string): Promise<FileState> {
  const fullPath = join(workspaceDir, path);
  const stats = await lstat(fullPath);
  const content = stats.isSymbolicLink()
    ? Buffer.from(await readlink(fullPath))
    : await readFile(fullPath);
  const mode = stats.isSymbolicLink()
    ? '120000'
    : (stats.mode & 0o111) !== 0
      ? '100755'
      : '100644';
  return describeContent(content, mode);
}

export async function collectWorkspaceArtifacts(
  workspaceDir: string,
  outputDir: string,
  baseline: WorkspaceBaseline
): Promise<ArtifactCollection> {
  try {
    await mkdir(outputDir, { recursive: true });
    const paths = ['.', ...INTERNAL_PATHSPECS];
    const commonArgs = gitArgs(baseline.gitDir, workspaceDir, []);

    await execa('git', [...commonArgs, 'add', '--intent-to-add', '--all', '--', ...paths]);

    const [{ stdout: patch }, { stdout: names }] = await Promise.all([
      execa('git', [
        ...commonArgs,
        'diff',
        '--binary',
        '--full-index',
        '--no-ext-diff',
        '--no-renames',
        baseline.commit,
        '--',
        ...paths,
      ], { stripFinalNewline: false }),
      execa('git', [
        ...commonArgs,
        'diff',
        '--name-status',
        '-z',
        '--no-renames',
        baseline.commit,
        '--',
        ...paths,
      ]),
    ]);

    const filesChanged = parseNameStatus(names);
    const entries: ManifestEntry[] = [];
    const statuses: Array<[ManifestEntry['status'], string[]]> = [
      ['modified', filesChanged.modified],
      ['created', filesChanged.created],
      ['deleted', filesChanged.deleted],
    ];

    for (const [status, files] of statuses) {
      for (const path of files) {
        entries.push({
          path,
          status,
          before: status === 'created' ? null : await readBaselineState(baseline, workspaceDir, path),
          after: status === 'deleted' ? null : await readFinalState(workspaceDir, path),
        });
      }
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));

    const patchPath = join(outputDir, 'changes.patch');
    const manifestPath = join(outputDir, 'files-manifest.json');
    await Promise.all([
      writeFile(patchPath, patch, 'utf-8'),
      writeFile(manifestPath, JSON.stringify({
        schema_version: 1,
        baseline_commit: baseline.commit,
        generated_at: new Date().toISOString(),
        changes: filesChanged,
        files: entries,
      }, null, 2), 'utf-8'),
    ]);

    return { filesChanged, patchPath, manifestPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to capture workspace artifacts: ${message}`);
  }
}
