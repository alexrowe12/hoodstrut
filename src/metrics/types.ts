export interface TokenMetrics {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
}

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
}

export interface RunMetrics {
  tokens: TokenMetrics;
  cost_usd: number;
  duration_seconds: number;
  turns: number;
  model: string;
  model_usage: Record<string, ModelUsage>;
}

export type MetricsResult =
  | { success: true; metrics: RunMetrics }
  | { success: false; metrics: null; warnings: string[] };

export interface TelemetryConfig {
  endpoint: string;
  headers?: string;
}
