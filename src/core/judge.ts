import Anthropic from '@anthropic-ai/sdk';

export interface JudgeInput {
  taskTitle: string;
  taskBody: string;
  judgeCriteria?: string;
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

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '\n... [truncated]';
}

function buildJudgePrompt(input: JudgeInput): string {
  const filesSection = [
    input.filesChanged.created.length > 0
      ? `Created: ${input.filesChanged.created.join(', ')}`
      : '',
    input.filesChanged.modified.length > 0
      ? `Modified: ${input.filesChanged.modified.join(', ')}`
      : '',
    input.filesChanged.deleted.length > 0
      ? `Deleted: ${input.filesChanged.deleted.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

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

export async function evaluateWithJudge(input: JudgeInput): Promise<JudgeResult> {
  const client = new Anthropic();

  const userPrompt = buildJudgePrompt(input);

  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 500,
    system: JUDGE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    const result = JSON.parse(jsonMatch[0]);
    return {
      success: Boolean(result.success),
      reasoning: result.reasoning || 'No reasoning provided',
      confidence: result.confidence || 'medium',
    };
  } catch {
    const lowerText = text.toLowerCase();
    return {
      success: lowerText.includes('success') && !lowerText.includes('not success'),
      reasoning: text.slice(0, 500),
      confidence: 'low',
    };
  }
}
