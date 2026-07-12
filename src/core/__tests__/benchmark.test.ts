import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BenchmarkConfigSchema, type RunResult } from '../types.js';
import { slugify, buildMatrix, summarizeBenchmark, loadBenchmarkConfig } from '../benchmark.js';

const PROFILE_YAML = (name: string) => `
name: ${name}
model: claude-sonnet-4-20250514
`;

const TASK_MD = (id: string) => `---
id: ${id}
title: Test task ${id}
repo: ./repos/todo-app
verification:
  type: command
  command: npm test
---

Do the thing.
`;

function makeRunResult(overrides: {
  profile?: string;
  task?: string;
  success?: boolean;
  status?: RunResult['result']['status'];
  errorType?: string;
  cost?: number | null;
  score?: number | null;
}): RunResult {
  const cost = overrides.cost === undefined ? 0.1 : overrides.cost;
  const scoreValue = overrides.score === undefined ? 500 : overrides.score;

  return {
    id: `run-${overrides.profile ?? 'p'}--${overrides.task ?? 't'}`,
    timestamp: '2026-07-11T00:00:00Z',
    profile: { name: overrides.profile ?? 'p', model: 'claude-sonnet-4-20250514', effort: 'medium' },
    task: { id: overrides.task ?? 't', title: 'Test' },
    metrics: cost === null ? null : {
      tokens: { input_tokens: 100, output_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 200 },
      cost_usd: cost,
      duration_seconds: 60,
      turns: 3,
      model: 'claude-sonnet-4-20250514',
      model_usage: {},
    },
    result: {
      success: overrides.success ?? true,
      success_method: 'command',
      status: overrides.status,
      error_type: overrides.errorType,
      files_modified: [],
      files_created: [],
      files_deleted: [],
    },
    score: scoreValue === null ? null : {
      value: scoreValue,
      breakdown: {
        success_bonus: 500, cost_score: 0, time_score: 0, difficulty_multiplier: 1,
        actual_cost: cost ?? 0, expected_cost: 0.1, actual_time: 60, expected_time: 150,
      },
    },
    logs: { stdout: 'stdout.log', stderr: 'stderr.log' },
  };
}

describe('slugify', () => {
  it('lowercases and keeps alphanumerics and hyphens', () => {
    expect(slugify('Hello-World-123')).toBe('hello-world-123');
  });

  it('replaces disallowed characters with hyphens', () => {
    expect(slugify('My Profile (v2)')).toBe('my-profile-v2');
  });

  it('collapses repeated hyphens and trims edges', () => {
    expect(slugify('  --weird__name--  ')).toBe('weird-name');
  });

  it('handles unicode', () => {
    expect(slugify('café über')).toBe('caf-ber');
  });
});

describe('BenchmarkConfigSchema', () => {
  it('applies defaults', () => {
    const result = BenchmarkConfigSchema.parse({
      profiles: ['a'],
      tasks: ['t'],
    });
    expect(result.name).toBe('benchmark');
    expect(result.parallel).toBe(1);
    expect(result.output).toBe('./results');
    expect(result.timeout).toBeUndefined();
  });

  it('rejects empty profiles or tasks', () => {
    expect(BenchmarkConfigSchema.safeParse({ profiles: [], tasks: ['t'] }).success).toBe(false);
    expect(BenchmarkConfigSchema.safeParse({ profiles: ['a'], tasks: [] }).success).toBe(false);
  });

  it('rejects non-integer or sub-1 parallel', () => {
    expect(BenchmarkConfigSchema.safeParse({ profiles: ['a'], tasks: ['t'], parallel: 0 }).success).toBe(false);
    expect(BenchmarkConfigSchema.safeParse({ profiles: ['a'], tasks: ['t'], parallel: 2.5 }).success).toBe(false);
  });
});

describe('buildMatrix', () => {
  let fixtureDir: string;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'hoodstrut-bench-'));
    await writeFile(join(fixtureDir, 'profile-a.yaml'), PROFILE_YAML('profile-a'));
    await writeFile(join(fixtureDir, 'profile-b.yaml'), PROFILE_YAML('profile-b'));
    await writeFile(join(fixtureDir, 'dup-a.yaml'), PROFILE_YAML('Profile A'));
    await writeFile(join(fixtureDir, 'task-x.md'), TASK_MD('task-x'));
    await writeFile(join(fixtureDir, 'task-y.md'), TASK_MD('task-y'));
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it('builds the cartesian product with slug run ids', async () => {
    const config = BenchmarkConfigSchema.parse({
      profiles: [join(fixtureDir, 'profile-a.yaml'), join(fixtureDir, 'profile-b.yaml')],
      tasks: [join(fixtureDir, 'task-x.md'), join(fixtureDir, 'task-y.md')],
    });

    const matrix = await buildMatrix(config);

    expect(matrix.profiles).toHaveLength(2);
    expect(matrix.tasks).toHaveLength(2);
    expect(matrix.specs).toHaveLength(4);
    expect(matrix.specs.map(s => s.runId)).toEqual([
      'run-profile-a--task-x',
      'run-profile-a--task-y',
      'run-profile-b--task-x',
      'run-profile-b--task-y',
    ]);
  });

  it('collects all resolution errors before failing', async () => {
    const config = BenchmarkConfigSchema.parse({
      profiles: [join(fixtureDir, 'missing-1.yaml'), join(fixtureDir, 'profile-a.yaml')],
      tasks: [join(fixtureDir, 'missing-2.md')],
    });

    await expect(buildMatrix(config)).rejects.toThrow(/missing-1[\s\S]*missing-2/);
  });

  it('rejects profiles whose names collide after slugification', async () => {
    const config = BenchmarkConfigSchema.parse({
      profiles: [join(fixtureDir, 'profile-a.yaml'), join(fixtureDir, 'dup-a.yaml')],
      tasks: [join(fixtureDir, 'task-x.md')],
    });

    await expect(buildMatrix(config)).rejects.toThrow(/Duplicate profile name/);
  });
});

describe('loadBenchmarkConfig', () => {
  let fixtureDir: string;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'hoodstrut-bench-cfg-'));
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it('parses a valid YAML config', async () => {
    const path = join(fixtureDir, 'suite.yaml');
    await writeFile(path, `
name: full-suite
profiles: [a, b]
tasks: [x]
parallel: 3
`);

    const config = await loadBenchmarkConfig(path);
    expect(config.name).toBe('full-suite');
    expect(config.profiles).toEqual(['a', 'b']);
    expect(config.parallel).toBe(3);
  });

  it('throws a readable error for invalid config', async () => {
    const path = join(fixtureDir, 'bad.yaml');
    await writeFile(path, 'name: no-profiles-or-tasks\n');

    await expect(loadBenchmarkConfig(path)).rejects.toThrow(/Invalid benchmark config/);
  });
});

describe('summarizeBenchmark', () => {
  const config = BenchmarkConfigSchema.parse({ name: 'suite', profiles: ['a'], tasks: ['x'] });

  it('aggregates success, cost, and score', () => {
    const results = [
      makeRunResult({ success: true, cost: 0.1, score: 600 }),
      makeRunResult({ success: false, cost: 0.2, score: 100 }),
      makeRunResult({ success: true, cost: null, score: null }),
    ];

    const summary = summarizeBenchmark(config, results, [], 4, 120, '2026-07-11T00:00:00Z');

    expect(summary.total_runs).toBe(4);
    expect(summary.successful_runs).toBe(2);
    expect(summary.failed_runs).toBe(1);
    expect(summary.errored_runs).toBe(0);
    expect(summary.total_cost_usd).toBeCloseTo(0.3);
    expect(summary.total_score).toBe(700);
    expect(summary.duration_seconds).toBe(120);
  });

  it('records infrastructure errors', () => {
    const summary = summarizeBenchmark(
      config,
      [],
      [{ run_id: 'run-a--x', message: 'docker exploded' }],
      1,
      5,
      '2026-07-11T00:00:00Z'
    );

    expect(summary.errored_runs).toBe(1);
    expect(summary.errors[0].message).toBe('docker exploded');
    expect(summary.successful_runs).toBe(0);
    expect(summary.failed_runs).toBe(0);
  });

  it('separates task failures, timeouts, and verification errors', () => {
    const results = [
      makeRunResult({ success: false, status: 'failed' }),
      makeRunResult({ success: false, status: 'timed_out' }),
      makeRunResult({
        success: false,
        status: 'judge_error',
        errorType: 'judge_invalid_response',
        score: null,
      }),
    ];

    const summary = summarizeBenchmark(config, results, [], 3, 30, '2026-07-11T00:00:00Z');
    expect(summary.failed_runs).toBe(2);
    expect(summary.errored_runs).toBe(1);
    expect(summary.errors[0]).toMatchObject({
      type: 'judge_invalid_response',
      phase: 'judge',
    });
  });
});
