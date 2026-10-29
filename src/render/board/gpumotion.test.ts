import { describe, expect, it } from 'vitest';
import type { GpuStep } from '../../sim/ref/gpuref';
import type { GpuSnap } from '../../sim/game/types';
import { CYCLES_PER_SEC } from '../die/diemotion';
import { bankState, conflicted, GpuPlayer, laneActive, stepText } from './gpumotion';

const step = (pc: number, o: Partial<GpuStep> = {}): GpuStep => ({ pc, name: 'vadd', kind: 'alu', mask: 0xff, cost: 1, banks: null, dest: 1, ...o });
const snap = (trace: GpuStep[], o: Partial<GpuSnap> = {}): GpuSnap => ({
  slot: 'pcie0', lanes: 8, banks: 4, memBytes: 8192, phase: 'run', mask: 0xff, stack: [], pc: 0, regs: [], trace, launches: 1, error: false,
  stats: { instructions: trace.length, idleLaneSlots: 0, conflictCycles: 0, cycles: trace.length }, ...o,
});
/** Seconds one cycle of the replay lasts. */
const CYC = 1 / CYCLES_PER_SEC;

describe('GPU replay', () => {
  it('shows nothing without a trace and forgets a removed card', () => {
    const p = new GpuPlayer();
    expect(p.advance(1).step).toBeNull();
    p.feed(snap([step(0)]));
    expect(p.advance(0).step?.pc).toBe(0);
    p.feed(undefined);
    expect(p.advance(1).step).toBeNull();
    p.feed(snap([]));
    expect(p.advance(1)).toMatchObject({ step: null, playing: false });
  });

  it('walks the window one instruction per cycle, and a conflicted access lasts its cost', () => {
    const p = new GpuPlayer();
    p.feed(snap([step(0), step(4, { name: 'vld', kind: 'ld', cost: 3, banks: [3, 0, 0, 0] }), step(8, { name: 'halt', kind: 'sys' })]));
    expect(p.advance(0)).toMatchObject({ index: 0, length: 3, playing: true });
    expect(p.advance(CYC * 1.5)).toMatchObject({ index: 1, round: 0 }); // 1.5 cycles in: half-way through the first round of the load
    expect(p.advance(CYC * 1)).toMatchObject({ index: 1, round: 1 });
    expect(p.advance(CYC * 1)).toMatchObject({ index: 1, round: 2 });
    expect(p.advance(CYC * 1)).toMatchObject({ index: 2 });
    const last = p.advance(CYC * 10);
    expect(last).toMatchObject({ index: 2, playing: false, progress: 1 }); // held on the last instruction
  });

  it('plays the newest window after the current one, dropping the ones between', () => {
    const p = new GpuPlayer();
    p.feed(snap([step(0), step(4)], { stats: { instructions: 2, idleLaneSlots: 0, conflictCycles: 0, cycles: 2 } }));
    p.advance(CYC * 0.5);
    p.feed(snap([step(100), step(104)], { stats: { instructions: 4, idleLaneSlots: 0, conflictCycles: 0, cycles: 4 } }));
    p.feed(snap([step(200), step(204)], { stats: { instructions: 6, idleLaneSlots: 0, conflictCycles: 0, cycles: 6 } }));
    expect(p.advance(0).step?.pc).toBe(0); // the first window is not cut short
    expect(p.advance(CYC * 5).playing).toBe(false);
    expect(p.advance(0.6).step?.pc).toBe(200); // held, then the newest
  });

  it('a new launch replaces the window at once', () => {
    const p = new GpuPlayer();
    p.feed(snap([step(0), step(4), step(8)]));
    p.advance(CYC * 2);
    p.feed(snap([step(40)], { launches: 2 }));
    expect(p.advance(0)).toMatchObject({ index: 0 });
    expect(p.advance(0).step?.pc).toBe(40);
  });

  it('reads the mask, banks and text of the instruction on show', () => {
    const p = new GpuPlayer();
    p.feed(snap([step(0, { name: 'vld', kind: 'ld', mask: 0b00001111, cost: 2, banks: [2, 1, 1, 0] })]));
    const t = p.advance(0);
    expect([0, 3, 4, 7].map((k) => laneActive(t, k))).toEqual([true, true, false, false]);
    expect(bankState(t, 0)).toEqual({ queued: 2, served: 1 });
    expect(bankState(t, 3)).toEqual({ queued: 0, served: 0 });
    expect(conflicted(t)).toBe(true);
    expect(stepText(t, 8)).toBe('vld    4/8');
    expect(laneActive(new GpuPlayer().advance(0), 5)).toBe(true); // idle card: every lane drawn as it is
    expect(laneActive({ ...t, step: step(0, { mask: 0x80000000 }) }, 31)).toBe(true); // lane 31 reads the top mask bit
  });
});
