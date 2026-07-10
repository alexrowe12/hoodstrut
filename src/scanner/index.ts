import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { scanSettings, type ScannedSettings } from './settings.js';
import { scanMcpServers, type ScannedMcpServers } from './mcp.js';
import { scanPrompt, type ScannedPrompt } from './prompts.js';
import { scanSkills, type ScannedSkill } from './skills.js';
import { scanEnvVars, type ScannedEnvVars } from './env.js';
import { generateProfile, type GeneratedProfile } from './profile-generator.js';

export interface ScanOptions {
  path?: string;
  project?: boolean;
  name?: string;
}

export interface ScanResult {
  sourcePath: string;
  settings: ScannedSettings;
  mcpServers: ScannedMcpServers;
  prompt: ScannedPrompt | null;
  skills: ScannedSkill[];
  env: ScannedEnvVars;
}

function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return resolve(homedir(), path.slice(2));
  }
  return resolve(path);
}

export async function scanClaudeConfig(options: ScanOptions = {}): Promise<ScanResult> {
  let sourcePath: string;
  let projectPath: string | undefined;

  if (options.project) {
    // Scan project-local config in current directory
    sourcePath = process.cwd();
    projectPath = process.cwd();
  } else if (options.path) {
    // Scan specified path
    sourcePath = expandPath(options.path);
    projectPath = sourcePath;
  } else {
    // Default: scan global ~/.claude + current project
    sourcePath = resolve(homedir(), '.claude');
    projectPath = process.cwd();
  }

  const [settings, mcpServers, prompt, skills, env] = await Promise.all([
    scanSettings(projectPath),
    scanMcpServers(projectPath),
    projectPath ? scanPrompt(projectPath) : Promise.resolve(null),
    scanSkills(),
    Promise.resolve(scanEnvVars()),
  ]);

  return {
    sourcePath,
    settings,
    mcpServers,
    prompt,
    skills,
    env,
  };
}

export async function generateProfileFromScan(
  options: ScanOptions = {}
): Promise<GeneratedProfile> {
  const scanResult = await scanClaudeConfig(options);
  const name = options.name || `scanned-${Date.now()}`;
  return generateProfile(scanResult, name);
}

export {
  type ScannedSettings,
  type ScannedMcpServers,
  type ScannedPrompt,
  type ScannedSkill,
  type ScannedEnvVars,
  type GeneratedProfile,
};
