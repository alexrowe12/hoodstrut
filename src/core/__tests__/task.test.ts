import { describe, it, expect } from 'vitest';
import { TaskSchema } from '../types.js';

describe('TaskSchema', () => {
  it('parses a valid minimal task', () => {
    const data = {
      id: 'test-task',
      title: 'Test Task',
      repo: './repos/test-app',
      verification: { type: 'command', command: 'npm test' },
    };

    const result = TaskSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('test-task');
      expect(result.data.title).toBe('Test Task');
      expect(result.data.branch).toBe('main');
    }
  });

  it('parses a full task with all fields', () => {
    const data = {
      id: 'full-task',
      title: 'Complete Task',
      repo: 'https://github.com/example/repo',
      branch: 'develop',
      verification: {
        type: 'ai_judge',
        evidence_command: 'npm test',
        criteria: 'Code should be well-structured',
      },
      timeout: 600,
      working_dir: 'src',
      setup_commands: ['npm install'],
      tags: ['backend', 'api'],
      difficulty: 'hard',
      estimated_tokens: 50000,
    };

    const result = TaskSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.branch).toBe('develop');
      expect(result.data.difficulty).toBe('hard');
      expect(result.data.tags).toContain('backend');
    }
  });

  it('rejects task without id', () => {
    const data = {
      title: 'Test Task',
      repo: './repos/test-app',
      verification: { type: 'command', command: 'npm test' },
    };

    const result = TaskSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects task without repo', () => {
    const data = {
      id: 'test-task',
      title: 'Test Task',
      verification: { type: 'command', command: 'npm test' },
    };

    const result = TaskSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('validates difficulty enum', () => {
    const validDifficulties = ['easy', 'medium', 'hard', 'expert'];

    for (const difficulty of validDifficulties) {
      const data = {
        id: 'test-task',
        title: 'Test Task',
        repo: './repos/test-app',
        verification: { type: 'command', command: 'npm test' },
        difficulty,
      };

      const result = TaskSchema.safeParse(data);
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid difficulty value', () => {
    const data = {
      id: 'test-task',
      title: 'Test Task',
      repo: './repos/test-app',
      verification: { type: 'command', command: 'npm test' },
      difficulty: 'impossible',
    };

    const result = TaskSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('defaults branch to main when not provided', () => {
    const data = {
      id: 'test-task',
      title: 'Test Task',
      repo: './repos/test-app',
      verification: { type: 'command', command: 'npm test' },
    };

    const result = TaskSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.branch).toBe('main');
    }
  });

  it('rejects a task without explicit verification', () => {
    const result = TaskSchema.safeParse({
      id: 'unverified',
      title: 'Unverified',
      repo: './repos/test-app',
    });
    expect(result.success).toBe(false);
  });

  it('normalizes an unambiguous legacy command', () => {
    const result = TaskSchema.parse({
      id: 'legacy',
      title: 'Legacy',
      repo: './repos/test-app',
      success_command: 'npm test',
    });
    expect(result.verification).toEqual({ type: 'command', command: 'npm test' });
  });

  it('rejects legacy prose-only patterns', () => {
    const result = TaskSchema.safeParse({
      id: 'unsafe-patterns',
      title: 'Unsafe patterns',
      repo: './repos/test-app',
      success_patterns: ['task complete'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid regular expressions', () => {
    const result = TaskSchema.safeParse({
      id: 'bad-regex',
      title: 'Bad regex',
      repo: './repos/test-app',
      verification: {
        type: 'pattern',
        command: 'npm test',
        patterns: ['[invalid'],
      },
    });
    expect(result.success).toBe(false);
  });

  it('defaults ai_judge to false when not provided', () => {
    const data = {
      id: 'test-task',
      title: 'Test Task',
      repo: './repos/test-app',
      verification: { type: 'command', command: 'npm test' },
    };

    const result = TaskSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ai_judge).toBe(false);
    }
  });
});
