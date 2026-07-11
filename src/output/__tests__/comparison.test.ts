import { describe, it, expect } from 'vitest';
import type { RunResult } from '../../core/types.js';
import { generateComparisonReport } from '../comparison.js';

function makeRunResult(overrides: {
  profile?: string;
  task?: string;
  success?: boolean;
  cost?: number | null;
  tokens?: number;
  score?: number | null;
}): RunResult {
  const cost = overrides.cost === undefined ? 0.1 : overrides.cost;
  const scoreValue = overrides.score === undefined ? 500 : overrides.score;
  const tokens = overrides.tokens ?? 1000;

  return {
    id: `run-${overrides.profile ?? 'p'}--${overrides.task ?? 't'}`,
    timestamp: '2026-07-11T00:00:00Z',
    profile: { name: overrides.profile ?? 'p', model: 'claude-sonnet-4-20250514', effort: 'medium' },
    task: { id: overrides.task ?? 't', title: 'Test' },
    metrics: cost === null ? null : {
      tokens: { input_tokens: tokens / 2, output_tokens: tokens / 2, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: tokens },
      cost_usd: cost,
      duration_seconds: 60,
      turns: 3,
      model: 'claude-sonnet-4-20250514',
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

const GENERATED_AT = '2026-07-11T12:00:00Z';

describe('generateComparisonReport', () => {
  it('includes both labels in the title and summary header', () => {
    const report = generateComparisonReport(
      { label: 'bench-a', results: [makeRunResult({})] },
      { label: 'bench-b', results: [makeRunResult({})] },
      GENERATED_AT
    );

    expect(report).toContain('# Comparison: bench-a vs bench-b');
    expect(report).toContain('| Metric | bench-a | bench-b | Δ |');
  });

  it('computes summary deltas with signs', () => {
    const a = [
      makeRunResult({ profile: 'p1', task: 't1', success: true, cost: 0.2, tokens: 2000, score: 400 }),
      makeRunResult({ profile: 'p1', task: 't2', success: false, cost: 0.2, tokens: 2000, score: 100 }),
    ];
    const b = [
      makeRunResult({ profile: 'p1', task: 't1', success: true, cost: 0.1, tokens: 1000, score: 600 }),
      makeRunResult({ profile: 'p1', task: 't2', success: true, cost: 0.1, tokens: 1000, score: 550 }),
    ];

    const report = generateComparisonReport(
      { label: 'A', results: a },
      { label: 'B', results: b },
      GENERATED_AT
    );

    // Success 50% -> 100% = +50pp
    expect(report).toContain('| Success Rate | 50% | 100% | +50pp |');
    // Cost 0.40 -> 0.20 = -$0.20 (-50%)
    expect(report).toContain('| Total Cost | $0.40 | $0.20 | -$0.20 (-50%) |');
    // Tokens 4000 -> 2000
    expect(report).toContain('| Total Tokens | 4,000 | 2,000 | -2,000 |');
    // Score 500 -> 1150
    expect(report).toContain('| Total Score | 500 | 1,150 | +650 |');
  });

  it('shows ±0 deltas for identical sides', () => {
    const results = [makeRunResult({ success: true, cost: 0.1, score: 500 })];
    const report = generateComparisonReport(
      { label: 'A', results },
      { label: 'B', results },
      GENERATED_AT
    );

    expect(report).toContain('| Success Rate | 100% | 100% | ±0pp |');
    expect(report).toContain('| Total Cost | $0.10 | $0.10 | ±$0 |');
  });

  it('matches runs on task id and profile name with per-run deltas', () => {
    const a = [makeRunResult({ profile: 'p1', task: 't1', cost: 0.2, score: 400 })];
    const b = [makeRunResult({ profile: 'p1', task: 't1', cost: 0.1, score: 600 })];

    const report = generateComparisonReport(
      { label: 'A', results: a },
      { label: 'B', results: b },
      GENERATED_AT
    );

    expect(report).toContain('| t1 | p1 | ✓ $0.20 (400) | ✓ $0.10 (600) | -$0.10 (-50%) | +200 |');
  });

  it('marks rows that exist on only one side', () => {
    const a = [makeRunResult({ profile: 'p1', task: 'only-in-a' })];
    const b = [makeRunResult({ profile: 'p1', task: 'only-in-b' })];

    const report = generateComparisonReport(
      { label: 'A', results: a },
      { label: 'B', results: b },
      GENERATED_AT
    );

    expect(report).toContain('| only-in-a | p1 | ✓ $0.10 (500) | — *(only in A)* | - | - |');
    expect(report).toContain('| only-in-b | p1 | — *(only in B)* | ✓ $0.10 (500) | - | - |');
  });

  it('renders dashes for runs with failed metrics extraction', () => {
    const a = [makeRunResult({ profile: 'p1', task: 't1', cost: null, score: null })];
    const b = [makeRunResult({ profile: 'p1', task: 't1', cost: 0.1, score: 600 })];

    const report = generateComparisonReport(
      { label: 'A', results: a },
      { label: 'B', results: b },
      GENERATED_AT
    );

    expect(report).toContain('| t1 | p1 | ✓ - (-) | ✓ $0.10 (600) | - | - |');
  });

  it('aggregates the profile section with success-rate deltas', () => {
    const a = [
      makeRunResult({ profile: 'p1', task: 't1', success: true, cost: 0.1, score: 500 }),
      makeRunResult({ profile: 'p1', task: 't2', success: false, cost: 0.1, score: 0 }),
    ];
    const b = [
      makeRunResult({ profile: 'p1', task: 't1', success: true, cost: 0.1, score: 500 }),
      makeRunResult({ profile: 'p1', task: 't2', success: true, cost: 0.1, score: 500 }),
    ];

    const report = generateComparisonReport(
      { label: 'A', results: a },
      { label: 'B', results: b },
      GENERATED_AT
    );

    expect(report).toContain('| p1 | 1/2 · $0.20 · 500 | 2/2 · $0.20 · 1,000 | +50pp | ±$0 | +500 |');
  });

  it('marks profiles that exist on only one side', () => {
    const a = [makeRunResult({ profile: 'only-a', task: 't1' })];
    const b = [makeRunResult({ profile: 'only-b', task: 't1' })];

    const report = generateComparisonReport(
      { label: 'A', results: a },
      { label: 'B', results: b },
      GENERATED_AT
    );

    expect(report).toContain('| only-a | 1/1 · $0.10 · 500 | — *(only in A)* | - | - | - |');
    expect(report).toContain('| only-b | — *(only in B)* | 1/1 · $0.10 · 500 | - | - | - |');
  });
});
