import type { GpuStep } from '../../sim/ref/gpuref';
import type { GpuSnap } from '../../sim/game/types';
import { CYCLES_PER_SEC } from '../die/diemotion';

// The slow-motion replay of a graphics card's last instructions (the die's `Player` for the card; docs/render/live.md). A snapshot carries the
// last instructions of the launch; the card runs far faster than the eye, so the replay walks that window at the die's pace (CYCLES_PER_SEC),
// on the card's own clock: an instruction starts in the cycle it issued in (`startCycle`) and lasts as many cycles as it really costs, so on a
// warp card the next warp's instruction starts while a load is still waiting, and each SM shows its own. A window without start cycles (the
// unpipelined unit) is a plain sequence. When the window is over the newest one replaces it (the ones between are dropped, as on the die); with
// nothing new the last instruction stays on show. The windows played are kept (`HISTORY`), and `seek` goes back to a cycle of one of them.

/** Seconds to hold the last instruction of a window before the next window replaces it. */
const HOLD_S = 0.5;
/** Windows kept to seek back into. */
export const HISTORY = 120;

/** What one SM shows: the newest instruction it issued by now, and how far through its cycles it is. */
export interface SmTick { sm: number; step: GpuStep | null; index: number; progress: number; round: number }
/** A warp's state at the cycle on show: the mask of its newest instruction (after it, when the engine says), and the SM it is on. */
export interface WarpTick { sm: number; warp: number; mask: number; index: number; /** The instruction is still waiting (a load, a bank conflict) at this cycle. */ busy: boolean }

export interface GpuTick {
  /** The instruction on show (the newest to have issued on the card), or null before any. */
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
  /** The cycle on show, counted from the first instruction of the window. */
  cycle: number;
  /** Every SM's newest instruction (one entry per SM seen in the window), and every warp's state. */
  sms: SmTick[];
  warps: WarpTick[];
}

const IDLE: GpuTick = { step: null, index: -1, length: 0, progress: 0, round: 0, playing: false, cycle: 0, sms: [], warps: [] };

const sigOf = (g: GpuSnap): string => {
  const a = g.trace[0], z = g.trace[g.trace.length - 1];
  return `${g.launches}|${g.trace.length}|${a?.pc ?? -1}|${z?.pc ?? -1}|${z?.mask ?? 0}|${g.stats.cycles}`;
};

interface Timed { step: GpuStep; t0: number; dur: number }

/** A window on the card's clock: starts from `startCycle` when every instruction has one, else one after the other. */
function timeline(steps: GpuStep[]): { items: Timed[]; total: number } {
  const timed = steps.length > 0 && steps.every((s) => s.startCycle !== undefined);
  const base = timed ? steps[0]!.startCycle! : 0;
  let at = 0, total = 0;
  const items = steps.map((step): Timed => {
    const dur = Math.max(1, step.cost), t0 = timed ? Math.max(0, step.startCycle! - base) : at;
    at += dur;
    total = Math.max(total, t0 + dur);
    return { step, t0, dur };
  });
  return { items, total };
}

export class GpuPlayer {
  private win: Timed[] = [];
  private total = 0;
  private pending: GpuStep[] | null = null;
  private sig = '';
  private launches = -1;
  private t = 0;
  private hold = 0;
  private past: GpuStep[][] = [];
  private frozen = false;

  /** The newest snapshot of the card (undefined: no card, forget everything). */
  feed(g: GpuSnap | undefined): void {
    if (!g) { this.show([]); this.pending = null; this.sig = ''; this.launches = -1; this.past = []; this.frozen = false; return; }
    const sig = sigOf(g);
    if (sig === this.sig) return;
    this.sig = sig;
    if (g.trace.length === 0) { this.show([]); this.pending = null; this.launches = g.launches; return; }
    if (g.launches !== this.launches || this.win.length === 0) { this.launches = g.launches; this.pending = null; if (!this.frozen) this.show(g.trace); else this.keep(g.trace); return; }
    this.pending = g.trace;
  }

  private keep(steps: GpuStep[]): void {
    this.past.push(steps);
    if (this.past.length > HISTORY) this.past.shift();
  }

  private show(steps: GpuStep[]): void {
    const tl = timeline(steps);
    this.win = tl.items;
    this.total = tl.total;
    this.t = 0;
    this.hold = 0;
    if (steps.length) this.keep(steps);
  }

  /** Windows that can be sought back into (the one on show last). */
  get windows(): number { return this.past.length; }
  /** True while the replay is held on a sought cycle. */
  get scrubbed(): boolean { return this.frozen; }

  /** Hold the replay at `cycle` of the window `back` windows before the newest (0 = the newest), and return the machine there. */
  seek(back: number, cycle = 0): GpuTick {
    const steps = this.past[this.past.length - 1 - Math.max(0, Math.min(back, this.past.length - 1))];
    if (!steps) return IDLE;
    const tl = timeline(steps);
    this.win = tl.items;
    this.total = tl.total;
    this.pending = null;
    this.frozen = true;
    this.hold = 0;
    this.t = Math.max(0, Math.min(tl.total, cycle));
    return this.tick();
  }

  /** Let the replay run again (the newest window replaces the sought one). */
  resume(): void {
    if (!this.frozen) return;
    this.frozen = false;
    const last = this.past[this.past.length - 1];
    if (last) { const tl = timeline(last); this.win = tl.items; this.total = tl.total; this.t = tl.total; this.hold = HOLD_S; }
  }

  /** Move the replay on by `dt` seconds and say what is on show. */
  advance(dt: number): GpuTick {
    if (this.win.length === 0) return IDLE;
    if (!this.frozen) {
      if (this.t < this.total) this.t = Math.min(this.total, this.t + dt * CYCLES_PER_SEC);
      else {
        this.hold += dt;
        if (this.pending && this.hold >= HOLD_S) { const next = this.pending; this.pending = null; this.show(next); return this.advance(0); }
      }
    }
    return this.tick();
  }

  private tick(): GpuTick {
    const win = this.win, t = this.t;
    // the newest instruction to have started by now, over the whole card and per SM and warp
    let at = 0;
    const smAt = new Map<number, number>(), warpAt = new Map<string, number>();
    for (let k = 0; k < win.length; k++) {
      const it = win[k]!;
      if (it.t0 > t && k > 0) continue;
      at = k;
      smAt.set(it.step.sm ?? 0, k);
      warpAt.set(`${it.step.sm ?? 0}.${it.step.warp ?? 0}`, k);
    }
    const view = (k: number) => {
      const it = win[k]!, progress = Math.min(1, Math.max(0, (t - it.t0) / it.dur));
      return { it, progress, round: Math.min(it.dur - 1, Math.floor(progress * it.dur)) };
    };
    const main = view(at);
    const sms: SmTick[] = [...smAt].sort((a, b) => a[0] - b[0]).map(([sm, k]) => { const v = view(k); return { sm, step: v.it.step, index: k, progress: v.progress, round: v.round }; });
    const warps: WarpTick[] = [...warpAt].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([key, k]) => {
      const it = win[k]!, [sm, warp] = key.split('.').map(Number) as [number, number];
      return { sm, warp, mask: it.step.maskAfter ?? it.step.mask, index: k, busy: t < it.t0 + it.dur };
    });
    return { step: main.it.step, index: at, length: win.length, progress: main.progress, round: main.round, playing: !this.frozen && t < this.total, cycle: t, sms, warps };
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
