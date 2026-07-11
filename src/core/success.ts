import { evaluateWithJudge } from './judge.js';

export type SuccessMethod = 'command' | 'pattern' | 'ai_judge' | 'exit_code';

export interface SuccessResult {
  success: boolean;
  method: SuccessMethod;
  details?: string;
}

export interface SuccessEvaluationInput {
  exitCode: number;
  stdout: string;
  stderr: string;
  task: {
    success_command?: string;
    success_patterns?: string[];
    ai_judge?: boolean;
    ai_judge_criteria?: string;
    title: string;
    body: string;
  };
  filesChanged: {
    modified: string[];
    created: string[];
    deleted: string[];
  };
}

export function evaluatePatterns(
  patterns: string[],
  stdout: string,
  stderr: string
): SuccessResult | null {
  const combined = stdout + '\n' + stderr;

  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, 'im');
      if (regex.test(combined)) {
        return {
          success: true,
          method: 'pattern',
          details: `matched regex: ${pattern}`,
        };
      }
    } catch {
      if (combined.includes(pattern)) {
        return {
          success: true,
          method: 'pattern',
          details: `matched substring: "${pattern}"`,
        };
      }
    }
  }

  return null;
}

export async function evaluateSuccess(input: SuccessEvaluationInput): Promise<SuccessResult> {
  if (input.task.success_command) {
    return {
      success: input.exitCode === 0,
      method: 'command',
      details: `success_command "${input.task.success_command}" exited with code ${input.exitCode}`,
    };
  }

  if (input.task.success_patterns?.length) {
    const patternResult = evaluatePatterns(
      input.task.success_patterns,
      input.stdout,
      input.stderr
    );
    if (patternResult) {
      return patternResult;
    }
    return {
      success: false,
      method: 'pattern',
      details: 'No success patterns matched',
    };
  }

  if (input.task.ai_judge) {
    const judgeResult = await evaluateWithJudge({
      taskTitle: input.task.title,
      taskBody: input.task.body,
      judgeCriteria: input.task.ai_judge_criteria,
      stdout: input.stdout,
      stderr: input.stderr,
      exitCode: input.exitCode,
      filesChanged: input.filesChanged,
    });
    return {
      success: judgeResult.success,
      method: 'ai_judge',
      details: `${judgeResult.reasoning} (confidence: ${judgeResult.confidence})`,
    };
  }

  return {
    success: input.exitCode === 0,
    method: 'exit_code',
    details: `Exit code: ${input.exitCode}`,
  };
}
