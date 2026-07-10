import { describe, it, expect } from 'vitest';
import { TaskSchema } from '../types.js';

describe('TaskSchema', () => {
  it('parses a valid minimal task', () => {
    const data = {
      id: 'test-task',
      title: 'Test Task',
      repo: './repos/test-app',
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
      success_command: 'npm test',
      success_patterns: ['All tests passed'],
      ai_judge: true,
      ai_judge_criteria: 'Code should be well-structured',
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
    };

    const result = TaskSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects task without repo', () => {
    const data = {
      id: 'test-task',
      title: 'Test Task',
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
    };

    const result = TaskSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.branch).toBe('main');
    }
  });

  it('defaults ai_judge to false when not provided', () => {
    const data = {
      id: 'test-task',
      title: 'Test Task',
      repo: './repos/test-app',
    };

    const result = TaskSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ai_judge).toBe(false);
    }
  });
});
