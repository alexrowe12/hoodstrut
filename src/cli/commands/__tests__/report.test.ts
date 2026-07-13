import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RunResult } from '../../../core/types.js';
import { analyzeBenchmark } from '../../../core/benchmark-analysis.js';
import { generateReport } from '../report.js';

describe('generateReport', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('recomputes persisted analysis so deleted result directories become missing samples', async () => {
    directory = await mkdtemp(join(tmpdir(), 'hoodstrut-report-'));
    const run: RunResult = {
      id: 'run-p--t--r001',
      repetition: 1,
      timestamp: '2026-07-12T00:00:00Z',
      profile: { name: 'p', model: 'model', effort: 'medium' },
      task: { id: 't', title: 'Task' },
      metrics: {
        tokens: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 2 },
        cost_usd: 0.1,
        duration_seconds: 10,
        turns: 1,
        model: 'model',
        model_usage: {},
      },
      result: {
        success: true,
        success_method: 'command',
        status: 'passed',
        files_modified: [], files_created: [], files_deleted: [],
      },
      score: null,
      logs: { stdout: 'stdout.log', stderr: 'stderr.log' },
    };
    const expectedSamples = [1, 2].map(repetition => ({
      runId: `run-p--t--r${String(repetition).padStart(3, '0')}`,
      profileName: 'p',
      taskId: 't',
      taskTitle: 'Task',
      repetition,
    }));
    const originalAnalysis = analyzeBenchmark({
      results: [run, { ...run, id: 'run-p--t--r002', repetition: 2 }],
      repetitions: 2,
      expectedSamples,
    });
    await writeFile(join(directory, 'benchmark.json'), JSON.stringify({
      name: 'suite',
      timestamp: '2026-07-12T00:00:00Z',
      config: { profiles: ['p'], tasks: ['t'], repetitions: 2 },
      duration_seconds: 10,
      total_runs: 2,
      successful_runs: 2,
      failed_runs: 0,
      errored_runs: 0,
      total_cost_usd: 0.2,
      methodology: 'lexicographic-v2',
      analysis: originalAnalysis,
      errors: [],
    }), 'utf-8');
    const runDirectory = join(directory, run.id);
    await mkdir(runDirectory);
    await writeFile(join(runDirectory, 'run-result.json'), JSON.stringify(run), 'utf-8');

    const reportPath = await generateReport(directory);
    const report = await readFile(reportPath, 'utf-8');
    expect(report).toContain('1 missing');
    expect(report).toContain('ineligible');
  });
});
