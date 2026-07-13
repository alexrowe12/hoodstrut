import { readFile } from 'node:fs/promises';

export interface ClaudeSettings {
  model?: string;
  effortLevel?: 'low' | 'medium' | 'high' | 'max' | 'xhigh';
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
}

export interface ScannedSettings {
  base: ClaudeSettings;
  local: ClaudeSettings;
  merged: ClaudeSettings;
}

export interface SettingsPaths {
  base: string;
  local?: string;
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    return null;
  }
}

function extractSettings(data: Record<string, unknown> | null): ClaudeSettings {
  if (!data) return {};
  const settings: ClaudeSettings = {};

  if (typeof data.model === 'string') settings.model = data.model;
  if (
    typeof data.effortLevel === 'string'
    && ['low', 'medium', 'high', 'max', 'xhigh'].includes(data.effortLevel)
  ) {
    settings.effortLevel = data.effortLevel as ClaudeSettings['effortLevel'];
  }

  if (data.permissions && typeof data.permissions === 'object') {
    const permissions = data.permissions as Record<string, unknown>;
    settings.permissions = {};
    if (Array.isArray(permissions.allow)) {
      settings.permissions.allow = permissions.allow.filter(
        (value): value is string => typeof value === 'string'
      );
    }
    if (Array.isArray(permissions.deny)) {
      settings.permissions.deny = permissions.deny.filter(
        (value): value is string => typeof value === 'string'
      );
    }
  }

  return settings;
}

function mergeSettings(base: ClaudeSettings, local: ClaudeSettings): ClaudeSettings {
  return {
    ...base,
    ...local,
    permissions: base.permissions || local.permissions
      ? {
          allow: [...(base.permissions?.allow ?? []), ...(local.permissions?.allow ?? [])],
          deny: [...(base.permissions?.deny ?? []), ...(local.permissions?.deny ?? [])],
        }
      : undefined,
  };
}

export async function scanSettings(paths: SettingsPaths): Promise<ScannedSettings> {
  const [baseData, localData] = await Promise.all([
    readJsonFile(paths.base),
    paths.local ? readJsonFile(paths.local) : Promise.resolve(null),
  ]);
  const base = extractSettings(baseData);
  const local = extractSettings(localData);
  return { base, local, merged: mergeSettings(base, local) };
}
