import { describe, it, expect } from 'vitest';
import type { RunResult } from '../../core/types.js';
import { buildReportModel } from '../report-model.js';
import { generateAggregateReport } from '../markdown.js';

function makeRunResult(overrides: {
  profile?: string;
  task?: string;
  taskTitle?: string;
  success?: boolean;
  cost?: number | null;
  score?: number | null;
}): RunResult {
  const cost = overrides.cost === undefined ? 0.1 : overrides.cost;
  const scoreValue = overrides.score === undefined ? 500 : overrides.score;

  return {
    id: `run-${overrides.profile ?? 'p'}--${overrides.task ?? 't'}`,
    timestamp: '2026-07-12T00:00:00Z',
    profile: { name: overrides.profile ?? 'p', model: 'claude-opus-4', effort: 'medium' },
    task: { id: overrides.task ?? 't', title: overrides.taskTitle ?? 'Test task' },
    metrics: cost === null ? null : {
      tokens: { input_tokens: 500, output_tokens: 500, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 1000 },
      cost_usd: cost,
      duration_seconds: 60,
      turns: 3,
      model: 'claude-opus-4',
      model_usage: {},
    },
    result: {
      success: overrides.success ?? true,
      success_method: 'command',
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

const GENERATED_AT = '2026-07-12T12:00:00Z';

// alpha wins t1 (900 vs 700) and t2 (600 vs 400) → total 1500 vs 1100.
function twoByTwo(): RunResult[] {
  return [
    makeRunResult({ profile: 'alpha', task: 't1', score: 900, cost: 0.2 }),
    makeRunResult({ profile: 'beta', task: 't1', score: 700, cost: 0.1 }),
    makeRunResult({ profile: 'alpha', task: 't2', score: 600, cost: 0.2 }),
    makeRunResult({ profile: 'beta', task: 't2', score: 400, cost: 0.1, success: false }),
  ];
}

describe('buildReportModel', () => {
  it('ranks profiles by total score, best first', () => {
    const model = buildReportModel(twoByTwo());
    expect(model.profiles.map(p => p.name)).toEqual(['alpha', 'beta']);
    expect(model.profiles[0].rank).toBe(1);
    expect(model.profiles[0].totalScore).toBe(1500);
    expect(model.winner?.name).toBe('alpha');
  });

  it('orders matrix rows by task total score, best first', () => {
    const model = buildReportModel(twoByTwo());
    // t1 total = 1600, t2 total = 1000
    expect(model.tasks.map(t => t.id)).toEqual(['t1', 't2']);
  });

  it('flags the best cell in each row and computes column totals', () => {
    const model = buildReportModel(twoByTwo());
    const t1 = model.matrix.get('t1')!;
    expect(t1.get('alpha')!.isBestInRow).toBe(true);
    expect(t1.get('beta')!.isBestInRow).toBe(false);
    expect(model.profileTotals.get('alpha')).toBe(1500);
    expect(model.profileTotals.get('beta')).toBe(1100);
  });

  it('marks a missing run as not-run in the matrix', () => {
    const results = [
      makeRunResult({ profile: 'alpha', task: 't1', score: 900 }),
      makeRunResult({ profile: 'beta', task: 't2', score: 400 }),
    ];
    const model = buildReportModel(results);
    expect(model.matrix.get('t1')!.get('beta')!.hasRun).toBe(false);
    expect(model.matrix.get('t2')!.get('alpha')!.hasRun).toBe(false);
  });

  it('ranks all runs by score descending', () => {
    const model = buildReportModel(twoByTwo());
    expect(model.rankedRuns.map(r => r.score)).toEqual([900, 700, 600, 400]);
    expect(model.rankedRuns[0].rank).toBe(1);
  });
});

describe('generateAggregateReport', () => {
  it('renders an empty report when there are no results', () => {
    const report = generateAggregateReport([], GENERATED_AT);
    expect(report).toContain('No results found.');
  });

  it('calls out the winning profile', () => {
    const report = generateAggregateReport(twoByTwo(), GENERATED_AT);
    expect(report).toContain('Winner: `alpha`');
  });

  it('renders a score matrix with profiles as columns ordered by rank', () => {
    const report = generateAggregateReport(twoByTwo(), GENERATED_AT);
    expect(report).toContain('## 📊 Score Matrix');
    // alpha (winner) column comes before beta.
    expect(report).toMatch(/\| Task \| 🥇 alpha \| 🥈 beta \|/);
    // Column totals footer.
    expect(report).toContain('| **Total** | **1,500** | **1,100** |');
  });

  it('bolds the best profile per task and marks pass/fail', () => {
    const report = generateAggregateReport(twoByTwo(), GENERATED_AT);
    // t1 row: alpha bold-best passing, beta plain passing.
    expect(report).toContain('| **t1** | **900** ✅ | 700 ✅ |');
    // t2 row: beta failed.
    expect(report).toContain('❌');
  });

  it('lists runs ranked by score under All Runs', () => {
    const report = generateAggregateReport(twoByTwo(), GENERATED_AT);
    const allRunsIndex = report.indexOf('## All Runs');
    const body = report.slice(allRunsIndex);
    const firstRow = body.split('\n').find(l => l.startsWith('| 1 |'));
    expect(firstRow).toContain('900');
  });
});
