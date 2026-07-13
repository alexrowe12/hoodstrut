import type { ConfidenceInterval, DistributionSummary } from './types.js';

const T_CRITICAL_95 = [
  0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
  2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093,
  2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045,
  2.042,
];

function tCritical95(degreesOfFreedom: number): number {
  if (degreesOfFreedom <= 30) return T_CRITICAL_95[degreesOfFreedom] ?? 1.96;
  if (degreesOfFreedom <= 40) return 2.021;
  if (degreesOfFreedom <= 60) return 2.000;
  if (degreesOfFreedom <= 120) return 1.980;
  return 1.960;
}

export function wilsonInterval(successes: number, attempts: number): ConfidenceInterval | null {
  if (attempts === 0) return null;
  const z = 1.959963984540054;
  const p = successes / attempts;
  const z2 = z * z;
  const denominator = 1 + z2 / attempts;
  const center = (p + z2 / (2 * attempts)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * attempts)) / attempts) / denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

export function summarizeDistribution(values: number[]): DistributionSummary {
  if (values.length === 0) {
    return {
      count: 0,
      mean: null,
      median: null,
      variance: null,
      standard_deviation: null,
      minimum: null,
      maximum: null,
      confidence_interval_95: null,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];

  if (values.length === 1) {
    return {
      count: 1,
      mean,
      median,
      variance: null,
      standard_deviation: null,
      minimum: sorted[0],
      maximum: sorted[0],
      confidence_interval_95: null,
    };
  }

  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0)
    / (values.length - 1);
  const standardDeviation = Math.sqrt(variance);
  const margin = tCritical95(values.length - 1) * standardDeviation / Math.sqrt(values.length);

  return {
    count: values.length,
    mean,
    median,
    variance,
    standard_deviation: standardDeviation,
    minimum: sorted[0],
    maximum: sorted[sorted.length - 1],
    confidence_interval_95: { lower: Math.max(0, mean - margin), upper: mean + margin },
  };
}
