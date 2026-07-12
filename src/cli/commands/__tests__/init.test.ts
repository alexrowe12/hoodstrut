import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dir as tmpDir } from 'tmp-promise';
import { ensureGitignore } from '../init.js';

describe('ensureGitignore', () => {
  let cwd: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await tmpDir({ unsafeCleanup: true });
    cwd = tmp.path;
    cleanup = tmp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('creates rules that protect credentials and generated results', async () => {
    await expect(ensureGitignore(cwd)).resolves.toBe('created');

    const content = await readFile(join(cwd, '.gitignore'), 'utf-8');
    expect(content).toContain('\n.env\n');
    expect(content).toContain('\n.env.*\n');
    expect(content).toContain('\n!.env.example\n');
    expect(content).toContain('\nresults/\n');
    expect(content).toContain('\notel_logs/\n');
  });

  it('preserves existing content and appends a canonical protection block', async () => {
    await writeFile(join(cwd, '.gitignore'), 'node_modules/\n.env\n', 'utf-8');

    await expect(ensureGitignore(cwd)).resolves.toBe('updated');

    const content = await readFile(join(cwd, '.gitignore'), 'utf-8');
    expect(content.startsWith('node_modules/\n.env\n')).toBe(true);
    expect(content.trimEnd().endsWith('results/\notel_logs/')).toBe(true);
    expect(content).toContain('!.env.example');
  });

  it('places credential protection after an existing negation rule', async () => {
    await writeFile(join(cwd, '.gitignore'), '.env\n!.env\n', 'utf-8');

    await ensureGitignore(cwd);

    const content = await readFile(join(cwd, '.gitignore'), 'utf-8');
    expect(content.lastIndexOf('\n.env\n')).toBeGreaterThan(content.lastIndexOf('\n!.env\n'));
  });

  it('adds a separator when the existing file has no trailing newline', async () => {
    await writeFile(join(cwd, '.gitignore'), 'node_modules/', 'utf-8');

    await ensureGitignore(cwd);

    const content = await readFile(join(cwd, '.gitignore'), 'utf-8');
    expect(content).toContain('node_modules/\n# hoodstrut\n');
  });

  it('is idempotent', async () => {
    await ensureGitignore(cwd);
    const first = await readFile(join(cwd, '.gitignore'), 'utf-8');

    await expect(ensureGitignore(cwd)).resolves.toBe('unchanged');
    const second = await readFile(join(cwd, '.gitignore'), 'utf-8');

    expect(second).toBe(first);
  });
});
