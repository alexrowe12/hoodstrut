import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

export interface McpServerConfig {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface ScannedMcpServers {
  servers: McpServerConfig[];
  requiredEnvVars: string[];
  warnings: string[];
}

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g;

function generatedHeaderVariable(server: string, header: string): string {
  return `MCP_${server}_${header}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}

function addReferences(value: string, required: Set<string>): string {
  for (const match of value.matchAll(ENV_REFERENCE)) required.add(match[1]);
  return value.replace(/:-[^}]*/g, '');
}

function sanitizeUrl(
  server: string,
  raw: string,
  required: Set<string>,
  warnings: string[]
): string {
  if ([...raw.matchAll(ENV_REFERENCE)].length) return addReferences(raw, required);
  try {
    const url = new URL(raw);
    if (!url.username && !url.password && !url.search) return raw;
  } catch {
    return raw;
  }
  const variable = `MCP_${server}_URL`.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  required.add(variable);
  warnings.push(`MCP server "${server}" URL credentials or query values were replaced with \${${variable}}`);
  return `\${${variable}}`;
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    return null;
  }
}

function extractServers(data: Record<string, unknown> | null): ScannedMcpServers {
  const configs = data?.mcpServers;
  if (!configs || typeof configs !== 'object' || Array.isArray(configs)) {
    return { servers: [], requiredEnvVars: [], warnings: [] };
  }

  const servers: McpServerConfig[] = [];
  const required = new Set<string>();
  const warnings: string[] = [];

  for (const [name, value] of Object.entries(configs as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const config = value as Record<string, unknown>;
    const inferredType = typeof config.url === 'string' ? 'http' : 'stdio';
    const type = ['stdio', 'http', 'sse'].includes(String(config.type))
      ? config.type as McpServerConfig['type']
      : inferredType;
    const server: McpServerConfig = { name, type };

    if (typeof config.command === 'string') server.command = config.command;
    if (Array.isArray(config.args)) {
      server.args = config.args.filter((item): item is string => typeof item === 'string');
    }
    if (typeof config.url === 'string') {
      server.url = sanitizeUrl(name, config.url, required, warnings);
    }
    if (typeof config.timeout === 'number' && Number.isFinite(config.timeout)) {
      server.timeout = config.timeout;
    }

    if (config.env && typeof config.env === 'object' && !Array.isArray(config.env)) {
      server.env = {};
      for (const [key, raw] of Object.entries(config.env as Record<string, unknown>)) {
        if (typeof raw !== 'string') continue;
        if (!ENV_NAME_PATTERN.test(key)) {
          warnings.push(`MCP server "${name}" has invalid environment variable name "${key}"; omitted`);
          continue;
        }
        if ([...raw.matchAll(ENV_REFERENCE)].length) {
          server.env[key] = addReferences(raw, required);
        } else {
          server.env[key] = `\${${key}}`;
          required.add(key);
        }
      }
    }

    if (config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)) {
      server.headers = {};
      for (const [header, raw] of Object.entries(config.headers as Record<string, unknown>)) {
        if (typeof raw !== 'string') continue;
        const references = [...raw.matchAll(ENV_REFERENCE)];
        if (references.length) {
          server.headers[header] = addReferences(raw, required);
          continue;
        }
        const variable = generatedHeaderVariable(name, header);
        const separator = raw.indexOf(' ');
        server.headers[header] = separator > 0
          ? `${raw.slice(0, separator)} \${${variable}}`
          : `\${${variable}}`;
        required.add(variable);
        warnings.push(`MCP server "${name}" header "${header}" was replaced with \${${variable}}`);
      }
    }

    for (const text of [server.url, ...Object.values(server.env ?? {}), ...Object.values(server.headers ?? {})]) {
      for (const match of text?.matchAll(ENV_REFERENCE) ?? []) required.add(match[1]);
    }
    servers.push(server);
  }

  return { servers, requiredEnvVars: [...required].sort(), warnings };
}

export async function scanMcpServers(path: string): Promise<ScannedMcpServers> {
  return extractServers(await readJsonFile(path));
}
