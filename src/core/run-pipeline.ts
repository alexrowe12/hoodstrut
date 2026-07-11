import { resolve, extname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { runContainer } from '../docker/index.js';
import { evaluateSuccess } from './success.js';
import { calculateScore } from './scorer.js';
import type { TelemetryConfig } from '../metrics/types.js';
import type { Profile, RunResult } from './types.js';
import type { TaskWithBody } from './task.js';

export function resolveProfilePath(nameOrPath: string): string {
  if (extname(nameOrPath) === '.yaml' || extname(nameOrPath) === '.yml') {
    return resolve(nameOrPath);
  }
  return resolve('./profiles', `${nameOrPath}.yaml`);
}

export function resolveTaskPath(idOrPath: string): string {
  if (extname(idOrPath) === '.md') {
    return resolve(idOrPath);
  }
  return resolve('./tasks', `${idOrPath}.md`);
}

export interface ExecuteRunOptions {
  profile: Profile;
  task: TaskWithBody;
  runId: string;
  outputDir: string;
  timeout?: number;
  verbose?: boolean;
  telemetry?: TelemetryConfig;
}

export interface ExecuteRunResult {
  runResult: RunResult;
  outputDir: string;
  duration: number;
}

/**
 * Execute a single profile/task run: container execution, success
 * evaluation, scoring, and persistence of run-result.json.
 *
 * Produces no console output, so multiple runs can execute
 * concurrently. Task failure (success=false) is a normal return;
 * only infrastructure errors (Docker, repo prep) throw.
 */
export async function executeRun(options: ExecuteRunOptions): Promise<ExecuteRunResult> {
  const { profile, task, runId, outputDir } = options;

  await mkdir(outputDir, { recursive: true });

  const executionResult = await runContainer({
    profile,
    task,
    outputDir,
    verbose: options.verbose ?? false,
    timeout: options.timeout,
    telemetry: options.telemetry,
  });

  const successResult = await evaluateSuccess({
    exitCode: executionResult.exitCode,
    stdout: executionResult.stdoutContent,
    stderr: executionResult.stderrContent,
    task: {
      success_command: task.success_command,
      success_patterns: task.success_patterns,
      ai_judge: task.ai_judge,
      ai_judge_criteria: task.ai_judge_criteria,
      title: task.title,
      body: task.body,
    },
    filesChanged: executionResult.filesChanged,
  });

  const warnings: string[] = [];
  if (!executionResult.metrics.success) {
    warnings.push(...executionResult.metrics.warnings);
  }

  const score = calculateScore({
    success: successResult.success,
    actualCost: executionResult.metrics.success ? executionResult.metrics.metrics.cost_usd : null,
    duration: executionResult.duration,
    difficulty: task.difficulty,
    estimatedTokens: task.estimated_tokens,
    expectedTime: task.expected_time,
    profileModel: profile.model,
  });

  const runResult: RunResult = {
    id: runId,
    timestamp: new Date().toISOString(),
    profile: {
      name: profile.name,
      model: profile.model,
      effort: profile.effort,
    },
    task: {
      id: task.id,
      title: task.title,
      difficulty: task.difficulty,
    },
    metrics: executionResult.metrics.success ? executionResult.metrics.metrics : null,
    result: {
      success: successResult.success,
      success_method: successResult.method,
      success_details: successResult.details,
      exit_code: executionResult.exitCode,
      files_modified: executionResult.filesChanged.modified,
      files_created: executionResult.filesChanged.created,
      files_deleted: executionResult.filesChanged.deleted,
    },
    score,
    logs: {
      stdout: executionResult.stdout,
      stderr: executionResult.stderr,
    },
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  await writeFile(
    resolve(outputDir, 'run-result.json'),
    JSON.stringify(runResult, null, 2),
    'utf-8'
  );

  return { runResult, outputDir, duration: executionResult.duration };
}
