import type { Profile } from '../core/types.js';
import type { TaskWithBody } from '../core/task.js';
import type { MetricsResult, TelemetryConfig } from '../metrics/types.js';

export interface RuntimeVersions {
  node: string;
  npm: string;
  git: string;
  python: string;
  claudeCode: string;
  agentSdk: string;
  os: string;
  architecture: string;
}

export interface DockerRuntime {
  serverVersion: string;
  apiVersion: string;
  os: string;
  architecture: string;
}

export interface RunnerImage {
  tag: string;
  hoodstrutVersion: string;
  buildInputsSha256: string;
  imageId: string;
  repoDigests: string[];
  platform: { os: string; architecture: string };
  versions: RuntimeVersions;
  docker: DockerRuntime;
}

export interface ExecutorOptions {
  profile: Profile;
  task: TaskWithBody;
  outputDir: string;
  verbose?: boolean;
  timeout?: number;
  telemetry?: TelemetryConfig;
}

export interface RepositoryProvenance {
  source: string;
  sourceType: 'remote_git' | 'local_git' | 'local_snapshot';
  requestedBranch?: string;
  requestedCommit?: string;
  resolvedCommit?: string;
  immutable: boolean;
  contentSha256: string;
}

export interface PreparedRepository extends RepositoryProvenance {
  path: string;
}

export interface ExecutionResult {
  containerId: string;
  exitCode: number;
  agentExitCode: number;
  agentTimedOut: boolean;
  verifierExitCode?: number;
  verifier?: {
    command: string;
    exitCode: number;
    timedOut: boolean;
    duration: number;
    stdout: string;
    stderr: string;
  };
  duration: number;
  stdout: string;
  stderr: string;
  stdoutContent: string;
  stderrContent: string;
  filesChanged: {
    modified: string[];
    created: string[];
    deleted: string[];
  };
  artifacts: {
    changesPatch: string;
    filesManifest: string;
    verifierOutput?: string;
  };
  metrics: MetricsResult;
  provenance: {
    runner: RunnerImage;
    repository: RepositoryProvenance;
  };
}

export interface PrepareRepoOptions {
  repo: string;
  branch?: string;
  commit?: string;
  destDir: string;
}

export interface ContainerRunOptions {
  image: string;
  workspaceDir: string;
  taskPrompt: string;
  envVars: Record<string, string>;
  timeout: number;
  setupCommands?: string[];
  successCommand?: string;
}
