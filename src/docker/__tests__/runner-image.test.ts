import { cp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dir as tmpDir } from 'tmp-promise';
import { computeRunnerBuildIdentity } from '../runner-image.js';

describe('runner build identity', () => {
  let root: string;
  let templatesDir: string;
  let scriptsDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await tmpDir({ unsafeCleanup: true });
    root = tmp.path;
    cleanup = tmp.cleanup;
    templatesDir = join(root, 'templates');
    scriptsDir = join(root, 'scripts');
    await cp(resolve('src/docker/templates'), templatesDir, { recursive: true });
    await cp(resolve('src/docker/scripts'), scriptsDir, { recursive: true });
  });

  afterEach(async () => cleanup());

  it('is stable for identical versioned inputs', async () => {
    const first = await computeRunnerBuildIdentity({ templatesDir, scriptsDir, hoodstrutVersion: '1.2.3' });
    const second = await computeRunnerBuildIdentity({ templatesDir, scriptsDir, hoodstrutVersion: '1.2.3' });

    expect(second).toEqual(first);
    expect(first.buildInputsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tag).toBe(`hoodstrut-runner:1.2.3-${first.buildInputsSha256.slice(0, 16)}`);
  });

  it('changes when a runner input or Hoodstrut version changes', async () => {
    const original = await computeRunnerBuildIdentity({ templatesDir, scriptsDir, hoodstrutVersion: '1.2.3' });
    await writeFile(join(scriptsDir, 'run-sdk.mjs'), '// changed runner\n');
    const scriptChanged = await computeRunnerBuildIdentity({ templatesDir, scriptsDir, hoodstrutVersion: '1.2.3' });
    const versionChanged = await computeRunnerBuildIdentity({ templatesDir, scriptsDir, hoodstrutVersion: '1.2.4' });

    expect(scriptChanged.buildInputsSha256).not.toBe(original.buildInputsSha256);
    expect(versionChanged.buildInputsSha256).not.toBe(scriptChanged.buildInputsSha256);
  });
});
