import { describe, it, expect } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dir as tmpDir } from 'tmp-promise';
import { scanMcpServers } from '../mcp.js';

describe('scanMcpServers', () => {
  it('returns an empty result for a missing file', async () => {
    const result = await scanMcpServers('/definitely/missing/.mcp.json');
    expect(result).toEqual({ servers: [], requiredEnvVars: [], warnings: [] });
  });

  it('preserves stdio and remote MCP fields while redacting secrets', async () => {
    const tmp = await tmpDir({ unsafeCleanup: true });
    try {
      const path = join(tmp.path, '.mcp.json');
      const secret = 'do-not-persist';
      await writeFile(path, JSON.stringify({ mcpServers: {
        local: {
          command: 'node', args: ['server.js'],
          env: { API_TOKEN: secret, ALIAS: '${SHARED_TOKEN:-unsafe}' }, timeout: 20,
        },
        remote: {
          type: 'http', url: 'https://example.test/mcp',
          headers: { Authorization: `Bearer ${secret}`, Existing: 'Bearer ${EXISTING_TOKEN}' },
        },
        signed: {
          type: 'http', url: 'https://example.test/mcp?token=url-secret',
        },
      } }));

      const result = await scanMcpServers(path);
      expect(result.servers[0]).toEqual({
        name: 'local', type: 'stdio', command: 'node', args: ['server.js'],
        env: { API_TOKEN: '${API_TOKEN}', ALIAS: '${SHARED_TOKEN}' }, timeout: 20,
      });
      expect(result.servers[1]).toMatchObject({
        name: 'remote', type: 'http', url: 'https://example.test/mcp',
        headers: {
          Authorization: 'Bearer ${MCP_REMOTE_AUTHORIZATION}',
          Existing: 'Bearer ${EXISTING_TOKEN}',
        },
      });
      expect(result.requiredEnvVars).toEqual([
        'API_TOKEN', 'EXISTING_TOKEN', 'MCP_REMOTE_AUTHORIZATION', 'MCP_SIGNED_URL', 'SHARED_TOKEN',
      ]);
      expect(result.servers[2].url).toBe('${MCP_SIGNED_URL}');
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain('url-secret');
      expect(JSON.stringify(result)).not.toContain('unsafe');
    } finally {
      await tmp.cleanup();
    }
  });

  it('omits invalid environment names without exposing values', async () => {
    const tmp = await tmpDir({ unsafeCleanup: true });
    try {
      const path = join(tmp.path, '.mcp.json');
      await writeFile(path, JSON.stringify({
        mcpServers: { bad: { command: 'node', env: { 'BAD-NAME': 'secret' } } },
      }));
      const result = await scanMcpServers(path);
      expect(result.servers[0].env).toEqual({});
      expect(result.warnings[0]).toContain('BAD-NAME');
      expect(JSON.stringify(result)).not.toContain('secret');
    } finally {
      await tmp.cleanup();
    }
  });
});
