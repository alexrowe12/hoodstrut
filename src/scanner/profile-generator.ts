import { stringify as yamlStringify } from 'yaml';
import { ProfileSchema, type Profile } from '../core/types.js';
import type { ScanResult } from './index.js';

export interface GeneratedProfile {
  yaml: string;
  profile: Profile;
  requiredEnvVars: string[];
  warnings: string[];
}

export function serializeGeneratedProfile(profile: Profile, sourcePath: string): string {
  const header = [
    `# Generated profile: ${profile.name}`,
    `# Scanned from: ${sourcePath}`,
    `# Scanned at: ${new Date().toISOString()}`,
    '',
  ].join('\n');
  return header + yamlStringify(profile);
}

function mapEffortLevel(effort?: string): 'low' | 'medium' | 'high' | 'max' {
  if (!effort) return 'medium';

  if (effort === 'xhigh') return 'max';

  if (['low', 'medium', 'high', 'max'].includes(effort)) {
    return effort as 'low' | 'medium' | 'high' | 'max';
  }

  return 'medium';
}

function normalizeModel(model?: string): string {
  if (!model) return 'claude-sonnet-5';

  // Map shorthand model names to full identifiers
  const modelMap: Record<string, string> = {
    'opus': 'claude-opus-4-8',
    'sonnet': 'claude-sonnet-5',
    'haiku': 'claude-haiku-4-5-20251001',
  };

  return modelMap[model.toLowerCase()] || model;
}

export function generateProfile(scanResult: ScanResult, name: string): GeneratedProfile {
  const profile: Profile = {
    name,
    description: `Auto-generated from ${scanResult.sourcePath}`,
    model: normalizeModel(
      scanResult.env.model || scanResult.settings.merged.model
    ),
    effort: mapEffortLevel(
      scanResult.env.effort || scanResult.settings.merged.effortLevel
    ),
    source: 'scanned',
    source_path: scanResult.sourcePath,
  };

  // Add system prompt if found
  if (scanResult.prompt) {
    profile.system_prompt = scanResult.prompt.content;
  }

  // Add MCP servers if found
  if (scanResult.mcpServers.servers.length > 0) {
    profile.mcp_servers = scanResult.mcpServers.servers.map(server => ({
      name: server.name,
      type: server.type,
      command: server.command,
      args: server.args,
      env: server.env,
      url: server.url,
      headers: server.headers,
      timeout: server.timeout,
    }));
  }

  const permissions = scanResult.settings.merged.permissions;
  if (permissions?.allow?.length || permissions?.deny?.length) {
    profile.settings = {
      allowed_tools: permissions.allow,
      disallowed_tools: permissions.deny,
    };
  }

  // Add skills if found
  if (scanResult.skills.length > 0) {
    profile.skills = scanResult.skills.map(skill => ({
      name: skill.name,
      source: skill.sourcePath,
    }));
  }

  const validatedProfile = ProfileSchema.parse(profile);
  const yaml = serializeGeneratedProfile(validatedProfile, scanResult.sourcePath);

  return {
    yaml,
    profile: validatedProfile,
    requiredEnvVars: scanResult.mcpServers.requiredEnvVars,
    warnings: [
      ...scanResult.mcpServers.warnings,
      ...(scanResult.settings.merged.effortLevel === 'xhigh'
        ? ['Claude Code effort xhigh was normalized to the SDK effort max']
        : []),
    ],
  };
}
