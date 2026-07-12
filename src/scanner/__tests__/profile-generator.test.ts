import { describe, it, expect } from 'vitest';
import { generateProfile } from '../profile-generator.js';
import type { ScanResult } from '../index.js';

describe('generateProfile', () => {
  const baseScanResult: ScanResult = {
    sourcePath: '/Users/test/.claude',
    settings: {
      global: {},
      project: {},
      merged: {},
    },
    mcpServers: {
      global: [],
      project: [],
      merged: [],
      requiredEnvVars: [],
      warnings: [],
    },
    prompt: null,
    skills: [],
    env: {
      claudeCodeVars: [],
    },
  };

  it('should generate a profile with defaults', () => {
    const { profile, yaml } = generateProfile(baseScanResult, 'test-profile');

    expect(profile.name).toBe('test-profile');
    expect(profile.model).toBe('claude-sonnet-5');
    expect(profile.effort).toBe('medium');
    expect(profile.source).toBe('scanned');
    expect(yaml).toContain('name: test-profile');
  });

  it('should use settings model and effort', () => {
    const scanResult: ScanResult = {
      ...baseScanResult,
      settings: {
        global: {},
        project: {},
        merged: {
          model: 'opus',
          effortLevel: 'high',
        },
      },
    };

    const { profile } = generateProfile(scanResult, 'test');

    expect(profile.model).toBe('claude-opus-4-8');
    expect(profile.effort).toBe('high');
  });

  it('should prefer env vars over settings', () => {
    const scanResult: ScanResult = {
      ...baseScanResult,
      settings: {
        global: {},
        project: {},
        merged: {
          model: 'sonnet',
          effortLevel: 'low',
        },
      },
      env: {
        model: 'claude-opus-4-20250514',
        effort: 'high',
        claudeCodeVars: [],
      },
    };

    const { profile } = generateProfile(scanResult, 'test');

    expect(profile.model).toBe('claude-opus-4-20250514');
    expect(profile.effort).toBe('high');
  });

  it('should map xhigh effort to high', () => {
    const scanResult: ScanResult = {
      ...baseScanResult,
      settings: {
        global: {},
        project: {},
        merged: {
          effortLevel: 'xhigh',
        },
      },
    };

    const { profile } = generateProfile(scanResult, 'test');

    expect(profile.effort).toBe('high');
  });

  it('should include MCP servers', () => {
    const scanResult: ScanResult = {
      ...baseScanResult,
      mcpServers: {
        global: [],
        project: [],
        merged: [
          {
            name: 'github',
            command: 'npx',
            args: ['-y', '@anthropic/mcp-server-github'],
            env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
          },
        ],
        requiredEnvVars: ['GITHUB_TOKEN'],
        warnings: [],
      },
    };

    const { profile, yaml, requiredEnvVars } = generateProfile(scanResult, 'test');

    expect(profile.mcp_servers).toHaveLength(1);
    expect(profile.mcp_servers?.[0].name).toBe('github');
    expect(yaml).toContain('mcp_servers:');
    expect(yaml).toContain('${GITHUB_TOKEN}');
    expect(requiredEnvVars).toEqual(['GITHUB_TOKEN']);
  });

  it('should include system prompt from CLAUDE.md', () => {
    const scanResult: ScanResult = {
      ...baseScanResult,
      prompt: {
        content: 'You are a helpful assistant.',
        sourcePath: '/project/CLAUDE.md',
      },
    };

    const { profile, yaml } = generateProfile(scanResult, 'test');

    expect(profile.system_prompt).toBe('You are a helpful assistant.');
    expect(yaml).toContain('system_prompt:');
  });

  it('should include skills', () => {
    const scanResult: ScanResult = {
      ...baseScanResult,
      skills: [
        {
          name: 'deploy',
          description: 'Deploy the app',
          sourcePath: '/Users/test/.claude/skills/deploy/SKILL.md',
        },
      ],
    };

    const { profile } = generateProfile(scanResult, 'test');

    expect(profile.skills).toHaveLength(1);
    expect(profile.skills?.[0].name).toBe('deploy');
    expect(profile.skills?.[0].source).toContain('deploy/SKILL.md');
  });

  it('should include header comment with timestamp', () => {
    const { yaml } = generateProfile(baseScanResult, 'test');

    expect(yaml).toContain('# Generated profile: test');
    expect(yaml).toContain('# Scanned from:');
    expect(yaml).toContain('# Scanned at:');
  });
});
