import { describe, expect, it } from 'vitest';
import type { CoreStats } from '../../sim/pipesnap';
import { CoreRateTracker, ipcText } from './corestats';

const st = (cycles: number, retired: number, stalls = 0, l2Wait = 0): CoreStats => ({ cycles, retired, stalls, l2Wait, coherence: 0 });

describe('core rates', () => {
  it('has no rates before a second reading', () => {
    const t = new CoreRateTracker();
    expect(t.update([st(100, 80)])).toEqual([{ ipc: 0, stall: 0, l2Wait: 0 }]);
  });

  it('reads instructions per cycle and the share of stalled cycles between two readings, per hardware core', () => {
    const t = new CoreRateTracker();
    t.update([st(0, 0), st(0, 0)]);
    const r = t.update([st(100, 100, 20, 10), st(100, 50, 50, 0)]);
    expect(r[0]!.ipc).toBeCloseTo(0.5, 5); // half of the first reading's 1.0, the rest smoothed from zero
    expect(r[1]!.stall).toBeCloseTo(0.25, 5);
    const r2 = t.update([st(200, 200, 40, 20), st(200, 100, 100, 0)]);
    expect(r2[0]!.ipc).toBeCloseTo(0.75, 5);
    expect(r2[0]!.l2Wait).toBeGreaterThan(0);
  });

  it('keeps its rates while no cycles pass (paused) and starts over when the counters go back (a reset)', () => {
    const t = new CoreRateTracker();
    t.update([st(0, 0)]);
    const a = t.update([st(100, 100)]);
    expect(t.update([st(100, 100)])).toEqual(a);
    expect(t.update([st(10, 5)])).toEqual([{ ipc: 0, stall: 0, l2Wait: 0 }]);
  });

  it('never goes above a full window of stalls, and forgets everything without counters', () => {
    const t = new CoreRateTracker();
    t.update([st(0, 0)]);
    expect(t.update([st(10, 0, 500)])[0]!.stall).toBeLessThanOrEqual(1);
    expect(t.update(undefined)).toEqual([]);
  });

  it('writes the readout', () => {
    expect(ipcText({ ipc: 0.824, stall: 0, l2Wait: 0 })).toBe('0.82 IPC');
    expect(ipcText(undefined)).toBe('');
  });
});
