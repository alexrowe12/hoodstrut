# Phase 4: Metrics & Telemetry - Implementation Plan

## Overview

**Two-pronged approach:**
1. **Agent SDK for metrics** (all runs): Use `@anthropic-ai/claude-agent-sdk` to run Claude Code and capture token/cost data directly from the response stream
2. **OTEL for telemetry** (optional `--telemetry` flag): Export detailed traces/spans to user's OTEL collector

## Architecture Change

**Before (Phase 3):** `spawn('docker', ['run', ...])` → `claude --print` → parse OTEL files
**After (Phase 4):** Agent SDK `query()` inside container → metrics from `result` message → optional OTEL export

## Files to Create/Modify

```
src/metrics/
├── types.ts           # TokenMetrics, RunMetrics interfaces
├── pricing.ts         # Model pricing config (easily editable)
├── index.ts           # Public exports
└── __tests__/
    └── pricing.test.ts

src/docker/
├── sdk-runner.ts      # NEW: Run Claude via Agent SDK, capture metrics
├── executor.ts        # MODIFY: Use sdk-runner, handle telemetry flag
├── scripts/
│   └── run-sdk.ts     # NEW: Container entrypoint using SDK
```

## Types

```typescript
// src/metrics/types.ts
export interface TokenMetrics {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
}

export interface RunMetrics {
  tokens: TokenMetrics;
  cost_usd: number;
  duration_seconds: number;
  turns: number;
  model: string;
  model_usage: Record<string, {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost_usd: number;
  }>;
}

export interface MetricsResult {
  success: true;
  metrics: RunMetrics;
} | {
  success: false;
  metrics: null;
  warnings: string[];
}
```

## Pricing Config

```typescript
// src/metrics/pricing.ts - EASILY EDITABLE
export const MODEL_PRICING: Record<string, { 
  input: number; 
  output: number; 
  cache_read: number; 
  cache_write: number;
}> = {
  // Prices per 1M tokens (USD) - Updated 2026-07
  // Opus 4
  'claude-opus-4-20250514': { input: 15.00, output: 75.00, cache_read: 1.50, cache_write: 18.75 },
  'claude-opus-4-8': { input: 15.00, output: 75.00, cache_read: 1.50, cache_write: 18.75 },
  // Sonnet 4
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00, cache_read: 0.30, cache_write: 3.75 },
  // Haiku 3.5
  'claude-haiku-3-5-20241022': { input: 0.80, output: 4.00, cache_read: 0.08, cache_write: 1.00 },
  // Fable (Claude 5 family)
  'claude-fable-5': { input: 5.00, output: 25.00, cache_read: 0.50, cache_write: 6.25 },
  // Legacy models
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00, cache_read: 0.30, cache_write: 3.75 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00, cache_read: 1.50, cache_write: 18.75 },
};

// Fallback for unknown models
export const DEFAULT_PRICING = MODEL_PRICING['claude-sonnet-4-20250514'];

export function getModelPricing(model: string) {
  return MODEL_PRICING[model] || DEFAULT_PRICING;
}
```

## SDK Runner (New)

```typescript
// src/docker/sdk-runner.ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { RunMetrics, MetricsResult } from '../metrics/types.js';

export interface SdkRunOptions {
  prompt: string;
  workingDir: string;
  env: Record<string, string>;
  telemetry?: {
    endpoint: string;
    headers?: string;
  };
}

export async function runWithSdk(options: SdkRunOptions): Promise<{
  success: boolean;
  exitCode: number;
  metrics: MetricsResult;
  output: string;
}> {
  const telemetryEnv = options.telemetry ? {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OTEL_EXPORTER_OTLP_ENDPOINT: options.telemetry.endpoint,
    ...(options.telemetry.headers && { 
      OTEL_EXPORTER_OTLP_HEADERS: options.telemetry.headers 
    }),
  } : {};

  let output = '';
  let metrics: RunMetrics | null = null;
  const warnings: string[] = [];

  try {
    for await (const message of query({
      prompt: options.prompt,
      options: {
        cwd: options.workingDir,
        env: { ...options.env, ...telemetryEnv },
      },
    })) {
      if (message.type === 'assistant') {
        output += message.content || '';
      }
      
      if (message.type === 'result') {
        metrics = extractMetrics(message);
      }
    }
  } catch (error) {
    warnings.push(`SDK error: ${error}`);
  }

  return {
    success: metrics !== null,
    exitCode: metrics ? 0 : 1,
    metrics: metrics 
      ? { success: true, metrics } 
      : { success: false, metrics: null, warnings },
    output,
  };
}
```

## CLI Changes

```bash
hoodstrut run [options]

Options:
  -p, --profile <profile>       Profile name or path (required)
  -t, --task <task>             Task ID or path (required)
  -o, --output <directory>      Output directory for results
  -v, --verbose                 Show detailed output
  --timeout <seconds>           Override timeout in seconds
  --build                       Force rebuild of Docker image
  --telemetry <endpoint>        Export OTEL telemetry to endpoint (e.g., http://localhost:4318)
  --telemetry-headers <headers> OTEL headers (e.g., "Authorization=Bearer token")
```

## Implementation Steps

| Step | Description | Est. |
|------|-------------|------|
| 1 | Add `@anthropic-ai/claude-agent-sdk` to dependencies | 5m |
| 2 | Create `src/metrics/types.ts` | 15m |
| 3 | Create `src/metrics/pricing.ts` with all models | 20m |
| 4 | Create `src/docker/sdk-runner.ts` - SDK wrapper | 1h |
| 5 | Create `src/docker/scripts/run-sdk.ts` - container entrypoint | 45m |
| 6 | Update `Dockerfile.runner` to include SDK dependencies | 15m |
| 7 | Update `executor.ts` to use SDK runner | 45m |
| 8 | Add `--telemetry` and `--telemetry-headers` flags to CLI | 20m |
| 9 | Update `run.ts` to display metrics + handle telemetry | 30m |
| 10 | Add **loud warnings** for metrics failures | 15m |
| 11 | Tests for pricing, metrics extraction | 45m |
| 12 | Update Dockerfile, rebuild | 15m |

## Warning Strategy

**Metrics are the whole point** - failures must be loud:

```typescript
if (!result.metrics.success) {
  console.log(chalk.bgYellow.black('\n ⚠️  WARNING: METRICS EXTRACTION FAILED '));
  for (const warning of result.metrics.warnings) {
    console.log(chalk.yellow(`  • ${warning}`));
  }
  console.log(chalk.yellow('\nToken counts, cost, and scoring will not be available.\n'));
}
```

## Graceful Degradation

When metrics fail:
- Run still succeeds (if success_command passes)
- `summary.json` includes `metrics: null` and `metrics_warnings: [...]`
- CLI shows loud warning banner
- Scoring phase (Phase 6) handles null metrics

## Telemetry Flag Behavior

When `--telemetry <endpoint>` is passed:
1. SDK sets OTEL env vars pointing to user's collector
2. Traces, metrics, and log events export in real-time
3. User can view in Honeycomb, Datadog, Grafana, Jaeger, etc.
4. Does NOT affect metrics extraction (that's from SDK response)

Example:
```bash
# Run with telemetry to local Jaeger
hoodstrut run -p my-profile -t my-task \
  --telemetry http://localhost:4318

# Run with telemetry to Honeycomb
hoodstrut run -p my-profile -t my-task \
  --telemetry https://api.honeycomb.io:443 \
  --telemetry-headers "x-honeycomb-team=YOUR_API_KEY"
```

## Updated Dockerfile

```dockerfile
FROM node:20-slim

# Install Claude Code CLI AND Agent SDK
RUN npm install -g @anthropic-ai/claude-code @anthropic-ai/claude-agent-sdk

# Install common dev tools
RUN apt-get update && apt-get install -y git python3 make gcc g++

WORKDIR /workspace

# New TypeScript entrypoint that uses SDK
COPY scripts/run-sdk.ts /run-sdk.ts
RUN npx tsc /run-sdk.ts --outDir /scripts

ENTRYPOINT ["node", "/scripts/run-sdk.js"]
```
