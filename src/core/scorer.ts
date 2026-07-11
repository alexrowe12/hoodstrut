import type { Score, ScoreBreakdown } from './types.js';
import { calculateCost } from '../metrics/pricing.js';

const DIFFICULTY_MULTIPLIERS: Record<string, number> = {
  easy: 0.8,
  medium: 1.0,
  hard: 1.3,
  expert: 1.6,
};

const DEFAULT_ESTIMATED_TOKENS = 25000;
const DEFAULT_EXPECTED_TIME = 150;

export interface ScoreInput {
  success: boolean;
  actualCost: number | null;
  duration: number;
  difficulty?: 'easy' | 'medium' | 'hard' | 'expert';
  estimatedTokens?: number;
  expectedTime?: number;
  profileModel: string;
}

export function calculateExpectedCost(
  model: string,
  estimatedTokens: number
): number {
  const inputTokens = Math.round(estimatedTokens * 0.4);
  const outputTokens = Math.round(estimatedTokens * 0.6);
  return calculateCost(model, inputTokens, outputTokens, 0, 0);
}

export function calculateScore(input: ScoreInput): Score | null {
  if (input.actualCost === null) {
    return null;
  }

  const estimatedTokens = input.estimatedTokens ?? DEFAULT_ESTIMATED_TOKENS;
  const expectedTime = input.expectedTime ?? DEFAULT_EXPECTED_TIME;
  const expectedCost = calculateExpectedCost(input.profileModel, estimatedTokens);
  const difficultyMultiplier = DIFFICULTY_MULTIPLIERS[input.difficulty ?? 'medium'] ?? 1.0;

  const successBonus = input.success ? 500 : 0;

  const costRatio = expectedCost > 0 ? input.actualCost / expectedCost : 1;
  const costScore = Math.max(0, 300 - 100 * costRatio);

  const timeRatio = expectedTime > 0 ? input.duration / expectedTime : 1;
  const timeScore = Math.max(0, 200 - 100 * timeRatio);

  const rawScore = successBonus + costScore + timeScore;
  const finalScore = Math.round(rawScore * difficultyMultiplier);

  const breakdown: ScoreBreakdown = {
    success_bonus: successBonus,
    cost_score: Math.round(costScore * 100) / 100,
    time_score: Math.round(timeScore * 100) / 100,
    difficulty_multiplier: difficultyMultiplier,
    actual_cost: input.actualCost,
    expected_cost: Math.round(expectedCost * 100000) / 100000,
    actual_time: input.duration,
    expected_time: expectedTime,
  };

  return {
    value: finalScore,
    breakdown,
  };
}
