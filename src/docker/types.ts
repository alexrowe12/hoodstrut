import type { Profile } from '../core/types.js';
import type { TaskWithBody } from '../core/task.js';

export interface ExecutorOptions {
  profile: Profile;
  task: TaskWithBody;
  outputDir: string;
  verbose?: boolean;
  timeout?: number;
}

export interface ExecutionResult {
  containerId: string;
  exitCode: number;
  duration: number;
  stdout: string;
  stderr: string;
  otelDir: string;
  success: boolean;
  successMethod: 'command' | 'exit_code';
  filesChanged: {
    modified: string[];
    created: string[];
    deleted: string[];
  };
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
