import { describe, it, expect } from 'vitest';
import { getModelPricing, calculateCost, MODEL_PRICING, DEFAULT_PRICING } from '../pricing.js';

describe('pricing', () => {
  describe('getModelPricing', () => {
    it('returns pricing for known models', () => {
      const pricing = getModelPricing('claude-sonnet-4-20250514');
      expect(pricing.input).toBe(3.00);
      expect(pricing.output).toBe(15.00);
    });

    it('returns pricing for short model names', () => {
      const pricing = getModelPricing('opus');
      expect(pricing.input).toBe(15.00);
      expect(pricing.output).toBe(75.00);
    });

    it('returns default pricing for unknown models', () => {
      const pricing = getModelPricing('unknown-model-xyz');
      expect(pricing).toEqual(DEFAULT_PRICING);
    });
  });

  describe('calculateCost', () => {
    it('calculates cost for input and output tokens', () => {
      // 1M input tokens at $3/M + 500K output tokens at $15/M = $3 + $7.50 = $10.50
      const cost = calculateCost('claude-sonnet-4-20250514', 1_000_000, 500_000);
      expect(cost).toBeCloseTo(10.50, 2);
    });

    it('includes cache read tokens', () => {
      // 100K input at $3/M + 50K output at $15/M + 200K cache_read at $0.30/M
      // = $0.30 + $0.75 + $0.06 = $1.11
      const cost = calculateCost('claude-sonnet-4-20250514', 100_000, 50_000, 200_000, 0);
      expect(cost).toBeCloseTo(1.11, 2);
    });

    it('includes cache write tokens', () => {
      // 100K input at $3/M + 50K output at $15/M + 100K cache_write at $3.75/M
      // = $0.30 + $0.75 + $0.375 = $1.425
      const cost = calculateCost('claude-sonnet-4-20250514', 100_000, 50_000, 0, 100_000);
      expect(cost).toBeCloseTo(1.425, 2);
    });

    it('uses default pricing for unknown models', () => {
      const knownCost = calculateCost('claude-sonnet-4-20250514', 1_000_000, 0);
      const unknownCost = calculateCost('unknown-model', 1_000_000, 0);
      // Both should use same default pricing
      expect(unknownCost).toEqual(knownCost);
    });

    it('returns 0 for 0 tokens', () => {
      const cost = calculateCost('claude-sonnet-4-20250514', 0, 0, 0, 0);
      expect(cost).toBe(0);
    });
  });

  describe('MODEL_PRICING', () => {
    it('includes all expected models', () => {
      expect(MODEL_PRICING['claude-opus-4-20250514']).toBeDefined();
      expect(MODEL_PRICING['claude-sonnet-4-20250514']).toBeDefined();
      expect(MODEL_PRICING['claude-haiku-3-5-20241022']).toBeDefined();
      expect(MODEL_PRICING['opus']).toBeDefined();
      expect(MODEL_PRICING['sonnet']).toBeDefined();
      expect(MODEL_PRICING['haiku']).toBeDefined();
    });

    it('has correct structure for all models', () => {
      for (const pricing of Object.values(MODEL_PRICING)) {
        expect(pricing).toHaveProperty('input');
        expect(pricing).toHaveProperty('output');
        expect(pricing).toHaveProperty('cache_read');
        expect(pricing).toHaveProperty('cache_write');
        expect(typeof pricing.input).toBe('number');
        expect(typeof pricing.output).toBe('number');
        expect(typeof pricing.cache_read).toBe('number');
        expect(typeof pricing.cache_write).toBe('number');
      }
    });

    it('cache_read is cheaper than input', () => {
      for (const pricing of Object.values(MODEL_PRICING)) {
        expect(pricing.cache_read).toBeLessThan(pricing.input);
      }
    });
  });
});
