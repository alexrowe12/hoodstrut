import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluatePatterns, evaluateSuccess } from '../success.js';

vi.mock('../judge.js', () => ({
  evaluateWithJudge: vi.fn(),
}));

import { evaluateWithJudge } from '../judge.js';

const mockedEvaluateWithJudge = vi.mocked(evaluateWithJudge);

describe('evaluatePatterns', () => {
  it('matches regex pattern in stdout', () => {
    const result = evaluatePatterns(
      ['test.*passed'],
      'Running tests...\ntest suite passed successfully',
      ''
    );
    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.method).toBe('pattern');
    expect(result?.details).toContain('matched regex');
  });

  it('matches substring when regex is invalid', () => {
    const result = evaluatePatterns(
      ['[invalid regex'],
      'output contains [invalid regex literally',
      ''
    );
    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.method).toBe('pattern');
    expect(result?.details).toContain('matched substring');
  });

  it('returns null when no patterns match', () => {
    const result = evaluatePatterns(
      ['success', 'passed', 'ok'],
      'failed with errors',
      'error: something went wrong'
    );
    expect(result).toBeNull();
  });

  it('is case-insensitive', () => {
    const result = evaluatePatterns(
      ['SUCCESS'],
      'success',
      ''
    );
    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
  });

  it('handles multiline output', () => {
    const result = evaluatePatterns(
      ['^Tests: \\d+ passed'],
      'Running...\nTests: 15 passed\nDone.',
      ''
    );
    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
  });

  it('matches in stderr', () => {
    const result = evaluatePatterns(
      ['build successful'],
      '',
      'build successful'
    );
    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
  });

  it('returns first matching pattern', () => {
    const result = evaluatePatterns(
      ['first', 'second', 'third'],
      'contains first and second',
      ''
    );
    expect(result?.details).toContain('first');
  });
});

describe('evaluateSuccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseInput = {
    exitCode: 0,
    stdout: 'output',
    stderr: '',
    task: {
      title: 'Test task',
      body: 'Task body',
    },
    filesChanged: {
      modified: [],
      created: [],
      deleted: [],
    },
  };

  it('uses command method when success_command set and exits 0', async () => {
    const result = await evaluateSuccess({
      ...baseInput,
      task: { ...baseInput.task, success_command: 'npm test' },
    });
    expect(result.success).toBe(true);
    expect(result.method).toBe('command');
    expect(result.details).toContain('npm test');
  });

  it('uses command method and fails when exit code non-zero', async () => {
    const result = await evaluateSuccess({
      ...baseInput,
      exitCode: 1,
      task: { ...baseInput.task, success_command: 'npm test' },
    });
    expect(result.success).toBe(false);
    expect(result.method).toBe('command');
  });

  it('uses pattern method when success_patterns set', async () => {
    const result = await evaluateSuccess({
      ...baseInput,
      stdout: 'all tests passed',
      task: { ...baseInput.task, success_patterns: ['tests passed'] },
    });
    expect(result.success).toBe(true);
    expect(result.method).toBe('pattern');
  });

  it('fails when patterns defined but none match', async () => {
    const result = await evaluateSuccess({
      ...baseInput,
      stdout: 'tests failed',
      task: { ...baseInput.task, success_patterns: ['tests passed', 'success'] },
    });
    expect(result.success).toBe(false);
    expect(result.method).toBe('pattern');
    expect(result.details).toContain('No success patterns matched');
  });

  it('uses ai_judge method when ai_judge is true', async () => {
    mockedEvaluateWithJudge.mockResolvedValue({
      success: true,
      reasoning: 'Task completed successfully',
      confidence: 'high',
    });

    const result = await evaluateSuccess({
      ...baseInput,
      task: { ...baseInput.task, ai_judge: true },
    });

    expect(result.success).toBe(true);
    expect(result.method).toBe('ai_judge');
    expect(result.details).toContain('Task completed successfully');
    expect(result.details).toContain('confidence: high');
    expect(mockedEvaluateWithJudge).toHaveBeenCalled();
  });

  it('falls back to exit_code when no criteria', async () => {
    const result = await evaluateSuccess(baseInput);
    expect(result.success).toBe(true);
    expect(result.method).toBe('exit_code');
  });

  it('exit_code fallback fails on non-zero', async () => {
    const result = await evaluateSuccess({
      ...baseInput,
      exitCode: 1,
    });
    expect(result.success).toBe(false);
    expect(result.method).toBe('exit_code');
  });

  it('command takes precedence over patterns', async () => {
    const result = await evaluateSuccess({
      ...baseInput,
      exitCode: 1,
      stdout: 'tests passed',
      task: {
        ...baseInput.task,
        success_command: 'npm test',
        success_patterns: ['tests passed'],
      },
    });
    expect(result.success).toBe(false);
    expect(result.method).toBe('command');
  });
});
