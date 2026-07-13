import { createHash } from 'node:crypto';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { dir as tmpDir } from 'tmp-promise';
import type { DockerRuntime, RunnerImage, RuntimeVersions } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HASHED_TEMPLATE_FILES = ['Dockerfile.runner', 'package.json', 'package-lock.json'] as const;
const HASHED_SCRIPT_FILES = ['run-task.sh', 'run-sdk.mjs', 'run-phase.mjs', 'runtime-info.mjs'] as const;

const inFlightBuilds = new Map<string, Promise<RunnerImage>>();
const completedBuilds = new Map<string, RunnerImage>();

export interface RunnerBuildIdentity {
  hoodstrutVersion: string;
  buildInputsSha256: string;
  tag: string;
}

export async function computeRunnerBuildIdentity(options: {
  templatesDir?: string;
  scriptsDir?: string;
  hoodstrutVersion?: string;
} = {}): Promise<RunnerBuildIdentity> {
  const templatesDir = options.templatesDir ?? resolve(__dirname, 'templates');
  const scriptsDir = options.scriptsDir ?? resolve(__dirname, 'scripts');
  const hoodstrutVersion = options.hoodstrutVersion ?? await readHoodstrutVersion();
  const inputs = [
    ...HASHED_TEMPLATE_FILES.map(name => ({ path: `templates/${name}`, source: join(templatesDir, name) })),
    ...HASHED_SCRIPT_FILES.map(name => ({ path: `scripts/${name}`, source: join(scriptsDir, name) })),
  ].sort((a, b) => a.path.localeCompare(b.path));

  const hash = createHash('sha256');
  hash.update(`hoodstrut-version\0${hoodstrutVersion}\0`);
  for (const input of inputs) {
    const content = await readFile(input.source);
    hash.update(`${Buffer.byteLength(input.path)}:${input.path}:${content.byteLength}:`);
    hash.update(content);
  }

  const buildInputsSha256 = hash.digest('hex');
  return {
    hoodstrutVersion,
    buildInputsSha256,
    tag: `hoodstrut-runner:${hoodstrutVersion}-${buildInputsSha256.slice(0, 16)}`,
  };
}

export async function buildRunnerImage(force: boolean = false): Promise<RunnerImage> {
  const identity = await computeRunnerBuildIdentity();
  if (!force) {
    const completed = completedBuilds.get(identity.buildInputsSha256);
    if (completed) return completed;
  }
  const existing = inFlightBuilds.get(identity.buildInputsSha256);
  if (existing) return existing;

  const build = buildAndInspectRunner(identity, force);
  inFlightBuilds.set(identity.buildInputsSha256, build);
  try {
    const runner = await build;
    completedBuilds.set(identity.buildInputsSha256, runner);
    return runner;
  } finally {
    inFlightBuilds.delete(identity.buildInputsSha256);
  }
}

async function buildAndInspectRunner(
  identity: RunnerBuildIdentity,
  force: boolean
): Promise<RunnerImage> {
  if (!force) {
    const cached = await inspectRunnerImage(identity).catch(() => null);
    if (cached) return cached;
  }

  const templatesDir = resolve(__dirname, 'templates');
  const scriptsDir = resolve(__dirname, 'scripts');
  const { path: buildContext, cleanup } = await tmpDir({ unsafeCleanup: true });

  try {
    await cp(join(templatesDir, 'Dockerfile.runner'), join(buildContext, 'Dockerfile'));
    await cp(join(templatesDir, 'package.json'), join(buildContext, 'package.json'));
    await cp(join(templatesDir, 'package-lock.json'), join(buildContext, 'package-lock.json'));
    await mkdir(join(buildContext, 'scripts'));
    for (const name of HASHED_SCRIPT_FILES) {
      await cp(join(scriptsDir, name), join(buildContext, 'scripts', name));
    }

    await execa('docker', [
      'build',
      '--build-arg', `HOODSTRUT_VERSION=${identity.hoodstrutVersion}`,
      '--build-arg', `RUNNER_BUILD_SHA256=${identity.buildInputsSha256}`,
      '-t', identity.tag,
      buildContext,
    ], { stdio: 'inherit' });
  } finally {
    await cleanup();
  }

  return inspectRunnerImage(identity);
}

async function inspectRunnerImage(identity: RunnerBuildIdentity): Promise<RunnerImage> {
  const { stdout } = await execa('docker', ['image', 'inspect', identity.tag]);
  const parsed = JSON.parse(stdout) as Array<{
    Id?: string;
    RepoDigests?: string[];
    Os?: string;
    Architecture?: string;
    Config?: { Labels?: Record<string, string> };
  }>;
  const image = parsed[0];
  if (!image?.Id || !image.Os || !image.Architecture) {
    throw new Error(`Docker returned incomplete metadata for ${identity.tag}`);
  }

  const labels = image.Config?.Labels ?? {};
  if (labels['org.hoodstrut.runner.build-inputs'] !== identity.buildInputsSha256 ||
      labels['org.opencontainers.image.version'] !== identity.hoodstrutVersion) {
    throw new Error(`Cached runner image ${identity.tag} does not match its build inputs`);
  }

  const [{ stdout: runtimeOutput }, docker] = await Promise.all([
    execa('docker', ['run', '--rm', '--entrypoint', 'node', identity.tag, '/runtime-info.mjs']),
    inspectDockerRuntime(),
  ]);

  return {
    ...identity,
    imageId: image.Id,
    repoDigests: image.RepoDigests ?? [],
    platform: { os: image.Os, architecture: image.Architecture },
    versions: parseRuntimeVersions(runtimeOutput),
    docker,
  };
}

async function inspectDockerRuntime(): Promise<DockerRuntime> {
  const { stdout } = await execa('docker', ['version', '--format', '{{json .Server}}']);
  const server = JSON.parse(stdout) as {
    Version?: string;
    ApiVersion?: string;
    Os?: string;
    Arch?: string;
  };
  if (!server.Version || !server.ApiVersion || !server.Os || !server.Arch) {
    throw new Error('Docker returned incomplete server version metadata');
  }
  return {
    serverVersion: server.Version,
    apiVersion: server.ApiVersion,
    os: server.Os,
    architecture: server.Arch,
  };
}

function parseRuntimeVersions(output: string): RuntimeVersions {
  const parsed = JSON.parse(output) as Partial<RuntimeVersions>;
  for (const key of ['node', 'npm', 'git', 'python', 'claudeCode', 'agentSdk', 'os', 'architecture'] as const) {
    if (typeof parsed[key] !== 'string' || parsed[key].length === 0) {
      throw new Error(`Runner runtime metadata is missing ${key}`);
    }
  }
  return parsed as RuntimeVersions;
}

async function readHoodstrutVersion(): Promise<string> {
  const packagePath = resolve(__dirname, '..', '..', 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { version?: string };
  if (!packageJson.version) throw new Error(`Package version is missing from ${packagePath}`);
  return packageJson.version;
}
