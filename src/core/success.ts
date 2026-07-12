import {
  evaluateWithJudge,
  JudgeEvaluationError,
  type JudgeResult,
} from './judge.js';
import type { RunStatus, Verification } from './types.js';

export type SuccessMethod = 'command' | 'pattern' | 'ai_judge';
export interface JudgeArtifact {
  status: 'completed' | 'error';
  raw_response?: string;
  result?: Omit<JudgeResult, 'rawResponse'>;
  error_code?: string;
  error?: string;
}

export interface SuccessResult {
  success: boolean;
  status: RunStatus;
  method: SuccessMethod;
  details: string;
  errorType?: string;
  judgeArtifact?: JudgeArtifact;
}

export interface SuccessEvaluationInput {
  agentExitCode: number;
  agentTimedOut: boolean;
  verification: Verification;
  verifier?: {
    command: string;
    exitCode: number;
    timedOut: boolean;
    stdout: string;
    stderr: string;
  };
  task: {
    title: string;
    body: string;
  };
  patch: string;
  manifest: string;
}

export interface PatternEvaluation {
  success: boolean;
  matches: Array<{ pattern: string; matched: boolean }>;
}

export function evaluatePatterns(
  patterns: string[],
  stdout: string,
  stderr: string,
  match: 'all' | 'any' = 'all'
): PatternEvaluation {
  const evidence = `${stdout}\n${stderr}`;
  const matches = patterns.map(pattern => ({
    pattern,
    matched: new RegExp(pattern, 'im').test(evidence),
  }));
  return {
    success: match === 'all' ? matches.every(item => item.matched) : matches.some(item => item.matched),
    matches,
  };
}

function verifierUnavailable(method: SuccessMethod): SuccessResult {
  return {
    success: false,
    status: 'verification_error',
    method,
    details: 'Verifier evidence was not produced',
    errorType: 'verifier_missing',
  };
}

export async function evaluateSuccess(input: SuccessEvaluationInput): Promise<SuccessResult> {
  const method = input.verification.type === 'ai_judge'
    ? 'ai_judge'
    : input.verification.type;

  if (input.agentTimedOut) {
    return {
      success: false,
      status: 'timed_out',
      method,
      details: 'Agent exceeded its execution timeout',
      errorType: 'agent_timeout',
    };
  }

  if (input.agentExitCode !== 0) {
    return {
      success: false,
      status: 'agent_error',
      method,
      details: `Agent exited with code ${input.agentExitCode}`,
      errorType: 'agent_error',
    };
  }

  if (!input.verifier) return verifierUnavailable(method);
  if (input.verifier.timedOut) {
    return {
      success: false,
      status: 'verification_error',
      method,
      details: 'Verifier exceeded its execution timeout',
      errorType: 'verification_timeout',
    };
  }

  if (input.verification.type === 'command') {
    const success = input.verifier.exitCode === 0;
    return {
      success,
      status: success ? 'passed' : 'failed',
      method: 'command',
      details: `Verification command "${input.verifier.command}" exited with code ${input.verifier.exitCode}`,
    };
  }

  if (input.verification.type === 'pattern') {
    if (input.verifier.exitCode !== 0) {
      return {
        success: false,
        status: 'failed',
        method: 'pattern',
        details: `Pattern evidence command exited with code ${input.verifier.exitCode}`,
      };
    }

    const evaluation = evaluatePatterns(
      input.verification.patterns,
      input.verifier.stdout,
      input.verifier.stderr,
      input.verification.match
    );
    const summary = evaluation.matches
      .map(item => `${item.matched ? 'matched' : 'missed'}: ${item.pattern}`)
      .join('; ');
    return {
      success: evaluation.success,
      status: evaluation.success ? 'passed' : 'failed',
      method: 'pattern',
      details: `${input.verification.match} patterns required; ${summary}`,
    };
  }

  try {
    const result = await evaluateWithJudge({
      taskTitle: input.task.title,
      taskBody: input.task.body,
      judgeCriteria: input.verification.criteria,
      patch: input.patch,
      manifest: input.manifest,
      agentExitCode: input.agentExitCode,
      verifier: input.verifier,
    });
    const { rawResponse, ...parsedResult } = result;
    return {
      success: result.success,
      status: result.success ? 'passed' : 'failed',
      method: 'ai_judge',
      details: `${result.reasoning} (confidence: ${result.confidence})`,
      judgeArtifact: { status: 'completed', raw_response: rawResponse, result: parsedResult },
    };
  } catch (error) {
    const judgeError = error instanceof JudgeEvaluationError ? error : undefined;
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      status: 'judge_error',
      method: 'ai_judge',
      details: message,
      errorType: judgeError?.code ?? 'judge_error',
      judgeArtifact: {
        status: 'error',
        raw_response: judgeError?.rawResponse,
        error_code: judgeError?.code ?? 'judge_error',
        error: message,
      },
    };
  }
}
