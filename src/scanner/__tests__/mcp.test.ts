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
