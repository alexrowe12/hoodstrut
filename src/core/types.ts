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

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  repo: z.string(),
  branch: z.string().default('main'),
  success_command: z.string().optional(),
  success_patterns: z.array(z.string()).optional(),
  ai_judge: z.boolean().default(false),
  ai_judge_criteria: z.string().optional(),
  timeout: z.number().optional(),
  working_dir: z.string().optional(),
  setup_commands: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).optional(),
  estimated_tokens: z.number().default(25000),
  expected_time: z.number().default(150),
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
    success_details: z.string().optional(),
    exit_code: z.number().optional(),
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
  })),
});

export type McpServer = z.infer<typeof McpServerSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type ProfileSettings = z.infer<typeof ProfileSettingsSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Metrics = z.infer<typeof MetricsSchema>;
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;
export type Score = z.infer<typeof ScoreSchema>;
export type RunResult = z.infer<typeof RunResultSchema>;
export type BenchmarkConfig = z.infer<typeof BenchmarkConfigSchema>;
export type BenchmarkSummary = z.infer<typeof BenchmarkSummarySchema>;
