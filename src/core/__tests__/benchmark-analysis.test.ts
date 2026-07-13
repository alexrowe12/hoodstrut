import { describe, expect, it } from 'vitest';
import type { RunResult } from '../types.js';
import { analyzeBenchmark, type ExpectedBenchmarkSample } from '../benchmark-analysis.js';

function result(id: string, profile: string, repetition: number, success: boolean, cost: number): RunResult {
  return {
    id,
    repetition,
    timestamp: '2026-07-12T00:00:00Z',
    profile: { name: profile, model: 'model', effort: 'medium' },
    task: { id: 'task', title: 'Task' },
    metrics: {
      tokens: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 2 },
      cost_usd: cost,
      duration_seconds: cost * 100,
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

function samples(profiles: string[], repetitions: number): ExpectedBenchmarkSample[] {
  return profiles.flatMap(profile => Array.from({ length: repetitions }, (_, index) => ({
    runId: `${profile}-${index + 1}`,
    profileName: profile,
    taskId: 'task',
    taskTitle: 'Task',
    repetition: index + 1,
  })));
}

describe('analyzeBenchmark', () => {
  it('makes correctness dominate efficiency', () => {
    const expected = samples(['reliable', 'cheap-failure'], 2);
    const results = [
      result('reliable-1', 'reliable', 1, true, 10),
      result('reliable-2', 'reliable', 2, true, 10),
      result('cheap-failure-1', 'cheap-failure', 1, true, 0.01),
      result('cheap-failure-2', 'cheap-failure', 2, false, 0.01),
    ];
    const analysis = analyzeBenchmark({ results, repetitions: 2, expectedSamples: expected });
    expect(analysis.profiles[0].name).toBe('reliable');
    expect(analysis.profiles[0].passed).toBe(2);
  });

  it('uses cost per pass only after exact correctness ties', () => {
    const expected = samples(['cheap', 'expensive'], 4);
    const results = expected.map(sample => result(
      sample.runId,
      sample.profileName,
      sample.repetition,
      true,
      sample.profileName === 'cheap' ? 1 : 2
    ));
    const analysis = analyzeBenchmark({ results, repetitions: 4, expectedSamples: expected });
    expect(analysis.profiles[0].name).toBe('cheap');
    expect(analysis.decision.winner).toBe('cheap');
  });

  it('makes missing samples ineligible and withholds a winner', () => {
    const expected = samples(['complete', 'partial'], 2);
    const results = [
      result('complete-1', 'complete', 1, true, 1),
      result('complete-2', 'complete', 2, true, 1),
      result('partial-1', 'partial', 1, true, 0.01),
    ];
    const analysis = analyzeBenchmark({ results, repetitions: 2, expectedSamples: expected });
    expect(analysis.profiles.find(profile => profile.name === 'partial')?.eligible).toBe(false);
    expect(analysis.decision.status).toBe('incomplete');
    expect(analysis.decision.winner).toBeNull();
  });

  it('does not double-count an errored result also listed in the summary errors', () => {
    const errored = result('a-1', 'a', 1, false, 1);
    errored.result.status = 'judge_error';
    const analysis = analyzeBenchmark({
      results: [errored],
      repetitions: 1,
      expectedSamples: samples(['a'], 1),
      errors: [{ run_id: 'a-1' }],
    });
    expect(analysis.observed_samples).toBe(1);
    expect(analysis.errored).toBe(1);
    expect(analysis.missing).toBe(0);
  });

  it('withholds a winner for a single repetition', () => {
    const expected = samples(['a', 'b'], 1);
    const results = [result('a-1', 'a', 1, true, 1), result('b-1', 'b', 1, false, 1)];
    const analysis = analyzeBenchmark({ results, repetitions: 1, expectedSamples: expected });
    expect(analysis.decision.status).toBe('insufficient_repetitions');
    expect(analysis.decision.leader).toBe('a');
    expect(analysis.decision.winner).toBeNull();
  });

  it('declares correctness only when confidence intervals separate', () => {
    const expected = samples(['a', 'b'], 100);
    const results = expected.map(sample => result(
      sample.runId,
      sample.profileName,
      sample.repetition,
      sample.profileName === 'a',
      1
    ));
    const analysis = analyzeBenchmark({ results, repetitions: 100, expectedSamples: expected });
    expect(analysis.decision.status).toBe('winner');
    expect(analysis.decision.winner).toBe('a');
  });
});
