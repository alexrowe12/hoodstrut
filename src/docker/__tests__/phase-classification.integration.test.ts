import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dir as tmpDir } from 'tmp-promise';
import type { Profile } from '../../core/types.js';
import type { TaskWithBody } from '../../core/task.js';
import { ExecutionPhaseError } from '../errors.js';
import { runContainer } from '../executor.js';

const dockerDescribe = process.env.HOODSTRUT_DOCKER_TESTS === '1' ? describe : describe.skip;

dockerDescribe('Docker phase classification', () => {
  let rootDir: string;
  let repoDir: string;
  let outputDir: string;
  let cleanup: () => Promise<void>;

  const profile: Profile = {
    name: 'integration',
    model: 'claude-sonnet-4-20250514',
    effort: 'medium',
  };

  beforeEach(async () => {
    const tmp = await tmpDir({ unsafeCleanup: true });
    rootDir = tmp.path;
    cleanup = tmp.cleanup;
    repoDir = join(rootDir, 'repo');
    outputDir = join(rootDir, 'output');
    await mkdir(repoDir);
    await writeFile(join(repoDir, 'README.md'), 'fixture\n');
  });

  afterEach(async () => cleanup());

  function task(setupCommand: string): TaskWithBody {
    return {
      id: 'phase-test',
      title: 'Phase test',
      repo: repoDir,
      branch: 'main',
      verification: { type: 'command', command: 'true' },
      ai_judge: false,
      setup_commands: [setupCommand],
      estimated_tokens: 100,
      expected_time: 1,
      body: 'This task must never reach the agent.',
    };
  }

  it('classifies a nonzero setup command', async () => {
    await expect(runContainer({
      profile,
      task: task('exit 2'),
      outputDir,
      timeout: 10,
    })).rejects.toMatchObject<Partial<ExecutionPhaseError>>({
      code: 'setup_failed',
      phase: 'setup',
      options: { timedOut: false, exitCode: 2 },
    });
  }, 300_000);

  it('classifies a setup timeout independently of its exit code', async () => {
    await expect(runContainer({
      profile,
      task: task('sleep 5'),
      outputDir,
      timeout: 1,
    })).rejects.toMatchObject<Partial<ExecutionPhaseError>>({
      code: 'setup_timeout',
      phase: 'setup',
      options: { timedOut: true },
    });
  }, 300_000);
});
