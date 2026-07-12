import { z } from 'zod';

export const McpServerSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

export const SkillSchema = z.object({
  name: z.string(),
  path: z.string().optional(),
  source: z.string().optional(),
});

export const ProfileSettingsSchema = z.object({
  max_turns: z.number().optional(),
  timeout: z.number().optional(),
  allowed_tools: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

export const ProfileSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  model: z.string(),
  effort: z.enum(['low', 'medium', 'high']).default('medium'),
  system_prompt: z.string().optional(),
  mcp_servers: z.array(McpServerSchema).optional(),
  skills: z.array(SkillSchema).optional(),
  settings: ProfileSettingsSchema.optional(),
  source: z.enum(['manual', 'scanned']).optional(),
  source_path: z.string().optional(),
});

const RegexPatternSchema = z.string().superRefine((pattern, ctx) => {
  try {
    new RegExp(pattern);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

export const VerificationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('command'),
    command: z.string().min(1),
  }),
  z.object({
    type: z.literal('pattern'),
    command: z.string().min(1),
    patterns: z.array(RegexPatternSchema).min(1),
    match: z.enum(['all', 'any']).default('all'),
  }),
  z.object({
    type: z.literal('ai_judge'),
    evidence_command: z.string().min(1),
    criteria: z.string().min(1),
  }),
]);

const TaskInputSchema = z.object({
  id: z.string(),
  title: z.string(),
  repo: z.string(),
  branch: z.string().default('main'),
  verification: VerificationSchema.optional(),
  // Legacy verification fields are normalized below when unambiguous.
  success_command: z.string().optional(),
  success_patterns: z.array(z.string()).optional(),
  ai_judge: z.boolean().optional(),
  ai_judge_criteria: z.string().optional(),
  timeout: z.number().optional(),
  working_dir: z.string().optional(),
  setup_commands: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).optional(),
  estimated_tokens: z.number().default(25000),
  expected_time: z.number().default(150),
});

export const TaskSchema = TaskInputSchema.superRefine((task, ctx) => {
  const hasLegacy = Boolean(
    task.success_command || task.success_patterns?.length || task.ai_judge || task.ai_judge_criteria
  );

  if (task.verification && hasLegacy) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['verification'],
      message: 'Do not combine verification with legacy success_* or ai_judge fields',
    });
    return;
  }

  if (task.verification) return;

  if (task.ai_judge_criteria && !task.ai_judge) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ai_judge_criteria'],
      message: 'ai_judge_criteria requires ai_judge: true',
    });
  }

  if (task.ai_judge) {
    if (task.success_patterns?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['success_patterns'],
        message: 'Legacy success_patterns cannot be combined with ai_judge',
      });
    }
    if (!task.success_command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['success_command'],
        message: 'Legacy ai_judge tasks require success_command as test evidence',
      });
    }
    if (!task.ai_judge_criteria) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ai_judge_criteria'],
        message: 'Legacy ai_judge tasks require ai_judge_criteria',
      });
    }
    return;
  }

  if (task.success_patterns?.length && !task.success_command) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['success_patterns'],
      message: 'Legacy success_patterns require success_command so patterns match verifier output',
    });
    return;
  }

  for (const [index, pattern] of (task.success_patterns ?? []).entries()) {
    try {
      new RegExp(pattern);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['success_patterns', index],
        message: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  if (!task.success_command) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['verification'],
      message: 'Task must define explicit verification',
    });
  }
}).transform((task) => {
  if (task.verification) {
    return { ...task, ai_judge: task.ai_judge ?? false, verification: task.verification };
  }

  if (task.ai_judge) {
    return {
      ...task,
      ai_judge: true,
      verification: {
        type: 'ai_judge' as const,
        evidence_command: task.success_command!,
        criteria: task.ai_judge_criteria!,
      },
    };
  }

  if (task.success_patterns?.length) {
    return {
      ...task,
      ai_judge: false,
      verification: {
        type: 'pattern' as const,
        command: task.success_command!,
        patterns: task.success_patterns,
        match: 'any' as const,
      },
    };
  }

  return {
    ...task,
    ai_judge: false,
    verification: { type: 'command' as const, command: task.success_command! },
  };
});

export const TokenMetricsSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_tokens: z.number(),
  cache_write_tokens: z.number(),
  total_tokens: z.number(),
});

export const ModelUsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_tokens: z.number(),
  cache_write_tokens: z.number(),
  cost_usd: z.number(),
});

export const MetricsSchema = z.object({
  tokens: TokenMetricsSchema,
  cost_usd: z.number(),
  duration_seconds: z.number(),
  turns: z.number(),
  model: z.string(),
  model_usage: z.record(ModelUsageSchema),
});

export const ScoreBreakdownSchema = z.object({
  success_bonus: z.number(),
  cost_score: z.number(),
  time_score: z.number(),
  difficulty_multiplier: z.number(),
  actual_cost: z.number(),
  expected_cost: z.number(),
  actual_time: z.number(),
  expected_time: z.number(),
});

export const ScoreSchema = z.object({
  value: z.number(),
  breakdown: ScoreBreakdownSchema,
});

export const RunStatusSchema = z.enum([
  'passed',
  'failed',
  'timed_out',
  'agent_error',
  'verification_error',
  'judge_error',
]);

export const RunResultSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  profile: z.object({
    name: z.string(),
    model: z.string(),
    effort: z.string(),
  }),
  task: z.object({
    id: z.string(),
    title: z.string(),
    difficulty: z.string().optional(),
  }),
  metrics: MetricsSchema.nullable(),
  result: z.object({
    success: z.boolean(),
    success_method: z.enum(['command', 'pattern', 'ai_judge', 'exit_code']),
    status: RunStatusSchema.optional(),
    error_type: z.string().optional(),
    success_details: z.string().optional(),
    exit_code: z.number().optional(),
    agent_exit_code: z.number().optional(),
    verifier_exit_code: z.number().optional(),
    files_modified: z.array(z.string()),
    files_created: z.array(z.string()),
    files_deleted: z.array(z.string()),
  }),
  score: ScoreSchema.nullable(),
  logs: z.object({
    stdout: z.string(),
    stderr: z.string(),
    conversation: z.string().optional(),
  }),
  artifacts: z.object({
    changes_patch: z.string(),
    files_manifest: z.string(),
    verifier_output: z.string().optional(),
    judge_output: z.string().optional(),
  }).optional(),
  warnings: z.array(z.string()).optional(),
});

export const BenchmarkConfigSchema = z.object({
  name: z.string().default('benchmark'),
  profiles: z.array(z.string()).min(1),
  tasks: z.array(z.string()).min(1),
  parallel: z.number().int().min(1).default(1),
  timeout: z.number().optional(),
  output: z.string().default('./results'),
});

export const BenchmarkSummarySchema = z.object({
  name: z.string(),
  timestamp: z.string(),
  config: BenchmarkConfigSchema,
  duration_seconds: z.number(),
  total_runs: z.number(),
  successful_runs: z.number(),
  failed_runs: z.number(),
  errored_runs: z.number(),
  total_cost_usd: z.number(),
  total_score: z.number(),
  errors: z.array(z.object({
    run_id: z.string(),
    message: z.string(),
    type: z.string().optional(),
    phase: z.enum(['setup', 'agent', 'verifier', 'judge', 'infrastructure']).optional(),
  })),
});

export type McpServer = z.infer<typeof McpServerSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type ProfileSettings = z.infer<typeof ProfileSettingsSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Verification = z.infer<typeof VerificationSchema>;
export type Metrics = z.infer<typeof MetricsSchema>;
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;
export type Score = z.infer<typeof ScoreSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunResult = z.infer<typeof RunResultSchema>;
export type BenchmarkConfig = z.infer<typeof BenchmarkConfigSchema>;
export type BenchmarkSummary = z.infer<typeof BenchmarkSummarySchema>;
