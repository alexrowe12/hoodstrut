export type ExecutionPhase = 'setup' | 'agent' | 'verifier';
export type ExecutionErrorCode =
  | 'setup_failed'
  | 'setup_timeout'
  | 'infrastructure_error';

export class ExecutionPhaseError extends Error {
  constructor(
    public readonly code: ExecutionErrorCode,
    public readonly phase: ExecutionPhase,
    message: string,
    public readonly options: { timedOut: boolean; exitCode?: number }
  ) {
    super(message);
    this.name = 'ExecutionPhaseError';
  }
}
