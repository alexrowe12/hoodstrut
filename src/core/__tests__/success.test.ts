import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluatePatterns, evaluateSuccess } from '../success.js';

vi.mock('../judge.js', async () => {
  const actual = await vi.importActual<typeof import('../judge.js')>('../judge.js');
  return { ...actual, evaluateWithJudge: vi.fn() };
});

import { evaluateWithJudge, JudgeEvaluationError } from '../judge.js';

const mockedEvaluateWithJudge = vi.mocked(evaluateWithJudge);

const verifier = {
  command: 'npm test',
  exitCode: 0,
  timedOut: false,
  stdout: 'Tests: 12 passed\nHello, World!',
  stderr: '',
};

const baseInput = {
  agentExitCode: 0,
  agentTimedOut: false,
  verification: { type: 'command' as const, command: 'npm test' },
  verifier,
  task: { title: 'Test task', body: 'Do the thing' },
  patch: 'diff --git a/a.ts b/a.ts',
  manifest: '{"files":[]}',
};

describe('evaluatePatterns', () => {
  it('requires all patterns by default', () => {
    const result = evaluatePatterns(['Tests: \\d+ passed', 'missing'], verifier.stdout, '');
    expect(result.success).toBe(false);
    expect(result.matches).toEqual([
      { pattern: 'Tests: \\d+ passed', matched: true },
      { pattern: 'missing', matched: false },
    ]);
  });

  it('supports explicit any matching', () => {
    expect(evaluatePatterns(['missing', 'Hello.*World'], verifier.stdout, '', 'any').success).toBe(true);
  });
});

describe('evaluateSuccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes a successful command verifier', async () => {
    const result = await evaluateSuccess(baseInput);
    expect(result).toMatchObject({ success: true, status: 'passed', method: 'command' });
  });

  it('treats verifier nonzero as a normal task failure', async () => {
    const result = await evaluateSuccess({
      ...baseInput,
      verifier: { ...verifier, exitCode: 1, stdout: 'tests failed' },
    });
    expect(result).toMatchObject({ success: false, status: 'failed' });
  });

  it('matches patterns only against verifier evidence', async () => {
    const result = await evaluateSuccess({
      ...baseInput,
      verification: {
        type: 'pattern',
        command: 'node hello.js',
        patterns: ['Hello.*World'],
        match: 'all',
      },
      verifier: { ...verifier, command: 'node hello.js', stdout: 'file not found', exitCode: 1 },
      patch: 'The assistant claimed: Hello World and task complete',
    });
    expect(result).toMatchObject({ success: false, status: 'failed', method: 'pattern' });
  });

  it('fails patterns that appear in the patch but not verifier output', async () => {
    const result = await evaluateSuccess({
      ...baseInput,
      verification: {
        type: 'pattern',
        command: 'node hello.js',
        patterns: ['Hello.*World'],
        match: 'all',
      },
      verifier: { ...verifier, command: 'node hello.js', stdout: 'different output' },
      patch: '+ console.log("Hello World")',
    });
    expect(result).toMatchObject({ success: false, status: 'failed' });
  });

  it('classifies agent timeouts without running verification', async () => {
    const result = await evaluateSuccess({ ...baseInput, agentTimedOut: true, verifier: undefined });
    expect(result).toMatchObject({ status: 'timed_out', errorType: 'agent_timeout' });
  });

  it('classifies agent process failures separately', async () => {
    const result = await evaluateSuccess({ ...baseInput, agentExitCode: 1, verifier: undefined });
    expect(result).toMatchObject({ status: 'agent_error', errorType: 'agent_error' });
  });

  it('classifies verifier timeouts as verification errors', async () => {
    const result = await evaluateSuccess({
      ...baseInput,
      verifier: { ...verifier, timedOut: true, exitCode: 137 },
    });
    expect(result).toMatchObject({ status: 'verification_error', errorType: 'verification_timeout' });
  });

  it('passes patch, manifest, and test evidence to the judge', async () => {
    mockedEvaluateWithJudge.mockResolvedValue({
      success: true,
      reasoning: 'Criteria are evidenced',
      confidence: 'high',
      criteria: [{ criterion: 'Works', met: true, evidence: 'Tests pass' }],
      rawResponse: '{"success":true}',
    });
    const result = await evaluateSuccess({
      ...baseInput,
      verification: {
        type: 'ai_judge',
        evidence_command: 'npm test',
        criteria: 'The change must work',
      },
    });

    expect(result.status).toBe('passed');
    expect(mockedEvaluateWithJudge).toHaveBeenCalledWith(expect.objectContaining({
      patch: baseInput.patch,
      manifest: baseInput.manifest,
      verifier,
    }));
    expect(result.judgeArtifact?.status).toBe('completed');
  });

  it('classifies invalid judge output as an unscored judge error', async () => {
    mockedEvaluateWithJudge.mockRejectedValue(new JudgeEvaluationError(
      'judge_invalid_response',
      'AI judge returned invalid JSON',
      'task was a success'
    ));
    const result = await evaluateSuccess({
      ...baseInput,
      verification: {
        type: 'ai_judge',
        evidence_command: 'npm test',
        criteria: 'The change must work',
      },
    });

    expect(result).toMatchObject({
      success: false,
      status: 'judge_error',
      errorType: 'judge_invalid_response',
    });
    expect(result.judgeArtifact).toMatchObject({
      status: 'error',
      raw_response: 'task was a success',
    });
  });
});
