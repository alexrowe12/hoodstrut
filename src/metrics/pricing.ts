export interface ModelPricing {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

// Prices per 1M tokens (USD)
// Last updated: 2026-07
// Edit this object to add new models or update pricing
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude 5 family
  'claude-fable-5': { input: 5.00, output: 25.00, cache_read: 0.50, cache_write: 6.25 },
  'claude-sonnet-5': { input: 3.00, output: 15.00, cache_read: 0.30, cache_write: 3.75 },

  // Opus 4.x
  'claude-opus-4-8': { input: 15.00, output: 75.00, cache_read: 1.50, cache_write: 18.75 },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00, cache_read: 1.50, cache_write: 18.75 },
  'opus': { input: 15.00, output: 75.00, cache_read: 1.50, cache_write: 18.75 },

  // Sonnet 4.x
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00, cache_read: 0.30, cache_write: 3.75 },
  'sonnet': { input: 3.00, output: 15.00, cache_read: 0.30, cache_write: 3.75 },

  // Haiku 4.5
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00, cache_read: 0.10, cache_write: 1.25 },
  'haiku': { input: 1.00, output: 5.00, cache_read: 0.10, cache_write: 1.25 },

  // Haiku 3.5
  'claude-haiku-3-5-20241022': { input: 0.80, output: 4.00, cache_read: 0.08, cache_write: 1.00 },

  // Legacy Sonnet 3.5
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00, cache_read: 0.30, cache_write: 3.75 },
  'claude-3-5-sonnet-20240620': { input: 3.00, output: 15.00, cache_read: 0.30, cache_write: 3.75 },

  // Legacy Opus 3
  'claude-3-opus-20240229': { input: 15.00, output: 75.00, cache_read: 1.50, cache_write: 18.75 },
};

// Fallback for unknown models (sonnet pricing as reasonable middle ground)
export const DEFAULT_PRICING: ModelPricing = {
  input: 3.00,
  output: 15.00,
  cache_read: 0.30,
  cache_write: 3.75,
};

export function getModelPricing(model: string): ModelPricing {
  return MODEL_PRICING[model] || DEFAULT_PRICING;
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheWriteTokens: number = 0
): number {
  const pricing = getModelPricing(model);

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.cache_read;
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * pricing.cache_write;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}
