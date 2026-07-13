import { z } from 'zod';

const SafeNameSchema = z.string().min(1).regex(
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  'must contain only letters, numbers, dots, underscores, and hyphens'
).refine(value => value !== '.' && value !== '..', 'must not be a relative path segment');

export const McpServerSchema = z.object({
  name: SafeNameSchema,
  type: z.enum(['stdio', 'http', 'sse']).optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().min(1).optional(),
  headers: z.record(z.string()).optional(),
  timeout: z.number().int().positive().optional(),
}).strict().superRefine((server, ctx) => {
  const type = server.type ?? (server.url ? 'http' : 'stdio');
  if (type === 'stdio' && !server.command) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['command'],
      message: 'stdio MCP servers require command',
    });
  }
  if (type !== 'stdio' && !server.url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['url'],
      message: `${type} MCP servers require url`,
    });
  }
  if (type === 'stdio' && (server.url || server.headers)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'stdio MCP servers cannot define url or headers',
    });
  }
  if (type !== 'stdio' && (server.command || server.args || server.env)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${type} MCP servers cannot define command, args, or env`,
    });
  }
}).transform(server => ({
  ...server,
  type: server.type ?? (server.url ? 'http' as const : 'stdio' as const),
}));

export const SkillSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const skill = value as Record<string, unknown>;
  const { path: legacyPath, ...rest } = skill;
  return {
    ...rest,
    source: skill.source ?? legacyPath,
  };
}, z.object({
  name: SafeNameSchema,
  source: z.string().min(1),
}).strict());

export const ProfileSettingsSchema = z.object({
  max_turns: z.number().int().positive().optional(),
  timeout: z.number().int().positive().optional(),
  allowed_tools: z.array(z.string()).optional(),
  disallowed_tools: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
}).strict();

export const ProfileSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  model: z.string(),
  effort: z.enum(['low', 'medium', 'high', 'max']).default('medium'),
  system_prompt: z.string().optional(),
  mcp_servers: z.array(McpServerSchema).optional(),
  skills: z.array(SkillSchema).optional(),
  settings: ProfileSettingsSchema.optional(),
  source: z.enum(['manual', 'scanned']).optional(),
  source_path: z.string().optional(),
}).strict().superRefine((profile, ctx) => {
  for (const [field, values] of [
    ['mcp_servers', profile.mcp_servers],
    ['skills', profile.skills],
  ] as const) {
    const names = new Set<string>();
    for (const [index, value] of (values ?? []).entries()) {
      if (names.has(value.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field, index, 'name'],
          message: `Duplicate ${field === 'skills' ? 'skill' : 'MCP server'} name: ${value.name}`,
        });
      }
      names.add(value.name);
    }
  }
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
  branch: z.string().min(1).optional(),
  commit: z.string().regex(
    /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/,
    'commit must be a full 40- or 64-character hexadecimal object ID'
  ).optional(),
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
  if (task.branch && task.commit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['commit'],
      message: 'commit and branch are mutually exclusive',
    });
  }

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
  const normalizedTask = {
    ...task,
    branch: task.branch ?? (task.commit ? undefined : 'main'),
    commit: task.commit?.toLowerCase(),
  };
  if (task.verification) {
    return { ...normalizedTask, ai_judge: task.ai_judge ?? false, verification: task.verification };
  }

  if (task.ai_judge) {
    return {
      ...normalizedTask,
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
      ...normalizedTask,
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
    ...normalizedTask,
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

const ProvenanceSchema = z.object({
  hoodstrut_version: z.string(),
  runner: z.object({
    tag: z.string(),
    build_inputs_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    image_id: z.string(),
    repo_digests: z.array(z.string()),
    platform: z.object({
      os: z.string(),
      architecture: z.string(),
    }),
  }),
  repository: z.object({
    source: z.string(),
    source_type: z.enum(['remote_git', 'local_git', 'local_snapshot']),
    requested_branch: z.string().optional(),
    requested_commit: z.string().optional(),
    resolved_commit: z.string().optional(),
    immutable: z.boolean(),
    content_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  runtime: z.object({
    node: z.string(),
    npm: z.string(),
    git: z.string(),
    python: z.string(),
    claude_code: z.string(),
    agent_sdk: z.string(),
  }),
  docker: z.object({
    server_version: z.string(),
    api_version: z.string(),
    os: z.string(),
    architecture: z.string(),
  }),
});

export const RunResultSchema = z.object({
  id: z.string(),
  // Optional only so reports can still read results written before repetitions existed.
  repetition: z.number().int().positive().optional(),
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
  // Optional only so reports can still read results written before provenance existed.
  provenance: ProvenanceSchema.optional(),
});

export const BenchmarkConfigSchema = z.object({
  name: z.string().default('benchmark'),
  profiles: z.array(z.string()).min(1),
  tasks: z.array(z.string()).min(1),
  repetitions: z.number().int().min(1).default(1),
  parallel: z.number().int().min(1).default(1),
  timeout: z.number().optional(),
  output: z.string().default('./results'),
});

const ConfidenceIntervalSchema = z.object({
  lower: z.number(),
  upper: z.number(),
});

const DistributionSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  mean: z.number().nullable(),
  median: z.number().nullable(),
  variance: z.number().nullable(),
  standard_deviation: z.number().nullable(),
  minimum: z.number().nullable(),
  maximum: z.number().nullable(),
  confidence_interval_95: ConfidenceIntervalSchema.nullable(),
});

const ProfileAnalysisSchema = z.object({
  name: z.string(),
  expected_samples: z.number().int().nonnegative(),
  observed_samples: z.number().int().nonnegative(),
  valid_samples: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  timed_out: z.number().int().nonnegative(),
  errored: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  completion_rate: z.number(),
  success_rate: z.number().nullable(),
  success_confidence_interval_95: ConfidenceIntervalSchema.nullable(),
  total_cost_usd: z.number(),
  cost_per_pass_usd: z.number().nullable(),
  total_duration_seconds: z.number(),
  duration_per_pass_seconds: z.number().nullable(),
  cost: DistributionSummarySchema,
  duration: DistributionSummarySchema,
  eligible: z.boolean(),
  rank: z.number().int().positive().nullable(),
});

const TaskProfileAnalysisSchema = z.object({
  task_id: z.string(),
  task_title: z.string(),
  profile_name: z.string(),
  expected_samples: z.number().int().nonnegative(),
  observed_samples: z.number().int().nonnegative(),
  valid_samples: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  timed_out: z.number().int().nonnegative(),
  errored: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  success_rate: z.number().nullable(),
  success_confidence_interval_95: ConfidenceIntervalSchema.nullable(),
  mean_cost_usd: z.number().nullable(),
  mean_duration_seconds: z.number().nullable(),
});

export const BenchmarkAnalysisSchema = z.object({
  methodology: z.literal('lexicographic-v2'),
  confidence_level: z.literal(0.95),
  repetitions: z.number().int().positive(),
  expected_samples: z.number().int().nonnegative(),
  observed_samples: z.number().int().nonnegative(),
  valid_samples: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  timed_out: z.number().int().nonnegative(),
  errored: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  expected_sample_manifest: z.array(z.object({
    run_id: z.string(),
    profile_name: z.string(),
    task_id: z.string(),
    task_title: z.string(),
    repetition: z.number().int().positive(),
  })),
  profiles: z.array(ProfileAnalysisSchema),
  task_profiles: z.array(TaskProfileAnalysisSchema),
  decision: z.object({
    leader: z.string().nullable(),
    winner: z.string().nullable(),
    status: z.enum([
      'winner',
      'tie',
      'incomplete',
      'insufficient_repetitions',
      'insufficient_competitors',
      'inconclusive',
    ]),
    reason: z.string(),
  }),
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
  // Legacy additive-score summaries remain readable, but v2 does not write this field.
  total_score: z.number().optional(),
  methodology: z.literal('lexicographic-v2').optional(),
  analysis: BenchmarkAnalysisSchema.optional(),
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
export type BenchmarkAnalysis = z.infer<typeof BenchmarkAnalysisSchema>;
export type ProfileAnalysis = z.infer<typeof ProfileAnalysisSchema>;
export type TaskProfileAnalysis = z.infer<typeof TaskProfileAnalysisSchema>;
export type DistributionSummary = z.infer<typeof DistributionSummarySchema>;
export type ConfidenceInterval = z.infer<typeof ConfidenceIntervalSchema>;
