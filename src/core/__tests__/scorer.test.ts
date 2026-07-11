import { describe, it, expect } from 'vitest';
import { calculateScore, calculateExpectedCost } from '../scorer.js';

describe('calculateExpectedCost', () => {
  it('calculates expected cost for sonnet model', () => {
    const cost = calculateExpectedCost('claude-sonnet-4-20250514', 25000);
    // 10000 input * $3/1M + 15000 output * $15/1M = $0.03 + $0.225 = $0.255
    expect(cost).toBeCloseTo(0.255, 4);
  });

  it('calculates expected cost for opus model', () => {
    const cost = calculateExpectedCost('claude-opus-4-20250514', 25000);
    // 10000 input * $15/1M + 15000 output * $75/1M = $0.15 + $1.125 = $1.275
    expect(cost).toBeCloseTo(1.275, 4);
  });

  it('calculates expected cost for haiku model', () => {
    const cost = calculateExpectedCost('claude-haiku-4-5-20251001', 25000);
    // 10000 input * $1/1M + 15000 output * $5/1M = $0.01 + $0.075 = $0.085
    expect(cost).toBeCloseTo(0.085, 4);
  });

  it('uses default pricing for unknown model', () => {
    const cost = calculateExpectedCost('unknown-model', 25000);
    // Falls back to sonnet pricing
    expect(cost).toBeCloseTo(0.255, 4);
  });
});

describe('calculateScore', () => {
  it('returns null when actualCost is null', () => {
    const score = calculateScore({
      success: true,
      actualCost: null,
      duration: 60,
      profileModel: 'claude-sonnet-4-20250514',
    });
    expect(score).toBeNull();
  });

  it('returns 0 for failed task', () => {
    const score = calculateScore({
      success: false,
      actualCost: 0.10,
      duration: 60,
      profileModel: 'claude-sonnet-4-20250514',
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.success_bonus).toBe(0);
    expect(score!.value).toBeGreaterThanOrEqual(0);
  });

  it('gives 500 success bonus for successful task', () => {
    const score = calculateScore({
      success: true,
      actualCost: 0.255,
      duration: 150,
      profileModel: 'claude-sonnet-4-20250514',
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.success_bonus).toBe(500);
  });

  it('gives 200 cost_score at expected cost', () => {
    const score = calculateScore({
      success: true,
      actualCost: 0.255,
      duration: 150,
      profileModel: 'claude-sonnet-4-20250514',
      estimatedTokens: 25000,
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.cost_score).toBeCloseTo(200, 0);
  });

  it('gives ~250 cost_score at half expected cost', () => {
    const score = calculateScore({
      success: true,
      actualCost: 0.1275,
      duration: 150,
      profileModel: 'claude-sonnet-4-20250514',
      estimatedTokens: 25000,
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.cost_score).toBeCloseTo(250, 0);
  });

  it('gives 0 cost_score at 3x expected cost', () => {
    const score = calculateScore({
      success: true,
      actualCost: 0.765,
      duration: 150,
      profileModel: 'claude-sonnet-4-20250514',
      estimatedTokens: 25000,
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.cost_score).toBe(0);
  });

  it('gives 100 time_score at expected time (150s)', () => {
    const score = calculateScore({
      success: true,
      actualCost: 0.255,
      duration: 150,
      profileModel: 'claude-sonnet-4-20250514',
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.time_score).toBeCloseTo(100, 0);
  });

  it('gives ~150 time_score at half expected time', () => {
    const score = calculateScore({
      success: true,
      actualCost: 0.255,
      duration: 75,
      profileModel: 'claude-sonnet-4-20250514',
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.time_score).toBeCloseTo(150, 0);
  });

  it('gives 0 time_score at 2x expected time', () => {
    const score = calculateScore({
      success: true,
      actualCost: 0.255,
      duration: 300,
      profileModel: 'claude-sonnet-4-20250514',
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.time_score).toBe(0);
  });

  it('applies 0.8x multiplier for easy difficulty', () => {
    const score = calculateScore({
      success: true,
      actualCost: 0.255,
      duration: 150,
      difficulty: 'easy',
      profileModel: 'claude-sonnet-4-20250514',
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.difficulty_multiplier).toBe(0.8);
    // (500 + 200 + 100) * 0.8 = 640
    expect(score!.value).toBe(640);
  });

  it('applies 1.0x multiplier for medium difficulty', () => {
    const score = calculateScore({
      success: true,
      actualCost: 0.255,
      duration: 150,
      difficulty: 'medium',
      profileModel: 'claude-sonnet-4-20250514',
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.difficulty_multiplier).toBe(1.0);
    expect(score!.value).toBe(800);
  });

  it('applies 1.3x multiplier for hard difficulty', () => {
    const score = calculateScore({
      success: true,
      actualCost: 0.255,
      duration: 150,
      difficulty: 'hard',
      profileModel: 'claude-sonnet-4-20250514',
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.difficulty_multiplier).toBe(1.3);
    // (500 + 200 + 100) * 1.3 = 1040
    expect(score!.value).toBe(1040);
  });

  it('applies 1.6x multiplier for expert difficulty', () => {
    const score = calculateScore({
      success: true,
      actualCost: 0.255,
      duration: 150,
      difficulty: 'expert',
      profileModel: 'claude-sonnet-4-20250514',
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.difficulty_multiplier).toBe(1.6);
    // (500 + 200 + 100) * 1.6 = 1280
    expect(score!.value).toBe(1280);
  });

  it('defaults to medium difficulty when not specified', () => {
    const score = calculateScore({
      success: true,
      actualCost: 0.255,
      duration: 150,
      profileModel: 'claude-sonnet-4-20250514',
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.difficulty_multiplier).toBe(1.0);
  });

  it('uses default estimated_tokens (25000) when not specified', () => {
    const score = calculateScore({
      success: true,
      actualCost: 0.255,
      duration: 150,
      profileModel: 'claude-sonnet-4-20250514',
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.expected_cost).toBeCloseTo(0.255, 3);
  });

  it('uses default expected_time (150s) when not specified', () => {
    const score = calculateScore({
      success: true,
      actualCost: 0.255,
      duration: 150,
      profileModel: 'claude-sonnet-4-20250514',
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.expected_time).toBe(150);
  });

  it('includes actual values in breakdown', () => {
    const score = calculateScore({
      success: true,
      actualCost: 0.12,
      duration: 45,
      profileModel: 'claude-sonnet-4-20250514',
    });
    expect(score).not.toBeNull();
    expect(score!.breakdown.actual_cost).toBe(0.12);
    expect(score!.breakdown.actual_time).toBe(45);
  });
});
