# Phase 5: Success Determination & Results

## Overview

Phase 5 adds robust success determination (pattern matching, AI judge) and produces structured `RunResult` JSON output matching the schema in `types.ts`.

**Estimated effort:** Medium (2-3 focused sessions)

---

## What's Already Done

| Feature | Status | Location |
|---------|--------|----------|
| Exit code success | ✅ Done | `executor.ts:100-101` |
| File change tracking | ✅ Done | `executor.ts:273-296` |
| Basic JSON output | ✅ Partial | `run.ts:153-185` (ad-hoc format) |
| RunResultSchema | ✅ Defined | `types.ts:90-118` |

---

## Implementation Tasks

### 1. Success Determination Module

Create `src/core/success.ts` — a dedicated module for evaluating run success.

```typescript
// src/core/success.ts

export type SuccessMethod = 'command' | 'pattern' | 'ai_judge' | 'exit_code';

export interface SuccessResult {
  success: boolean;
  method: SuccessMethod;
  details?: string;  // e.g., "matched pattern: /test passed/i" or "AI judge: task completed"
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
```

**Evaluation order (first match wins):**
1. `success_command` → exit code (already implemented, just needs extraction)
2. `success_patterns` → regex/substring matching against stdout+stderr
3. `ai_judge: true` → call Claude API
4. Fallback → raw exit code

#### 1.1 Pattern Matching

```typescript
export function evaluatePatterns(
  patterns: string[],
  stdout: string,
  stderr: string
): SuccessResult | null {
  const combined = stdout + '\n' + stderr;
  
  for (const pattern of patterns) {
    // Try as regex first
    try {
      const regex = new RegExp(pattern, 'im');  // case-insensitive, multiline
      if (regex.test(combined)) {
        return {
          success: true,
          method: 'pattern',
          details: `matched regex: ${pattern}`,
        };
      }
    } catch {
      // Not a valid regex, try as substring
      if (combined.includes(pattern)) {
        return {
          success: true,
          method: 'pattern',
          details: `matched substring: "${pattern}"`,
        };
      }
    }
  }
  
  return null;  // No patterns matched
}
```

**Design note:** Patterns are currently "any match = success". The schema and function signature should be extensible for future enhancements:
- Negative patterns (must NOT match)
- All-match mode (all patterns must match)
- Weighted/scored patterns
- Semantic similarity matching (LLM-based)

#### 1.2 AI Judge

Create `src/core/judge.ts`:

```typescript
// src/core/judge.ts
import Anthropic from '@anthropic-ai/sdk';

export interface JudgeInput {
  taskTitle: string;
  taskBody: string;
  judgeCriteria?: string;  // Optional custom criteria from task
  stdout: string;
  stderr: string;
  exitCode: number;
  filesChanged: {
    modified: string[];
    created: string[];
    deleted: string[];
  };
}

export interface JudgeResult {
  success: boolean;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

const JUDGE_SYSTEM_PROMPT = `You are evaluating whether an AI coding assistant successfully completed a task.

You will be given:
- The task description and acceptance criteria
- The stdout/stderr output from the run
- The exit code
- List of files modified/created/deleted

Evaluate whether the task was completed successfully based on the acceptance criteria.

Respond with JSON only:
{
  "success": true/false,
  "reasoning": "Brief explanation of your decision",
  "confidence": "high" | "medium" | "low"
}`;

export async function evaluateWithJudge(input: JudgeInput): Promise<JudgeResult> {
  const client = new Anthropic();
  
  const userPrompt = buildJudgePrompt(input);
  
  const response = await client.messages.create({
    model: 'claude-sonnet-5-20250514',
    max_tokens: 500,
    thinking: {
      type: 'enabled',
      budget_tokens: 1024,  // Low effort - minimal thinking
    },
    system: JUDGE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });
  
  // Parse JSON response
  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');
  
  try {
    const result = JSON.parse(text);
    return {
      success: Boolean(result.success),
      reasoning: result.reasoning || 'No reasoning provided',
      confidence: result.confidence || 'medium',
    };
  } catch {
    // If JSON parse fails, try to infer from text
    const lowerText = text.toLowerCase();
    return {
      success: lowerText.includes('success') && !lowerText.includes('not success'),
      reasoning: text.slice(0, 500),
      confidence: 'low',
    };
  }
}

function buildJudgePrompt(input: JudgeInput): string {
  const filesSection = [
    input.filesChanged.created.length > 0 
      ? `Created: ${input.filesChanged.created.join(', ')}` : '',
    input.filesChanged.modified.length > 0 
      ? `Modified: ${input.filesChanged.modified.join(', ')}` : '',
    input.filesChanged.deleted.length > 0 
      ? `Deleted: ${input.filesChanged.deleted.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  return `## Task
${input.taskTitle}

${input.taskBody}

${input.judgeCriteria ? `## Custom Evaluation Criteria\n${input.judgeCriteria}\n` : ''}
## Execution Results

Exit code: ${input.exitCode}

### Files Changed
${filesSection || 'No files changed'}

### Output (stdout)
\`\`\`
${truncate(input.stdout, 3000)}
\`\`\`

### Errors (stderr)
\`\`\`
${truncate(input.stderr, 1000)}
\`\`\`

Evaluate whether this task was completed successfully.`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '\n... [truncated]';
}
```

**Cost estimate:** ~500 input tokens + 500 output tokens per judge call ≈ $0.003-0.005 per evaluation.

#### 1.3 Main Success Evaluator

```typescript
// src/core/success.ts (continued)

export async function evaluateSuccess(input: SuccessEvaluationInput): Promise<SuccessResult> {
  // 1. If success_command was specified, exit code determines success
  if (input.task.success_command) {
    return {
      success: input.exitCode === 0,
      method: 'command',
      details: `success_command "${input.task.success_command}" exited with code ${input.exitCode}`,
    };
  }
  
  // 2. Try pattern matching
  if (input.task.success_patterns?.length) {
    const patternResult = evaluatePatterns(
      input.task.success_patterns,
      input.stdout,
      input.stderr
    );
    if (patternResult) {
      return patternResult;
    }
    // Patterns defined but none matched = failure
    return {
      success: false,
      method: 'pattern',
      details: 'No success patterns matched',
    };
  }
  
  // 3. AI Judge
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
  
  // 4. Fallback: raw exit code
  return {
    success: input.exitCode === 0,
    method: 'exit_code',
    details: `Exit code: ${input.exitCode}`,
  };
}
```

---

### 2. Update ExecutionResult Type

Update `src/docker/types.ts`:

```typescript
export interface ExecutionResult {
  containerId: string;
  exitCode: number;
  duration: number;
  stdout: string;       // Path to stdout file
  stderr: string;       // Path to stderr file
  stdoutContent: string; // Actual content (for pattern matching)
  stderrContent: string; // Actual content (for pattern matching)
  filesChanged: {
    modified: string[];
    created: string[];
    deleted: string[];
  };
  metrics: MetricsResult;
}
```

**Remove** `success` and `successMethod` from `ExecutionResult` — these will be determined by the success module after execution, not during.

---

### 3. Update Executor

Modify `executor.ts` to:
1. Read stdout/stderr file contents after container exits
2. Return content in `ExecutionResult`
3. Remove success determination logic (moves to `success.ts`)

```typescript
// In runContainer(), after closeCaptureStreams:

const [stdoutContent, stderrContent] = await Promise.all([
  readFile(streams.stdoutPath, 'utf-8').catch(() => ''),
  readFile(streams.stderrPath, 'utf-8').catch(() => ''),
]);

return {
  containerId,
  exitCode,
  duration,
  stdout: streams.stdoutPath,
  stderr: streams.stderrPath,
  stdoutContent,
  stderrContent,
  filesChanged,
  metrics,
};
```

---

### 4. Update CLI Run Command

Refactor `run.ts` to:
1. Call `evaluateSuccess()` after execution
2. Build `RunResult` matching the schema
3. Write proper `run-result.json`

```typescript
// In run.ts action handler:

import { evaluateSuccess } from '../core/success.js';
import type { RunResult } from '../core/types.js';

// After runContainer():
const executionResult = await runContainer({ ... });

// Evaluate success
const successResult = await evaluateSuccess({
  exitCode: executionResult.exitCode,
  stdout: executionResult.stdoutContent,
  stderr: executionResult.stderrContent,
  task: {
    success_command: task.success_command,
    success_patterns: task.success_patterns,
    ai_judge: task.ai_judge,
    ai_judge_criteria: task.ai_judge_criteria,
    title: task.title,
    body: task.body,
  },
  filesChanged: executionResult.filesChanged,
});

// Build RunResult
const runResult: RunResult = {
  id: runId,
  timestamp: new Date().toISOString(),
  profile: {
    name: profile.name,
    model: profile.model,
    effort: profile.effort,
  },
  task: {
    id: task.id,
    title: task.title,
    difficulty: task.difficulty,
  },
  metrics: executionResult.metrics.success 
    ? executionResult.metrics.metrics 
    : {
        tokens: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 0 },
        cost_usd: 0,
        duration_seconds: executionResult.duration,
        turns: 0,
        model: profile.model,
        model_usage: {},
      },
  result: {
    success: successResult.success,
    success_method: successResult.method,
    exit_code: executionResult.exitCode,
    files_modified: executionResult.filesChanged.modified,
    files_created: executionResult.filesChanged.created,
    files_deleted: executionResult.filesChanged.deleted,
  },
  score: {
    value: 0,  // Placeholder - Phase 6
    breakdown: {
      success_bonus: 0,
      token_efficiency: 0,
      time_bonus: 0,
      difficulty_multiplier: 1,
    },
  },
  logs: {
    stdout: executionResult.stdout,
    stderr: executionResult.stderr,
    conversation: '',  // Deferred - future enhancement
  },
};

// Write result
await writeFile(
  resolve(outputDir, 'run-result.json'),
  JSON.stringify(runResult, null, 2),
  'utf-8'
);
```

---

### 5. Update RunResultSchema

The existing schema needs one modification — make `score` optional for Phase 5:

```typescript
// In types.ts, modify RunResultSchema:

export const RunResultSchema = z.object({
  // ... existing fields ...
  score: ScoreSchema.optional(),  // Make optional for Phase 5
  logs: z.object({
    stdout: z.string(),
    stderr: z.string(),
    conversation: z.string().optional(),  // Make optional - deferred
  }),
});
```

---

### 6. Add Anthropic SDK Dependency

The AI judge needs `@anthropic-ai/sdk` on the host (not just in container):

```bash
npm install @anthropic-ai/sdk
```

---

### 7. Tests

#### 7.1 Pattern Matching Tests (`src/core/__tests__/success.test.ts`)

```typescript
describe('evaluatePatterns', () => {
  it('matches regex pattern', () => { ... });
  it('matches substring when regex invalid', () => { ... });
  it('returns null when no patterns match', () => { ... });
  it('is case-insensitive', () => { ... });
  it('handles multiline output', () => { ... });
});

describe('evaluateSuccess', () => {
  it('uses command method when success_command set', async () => { ... });
  it('uses pattern method when success_patterns set', async () => { ... });
  it('falls back to exit_code when no criteria', async () => { ... });
  it('fails when patterns defined but none match', async () => { ... });
});
```

#### 7.2 AI Judge Tests (`src/core/__tests__/judge.test.ts`)

```typescript
describe('evaluateWithJudge', () => {
  // Mock the Anthropic client
  it('returns success when task completed', async () => { ... });
  it('returns failure when task not completed', async () => { ... });
  it('handles malformed JSON gracefully', async () => { ... });
  it('truncates long output', () => { ... });
});
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/core/success.ts` | Create | Success evaluation module |
| `src/core/judge.ts` | Create | AI judge implementation |
| `src/core/types.ts` | Modify | Make score/conversation optional |
| `src/docker/types.ts` | Modify | Add stdout/stderrContent, remove success fields |
| `src/docker/executor.ts` | Modify | Read file contents, remove success logic |
| `src/cli/commands/run.ts` | Modify | Use success module, write RunResult |
| `src/core/__tests__/success.test.ts` | Create | Pattern matching tests |
| `src/core/__tests__/judge.test.ts` | Create | AI judge tests |
| `package.json` | Modify | Add @anthropic-ai/sdk |

---

## Implementation Order

1. **Install SDK** — `npm install @anthropic-ai/sdk`
2. **Create success.ts** — pattern matching logic first (no external deps)
3. **Create judge.ts** — AI judge with Anthropic SDK
4. **Update types** — make score/conversation optional
5. **Update docker/types.ts** — add content fields
6. **Update executor.ts** — read content, remove success determination
7. **Update run.ts** — integrate success module, write RunResult
8. **Write tests** — pattern matching tests, judge tests (mocked)
9. **Manual test** — run against example task with patterns and ai_judge

---

## Deferred Items

| Item | Reason | Future Phase |
|------|--------|--------------|
| Conversation log capture | Requires SDK modification, low MVP value | Post-MVP |
| Negative patterns | Adds complexity, wait for user feedback | Future |
| Weighted/scored patterns | Premature until scoring phase | Phase 6+ |
| Semantic similarity | Requires embeddings, overkill for MVP | Post-MVP |

---

## Verification Checklist

- [x] `npm run build` passes
- [x] `npm run lint` passes
- [x] `npm run test:run` passes (85 tests, 22 new)
- [ ] Manual test: task with `success_command` produces correct result
- [ ] Manual test: task with `success_patterns` (regex) produces correct result
- [ ] Manual test: task with `success_patterns` (substring) produces correct result
- [ ] Manual test: task with `ai_judge: true` produces correct result
- [ ] Manual test: task with no success criteria uses exit code
- [ ] `run-result.json` validates against `RunResultSchema`
- [x] Score is present but null (placeholder)

## Implementation Status

**Completed 2026-07-11:**
- Installed `@anthropic-ai/sdk` dependency
- Created `src/core/success.ts` - pattern matching + orchestration
- Created `src/core/judge.ts` - AI judge with Sonnet 4, low thinking budget
- Updated `src/core/types.ts` - made score/conversation optional, added success_details
- Updated `src/docker/types.ts` - added stdoutContent/stderrContent
- Updated `src/docker/executor.ts` - reads output content
- Updated `src/cli/commands/run.ts` - uses success module, writes run-result.json
- Created `src/core/__tests__/success.test.ts` - 15 tests
- Created `src/core/__tests__/judge.test.ts` - 7 tests
- Fixed pre-existing lint errors in pricing.test.ts
- Added example tasks for pattern and AI judge testing
