import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dir as tmpDir } from 'tmp-promise';
import type { ExecutorOptions, ExecutionResult } from './types.js';
import type { MetricsResult, RunMetrics } from '../metrics/types.js';
import { prepareRepo } from './repo-preparer.js';
import { prepareProfileRuntime, buildEnvVars, PROFILE_RUNTIME_FILENAME } from './config-injector.js';
import {
  createCaptureStreams,
  pipeWithLogging,
  closeCaptureStreams,
  type CaptureStreams,
} from './output-capture.js';
import { collectWorkspaceArtifacts, establishWorkspaceBaseline } from './workspace-artifacts.js';
import { ExecutionPhaseError } from './errors.js';
import { buildRunnerImage } from './runner-image.js';

const DEFAULT_TIMEOUT = 300;
const METRICS_FILENAME = 'metrics.json';

// Names of containers currently running, so we can force-remove them if the
// host process is interrupted (Ctrl-C during a `benchmark --parallel N` would
// otherwise orphan every in-flight `--rm` container).
const activeContainers = new Set<string>();
let signalHandlersInstalled = false;

function installSignalHandlers(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;

  const cleanupAndExit = (signal: NodeJS.Signals) => {
    for (const name of activeContainers) {
      // Synchronous best-effort removal — the handler may be the last thing
      // that runs before the process exits.
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    }
    activeContainers.clear();
    // Re-raise with the default disposition so the exit code reflects the signal.
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  };

  process.once('SIGINT', () => cleanupAndExit('SIGINT'));
  process.once('SIGTERM', () => cleanupAndExit('SIGTERM'));
}

function forceRemoveContainer(name: string): void {
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
}

export async function runContainer(options: ExecutorOptions): Promise<ExecutionResult> {
  const { profile, task, outputDir, verbose = false, telemetry } = options;
  const timeout = resolveRunTimeout(options.timeout, task.timeout, profile.settings?.timeout);
  const envVars = buildEnvVars(profile, telemetry);

  await mkdir(outputDir, { recursive: true });

  installSignalHandlers();
  const runName = `hoodstrut-${randomUUID().slice(0, 8)}`;
  const { path: workspaceDir, cleanup: cleanupWorkspace } = await tmpDir({ unsafeCleanup: true });
  const { path: baselineDir, cleanup: cleanupBaseline } = await tmpDir({ unsafeCleanup: true });
  const { path: containerArtifactsDir, cleanup: cleanupContainerArtifacts } = await tmpDir({ unsafeCleanup: true });
  const { path: profileConfigDir, cleanup: cleanupProfileConfig } = await tmpDir({ unsafeCleanup: true });
  let streams: Awaited<ReturnType<typeof createCaptureStreams>> | undefined;
  let streamsClosed = false;

  try {
    const preparedRepository = await prepareRepo({
      repo: task.repo,
      branch: task.branch,
      commit: task.commit,
      destDir: workspaceDir,
    });

    await prepareProfileRuntime(profile, profileConfigDir);
    const runner = await buildRunnerImage();
    const image = runner.tag;
    const startTime = Date.now();
    const taskPrompt = buildTaskPrompt(task.title, task.body);
    streams = await createCaptureStreams(outputDir, verbose);

    if (task.setup_commands?.length) {
      const setupName = `${runName}-setup`;
      const setupResult = await runManagedContainer(
        buildDockerArgs({
          phase: 'setup', image, containerName: setupName, workspaceDir,
          artifactDir: containerArtifactsDir,
          envVars, timeout, commands: task.setup_commands, workingDir: task.working_dir,
        }),
        setupName,
        streams,
        verbose,
        timeout
      );
      if (setupResult.exitCode !== 0) {
        const code = setupResult.timedOut ? 'setup_timeout' : 'setup_failed';
        const message = setupResult.timedOut
          ? `Setup commands timed out after ${timeout}s`
          : `Setup commands failed with exit code ${setupResult.exitCode}`;
        throw new ExecutionPhaseError(code, 'setup', message, {
          timedOut: setupResult.timedOut,
          exitCode: setupResult.exitCode,
        });
      }
    }

    const baseline = await establishWorkspaceBaseline(workspaceDir, join(baselineDir, 'git'));

    const agentName = `${runName}-agent`;
    const agentResult = await runManagedContainer(
      buildDockerArgs({
        phase: 'agent', image, containerName: agentName, workspaceDir,
        artifactDir: containerArtifactsDir,
        envVars, timeout, workingDir: task.working_dir, taskPrompt, profileConfigDir,
      }),
      agentName,
      streams,
      verbose,
      timeout
    );
    await closeCaptureStreams(streams);
    streamsClosed = true;

    // Capture the agent's workspace before verification commands can create
    // coverage, snapshots, or other test artifacts of their own.
    const captured = await collectWorkspaceArtifacts(workspaceDir, outputDir, baseline);
    const agentDuration = Math.round((Date.now() - startTime) / 1000);
    const metrics = await readMetricsFile(containerArtifactsDir, agentDuration);
    await cp(
      join(containerArtifactsDir, METRICS_FILENAME),
      join(outputDir, METRICS_FILENAME)
    ).catch(() => undefined);

    let verifier: ExecutionResult['verifier'];
    let verifierOutput: string | undefined;
    if (!agentResult.timedOut && agentResult.exitCode === 0) {
      const verificationCommand = task.verification.type === 'ai_judge'
        ? task.verification.evidence_command
        : task.verification.command;
      verifierOutput = join(outputDir, 'verifier.log');
      const verifierTempDir = join(outputDir, '.verifier');
      const verifierStreams = await createCaptureStreams(verifierTempDir, verbose);
      let verifierStreamsClosed = false;
      const verifierName = `${runName}-verifier`;
      try {
        const verifierResult = await runManagedContainer(
          buildDockerArgs({
            phase: 'verify', image, containerName: verifierName, workspaceDir,
            artifactDir: containerArtifactsDir,
            envVars, timeout, command: verificationCommand, workingDir: task.working_dir,
          }),
          verifierName,
          verifierStreams,
          verbose,
          timeout
        );
        await closeCaptureStreams(verifierStreams);
        verifierStreamsClosed = true;
        const [verifierStdout, verifierStderr] = await Promise.all([
          readFile(verifierStreams.stdoutPath, 'utf-8').catch(() => ''),
          readFile(verifierStreams.stderrPath, 'utf-8').catch(() => ''),
        ]);
        await writeFile(
          verifierOutput,
          [
            `Command: ${verificationCommand}`,
            `Exit code: ${verifierResult.exitCode}`,
            `Timed out: ${verifierResult.timedOut}`,
            '',
            '=== stdout ===',
            verifierStdout,
            '=== stderr ===',
            verifierStderr,
          ].join('\n'),
          'utf-8'
        );
        verifier = {
          command: verificationCommand,
          exitCode: verifierResult.exitCode,
          timedOut: verifierResult.timedOut,
          duration: verifierResult.duration,
          stdout: verifierStdout,
          stderr: verifierStderr,
        };
      } finally {
        if (!verifierStreamsClosed) {
          await closeCaptureStreams(verifierStreams);
        }
        await rm(verifierTempDir, { recursive: true, force: true });
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    const [stdoutContent, stderrContent] = await Promise.all([
      readFile(streams.stdoutPath, 'utf-8').catch(() => ''),
      readFile(streams.stderrPath, 'utf-8').catch(() => ''),
    ]);

    return {
      containerId: agentResult.containerId,
      exitCode: verifier?.exitCode ?? agentResult.exitCode,
      agentExitCode: agentResult.exitCode,
      agentTimedOut: agentResult.timedOut,
      verifierExitCode: verifier?.exitCode,
      verifier,
      duration,
      stdout: streams.stdoutPath,
      stderr: streams.stderrPath,
      stdoutContent,
      stderrContent,
      filesChanged: captured.filesChanged,
      artifacts: {
        changesPatch: captured.patchPath,
        filesManifest: captured.manifestPath,
        verifierOutput,
      },
      metrics,
      provenance: {
        runner,
        repository: {
          source: preparedRepository.source,
          sourceType: preparedRepository.sourceType,
          requestedBranch: preparedRepository.requestedBranch,
          requestedCommit: preparedRepository.requestedCommit,
          resolvedCommit: preparedRepository.resolvedCommit,
          immutable: preparedRepository.immutable,
          contentSha256: preparedRepository.contentSha256,
        },
      },
    };
  } finally {
    if (streams && !streamsClosed) {
      await closeCaptureStreams(streams);
    }
    await cleanupWorkspace();
    await cleanupBaseline();
    await cleanupContainerArtifacts();
    await cleanupProfileConfig();
  }
}

export function resolveRunTimeout(
  override?: number,
  taskTimeout?: number,
  profileTimeout?: number
): number {
  return override ?? taskTimeout ?? profileTimeout ?? DEFAULT_TIMEOUT;
}

function buildTaskPrompt(title: string, body: string): string {
  return `# Task: ${title}\n\n${body}`;
}

interface DockerArgsOptions {
  phase: 'setup' | 'agent' | 'verify';
  image: string;
  containerName: string;
  workspaceDir: string;
  artifactDir: string;
  envVars: Record<string, string>;
  timeout: number;
  commands?: string[];
  command?: string;
  workingDir?: string;
  taskPrompt?: string;
  profileConfigDir?: string;
}

function buildDockerArgs(options: DockerArgsOptions): string[] {
  const args = [
    'run',
    '--rm',
    '--name', options.containerName,
    '-v', `${options.workspaceDir}:/workspace`,
    '--stop-timeout', String(options.timeout),
  ];

  if (options.phase === 'agent') {
    args.push('-v', `${options.artifactDir}:/hoodstrut-artifacts`);
    if (!options.profileConfigDir) throw new Error('Agent phase requires profileConfigDir');
    args.push('-v', `${options.profileConfigDir}:/root/.claude`);
  }

  for (const [key, value] of Object.entries(options.envVars)) {
    args.push('-e', `${key}=${value}`);
  }

  if (options.phase === 'setup') {
    args.push('-e', `SETUP_COMMANDS=${JSON.stringify(options.commands ?? [])}`);
  }

  if (options.phase === 'verify' && options.command) {
    args.push('-e', `SUCCESS_COMMAND=${options.command}`);
  }

  if (options.workingDir) {
    args.push('-e', `WORKING_DIR=/workspace/${options.workingDir}`);
  }

  if (options.phase === 'agent') {
    args.push('-e', 'METRICS_FILE=/hoodstrut-artifacts/metrics.json');
    args.push('-e', `PROFILE_CONFIG_FILE=/root/.claude/${PROFILE_RUNTIME_FILENAME}`);
  }

  if (options.phase !== 'agent') {
    args.push('--entrypoint', 'node');
  }

  args.push(options.image);
  if (options.phase === 'agent') {
    args.push(options.taskPrompt ?? '');
  } else {
    args.push('/run-phase.mjs', options.phase);
  }

  return args;
}

interface ContainerResult {
  exitCode: number;
  containerId: string;
  timedOut: boolean;
  duration: number;
}

async function runManagedContainer(
  args: string[],
  containerName: string,
  streams: Pick<CaptureStreams, 'stdoutStream' | 'stderrStream'>,
  verbose: boolean,
  timeout: number
): Promise<ContainerResult> {
  activeContainers.add(containerName);
  try {
    return await runDockerContainer(args, containerName, streams, verbose, timeout);
  } finally {
    forceRemoveContainer(containerName);
    activeContainers.delete(containerName);
  }
}

async function runDockerContainer(
  args: string[],
  containerName: string,
  streams: Pick<CaptureStreams, 'stdoutStream' | 'stderrStream'>,
  verbose: boolean,
  timeout: number
): Promise<ContainerResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let timedOut = false;
    const proc = spawn('docker', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    pipeWithLogging(proc.stdout, streams.stdoutStream, verbose, '[stdout]');
    pipeWithLogging(proc.stderr, streams.stderrStream, verbose, '[stderr]');

    const timeoutId = globalThis.setTimeout(() => {
      timedOut = true;
      // Kill the container by name — killing the `docker run` client alone does
      // NOT stop the container, so with `--rm` it would keep running orphaned.
      spawn('docker', ['kill', containerName], { stdio: 'ignore' });
    }, timeout * 1000);

    proc.on('close', (code) => {
      globalThis.clearTimeout(timeoutId);
      resolve({
        exitCode: code ?? 1,
        containerId: containerName,
        timedOut,
        duration: Math.round((Date.now() - startedAt) / 1000),
      });
    });

    proc.on('error', (err) => {
      globalThis.clearTimeout(timeoutId);
      reject(err);
    });
  });
}

async function runDockerCommand(
  args: string[],
  options: { silent?: boolean } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', args, {
      stdio: options.silent ? 'pipe' : 'inherit',
    });

    let output = '';

    if (proc.stdout) {
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });
    }

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(`Docker command failed with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

interface MetricsFileContent {
  success: boolean;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  turns: number;
  model: string;
  model_usage: Record<string, {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost_usd: number;
  }>;
  duration_ms: number;
  error?: string;
}

async function readMetricsFile(outputDir: string, fallbackDuration: number): Promise<MetricsResult> {
  const metricsPath = join(outputDir, METRICS_FILENAME);
  const warnings: string[] = [];

  try {
    const content = await readFile(metricsPath, 'utf-8');
    const data = JSON.parse(content) as MetricsFileContent;

    if (data.error) {
      warnings.push(`SDK reported error: ${data.error}`);
    }

    const metrics: RunMetrics = {
      tokens: {
        input_tokens: data.input_tokens || 0,
        output_tokens: data.output_tokens || 0,
        cache_read_tokens: data.cache_read_tokens || 0,
        cache_write_tokens: data.cache_write_tokens || 0,
        total_tokens: (data.input_tokens || 0) + (data.output_tokens || 0),
      },
      cost_usd: data.cost_usd || 0,
      duration_seconds: Math.round((data.duration_ms || 0) / 1000) || fallbackDuration,
      turns: data.turns || 0,
      model: data.model || 'unknown',
      model_usage: data.model_usage || {},
    };

    // Check if we got meaningful data
    if (metrics.tokens.total_tokens === 0 && metrics.cost_usd === 0) {
      warnings.push('Metrics file exists but contains no token/cost data');
      if (warnings.length > 0) {
        return { success: false, metrics: null, warnings };
      }
    }

    return { success: true, metrics };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('ENOENT')) {
      warnings.push('Metrics file not found - SDK may not have run correctly');
    } else {
      warnings.push(`Failed to parse metrics file: ${errorMessage}`);
    }

    return { success: false, metrics: null, warnings };
  }
}

export async function cleanup(containerId: string): Promise<void> {
  try {
    await runDockerCommand(['stop', containerId], { silent: true });
  } catch {
    // Container may already be stopped
  }

  try {
    await runDockerCommand(['rm', containerId], { silent: true });
  } catch {
    // Container may already be removed
  }
}
