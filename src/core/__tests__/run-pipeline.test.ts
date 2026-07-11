import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RunResultSchema, type Profile } from '../types.js';
import type { TaskWithBody } from '../task.js';

vi.mock('../../docker/index.js', () => ({
  runContainer: vi.fn(),
  buildRunnerImage: vi.fn(),
}));

import { executeRun, resolveProfilePath, resolveTaskPath } from '../run-pipeline.js';
import { runContainer } from '../../docker/index.js';

const profile: Profile = {
  name: 'test-profile',
  model: 'claude-sonnet-4-20250514',
  effort: 'medium',
};

const task: TaskWithBody = {
  id: 'test-task',
  title: 'Test task',
  repo: './repos/todo-app',
  branch: 'main',
  ai_judge: false,
  estimated_tokens: 25000,
  expected_time: 150,
  difficulty: 'easy',
  body: 'Do the thing.',
};

function mockExecutionResult(overrides: { exitCode?: number } = {}) {
  return {
    containerId: 'docker-123',
    exitCode: overrides.exitCode ?? 0,
    duration: 42,
    stdout: '/tmp/out/stdout.log',
    stderr: '/tmp/out/stderr.log',
    stdoutContent: 'all good',
    stderrContent: '',
    filesChanged: { modified: ['src/a.ts'], created: [], deleted: [] },
    metrics: {
      success: true as const,
      metrics: {
        tokens: { input_tokens: 100, output_tokens: 200, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 300 },
        cost_usd: 0.05,
        duration_seconds: 40,
        turns: 4,
        model: 'claude-sonnet-4-20250514',
        model_usage: {},
      },
    },
  };
}

describe('resolveProfilePath', () => {
  it('resolves yaml paths as-is', () => {
    expect(resolveProfilePath('./foo/bar.yaml')).toMatch(/foo\/bar\.yaml$/);
  });

  it('resolves bare names into ./profiles', () => {
    expect(resolveProfilePath('my-profile')).toMatch(/profiles\/my-profile\.yaml$/);
  });
});

describe('resolveTaskPath', () => {
  it('resolves md paths as-is', () => {
    expect(resolveTaskPath('./foo/task.md')).toMatch(/foo\/task\.md$/);
  });

  it('resolves bare ids into ./tasks', () => {
    expect(resolveTaskPath('my-task')).toMatch(/tasks\/my-task\.md$/);
  });
});

describe('executeRun', () => {
  let outputRoot: string;

  beforeAll(async () => {
    outputRoot = await mkdtemp(join(tmpdir(), 'hoodstrut-run-'));
  });

  afterAll(async () => {
    await rm(outputRoot, { recursive: true, force: true });
  });

  it('writes a schema-valid run-result.json with score', async () => {
    vi.mocked(runContainer).mockResolvedValue(mockExecutionResult());

    const outputDir = join(outputRoot, 'run-1');
    const { runResult, duration } = await executeRun({
      profile,
      task,
      runId: 'run-1',
      outputDir,
    });

    expect(duration).toBe(42);
    expect(runResult.result.success).toBe(true);
    expect(runResult.profile.name).toBe('test-profile');
    expect(runResult.task.id).toBe('test-task');
    expect(runResult.metrics?.cost_usd).toBe(0.05);
    expect(runResult.score).not.toBeNull();

    const written = JSON.parse(await readFile(join(outputDir, 'run-result.json'), 'utf-8'));
    const parsed = RunResultSchema.safeParse(written);
    expect(parsed.success).toBe(true);
    expect(written.id).toBe('run-1');
  });

  it('returns a failed result (not a throw) when the task fails', async () => {
    const failed = mockExecutionResult({ exitCode: 1 });
    vi.mocked(runContainer).mockResolvedValue(failed);

    const { runResult } = await executeRun({
      profile,
      task,
      runId: 'run-2',
      outputDir: join(outputRoot, 'run-2'),
    });

    expect(runResult.result.success).toBe(false);
    expect(runResult.result.exit_code).toBe(1);
  });

  it('sets metrics and score to null when extraction fails, with warnings', async () => {
    const noMetrics = {
      ...mockExecutionResult(),
      metrics: { success: false as const, metrics: null, warnings: ['Metrics file not found'] },
    };
    vi.mocked(runContainer).mockResolvedValue(noMetrics);

    const { runResult } = await executeRun({
      profile,
      task,
      runId: 'run-3',
      outputDir: join(outputRoot, 'run-3'),
    });

    expect(runResult.metrics).toBeNull();
    expect(runResult.score).toBeNull();
    expect(runResult.warnings).toEqual(['Metrics file not found']);
  });
});
