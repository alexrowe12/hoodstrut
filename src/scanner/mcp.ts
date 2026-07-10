import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface McpServerConfig {
  name: string;
  type?: 'stdio' | 'http' | 'sse' | 'ws';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface ScannedMcpServers {
  global: McpServerConfig[];
  project: McpServerConfig[];
  merged: McpServerConfig[];
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function extractMcpServers(data: Record<string, unknown> | null): McpServerConfig[] {
  if (!data) return [];

  const mcpServers = data.mcpServers as Record<string, unknown> | undefined;
  if (!mcpServers || typeof mcpServers !== 'object') return [];

  const servers: McpServerConfig[] = [];

  for (const [name, config] of Object.entries(mcpServers)) {
    if (!config || typeof config !== 'object') continue;

    const serverConfig = config as Record<string, unknown>;
    const server: McpServerConfig = { name };

    if (typeof serverConfig.type === 'string') {
      server.type = serverConfig.type as McpServerConfig['type'];
    }

    if (typeof serverConfig.command === 'string') {
      server.command = serverConfig.command;
    }

    if (Array.isArray(serverConfig.args)) {
      server.args = serverConfig.args.filter((x): x is string => typeof x === 'string');
    }

    if (serverConfig.env && typeof serverConfig.env === 'object') {
      server.env = {};
      for (const [key, value] of Object.entries(serverConfig.env as Record<string, unknown>)) {
        if (typeof value === 'string') {
          server.env[key] = value;
        }
      }
    }

    if (typeof serverConfig.url === 'string') {
      server.url = serverConfig.url;
    }

    if (serverConfig.headers && typeof serverConfig.headers === 'object') {
      server.headers = {};
      for (const [key, value] of Object.entries(serverConfig.headers as Record<string, unknown>)) {
        if (typeof value === 'string') {
          server.headers[key] = value;
        }
      }
    }

    if (typeof serverConfig.timeout === 'number') {
      server.timeout = serverConfig.timeout;
    }

    servers.push(server);
  }

  return servers;
}

function mergeServers(global: McpServerConfig[], project: McpServerConfig[]): McpServerConfig[] {
  const merged = new Map<string, McpServerConfig>();

  for (const server of global) {
    merged.set(server.name, server);
  }

  for (const server of project) {
    merged.set(server.name, server);
  }

  return Array.from(merged.values());
}

export async function scanMcpServers(projectPath?: string): Promise<ScannedMcpServers> {
  const globalConfigPath = join(homedir(), '.claude.json');
  const globalData = await readJsonFile(globalConfigPath);
  const global = extractMcpServers(globalData);

  let project: McpServerConfig[] = [];
  if (projectPath) {
    const projectConfigPath = join(projectPath, '.mcp.json');
    const projectData = await readJsonFile(projectConfigPath);
    project = extractMcpServers(projectData);
  }

  return {
    global,
    project,
    merged: mergeServers(global, project),
  };
}
