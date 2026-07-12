import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDotenv } from '../dotenv.js';

describe('loadDotenv', () => {
  const originalEnv = process.env;
  let dir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    dir = mkdtempSync(join(tmpdir(), 'hoodstrut-dotenv-'));
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(dir, { recursive: true, force: true });
  });

  function writeEnv(contents: string): void {
    writeFileSync(join(dir, '.env'), contents);
  }

  it('loads KEY=VALUE pairs into process.env', () => {
    delete process.env.ANTHROPIC_API_KEY;
    writeEnv('ANTHROPIC_API_KEY=sk-test-123\n');

    const loaded = loadDotenv(dir);

    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-test-123');
    expect(loaded).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('does not override an existing environment variable', () => {
    process.env.ANTHROPIC_API_KEY = 'real-key';
    writeEnv('ANTHROPIC_API_KEY=from-file\n');

    const loaded = loadDotenv(dir);

    expect(process.env.ANTHROPIC_API_KEY).toBe('real-key');
    expect(loaded).not.toContain('ANTHROPIC_API_KEY');
  });

  it('ignores comments and blank lines', () => {
    delete process.env.FOO;
    writeEnv('# a comment\n\nFOO=bar\n');

    loadDotenv(dir);

    expect(process.env.FOO).toBe('bar');
  });

  it('tolerates a leading `export` and strips surrounding quotes', () => {
    delete process.env.FOO;
    delete process.env.BAZ;
    writeEnv('export FOO="bar baz"\nBAZ=\'quux\'\n');

    loadDotenv(dir);

    expect(process.env.FOO).toBe('bar baz');
    expect(process.env.BAZ).toBe('quux');
  });

  it('returns an empty list when no .env exists', () => {
    expect(loadDotenv(dir)).toEqual([]);
  });
});
