import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../pool.js';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms));
}

describe('mapWithConcurrency', () => {
  it('returns empty array for empty input', async () => {
    const results = await mapWithConcurrency([], 4, async (x: number) => x);
    expect(results).toEqual([]);
  });

  it('preserves input order in results', async () => {
    const items = [50, 10, 30, 5, 20];
    const results = await mapWithConcurrency(items, 3, async (ms) => {
      await delay(ms);
      return ms * 2;
    });

    expect(results).toEqual(items.map(ms => ({ ok: true, value: ms * 2 })));
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(10);
      inFlight--;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('runs sequentially with limit 1', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await mapWithConcurrency([1, 2, 3], 1, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight--;
    });

    expect(maxInFlight).toBe(1);
  });

  it('captures a rejection without stopping other items', async () => {
    const completed: number[] = [];

    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      if (n === 2) {
        throw new Error('boom');
      }
      await delay(5);
      completed.push(n);
      return n;
    });

    expect(completed.sort()).toEqual([1, 3, 4]);
    expect(results[0]).toEqual({ ok: true, value: 1 });
    expect(results[1].ok).toBe(false);
    if (!results[1].ok) {
      expect(results[1].error.message).toBe('boom');
    }
    expect(results[2]).toEqual({ ok: true, value: 3 });
    expect(results[3]).toEqual({ ok: true, value: 4 });
  });

  it('wraps non-Error rejections in Error', async () => {
    const results = await mapWithConcurrency([1], 1, async () => {
      throw 'string failure';
    });

    expect(results[0].ok).toBe(false);
    if (!results[0].ok) {
      expect(results[0].error).toBeInstanceOf(Error);
      expect(results[0].error.message).toBe('string failure');
    }
  });

  it('clamps limit above item count', async () => {
    const results = await mapWithConcurrency([1, 2], 100, async (n) => n);
    expect(results).toEqual([
      { ok: true, value: 1 },
      { ok: true, value: 2 },
    ]);
  });

  it('clamps limit below 1', async () => {
    const results = await mapWithConcurrency([1, 2], 0, async (n) => n);
    expect(results).toEqual([
      { ok: true, value: 1 },
      { ok: true, value: 2 },
    ]);
  });

  it('passes the index to the callback', async () => {
    const results = await mapWithConcurrency(['a', 'b', 'c'], 2, async (item, i) => `${item}${i}`);
    expect(results).toEqual([
      { ok: true, value: 'a0' },
      { ok: true, value: 'b1' },
      { ok: true, value: 'c2' },
    ]);
  });
});
