import { describe, expect, it } from 'vitest';
import { summarizeDistribution, wilsonInterval } from '../statistics.js';

describe('statistics', () => {
  it('calculates sample variance and a mean confidence interval', () => {
    const summary = summarizeDistribution([1, 2, 3]);
    expect(summary.mean).toBe(2);
    expect(summary.median).toBe(2);
    expect(summary.variance).toBe(1);
    expect(summary.standard_deviation).toBe(1);
    expect(summary.confidence_interval_95?.lower).toBeLessThan(2);
    expect(summary.confidence_interval_95?.upper).toBeGreaterThan(2);
  });

  it('does not manufacture variance or confidence from one sample', () => {
    const summary = summarizeDistribution([4]);
    expect(summary.variance).toBeNull();
    expect(summary.standard_deviation).toBeNull();
    expect(summary.confidence_interval_95).toBeNull();
  });

  it('calculates bounded Wilson intervals', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    const interval = wilsonInterval(5, 10)!;
    expect(interval.lower).toBeCloseTo(0.2366, 3);
    expect(interval.upper).toBeCloseTo(0.7634, 3);
  });
});
