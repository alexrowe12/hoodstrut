import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanEnvVars } from '../env.js';

describe('scanEnvVars', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should detect CLAUDE_CODE_EFFORT_LEVEL', () => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'high';

    const result = scanEnvVars();

    expect(result.effort).toBe('high');
    expect(result.claudeCodeVars).toContain('CLAUDE_CODE_EFFORT_LEVEL');
  });

  it('should detect ANTHROPIC_MODEL', () => {
    process.env.ANTHROPIC_MODEL = 'claude-opus-4-20250514';

    const result = scanEnvVars();

    expect(result.model).toBe('claude-opus-4-20250514');
    expect(result.claudeCodeVars).toContain('ANTHROPIC_MODEL');
  });

  it('should collect all CLAUDE_ prefixed vars', () => {
    process.env.CLAUDE_CODE_SOME_SETTING = 'value';
    process.env.CLAUDE_OTHER_VAR = 'value';

    const result = scanEnvVars();

    expect(result.claudeCodeVars).toContain('CLAUDE_CODE_SOME_SETTING');
    expect(result.claudeCodeVars).toContain('CLAUDE_OTHER_VAR');
  });

  it('should not include non-Claude vars', () => {
    process.env.SOME_OTHER_VAR = 'value';

    const result = scanEnvVars();

    expect(result.claudeCodeVars).not.toContain('SOME_OTHER_VAR');
  });
});
