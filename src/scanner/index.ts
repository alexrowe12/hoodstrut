import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { scanSettings, type ScannedSettings } from './settings.js';
import { scanMcpServers, type ScannedMcpServers } from './mcp.js';
import { scanPrompt, type ScannedPrompt } from './prompts.js';
import { scanSkills, type ScannedSkill } from './skills.js';
import { scanEnvVars, type ScannedEnvVars } from './env.js';
import {
  generateProfile,
  serializeGeneratedProfile,
  type GeneratedProfile,
} from './profile-generator.js';
import { writeGeneratedProfile } from './profile-writer.js';

export interface ScanOptions {
  path?: string;
  project?: boolean;
  name?: string;
}

export interface ScanScope {
  type: 'user' | 'project';
  root: string;
  settings: { base: string; local?: string };
  prompts: string[];
  skills: string;
  mcp: string;
}

export interface ScanResult {
  sourcePath: string;
  scope: ScanScope['type'];
  settings: ScannedSettings;
  mcpServers: ScannedMcpServers;
  prompt: ScannedPrompt | null;
  skills: ScannedSkill[];
  env: ScannedEnvVars;
}

function expandPath(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

export function resolveScanScope(options: ScanOptions = {}): ScanScope {
  if (options.project) {
    const root = options.path ? expandPath(options.path) : process.cwd();
    return {
      type: 'project',
      root,
      settings: {
        base: join(root, '.claude', 'settings.json'),
        local: join(root, '.claude', 'settings.local.json'),
      },
      prompts: [join(root, 'CLAUDE.md'), join(root, '.claude', 'CLAUDE.md')],
      skills: join(root, '.claude', 'skills'),
      mcp: join(root, '.mcp.json'),
    };
  }

  const root = options.path ? expandPath(options.path) : join(homedir(), '.claude');
  return {
    type: 'user',
    root,
    settings: { base: join(root, 'settings.json') },
    prompts: [join(root, 'CLAUDE.md')],
    skills: join(root, 'skills'),
    mcp: join(dirname(root), '.claude.json'),
  };
}

export async function scanClaudeConfig(options: ScanOptions = {}): Promise<ScanResult> {
  const scope = resolveScanScope(options);
  const [settings, mcpServers, prompt, skills] = await Promise.all([
    scanSettings(scope.settings),
    scanMcpServers(scope.mcp),
    scanPrompt(scope.prompts),
    scanSkills(scope.skills),
  ]);
  return {
    sourcePath: scope.root,
    scope: scope.type,
    settings,
    mcpServers,
    prompt,
    skills,
    env: scanEnvVars(),
  };
}

export async function generateProfileFromScan(options: ScanOptions = {}): Promise<GeneratedProfile> {
  const scanResult = await scanClaudeConfig(options);
  return generateProfile(scanResult, options.name || `scanned-${Date.now()}`);
}

export {
  type ScannedSettings,
  type ScannedMcpServers,
  type ScannedPrompt,
  type ScannedSkill,
  type ScannedEnvVars,
  type GeneratedProfile,
};
export { serializeGeneratedProfile };
export { writeGeneratedProfile };
