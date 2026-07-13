import { resolve, extname } from 'node:path';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { runContainer } from '../docker/index.js';
import { evaluateSuccess } from './success.js';
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
  repetition?: number;
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

async function readBoundedEvidence(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const stats = await handle.stat();
    const bytesToRead = Math.min(stats.size, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    let offset = 0;
    while (offset < bytesToRead) {
      const { bytesRead } = await handle.read(buffer, offset, bytesToRead - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const content = buffer.subarray(0, offset).toString('utf-8');
    return stats.size > maxBytes
      ? `${content}\n... [artifact truncated; original ${stats.size} bytes]`
      : content;
  } finally {
    await handle.close();
  }
}

/**
 * Execute a single profile/task run: container execution, success
 * evaluation and persistence of run-result.json. Benchmark-level analysis
 * ranks correctness before efficiency; new runs do not receive additive points.
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

  const [patch, manifest] = task.verification.type === 'ai_judge'
    ? await Promise.all([
        readBoundedEvidence(executionResult.artifacts.changesPatch, 30_000),
        readBoundedEvidence(executionResult.artifacts.filesManifest, 8_000),
      ])
    : ['', ''];

  const successResult = await evaluateSuccess({
    agentExitCode: executionResult.agentExitCode,
    agentTimedOut: executionResult.agentTimedOut,
    verification: task.verification,
    verifier: executionResult.verifier,
    task: { title: task.title, body: task.body },
    patch,
    manifest,
  });

  let judgeOutput: string | undefined;
  if (successResult.judgeArtifact) {
    judgeOutput = resolve(outputDir, 'judge-result.json');
    await writeFile(judgeOutput, JSON.stringify(successResult.judgeArtifact, null, 2), 'utf-8');
  }

  const warnings: string[] = [];
  if (!executionResult.metrics.success) {
    warnings.push(...executionResult.metrics.warnings);
  }

  const score = null;

  const runResult: RunResult = {
    id: runId,
    repetition: options.repetition ?? 1,
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
      status: successResult.status,
      error_type: successResult.errorType,
      success_details: successResult.details,
      exit_code: executionResult.exitCode,
      agent_exit_code: executionResult.agentExitCode,
      verifier_exit_code: executionResult.verifierExitCode,
      files_modified: executionResult.filesChanged.modified,
      files_created: executionResult.filesChanged.created,
      files_deleted: executionResult.filesChanged.deleted,
    },
    score,
    logs: {
      stdout: executionResult.stdout,
      stderr: executionResult.stderr,
    },
    artifacts: {
      changes_patch: executionResult.artifacts.changesPatch,
      files_manifest: executionResult.artifacts.filesManifest,
      verifier_output: executionResult.artifacts.verifierOutput,
      judge_output: judgeOutput,
    },
    warnings: warnings.length > 0 ? warnings : undefined,
    provenance: {
      hoodstrut_version: executionResult.provenance.runner.hoodstrutVersion,
      runner: {
        tag: executionResult.provenance.runner.tag,
        build_inputs_sha256: executionResult.provenance.runner.buildInputsSha256,
        image_id: executionResult.provenance.runner.imageId,
        repo_digests: executionResult.provenance.runner.repoDigests,
        platform: executionResult.provenance.runner.platform,
      },
      repository: {
        source: executionResult.provenance.repository.source,
        source_type: executionResult.provenance.repository.sourceType,
        requested_branch: executionResult.provenance.repository.requestedBranch,
        requested_commit: executionResult.provenance.repository.requestedCommit,
        resolved_commit: executionResult.provenance.repository.resolvedCommit,
        immutable: executionResult.provenance.repository.immutable,
        content_sha256: executionResult.provenance.repository.contentSha256,
      },
      runtime: {
        node: executionResult.provenance.runner.versions.node,
        npm: executionResult.provenance.runner.versions.npm,
        git: executionResult.provenance.runner.versions.git,
        python: executionResult.provenance.runner.versions.python,
        claude_code: executionResult.provenance.runner.versions.claudeCode,
        agent_sdk: executionResult.provenance.runner.versions.agentSdk,
      },
      docker: {
        server_version: executionResult.provenance.runner.docker.serverVersion,
        api_version: executionResult.provenance.runner.docker.apiVersion,
        os: executionResult.provenance.runner.docker.os,
        architecture: executionResult.provenance.runner.docker.architecture,
      },
    },
  };

  await writeFile(
    resolve(outputDir, 'run-result.json'),
    JSON.stringify(runResult, null, 2),
    'utf-8'
  );

  return { runResult, outputDir, duration: executionResult.duration };
}
