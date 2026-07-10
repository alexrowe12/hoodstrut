export interface ScannedEnvVars {
  effort?: string;
  model?: string;
  claudeCodeVars: string[];
}

const CLAUDE_CODE_PREFIXES = ['CLAUDE_CODE_', 'CLAUDE_'];
const ANTHROPIC_VARS = ['ANTHROPIC_MODEL'];

export function scanEnvVars(): ScannedEnvVars {
  const result: ScannedEnvVars = {
    claudeCodeVars: [],
  };

  // Check for effort level env var
  const effortLevel = process.env.CLAUDE_CODE_EFFORT_LEVEL;
  if (effortLevel) {
    result.effort = effortLevel;
  }

  // Check for model env var
  const model = process.env.ANTHROPIC_MODEL;
  if (model) {
    result.model = model;
  }

  // Collect all Claude Code related env vars (names only, not values)
  for (const key of Object.keys(process.env)) {
    const isClaudeVar = CLAUDE_CODE_PREFIXES.some(prefix => key.startsWith(prefix));
    const isAnthropicVar = ANTHROPIC_VARS.includes(key);

    if (isClaudeVar || isAnthropicVar) {
      result.claudeCodeVars.push(key);
    }
  }

  return result;
}
