import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface ClaudeSettings {
  model?: string;
  effortLevel?: 'low' | 'medium' | 'high' | 'xhigh';
  theme?: string;
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
}

export interface ScannedSettings {
  global: ClaudeSettings;
  project: ClaudeSettings;
  merged: ClaudeSettings;
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function extractSettings(data: Record<string, unknown> | null): ClaudeSettings {
  if (!data) return {};

  const settings: ClaudeSettings = {};

  if (typeof data.model === 'string') {
    settings.model = data.model;
  }

  if (typeof data.effortLevel === 'string') {
    const validEfforts = ['low', 'medium', 'high', 'xhigh'];
    if (validEfforts.includes(data.effortLevel)) {
      settings.effortLevel = data.effortLevel as ClaudeSettings['effortLevel'];
    }
  }

  if (typeof data.theme === 'string') {
    settings.theme = data.theme;
  }

  if (data.permissions && typeof data.permissions === 'object') {
    const perms = data.permissions as Record<string, unknown>;
    settings.permissions = {};
    if (Array.isArray(perms.allow)) {
      settings.permissions.allow = perms.allow.filter((x): x is string => typeof x === 'string');
    }
    if (Array.isArray(perms.deny)) {
      settings.permissions.deny = perms.deny.filter((x): x is string => typeof x === 'string');
    }
  }

  return settings;
}

function mergeSettings(global: ClaudeSettings, project: ClaudeSettings): ClaudeSettings {
  const merged: ClaudeSettings = { ...global };

  if (project.model) merged.model = project.model;
  if (project.effortLevel) merged.effortLevel = project.effortLevel;
  if (project.theme) merged.theme = project.theme;

  if (project.permissions) {
    merged.permissions = {
      allow: [
        ...(global.permissions?.allow || []),
        ...(project.permissions.allow || []),
      ],
      deny: [
        ...(global.permissions?.deny || []),
        ...(project.permissions.deny || []),
      ],
    };
  }

  return merged;
}

export async function scanSettings(projectPath?: string): Promise<ScannedSettings> {
  const globalSettingsPath = join(homedir(), '.claude', 'settings.json');
  const globalData = await readJsonFile(globalSettingsPath);
  const global = extractSettings(globalData);

  let project: ClaudeSettings = {};
  if (projectPath) {
    const projectSettingsPath = join(projectPath, '.claude', 'settings.local.json');
    const projectData = await readJsonFile(projectSettingsPath);
    project = extractSettings(projectData);
  }

  return {
    global,
    project,
    merged: mergeSettings(global, project),
  };
}
