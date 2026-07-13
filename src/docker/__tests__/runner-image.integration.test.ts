import { describe, expect, it } from 'vitest';
import { buildRunnerImage, computeRunnerBuildIdentity } from '../runner-image.js';

const dockerDescribe = process.env.HOODSTRUT_DOCKER_TESTS === '1' ? describe : describe.skip;

dockerDescribe('content-addressed runner image', () => {
  it('builds the computed tag and reports pinned runtime versions', async () => {
    const identity = await computeRunnerBuildIdentity();
    const runner = await buildRunnerImage(true);

    expect(runner.tag).toBe(identity.tag);
    expect(runner.buildInputsSha256).toBe(identity.buildInputsSha256);
    expect(runner.imageId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(runner.versions).toMatchObject({
      node: '20.20.2',
      claudeCode: '2.1.197',
      agentSdk: '0.3.207',
      os: 'linux',
    });
    expect(runner.platform.os).toBe('linux');
    expect(runner.docker.serverVersion).not.toBe('');
    expect(runner.docker.apiVersion).not.toBe('');
  }, 300_000);
});
