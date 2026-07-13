import { describe, expect, it } from 'vitest';
import type { RunResult } from '../../core/types.js';
import { analyzeBenchmark } from '../../core/benchmark-analysis.js';
import { generateComparisonReport } from '../comparison.js';

function run(profile: string, task: string, repetition: number, success = true, cost = 0.1): RunResult {
  return {
    id: `run-${profile}--${task}--r${repetition}`,
    repetition,
    timestamp: '2026-07-12T00:00:00Z',
    profile: { name: profile, model: 'model', effort: 'medium' },
    task: { id: task, title: task },
    metrics: {
      tokens: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 2 },
      cost_usd: cost,
      duration_seconds: 60,
      turns: 1,
      model: 'model',
      model_usage: {},
    },
    result: {
      success,
      success_method: 'command',
      status: success ? 'passed' : 'failed',
      files_modified: [], files_created: [], files_deleted: [],
    },
    score: null,
    logs: { stdout: 'stdout.log', stderr: 'stderr.log' },
  };
}

describe('generateComparisonReport', () => {
  const generatedAt = '2026-07-12T12:00:00Z';

  it('compares correctness and cost without legacy point scores', () => {
    const a = [run('p', 't1', 1, true, 0.2), run('p', 't2', 1, false, 0.2)];
    const b = [run('p', 't1', 1, true, 0.1), run('p', 't2', 1, true, 0.1)];
    const report = generateComparisonReport(
      { label: 'A', results: a },
      { label: 'B', results: b },
      generatedAt
    );
    expect(report).toContain('# Comparison: A vs B');
    expect(report).toContain('| Passed | 1 | 2 | +1 |');
    expect(report).toContain('| `p` | 1/2 (50%)');
    expect(report).toContain('+50pp');
    expect(report).not.toContain('Total Score');
  });

  it('groups repetitions instead of overwriting task/profile pairs', () => {
    const a = [run('p', 't', 1), run('p', 't', 2, false)];
    const b = [run('p', 't', 1), run('p', 't', 2)];
    const report = generateComparisonReport(
      { label: 'A', results: a },
      { label: 'B', results: b },
      generatedAt
    );
    expect(report).toContain('| t | `p` | 1/2 passed');
    expect(report).toContain('| 2/2 passed');
  });

  it('warns when repetition counts or task sets differ', () => {
    const report = generateComparisonReport(
      { label: 'A', results: [run('p', 'only-a', 1), run('p', 'only-a', 2)] },
      { label: 'B', results: [run('p', 'only-b', 1)] },
      generatedAt
    );
    expect(report).toContain('## Compatibility Warnings');
    expect(report).toContain('Repetition counts differ');
    expect(report).toContain('Task sets differ');
  });

  it('warns and preserves missing samples from persisted analysis', () => {
    const results = [run('p', 't', 1)];
    const analysis = analyzeBenchmark({
      results,
      repetitions: 2,
      expectedSamples: [
        { runId: 'run-p--t--r1', profileName: 'p', taskId: 't', taskTitle: 't', repetition: 1 },
        { runId: 'run-p--t--r2', profileName: 'p', taskId: 't', taskTitle: 't', repetition: 2 },
      ],
    });
    const report = generateComparisonReport(
      { label: 'partial', results, analysis },
      { label: 'complete', results: [run('p', 't', 1), run('p', 't', 2)] },
      generatedAt
    );
    expect(report).toContain('At least one side is incomplete');
    expect(report).toContain('1/2 passed · 0 error · 1 missing');
  });
});
