import { stringify as yamlStringify } from 'yaml';
import type { Profile } from '../core/types.js';
import type { ScanResult } from './index.js';

export interface GeneratedProfile {
  yaml: string;
  profile: Profile;
}

function mapEffortLevel(effort?: string): 'low' | 'medium' | 'high' {
  if (!effort) return 'medium';

  // Map xhigh to high since our profile schema only supports low/medium/high
  if (effort === 'xhigh') return 'high';

  if (['low', 'medium', 'high'].includes(effort)) {
    return effort as 'low' | 'medium' | 'high';
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
  if (scanResult.mcpServers.merged.length > 0) {
    profile.mcp_servers = scanResult.mcpServers.merged.map(server => ({
      name: server.name,
      command: server.command || '',
      args: server.args,
      env: server.env,
    }));
  }

  // Add skills if found
  if (scanResult.skills.length > 0) {
    profile.skills = scanResult.skills.map(skill => ({
      name: skill.name,
      source: skill.sourcePath,
    }));
  }

  // Generate YAML with header comment
  const timestamp = new Date().toISOString();
  const header = [
    `# Generated profile: ${name}`,
    `# Scanned from: ${scanResult.sourcePath}`,
    `# Scanned at: ${timestamp}`,
    '',
  ].join('\n');

  const yaml = header + yamlStringify(profile);

  return { yaml, profile };
}
