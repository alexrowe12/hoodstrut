import { writeFile, mkdir, cp } from 'node:fs/promises';
import { join } from 'node:path';
import type { Profile } from '../core/types.js';
import type { TelemetryConfig } from '../metrics/types.js';

export async function injectConfig(profile: Profile, workspaceDir: string): Promise<void> {
  await Promise.all([
    injectSystemPrompt(profile, workspaceDir),
    injectSettings(profile, workspaceDir),
    injectMcpServers(profile, workspaceDir),
    injectSkills(profile, workspaceDir),
  ]);
}

async function injectSystemPrompt(profile: Profile, workspaceDir: string): Promise<void> {
  if (!profile.system_prompt) return;

  const claudeMdPath = join(workspaceDir, 'CLAUDE.md');
  await writeFile(claudeMdPath, profile.system_prompt, 'utf-8');
}

async function injectSettings(profile: Profile, workspaceDir: string): Promise<void> {
  const settingsDir = join(workspaceDir, '.claude');
  await mkdir(settingsDir, { recursive: true });

  const settings: Record<string, unknown> = {};

  if (profile.model) {
    settings.model = profile.model;
  }

  if (profile.effort) {
    settings.effortLevel = profile.effort;
  }

  if (profile.settings?.max_turns) {
    settings.maxTurns = profile.settings.max_turns;
  }

  if (profile.settings?.allowed_tools) {
    settings.allowedTools = profile.settings.allowed_tools;
  }

  const settingsPath = join(settingsDir, 'settings.local.json');
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

async function injectMcpServers(profile: Profile, workspaceDir: string): Promise<void> {
  if (!profile.mcp_servers?.length) return;

  const mcpConfig: Record<string, unknown> = {
    mcpServers: {},
  };

  for (const server of profile.mcp_servers) {
    (mcpConfig.mcpServers as Record<string, unknown>)[server.name] = {
      command: server.command,
      args: server.args || [],
      env: server.env || {},
    };
  }

  const mcpPath = join(workspaceDir, '.mcp.json');
  await writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
}

async function injectSkills(profile: Profile, workspaceDir: string): Promise<void> {
  if (!profile.skills?.length) return;

  const skillsDir = join(workspaceDir, '.claude', 'skills');
  await mkdir(skillsDir, { recursive: true });

  for (const skill of profile.skills) {
    if (!skill.source) continue;

    const skillDir = join(skillsDir, skill.name);
    await mkdir(skillDir, { recursive: true });

    try {
      await cp(skill.source, join(skillDir, 'SKILL.md'));
    } catch {
      // Skip if skill source doesn't exist
    }
  }
}

export function buildEnvVars(profile: Profile, telemetry?: TelemetryConfig): Record<string, string> {
  const env: Record<string, string> = {};

  if (process.env.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }

  if (profile.model) {
    env.ANTHROPIC_MODEL = profile.model;
  }

  // Add telemetry env vars if telemetry is configured
  if (telemetry) {
    env.CLAUDE_CODE_ENABLE_TELEMETRY = '1';
    env.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA = '1';
    env.OTEL_TRACES_EXPORTER = 'otlp';
    env.OTEL_METRICS_EXPORTER = 'otlp';
    env.OTEL_LOGS_EXPORTER = 'otlp';
    env.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/protobuf';
    env.OTEL_EXPORTER_OTLP_ENDPOINT = telemetry.endpoint;
    // Flush quickly for short-lived runs
    env.OTEL_METRIC_EXPORT_INTERVAL = '1000';
    env.OTEL_LOGS_EXPORT_INTERVAL = '1000';
    env.OTEL_TRACES_EXPORT_INTERVAL = '1000';

    if (telemetry.headers) {
      env.OTEL_EXPORTER_OTLP_HEADERS = telemetry.headers;
    }
  }

  if (profile.settings?.env) {
    Object.assign(env, profile.settings.env);
  }

  const referencePattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)(:-[^}]*)?\}/g;
  for (const server of profile.mcp_servers ?? []) {
    for (const value of Object.values(server.env ?? {})) {
      for (const match of value.matchAll(referencePattern)) {
        const variable = match[1];
        const hasDefault = match[2] !== undefined;
        const resolved = env[variable] ?? process.env[variable];

        if (resolved !== undefined) {
          env[variable] = resolved;
        } else if (!hasDefault) {
          throw new Error(
            `Profile "${profile.name}" requires ${variable} for MCP server "${server.name}"`
          );
        }
      }
    }
  }

  return env;
}
