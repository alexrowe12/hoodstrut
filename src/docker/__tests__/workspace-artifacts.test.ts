import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dir as tmpDir } from 'tmp-promise';
import {
  collectWorkspaceArtifacts,
  establishWorkspaceBaseline,
} from '../workspace-artifacts.js';

describe('workspace artifacts', () => {
  let rootDir: string;
  let workspaceDir: string;
  let outputDir: string;
  let protectedGitDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await tmpDir({ unsafeCleanup: true });
    rootDir = tmp.path;
    cleanup = tmp.cleanup;
    workspaceDir = join(rootDir, 'workspace');
    outputDir = join(rootDir, 'output');
    protectedGitDir = join(rootDir, 'protected-git');
    await mkdir(workspaceDir);
    await mkdir(outputDir);
  });

  afterEach(async () => cleanup());

  it('captures only changes made after the baseline', async () => {
    await writeFile(join(workspaceDir, '.gitignore'), 'ignored.txt\n');
    await writeFile(join(workspaceDir, 'configured.txt'), 'from setup\n');
    await writeFile(join(workspaceDir, 'modified.txt'), 'before\n');
    await writeFile(join(workspaceDir, 'deleted.txt'), 'remove me\n');

    const baseline = await establishWorkspaceBaseline(workspaceDir, protectedGitDir);

    await writeFile(join(workspaceDir, 'modified.txt'), 'after\n');
    await writeFile(join(workspaceDir, 'created.txt'), 'created\n');
    await writeFile(join(workspaceDir, 'ignored.txt'), 'ignored\n');
    await writeFile(join(workspaceDir, '.metrics.json'), '{"internal":true}\n');
    await mkdir(join(workspaceDir, '.otel'));
    await writeFile(join(workspaceDir, '.otel', 'trace.json'), '{}\n');
    await rm(join(workspaceDir, 'deleted.txt'));

    const result = await collectWorkspaceArtifacts(workspaceDir, outputDir, baseline);

    expect(result.filesChanged).toEqual({
      modified: ['modified.txt'],
      created: ['created.txt'],
      deleted: ['deleted.txt'],
    });
    const patch = await readFile(result.patchPath, 'utf-8');
    expect(patch).toContain('created.txt');
    expect(patch).not.toContain('configured.txt');
    expect(patch).not.toContain('.metrics.json');
    expect(patch).not.toContain('.otel');
  });

  it('uses protected metadata when the agent commits and removes workspace .git', async () => {
    await writeFile(join(workspaceDir, 'tracked.txt'), 'before\n');
    const baseline = await establishWorkspaceBaseline(workspaceDir, protectedGitDir);

    await writeFile(join(workspaceDir, 'tracked.txt'), 'committed by agent\n');
    await execa('git', ['add', '--all'], { cwd: workspaceDir });
    await execa('git', ['commit', '--quiet', '-m', 'agent commit'], { cwd: workspaceDir });
    await rm(join(workspaceDir, '.git'), { recursive: true, force: true });

    const result = await collectWorkspaceArtifacts(workspaceDir, outputDir, baseline);

    expect(result.filesChanged.modified).toEqual(['tracked.txt']);
  });

  it('records hashes, binary files, and executable modes in the manifest', async () => {
    await writeFile(join(workspaceDir, 'script.sh'), '#!/bin/sh\necho before\n');
    const baseline = await establishWorkspaceBaseline(workspaceDir, protectedGitDir);

    await writeFile(join(workspaceDir, 'script.sh'), '#!/bin/sh\necho after\n');
    await chmod(join(workspaceDir, 'script.sh'), 0o755);
    await writeFile(join(workspaceDir, 'binary.dat'), Buffer.from([0, 1, 2, 3]));

    const result = await collectWorkspaceArtifacts(workspaceDir, outputDir, baseline);
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf-8'));
    const script = manifest.files.find((file: { path: string }) => file.path === 'script.sh');
    const binary = manifest.files.find((file: { path: string }) => file.path === 'binary.dat');

    expect(manifest.schema_version).toBe(1);
    expect(manifest.baseline_commit).toBe(baseline.commit);
    expect(script.before.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(script.after.mode).toBe('100755');
    expect(binary.after.binary).toBe(true);
    expect(binary.after.size).toBe(4);
  });

  it('produces a patch that reconstructs the changed tree', async () => {
    await writeFile(join(workspaceDir, 'existing.txt'), 'before\n');
    const baseline = await establishWorkspaceBaseline(workspaceDir, protectedGitDir);

    await writeFile(join(workspaceDir, 'existing.txt'), 'after\n');
    await writeFile(join(workspaceDir, 'new.txt'), 'new\n');
    const result = await collectWorkspaceArtifacts(workspaceDir, outputDir, baseline);

    const replayDir = join(rootDir, 'replay');
    await mkdir(replayDir);
    await execa('git', [
      '--git-dir', baseline.gitDir,
      '--work-tree', replayDir,
      'checkout', '--force', baseline.commit, '--', '.',
    ]);
    await execa('git', ['apply', '--binary', result.patchPath], { cwd: replayDir });

    await expect(readFile(join(replayDir, 'existing.txt'), 'utf-8')).resolves.toBe('after\n');
    await expect(readFile(join(replayDir, 'new.txt'), 'utf-8')).resolves.toBe('new\n');
  });
});
