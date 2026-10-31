// Per-core rates for the die and the Trace panel (docs/DIE.md "Core tiles"): the snapshot carries each hardware core's counters since the machine started,
// this turns two readings of them into instructions per cycle and the share of cycles lost to stalls. Pure: counters in, rates out.

import type { CoreStats } from '../sim/pipesnap';

export interface CoreRate {
  /** Instructions retired per cycle over the last window (smoothed). */
  ipc: number;
  /** The share of the window's cycles lost to stalls, 0..1. */
  stall: number;
  /** The share of them spent waiting for the shared L2 port, 0..1. */
  l2Wait: number;
}

const NONE: CoreRate = { ipc: 0, stall: 0, l2Wait: 0 };
const KEEP = 0.5; // how much of the previous rate stays in the next (a window is one snapshot, which is short and noisy)

/** Remembers the last reading of every hardware core and gives the rates between it and the next. */
export class CoreRateTracker {
  private prev: CoreStats[] = [];
  private rates: CoreRate[] = [];

  /** The rates after reading `cur` (one entry per hardware core). A paused machine (no cycles passed) keeps its rates; counters that went backwards (a reset) start over. */
  update(cur: CoreStats[] | undefined): CoreRate[] {
    if (!cur) { this.prev = []; this.rates = []; return this.rates; }
    this.rates = cur.map((c, k) => {
      const p = this.prev[k], was = this.rates[k] ?? NONE;
      if (!p || c.cycles < p.cycles) return NONE;
      const dc = c.cycles - p.cycles;
      if (dc <= 0) return was;
      const mix = (old: number, now: number) => old * KEEP + now * (1 - KEEP);
      return {
        ipc: mix(was.ipc, Math.max(0, c.retired - p.retired) / dc),
        stall: mix(was.stall, Math.min(1, Math.max(0, c.stalls - p.stalls) / dc)),
        l2Wait: mix(was.l2Wait, Math.min(1, Math.max(0, c.l2Wait - p.l2Wait) / dc)),
      };
    });
    this.prev = cur.map((c) => ({ ...c }));
    return this.rates;
  }
}

/** "0.82 IPC": the readout under a core. */
export const ipcText = (r: CoreRate | undefined): string => (r ? r.ipc.toFixed(2) + ' IPC' : '');
