import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: vi.fn() } };
  }),
}));

import Anthropic from '@anthropic-ai/sdk';
import {
  buildJudgePrompt,
  evaluateWithJudge,
  JudgeEvaluationError,
} from '../judge.js';

const MockedAnthropic = vi.mocked(Anthropic);
const validResponse = {
  success: true,
  reasoning: 'The patch and tests satisfy the task',
  confidence: 'high',
  criteria: [{ criterion: 'Login works', met: true, evidence: 'Test output and handler patch' }],
};

const baseInput = {
  taskTitle: 'Fix the bug',
  taskBody: 'The login button is broken',
  judgeCriteria: 'The login flow works and tests pass',
  patch: 'diff --git a/src/login.ts b/src/login.ts\n+handleLogin();',
  manifest: '{"files":[{"path":"src/login.ts","status":"modified"}]}',
  agentExitCode: 0,
  verifier: {
    command: 'npm test',
    exitCode: 0,
    stdout: '12 tests passed',
    stderr: '',
  },
};

function mockResponse(text: string) {
  const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text }] });
  MockedAnthropic.mockImplementation(function () {
    return { messages: { create } } as unknown as Anthropic;
  });
  return create;
}

describe('AI judge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a strictly validated judgment', async () => {
    mockResponse(JSON.stringify(validResponse));
    const result = await evaluateWithJudge(baseInput);
    expect(result).toMatchObject(validResponse);
    expect(result.rawResponse).toBe(JSON.stringify(validResponse));
  });

  it('includes patch, manifest, and verifier evidence but no assistant conversation', () => {
    const prompt = buildJudgePrompt(baseInput);
    expect(prompt).toContain('handleLogin');
    expect(prompt).toContain('src/login.ts');
    expect(prompt).toContain('12 tests passed');
    expect(prompt).not.toContain('assistant output');
  });

  it('rejects malformed prose instead of inferring success', async () => {
    mockResponse('The task was a success, everything looks good.');
    await expect(evaluateWithJudge(baseInput)).rejects.toMatchObject({
      code: 'judge_invalid_response',
    });
  });

  it('rejects JSON missing criterion-level evidence', async () => {
    mockResponse('{"success":true,"reasoning":"Looks good","confidence":"high"}');
    await expect(evaluateWithJudge(baseInput)).rejects.toBeInstanceOf(JudgeEvaluationError);
  });

  it('classifies API failures', async () => {
    const create = vi.fn().mockRejectedValue(new Error('service unavailable'));
    MockedAnthropic.mockImplementation(function () {
      return { messages: { create } } as unknown as Anthropic;
    });
    await expect(evaluateWithJudge(baseInput)).rejects.toMatchObject({
      code: 'judge_request_failed',
    });
  });

  it('uses the configured judge model and evidence budget', async () => {
    const create = mockResponse(JSON.stringify(validResponse));
    await evaluateWithJudge({ ...baseInput, patch: 'x'.repeat(40_000) });
    const request = create.mock.calls[0][0];
    expect(request.model).toBe('claude-sonnet-5');
    expect(request.max_tokens).toBe(1000);
    expect(request.messages[0].content).toContain('patch truncated');
  });
});
