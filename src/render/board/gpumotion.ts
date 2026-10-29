import type { GpuStep } from '../../sim/ref/gpuref';
import type { GpuSnap } from '../../sim/game/types';
import { CYCLES_PER_SEC } from '../die/diemotion';

// The slow-motion replay of a graphics card's last instructions (the die's `Player` for the lanes). A snapshot carries the last 24 instructions
// of the launch; the card runs far faster than the eye, so the replay walks that window at the die's pace (CYCLES_PER_SEC), one instruction at a
// time, a `vld` that hits a bank conflict lasting as many cycles as it really costs. When the window is over the newest one replaces it (the one
// in between is dropped, as on the die); with nothing new the last instruction stays on show.

/** Seconds to hold the last instruction of a window before the next window replaces it. */
const HOLD_S = 0.5;

export interface GpuTick {
  /** The instruction on show, or null before any. */
  step: GpuStep | null;
  /** Its place in the window being replayed, and the window's length. */
  index: number;
  length: number;
  /** 0..1 through the instruction's cycles. */
  progress: number;
  /** Which of its cycles is on: a conflicted access takes one round per distinct address of its busiest bank. */
  round: number;
  /** False once the window is over and held. */
  playing: boolean;
}

const IDLE: GpuTick = { step: null, index: -1, length: 0, progress: 0, round: 0, playing: false };

const sigOf = (g: GpuSnap): string => {
  const a = g.trace[0], z = g.trace[g.trace.length - 1];
  return `${g.launches}|${g.trace.length}|${a?.pc ?? -1}|${z?.pc ?? -1}|${z?.mask ?? 0}|${g.stats.cycles}`;
};

export class GpuPlayer {
  private win: GpuStep[] = [];
  private pending: GpuStep[] | null = null;
  private sig = '';
  private launches = -1;
  private t = 0;
  private hold = 0;

  /** The newest snapshot of the card (undefined: no card, forget everything). */
  feed(g: GpuSnap | undefined): void {
    if (!g) { this.win = []; this.pending = null; this.sig = ''; this.launches = -1; return; }
    const sig = sigOf(g);
    if (sig === this.sig) return;
    this.sig = sig;
    if (g.trace.length === 0) { this.win = []; this.pending = null; this.launches = g.launches; return; }
    if (g.launches !== this.launches || this.win.length === 0) { this.launches = g.launches; this.win = g.trace; this.pending = null; this.t = 0; this.hold = 0; return; }
    this.pending = g.trace;
  }

  /** Cycles in the window being replayed. */
  private total(): number {
    let n = 0;
    for (const s of this.win) n += Math.max(1, s.cost);
    return n;
  }

  /** Move the replay on by `dt` seconds and say what is on show. */
  advance(dt: number): GpuTick {
    if (this.win.length === 0) return IDLE;
    const total = this.total();
    if (this.t < total) this.t = Math.min(total, this.t + dt * CYCLES_PER_SEC);
    else {
      this.hold += dt;
      if (this.pending && this.hold >= HOLD_S) { this.win = this.pending; this.pending = null; this.t = 0; this.hold = 0; return this.advance(0); }
    }
    let at = 0;
    for (let k = 0; k < this.win.length; k++) {
      const s = this.win[k]!, c = Math.max(1, s.cost);
      if (this.t < at + c || k === this.win.length - 1) {
        const progress = Math.min(1, (this.t - at) / c);
        return { step: s, index: k, length: this.win.length, progress, round: Math.min(c - 1, Math.floor(progress * c)), playing: this.t < total };
      }
      at += c;
    }
    return IDLE;
  }
}

/** Is lane `k` active in the instruction on show? (No instruction: every lane is, the card's idle look.) */
export const laneActive = (t: GpuTick, k: number): boolean => (t.step ? ((t.step.mask >>> k) & 1) === 1 : true);

/** A bank's state during the instruction on show: the addresses queued on it and how many its rounds have served so far. */
export function bankState(t: GpuTick, b: number): { queued: number; served: number } {
  const queued = t.step?.banks?.[b] ?? 0;
  return { queued, served: Math.min(queued, t.round + 1) };
}

/** Did this instruction lose cycles to a bank conflict? */
export const conflicted = (t: GpuTick): boolean => !!t.step && t.step.cost > 1;

/** The mnemonic on show, with the active lane count: `vld  6/8`. */
export function stepText(t: GpuTick, lanes: number): string {
  if (!t.step) return '';
  let n = 0;
  for (let k = 0; k < lanes; k++) if (laneActive(t, k)) n++;
  return `${t.step.name.padEnd(6)} ${n}/${lanes}`;
}
