import { describe, expect, it } from 'vitest';
import type { CoreStats, CoresSnap } from '../../sim/pipesnap';
import { CoreRateTracker, ipcText } from './corestats';
import type * as statsTypes from './corestats';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A reading of `cycles` and `retired`, with `stalls` and `l2Wait` stalled cycles (none unless given). */
const st = (cycles: number, retired: number, { stalls = 0, l2Wait = 0 } = {}): CoreStats => ({
  cycles,
  retired,
  stalls,
  l2Wait,
  coherence: 0,
});

/** A multicore snapshot that carries no counters. */
const NO_STATS: Pick<CoresSnap, 'stats'> = {};

/** The rates of a die with no cores read yet. */
const NO_RATES: statsTypes.CoreRate[] = [];

describe('core rates', () => {
  it('has no rates before a second reading', () => {
    const t = new CoreRateTracker();
    expect(t.update([st(100, 80)])).toStrictEqual([{ ipc: 0, stall: 0, l2Wait: 0 }]);
  });

  it('reads instructions per cycle and the share of stalled cycles between two readings, per hardware core', () => {
    const t = new CoreRateTracker();
    t.update([st(0, 0), st(0, 0)]);
    const r = t.update([st(100, 100, { stalls: 20, l2Wait: 10 }), st(100, 50, { stalls: 50, l2Wait: 0 })]);
    expect(must(r[0]).ipc).toBeCloseTo(0.5, 5); // half of the first reading's 1.0, the rest smoothed from zero
    expect(must(r[1]).stall).toBeCloseTo(0.25, 5);
    const r2 = t.update([st(200, 200, { stalls: 40, l2Wait: 20 }), st(200, 100, { stalls: 100, l2Wait: 0 })]);
    expect(must(r2[0]).ipc).toBeCloseTo(0.75, 5);
    expect(must(r2[0]).l2Wait).toBeGreaterThan(0);
  });

  it('keeps its rates while no cycles pass (paused) and starts over when the counters go back (a reset)', () => {
    const t = new CoreRateTracker();
    t.update([st(0, 0)]);
    const a = t.update([st(100, 100)]);
    expect(t.update([st(100, 100)])).toStrictEqual(a);
    expect(t.update([st(10, 5)])).toStrictEqual([{ ipc: 0, stall: 0, l2Wait: 0 }]);
  });

  it('never goes above a full window of stalls, and forgets everything without counters', () => {
    const t = new CoreRateTracker();
    t.update([st(0, 0)]);
    const [flooded] = t.update([st(10, 0, { stalls: 500 })]);
    expect(must(flooded).stall).toBeLessThanOrEqual(1);
    expect(t.update(NO_STATS.stats)).toStrictEqual([]);
  });

  it('writes the readout', () => {
    expect(ipcText({ ipc: 0.824, stall: 0, l2Wait: 0 })).toBe('0.82 IPC');
    expect(ipcText(NO_RATES[0])).toBe('');
  });
});
