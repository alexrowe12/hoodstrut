import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  BenchmarkConfigSchema,
  type BenchmarkConfig,
  type BenchmarkSummary,
  type Profile,
  type RunResult,
} from './types.js';
import { loadProfile } from './profile.js';
import { loadTask, type TaskWithBody } from './task.js';
import { executeRun, resolveProfilePath, resolveTaskPath } from './run-pipeline.js';
import { mapWithConcurrency } from './pool.js';
import { buildRunnerImage } from '../docker/index.js';
import type { TelemetryConfig } from '../metrics/types.js';
import { ExecutionPhaseError } from '../docker/errors.js';
import { analyzeBenchmark, type ExpectedBenchmarkSample } from './benchmark-analysis.js';

export interface BenchmarkError {
  run_id: string;
  message: string;
  type?: string;
  phase?: 'setup' | 'agent' | 'verifier' | 'judge' | 'infrastructure';
}

export async function loadBenchmarkConfig(path: string): Promise<BenchmarkConfig> {
  const content = await readFile(path, 'utf-8');
  const data = parseYaml(content);
  const result = BenchmarkConfigSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.errors
      .map(e => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Invalid benchmark config at ${path}:\n${errors}`);
  }

  return result.data;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface BenchmarkRunSpec {
  profile: Profile;
  task: TaskWithBody;
  runId: string;
  repetition: number;
}

export interface ResolvedMatrix {
  profiles: Profile[];
  tasks: TaskWithBody[];
  specs: BenchmarkRunSpec[];
}

/**
 * Resolve and load every profile and task, then build the cartesian
 * product of run specs. Fails fast with all resolution errors
 * collected, before anything runs.
 */
export async function buildMatrix(config: BenchmarkConfig): Promise<ResolvedMatrix> {
  const errors: string[] = [];

  const profiles: Profile[] = [];
  for (const ref of config.profiles) {
    try {
      profiles.push(await loadProfile(resolveProfilePath(ref)));
    } catch (error) {
      errors.push(`profile "${ref}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const tasks: TaskWithBody[] = [];
  for (const ref of config.tasks) {
    try {
      tasks.push(await loadTask(resolveTaskPath(ref)));
    } catch (error) {
      errors.push(`task "${ref}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Failed to load benchmark inputs:\n  - ${errors.join('\n  - ')}`);
  }

  const profileSlugs = new Map<string, string>();
  for (const profile of profiles) {
    const slug = slugify(profile.name);
    const existing = profileSlugs.get(slug);
    if (existing !== undefined) {
      throw new Error(`Duplicate profile name in benchmark: "${profile.name}" collides with "${existing}"`);
    }
    profileSlugs.set(slug, profile.name);
  }

  const taskSlugs = new Map<string, string>();
  for (const task of tasks) {
    const slug = slugify(task.id);
    const existing = taskSlugs.get(slug);
    if (existing !== undefined) {
      throw new Error(`Duplicate task id in benchmark: "${task.id}" collides with "${existing}"`);
    }
    taskSlugs.set(slug, task.id);
  }

  const specs: BenchmarkRunSpec[] = [];
  for (const profile of profiles) {
    for (const task of tasks) {
      for (let repetition = 1; repetition <= config.repetitions; repetition++) {
        const suffix = config.repetitions > 1
          ? `--r${String(repetition).padStart(3, '0')}`
          : '';
        specs.push({
          profile,
          task,
          repetition,
          runId: `run-${slugify(profile.name)}--${slugify(task.id)}${suffix}`,
        });
      }
    }
  }

  return { profiles, tasks, specs };
}

export interface BenchmarkProgress {
  completed: number;
  total: number;
  spec: BenchmarkRunSpec;
  result?: RunResult;
  error?: string;
  errorType?: string;
  errorPhase?: BenchmarkError['phase'];
}

function classifyThrownError(runId: string, error: Error): BenchmarkError {
  if (error instanceof ExecutionPhaseError) {
    return {
      run_id: runId,
      message: error.message,
      type: error.code,
      phase: error.phase,
    };
  }
  return {
    run_id: runId,
    message: error.message,
    type: 'infrastructure_error',
    phase: 'infrastructure',
  };
}

export interface RunBenchmarkOptions {
  telemetry?: TelemetryConfig;
  onProgress?: (progress: BenchmarkProgress) => void;
}

export interface RunBenchmarkResult {
  summary: BenchmarkSummary;
  benchmarkDir: string;
  results: RunResult[];
}

function benchmarkDirName(name: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `benchmark-${slugify(name)}-${stamp}`;
}

export function summarizeBenchmark(
  config: BenchmarkConfig,
  results: RunResult[],
  errors: BenchmarkError[],
  totalRuns: number,
  durationSeconds: number,
  timestamp: string,
  expectedSamples?: ExpectedBenchmarkSample[]
): BenchmarkSummary {
  const successful = results.filter(r => r.result.success).length;
  const failed = results.filter(r => {
    const status = r.result.status;
    return status ? status === 'failed' || status === 'timed_out' : !r.result.success;
  }).length;
  const resultErrors: BenchmarkError[] = results.flatMap(result => {
    const status = result.result.status;
    if (!status || !['agent_error', 'verification_error', 'judge_error'].includes(status)) return [];
    const phase = status === 'agent_error' ? 'agent' : status === 'judge_error' ? 'judge' : 'verifier';
    return [{
      run_id: result.id,
      message: result.result.success_details ?? status,
      type: result.result.error_type ?? status,
      phase,
    }];
  });
  const allErrors = [...errors, ...resultErrors];

  const analysis = expectedSamples
    ? analyzeBenchmark({
        results,
        repetitions: config.repetitions,
        expectedSamples,
        errors: allErrors,
      })
    : undefined;

  return {
    name: config.name,
    timestamp,
    config,
    duration_seconds: durationSeconds,
    total_runs: totalRuns,
    successful_runs: analysis?.passed ?? successful,
    failed_runs: analysis ? analysis.failed + analysis.timed_out : failed,
    errored_runs: analysis?.errored ?? allErrors.length,
    total_cost_usd: analysis
      ? analysis.profiles.reduce((sum, profile) => sum + profile.total_cost_usd, 0)
      : results.reduce((sum, r) => sum + (r.metrics?.cost_usd ?? 0), 0),
    methodology: analysis?.methodology,
    analysis,
    errors: allErrors,
  };
}

export async function runBenchmark(
  config: BenchmarkConfig,
  options: RunBenchmarkOptions = {}
): Promise<RunBenchmarkResult> {
  const matrix = await buildMatrix(config);

  const startedAt = new Date();
  const benchmarkDir = resolve(config.output, benchmarkDirName(config.name, startedAt));
  await mkdir(benchmarkDir, { recursive: true });

  // Build the image once up front so concurrent runs don't race the build
  await buildRunnerImage();

  let completed = 0;
  const poolResults = await mapWithConcurrency(matrix.specs, config.parallel, async (spec) => {
    try {
      const { runResult } = await executeRun({
        profile: spec.profile,
        task: spec.task,
        runId: spec.runId,
        repetition: spec.repetition,
        outputDir: join(benchmarkDir, spec.runId),
        timeout: config.timeout,
        verbose: false,
        telemetry: options.telemetry,
      });
      completed++;
      options.onProgress?.({ completed, total: matrix.specs.length, spec, result: runResult });
      return runResult;
    } catch (error) {
      completed++;
      const normalized = error instanceof Error ? error : new Error(String(error));
      const classified = classifyThrownError(spec.runId, normalized);
      options.onProgress?.({
        completed,
        total: matrix.specs.length,
        spec,
        error: classified.message,
        errorType: classified.type,
        errorPhase: classified.phase,
      });
      throw normalized;
    }
  });

  const results: RunResult[] = [];
  const errors: BenchmarkError[] = [];

  for (let i = 0; i < poolResults.length; i++) {
    const poolResult = poolResults[i];
    if (poolResult.ok) {
      results.push(poolResult.value);
    } else {
      errors.push(classifyThrownError(matrix.specs[i].runId, poolResult.error));
    }
  }

  const durationSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000);
  const summary = summarizeBenchmark(
    config,
    results,
    errors,
    matrix.specs.length,
    durationSeconds,
    startedAt.toISOString(),
    matrix.specs.map(spec => ({
      runId: spec.runId,
      profileName: spec.profile.name,
      taskId: spec.task.id,
      taskTitle: spec.task.title,
      repetition: spec.repetition,
    }))
  );

  await writeFile(
    join(benchmarkDir, 'benchmark.json'),
    JSON.stringify(summary, null, 2),
    'utf-8'
  );

  return { summary, benchmarkDir, results };
}
