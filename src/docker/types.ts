import type { Profile } from '../core/types.js';
import type { TaskWithBody } from '../core/task.js';
import type { MetricsResult, TelemetryConfig } from '../metrics/types.js';

export interface ExecutorOptions {
  profile: Profile;
  task: TaskWithBody;
  outputDir: string;
  verbose?: boolean;
  timeout?: number;
  telemetry?: TelemetryConfig;
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
}

export interface PrepareRepoOptions {
  repo: string;
  branch: string;
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
