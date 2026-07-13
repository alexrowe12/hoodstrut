import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Profile } from '../core/types.js';
import type { TelemetryConfig } from '../metrics/types.js';

export const PROFILE_RUNTIME_FILENAME = 'hoodstrut-profile.json';

export interface ProfileRuntimeConfig {
  model: string;
  effort: Profile['effort'];
  systemPrompt?: string;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, Record<string, unknown>>;
}

function buildMcpServers(profile: Profile): ProfileRuntimeConfig['mcpServers'] {
  if (!profile.mcp_servers?.length) return undefined;
  return Object.fromEntries(profile.mcp_servers.map(server => {
    const config = server.type === 'stdio'
      ? {
          type: 'stdio',
          command: server.command,
          args: server.args ?? [],
          env: server.env ?? {},
        }
      : {
          type: server.type,
          url: server.url,
          headers: server.headers ?? {},
        };
    if (server.timeout !== undefined) Object.assign(config, { timeout: server.timeout });
    return [server.name, config];
  }));
}

export function buildProfileRuntime(profile: Profile): ProfileRuntimeConfig {
  return {
    model: profile.model,
    effort: profile.effort,
    systemPrompt: profile.system_prompt,
    maxTurns: profile.settings?.max_turns,
    allowedTools: profile.settings?.allowed_tools,
    disallowedTools: profile.settings?.disallowed_tools,
    mcpServers: buildMcpServers(profile),
  };
}

async function copySkill(source: string, destination: string): Promise<void> {
  const sourceStat = await stat(source).catch(() => null);
  if (!sourceStat) throw new Error(`Skill source does not exist: ${source}`);
  await mkdir(destination, { recursive: true });
  if (sourceStat.isDirectory()) {
    await cp(source, destination, { recursive: true });
  } else if (sourceStat.isFile()) {
    await cp(source, join(destination, 'SKILL.md'));
  } else {
    throw new Error(`Skill source is not a file or directory: ${source}`);
  }
}

export async function prepareProfileRuntime(profile: Profile, claudeConfigDir: string): Promise<string> {
  await mkdir(claudeConfigDir, { recursive: true });
  const names = new Set<string>();
  for (const skill of profile.skills ?? []) {
    if (names.has(skill.name)) throw new Error(`Duplicate skill name in profile: ${skill.name}`);
    names.add(skill.name);
    await copySkill(skill.source, join(claudeConfigDir, 'skills', skill.name));
  }

  const runtimePath = join(claudeConfigDir, PROFILE_RUNTIME_FILENAME);
  await writeFile(runtimePath, JSON.stringify(buildProfileRuntime(profile), null, 2), 'utf-8');
  return runtimePath;
}

export function buildEnvVars(profile: Profile, telemetry?: TelemetryConfig): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (telemetry) {
    Object.assign(env, {
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_ENDPOINT: telemetry.endpoint,
      OTEL_METRIC_EXPORT_INTERVAL: '1000',
      OTEL_LOGS_EXPORT_INTERVAL: '1000',
      OTEL_TRACES_EXPORT_INTERVAL: '1000',
    });
    if (telemetry.headers) env.OTEL_EXPORTER_OTLP_HEADERS = telemetry.headers;
  }

  Object.assign(env, profile.settings?.env ?? {});

  const referencePattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)(:-[^}]*)?\}/g;
  for (const server of profile.mcp_servers ?? []) {
    const values = [server.url, ...Object.values(server.env ?? {}), ...Object.values(server.headers ?? {})];
    for (const value of values) {
      for (const match of value?.matchAll(referencePattern) ?? []) {
        const variable = match[1];
        const hasDefault = match[2] !== undefined;
        const resolved = env[variable] ?? process.env[variable];
        if (resolved !== undefined) env[variable] = resolved;
        else if (!hasDefault) {
          throw new Error(`Profile "${profile.name}" requires ${variable} for MCP server "${server.name}"`);
        }
      }
    }
  }

  return env;
}
