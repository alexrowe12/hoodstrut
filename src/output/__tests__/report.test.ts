import { describe, expect, it } from 'vitest';
import type { RunResult } from '../../core/types.js';
import { buildReportModel } from '../report-model.js';
import { generateAggregateReport } from '../markdown.js';

function makeRun(profile: string, task: string, repetition: number, success: boolean, cost: number): RunResult {
  return {
    id: `run-${profile}--${task}--r${String(repetition).padStart(3, '0')}`,
    repetition,
    timestamp: '2026-07-12T00:00:00Z',
    profile: { name: profile, model: 'model', effort: 'medium' },
    task: { id: task, title: `Task ${task}` },
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

function repeatedTwoByTwo(): RunResult[] {
  return [1, 2].flatMap(repetition => [
    makeRun('alpha', 't1', repetition, true, 0.2),
    makeRun('beta', 't1', repetition, true, 0.1),
    makeRun('alpha', 't2', repetition, true, 0.2),
    makeRun('beta', 't2', repetition, false, 0.1),
  ]);
}

describe('buildReportModel', () => {
  it('ranks correctness before cost', () => {
    const model = buildReportModel(repeatedTwoByTwo());
    expect(model.profiles.map(profile => profile.name)).toEqual(['alpha', 'beta']);
    expect(model.profiles[0].passed).toBe(4);
    expect(model.profiles[0].rank).toBe(1);
  });

  it('aggregates repetitions into one task/profile cell', () => {
    const cell = buildReportModel(repeatedTwoByTwo()).matrix.get('t1')!.get('beta')!;
    expect(cell.expected_samples).toBe(2);
    expect(cell.valid_samples).toBe(2);
    expect(cell.passed).toBe(2);
    expect(cell.mean_cost_usd).toBeCloseTo(0.1);
  });

  it('marks inferred missing samples explicitly and makes the profile incomplete', () => {
    const results = repeatedTwoByTwo().filter(run =>
      !(run.profile.name === 'beta' && run.task.id === 't2' && run.repetition === 2)
    );
    const model = buildReportModel(results);
    const cell = model.matrix.get('t2')!.get('beta')!;
    expect(cell.missing).toBe(1);
    expect(cell.complete).toBe(false);
    expect(model.profiles.find(profile => profile.name === 'beta')?.eligible).toBe(false);
    expect(model.analysis.decision.status).toBe('incomplete');
  });

  it('lists every repetition without collapsing duplicate task/profile pairs', () => {
    const model = buildReportModel(repeatedTwoByTwo());
    expect(model.rankedRuns).toHaveLength(8);
    expect(model.rankedRuns.filter(run => run.taskId === 't1' && run.profile === 'alpha').map(run => run.repetition)).toEqual([1, 2]);
  });
});

describe('generateAggregateReport', () => {
  const generatedAt = '2026-07-12T12:00:00Z';

  it('renders an empty report when there is no result or persisted analysis', () => {
    expect(generateAggregateReport([], generatedAt)).toContain('No results found.');
  });

  it('labels an unsupported point estimate as a provisional leader', () => {
    const report = generateAggregateReport(repeatedTwoByTwo(), generatedAt);
    expect(report).toContain('Provisional leader: `alpha`');
    expect(report).toContain('do not support a winner claim');
  });

  it('renders repeated sample groups and confidence information', () => {
    const report = generateAggregateReport(repeatedTwoByTwo(), generatedAt);
    expect(report).toContain('## Results Matrix');
    expect(report).toContain('2/2 · $0.10 · 1m');
    expect(report).toContain('Success (95% CI)');
    expect(report).toContain('## Individual Runs');
  });
});
