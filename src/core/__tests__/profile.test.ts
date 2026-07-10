import { describe, it, expect } from 'vitest';
import { ProfileSchema } from '../types.js';

describe('ProfileSchema', () => {
  it('parses a valid minimal profile', () => {
    const data = {
      name: 'test-profile',
      model: 'claude-sonnet-4-20250514',
    };

    const result = ProfileSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('test-profile');
      expect(result.data.model).toBe('claude-sonnet-4-20250514');
      expect(result.data.effort).toBe('medium');
    }
  });

  it('parses a full profile with all fields', () => {
    const data = {
      name: 'full-profile',
      description: 'A complete profile',
      model: 'claude-opus-4-20250514',
      effort: 'high',
      system_prompt: 'You are a helpful assistant.',
      mcp_servers: [
        {
          name: 'filesystem',
          command: 'npx',
          args: ['-y', '@anthropic/mcp-server-filesystem'],
        },
      ],
      skills: [
        {
          name: 'test-runner',
          path: './skills/test-runner.md',
        },
      ],
      settings: {
        max_turns: 50,
        timeout: 300,
      },
      source: 'scanned',
      source_path: '/Users/test/.claude',
    };

    const result = ProfileSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('full-profile');
      expect(result.data.effort).toBe('high');
      expect(result.data.mcp_servers).toHaveLength(1);
      expect(result.data.skills).toHaveLength(1);
    }
  });

  it('rejects profile without name', () => {
    const data = {
      model: 'claude-sonnet-4-20250514',
    };

    const result = ProfileSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects profile without model', () => {
    const data = {
      name: 'test-profile',
    };

    const result = ProfileSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects invalid effort value', () => {
    const data = {
      name: 'test-profile',
      model: 'claude-sonnet-4-20250514',
      effort: 'extreme',
    };

    const result = ProfileSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('defaults effort to medium when not provided', () => {
    const data = {
      name: 'test-profile',
      model: 'claude-sonnet-4-20250514',
    };

    const result = ProfileSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.effort).toBe('medium');
    }
  });

  it('validates MCP server configuration', () => {
    const data = {
      name: 'test-profile',
      model: 'claude-sonnet-4-20250514',
      mcp_servers: [
        {
          name: 'github',
          command: 'npx',
          args: ['-y', '@anthropic/mcp-server-github'],
          env: {
            GITHUB_TOKEN: '${GITHUB_TOKEN}',
          },
        },
      ],
    };

    const result = ProfileSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcp_servers?.[0].env?.GITHUB_TOKEN).toBe('${GITHUB_TOKEN}');
    }
  });
});
