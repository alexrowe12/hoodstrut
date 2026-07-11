import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn(),
      },
    })),
  };
});

import Anthropic from '@anthropic-ai/sdk';
import { evaluateWithJudge } from '../judge.js';

const MockedAnthropic = vi.mocked(Anthropic);

describe('evaluateWithJudge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseInput = {
    taskTitle: 'Fix the bug',
    taskBody: 'The login button is broken',
    stdout: 'Fixed login handler',
    stderr: '',
    exitCode: 0,
    filesChanged: {
      modified: ['src/login.ts'],
      created: [],
      deleted: [],
    },
  };

  it('returns success when judge says success', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"success": true, "reasoning": "Task completed", "confidence": "high"}',
        },
      ],
    });

    MockedAnthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as unknown as Anthropic);

    const result = await evaluateWithJudge(baseInput);

    expect(result.success).toBe(true);
    expect(result.reasoning).toBe('Task completed');
    expect(result.confidence).toBe('high');
  });

  it('returns failure when judge says failure', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"success": false, "reasoning": "Tests still failing", "confidence": "high"}',
        },
      ],
    });

    MockedAnthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as unknown as Anthropic);

    const result = await evaluateWithJudge(baseInput);

    expect(result.success).toBe(false);
    expect(result.reasoning).toBe('Tests still failing');
  });

  it('handles JSON embedded in text', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: 'Based on my analysis:\n{"success": true, "reasoning": "All criteria met", "confidence": "medium"}\nEnd of response.',
        },
      ],
    });

    MockedAnthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as unknown as Anthropic);

    const result = await evaluateWithJudge(baseInput);

    expect(result.success).toBe(true);
    expect(result.reasoning).toBe('All criteria met');
    expect(result.confidence).toBe('medium');
  });

  it('handles malformed JSON gracefully', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: 'The task was a success, everything looks good.',
        },
      ],
    });

    MockedAnthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as unknown as Anthropic);

    const result = await evaluateWithJudge(baseInput);

    expect(result.success).toBe(true);
    expect(result.confidence).toBe('low');
  });

  it('infers failure from text when JSON malformed', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: 'The task was not successful, there were errors.',
        },
      ],
    });

    MockedAnthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as unknown as Anthropic);

    const result = await evaluateWithJudge(baseInput);

    expect(result.success).toBe(false);
    expect(result.confidence).toBe('low');
  });

  it('includes custom judge criteria in prompt', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"success": true, "reasoning": "Met custom criteria", "confidence": "high"}',
        },
      ],
    });

    MockedAnthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as unknown as Anthropic);

    await evaluateWithJudge({
      ...baseInput,
      judgeCriteria: 'Must add unit tests',
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain('Must add unit tests');
  });

  it('uses correct model and parameters', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '{"success": true, "reasoning": "OK", "confidence": "high"}',
        },
      ],
    });

    MockedAnthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as unknown as Anthropic);

    await evaluateWithJudge(baseInput);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('claude-sonnet-5');
    expect(callArgs.max_tokens).toBe(500);
    expect(callArgs.system).toBeDefined();
    expect(callArgs.messages).toHaveLength(1);
  });
});
