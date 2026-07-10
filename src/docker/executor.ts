import { spawn } from 'node:child_process';
import { mkdir, cp, readdir, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dir as tmpDir } from 'tmp-promise';
import type { ExecutorOptions, ExecutionResult } from './types.js';
import { prepareRepo } from './repo-preparer.js';
import { injectConfig, buildEnvVars } from './config-injector.js';
import { createCaptureStreams, pipeWithLogging, closeCaptureStreams } from './output-capture.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCKER_IMAGE = 'hoodstrut-runner:latest';
const DEFAULT_TIMEOUT = 300;

export async function buildRunnerImage(force: boolean = false): Promise<string> {
  if (!force) {
    const exists = await imageExists(DOCKER_IMAGE);
    if (exists) {
      return DOCKER_IMAGE;
    }
  }

  const templatesDir = resolve(__dirname, 'templates');
  const scriptsDir = resolve(__dirname, 'scripts');

  const { path: buildContext, cleanup } = await tmpDir({ unsafeCleanup: true });

  try {
    await cp(join(templatesDir, 'Dockerfile.runner'), join(buildContext, 'Dockerfile'));
    await mkdir(join(buildContext, 'scripts'));
    await cp(join(scriptsDir, 'run-task.sh'), join(buildContext, 'scripts', 'run-task.sh'));

    await runDockerCommand(['build', '-t', DOCKER_IMAGE, buildContext]);

    return DOCKER_IMAGE;
  } finally {
    await cleanup();
  }
}

async function imageExists(imageName: string): Promise<boolean> {
  try {
    await runDockerCommand(['image', 'inspect', imageName], { silent: true });
    return true;
  } catch {
    return false;
  }
}

export async function runContainer(options: ExecutorOptions): Promise<ExecutionResult> {
  const { profile, task, outputDir, verbose = false } = options;
  const timeout = options.timeout ?? task.timeout ?? DEFAULT_TIMEOUT;

  await mkdir(outputDir, { recursive: true });

  const { path: workspaceDir, cleanup: cleanupWorkspace } = await tmpDir({ unsafeCleanup: true });
  const otelDir = join(outputDir, 'otel');
  const containerOtelDir = '/workspace/.otel';

  try {
    await prepareRepo({
      repo: task.repo,
      branch: task.branch,
      destDir: workspaceDir,
    });

    const filesBefore = await listFilesRecursive(workspaceDir);

    await injectConfig(profile, workspaceDir);

    await mkdir(otelDir, { recursive: true });

    const image = await buildRunnerImage();

    const startTime = Date.now();

    const envVars = buildEnvVars(profile, containerOtelDir);

    const taskPrompt = buildTaskPrompt(task.title, task.body);

    const dockerArgs = buildDockerArgs({
      image,
      workspaceDir,
      otelDir,
      envVars,
      timeout,
      setupCommands: task.setup_commands,
      successCommand: task.success_command,
      workingDir: task.working_dir,
      taskPrompt,
    });

    const streams = await createCaptureStreams(outputDir, verbose);

    const { exitCode, containerId } = await runDockerContainer(dockerArgs, streams, verbose, timeout);

    await closeCaptureStreams(streams);

    const duration = Math.round((Date.now() - startTime) / 1000);

    const filesAfter = await listFilesRecursive(workspaceDir);
    const filesChanged = computeFileChanges(filesBefore, filesAfter);

    const success = task.success_command ? exitCode === 0 : exitCode === 0;
    const successMethod = task.success_command ? 'command' : 'exit_code';

    await copyOtelLogs(profile.name, otelDir);

    return {
      containerId,
      exitCode,
      duration,
      stdout: streams.stdoutPath,
      stderr: streams.stderrPath,
      otelDir,
      success,
      successMethod,
      filesChanged,
    };
  } finally {
    await cleanupWorkspace();
  }
}

function buildTaskPrompt(title: string, body: string): string {
  return `# Task: ${title}\n\n${body}`;
}

interface DockerArgsOptions {
  image: string;
  workspaceDir: string;
  otelDir: string;
  envVars: Record<string, string>;
  timeout: number;
  setupCommands?: string[];
  successCommand?: string;
  workingDir?: string;
  taskPrompt: string;
}

function buildDockerArgs(options: DockerArgsOptions): string[] {
  const args = [
    'run',
    '--rm',
    '-v', `${options.workspaceDir}:/workspace`,
    '-v', `${options.otelDir}:/workspace/.otel`,
    '--stop-timeout', String(options.timeout),
  ];

  for (const [key, value] of Object.entries(options.envVars)) {
    args.push('-e', `${key}=${value}`);
  }

  if (options.setupCommands?.length) {
    args.push('-e', `SETUP_COMMANDS=${JSON.stringify(options.setupCommands)}`);
  }

  if (options.successCommand) {
    args.push('-e', `SUCCESS_COMMAND=${options.successCommand}`);
  }

  if (options.workingDir) {
    args.push('-e', `WORKING_DIR=/workspace/${options.workingDir}`);
  }

  args.push(options.image);
  args.push(options.taskPrompt);

  return args;
}

interface ContainerResult {
  exitCode: number;
  containerId: string;
}

async function runDockerContainer(
  args: string[],
  streams: Awaited<ReturnType<typeof createCaptureStreams>>,
  verbose: boolean,
  timeout: number
): Promise<ContainerResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let containerId = `docker-${proc.pid}`;

    pipeWithLogging(proc.stdout, streams.stdoutStream, verbose, '[stdout]');
    pipeWithLogging(proc.stderr, streams.stderrStream, verbose, '[stderr]');

    const timeoutId = globalThis.setTimeout(() => {
      proc.kill('SIGTERM');
    }, timeout * 1000);

    proc.on('close', (code) => {
      globalThis.clearTimeout(timeoutId);
      resolve({
        exitCode: code ?? 1,
        containerId,
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

async function listFilesRecursive(dir: string): Promise<Map<string, number>> {
  const files = new Map<string, number>();

  async function walk(currentDir: string, prefix: string = '') {
    try {
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const fullPath = join(currentDir, entry.name);

        if (entry.name === '.git' || entry.name === '.claude' || entry.name === '.otel') {
          continue;
        }

        if (entry.isDirectory()) {
          await walk(fullPath, relativePath);
        } else {
          const stats = await stat(fullPath);
          files.set(relativePath, stats.mtimeMs);
        }
      }
    } catch {
      // Ignore errors reading directories
    }
  }

  await walk(dir);
  return files;
}

interface FileChanges {
  modified: string[];
  created: string[];
  deleted: string[];
}

function computeFileChanges(
  before: Map<string, number>,
  after: Map<string, number>
): FileChanges {
  const modified: string[] = [];
  const created: string[] = [];
  const deleted: string[] = [];

  for (const [path, mtime] of after) {
    if (!before.has(path)) {
      created.push(path);
    } else if (before.get(path) !== mtime) {
      modified.push(path);
    }
  }

  for (const path of before.keys()) {
    if (!after.has(path)) {
      deleted.push(path);
    }
  }

  return { modified, created, deleted };
}

async function copyOtelLogs(profileName: string, sourceOtelDir: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destDir = resolve(process.cwd(), 'otel_logs', profileName, timestamp);

  try {
    await mkdir(destDir, { recursive: true });
    await cp(sourceOtelDir, destDir, { recursive: true });
  } catch {
    // OTEL logs may not exist if Claude Code didn't produce any
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
