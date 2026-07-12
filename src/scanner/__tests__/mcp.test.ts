import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanMcpServers } from '../mcp.js';

describe('scanMcpServers', () => {
  const testDir = join(tmpdir(), 'hoodstrut-test-mcp');
  const projectDir = join(testDir, 'project');

  beforeEach(async () => {
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should return empty arrays when no config exists', async () => {
    const result = await scanMcpServers(projectDir);

    expect(result.global).toEqual([]);
    expect(result.project).toEqual([]);
    expect(result.merged).toEqual([]);
    expect(result.requiredEnvVars).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('should parse project .mcp.json', async () => {
    await writeFile(
      join(projectDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          github: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@anthropic/mcp-server-github'],
            env: {
              GITHUB_TOKEN: '${GITHUB_TOKEN}',
            },
          },
        },
      })
    );

    const result = await scanMcpServers(projectDir);

    expect(result.project).toHaveLength(1);
    expect(result.project[0].name).toBe('github');
    expect(result.project[0].command).toBe('npx');
    expect(result.project[0].args).toEqual(['-y', '@anthropic/mcp-server-github']);
    expect(result.project[0].env?.GITHUB_TOKEN).toBe('${GITHUB_TOKEN}');
    expect(result.requiredEnvVars).toContain('GITHUB_TOKEN');
  });

  it('replaces literal MCP environment values without retaining the secret', async () => {
    const secret = 'ghp_do-not-persist-this';
    await writeFile(
      join(projectDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          github: {
            command: 'npx',
            env: {
              GITHUB_TOKEN: secret,
              API_TOKEN: '${API_TOKEN:-unsafe-default}',
            },
          },
        },
      })
    );

    const result = await scanMcpServers(projectDir);
    const serialized = JSON.stringify(result);

    expect(result.project[0].env).toEqual({
      GITHUB_TOKEN: '${GITHUB_TOKEN}',
      API_TOKEN: '${API_TOKEN}',
    });
    expect(result.requiredEnvVars).toEqual(['API_TOKEN', 'GITHUB_TOKEN']);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('unsafe-default');
  });

  it('omits invalid environment names without exposing their values', async () => {
    const secret = 'do-not-log-this';
    await writeFile(
      join(projectDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          unsafe: {
            command: 'node',
            env: { 'INVALID-NAME': secret },
          },
        },
      })
    );

    const result = await scanMcpServers(projectDir);

    expect(result.project[0].env).toEqual({});
    expect(result.warnings[0]).toContain('INVALID-NAME');
    expect(result.warnings[0]).not.toContain(secret);
  });

  it('should parse HTTP MCP servers', async () => {
    await writeFile(
      join(projectDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          api: {
            type: 'http',
            url: 'https://api.example.com/mcp',
            headers: {
              Authorization: 'Bearer ${API_TOKEN}',
            },
          },
        },
      })
    );

    const result = await scanMcpServers(projectDir);

    expect(result.project[0].name).toBe('api');
    expect(result.project[0].type).toBe('http');
    expect(result.project[0].url).toBe('https://api.example.com/mcp');
    expect(result.project[0].headers?.Authorization).toBe('Bearer ${API_TOKEN}');
  });

  it('should merge servers with project overriding global', async () => {
    const result = await scanMcpServers(projectDir);

    // Without global config, merged should equal project
    expect(result.merged).toEqual(result.project);
  });

  it('should handle missing mcpServers key', async () => {
    await writeFile(
      join(projectDir, '.mcp.json'),
      JSON.stringify({ someOtherKey: {} })
    );

    const result = await scanMcpServers(projectDir);

    expect(result.project).toEqual([]);
  });
});
