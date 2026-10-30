// The cores of a multicore CPU as live tiles (docs/DIE.md "Core tiles"): one tile per logical core, tinted by the job thread it runs, with its hardware
// core's pipeline as a row of cells in the colours of the instructions in it. Pure: the snapshot in, a model out; `dieview.ts` draws it above the die and the
// Trace panel draws the same model as its core selector.

import type { CoresSnap, OooSnap, PipeSnap } from '../../sim/game/pipesnap';
import { CommitStall, DispatchStall, FetchStall } from '../../sim/engines/view';
import { SlotKind } from '../../sim/engines/view';
import { opClass, type OpClass } from './diemotion';
import type { CoreRate } from './corestats';

/** One cell of a tile's pipeline: the class of the instruction in it, or null when nothing is. */
export type TileCell = OpClass | null;

export interface TileModel {
  core: number;
  hw: number;
  parked: boolean;
  selected: boolean;
  /** Job slot and thread number running on the core (job 0: none). */
  job: number;
  thread: number;
  /** The thread's tint (#rrggbb), or null when no job runs here. */
  tint: string | null;
  /** The core's own colour (#rrggbb): the same on the die, the RAM bubbles and the Trace panel, whatever runs on it. */
  color: string;
  /** Instructions per cycle and the share of cycles lost to stalls of its hardware core (0 until two readings are in). */
  ipc: number;
  stall: number;
  /** The hardware core's pipeline: the stages, or for the out-of-order engine the four units. */
  cells: TileCell[];
  /** How full the reorder buffer is, 0..1 (0 for the in-order engines). */
  fill: number;
  /** The out-of-order core's structures (null for the in-order engines). */
  ooo: OooStages | null;
  /** "C3", and under it "fft T3" style text for the panel. */
  label: string;
  sub: string;
}

const hsl = (h: number, s: number, l: number): string => {
  const f = (n: number) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  const c = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return '#' + c(f(0)) + c(f(8)) + c(f(4));
};

/**
 * The tint of thread `thread` of the job in slot `job`: a hue for the job (the slot word is spread so neighbouring slots differ) and a lightness for
 * the thread, so the threads of one job read as one family and two jobs as two.
 */
export function threadTint(job: number, thread: number, dark: boolean): string {
  const h = (((Math.imul(job >>> 0, 2654435761) >>> 0) >>> 8) % 360) / 360;
  const step = Math.min(7, thread) / 7;
  return hsl(h, 0.7, dark ? 0.5 + 0.18 * step : 0.32 + 0.2 * step);
}

/**
 * The colour of core `core`: spaced round the hue circle by the golden angle so the first cores are far apart, and the same whatever runs on it
 * (the job's hue is the wash's: `threadTint`).
 */
export function coreColor(core: number, dark: boolean): string {
  const h = (0.58 + core * 0.381966) % 1;
  return hsl(h, 0.78, dark ? 0.62 : 0.42);
}

/** One structure of the out-of-order engine as a gauge: `used` of `cap` slots (each the class of the instruction in it, `done` when it has finished), and why it made no progress this cycle. */
export interface OooGauge { name: string; used: number; cap: number; slots: { cls: TileCell; done: boolean }[]; stall: string | null }

/** An execution unit: the class of the instruction in it and how far through its latency it is (0..1). */
export interface OooUnit { name: string; cls: TileCell; progress: number }

/** What an out-of-order core is doing, per structure: the front end, the scheduler, the reorder buffer and the units. */
export interface OooStages { gauges: OooGauge[]; units: OooUnit[] }

const FETCH_WHY: Record<number, string> = { [FetchStall.QueueFull]: 'queue full', [FetchStall.Stopped]: 'stopped', [FetchStall.ICache]: 'I-cache miss' };
const DISPATCH_WHY: Record<number, string> = { [DispatchStall.Empty]: 'starved', [DispatchStall.RobFull]: 'ROB full', [DispatchStall.SchedFull]: 'sched full' };
const COMMIT_WHY: Record<number, string> = { [CommitStall.Empty]: 'nothing to retire', [CommitStall.HeadPending]: 'head waiting' };
const UNIT_NAMES = ['ALU0', 'ALU1', 'MUL', 'LSU'];

const clsOf = (op: string): TileCell => (op ? opClass(op) : null);

/** The usage of each structure of an out-of-order core's snapshot, for the tile: used slots by instruction class, the stall cause, the units' progress. */
export function oooStages(o: OooSnap): OooStages {
  const [fs, ds, cs] = o.stall;
  const fetchCap = Math.max(o.fetchQ.length, o.fetchCap ?? o.fetchQ.length, 1);
  const decoded = o.decode.filter((op) => op !== '');
  const sched = o.sched.filter((s) => s.op !== '');
  const rob = o.rob.filter((s) => s.op !== '');
  return {
    gauges: [
      { name: 'FETCH', used: o.fetchQ.length, cap: fetchCap, slots: o.fetchQ.map((op) => ({ cls: clsOf(op), done: false })), stall: FETCH_WHY[fs] ?? null },
      { name: 'DECODE', used: decoded.length, cap: Math.max(1, o.decode.length), slots: decoded.map((op) => ({ cls: clsOf(op), done: false })), stall: DISPATCH_WHY[ds] ?? null },
      { name: 'SCHED', used: sched.length, cap: Math.max(1, o.sched.length), slots: sched.map((s) => ({ cls: clsOf(s.op), done: false })), stall: null },
      { name: 'ROB', used: rob.length, cap: Math.max(1, o.rob.length), slots: rob.map((s) => ({ cls: clsOf(s.op), done: s.state >= 3 })), stall: COMMIT_WHY[cs] ?? null },
    ],
    units: o.units.map((u, k) => ({ name: UNIT_NAMES[k] ?? 'U' + k, cls: clsOf(u.op), progress: u.op && u.total > 0 ? Math.min(1, (u.total - u.left) / u.total) : 0 })),
  };
}

/** The cells of one pipeline snapshot. */
export function pipeCells(p: PipeSnap | undefined): { cells: TileCell[]; fill: number } {
  if (!p) return { cells: [], fill: 0 };
  if (p.ooo) {
    return { cells: p.ooo.units.map((u) => (u.op ? opClass(u.op) : null)), fill: p.ooo.rob.length ? p.ooo.robCount / p.ooo.rob.length : 0 };
  }
  return { cells: p.stages.map((s) => (s.kind === SlotKind.Instr && s.op ? opClass(s.op) : null)), fill: 0 };
}

/** The tiles of a multicore snapshot, in core order. `rates` are the hardware cores' rates (corestats.ts), by hardware core. */
export function tileModels(c: CoresSnap, dark: boolean, rates: readonly CoreRate[] = []): TileModel[] {
  return c.live.map((l) => {
    const { cells, fill } = pipeCells(c.tiles[l.hw]);
    const running = l.job !== 0, asleep = l.parked && !running, r = rates[l.hw];
    return {
      core: l.core, hw: l.hw, parked: l.parked, selected: l.core === c.selected, job: l.job, thread: l.thread,
      tint: running ? threadTint(l.job, l.thread, dark) : null,
      color: coreColor(l.core, dark), ipc: asleep ? 0 : r?.ipc ?? 0, stall: asleep ? 0 : r?.stall ?? 0,
      cells: asleep ? cells.map(() => null) : cells, fill, ooo: c.tiles[l.hw]?.ooo && !asleep ? oooStages(c.tiles[l.hw]!.ooo!) : null,
      label: 'C' + l.core,
      sub: running ? 'T' + l.thread : l.parked ? 'parked' : 'kernel',
    };
  });
}

/** Where tile `k` of `n` goes in a row `w` wide (a gap of `gap` between tiles; they shrink to fit, up to `maxW`). */
export function tileRect(k: number, n: number, w: number, gap: number, maxW: number, h: number): { x: number; y: number; w: number; h: number } {
  const tw = Math.min(maxW, (w - gap * (n - 1)) / n);
  return { x: k * (tw + gap), y: 0, w: tw, h };
}

/** What the wash of one hardware core's tile shows: the logical cores on it. */
export interface WashModel { hw: number; selected: boolean; models: TileModel[] }

/** The logical cores grouped by hardware core, in tile order. */
export function washModels(c: CoresSnap, dark: boolean, rates: readonly CoreRate[] = []): WashModel[] {
  const all = tileModels(c, dark, rates), out: WashModel[] = [];
  for (const m of all) {
    let w = out.find((x) => x.hw === m.hw);
    if (!w) { w = { hw: m.hw, selected: false, models: [] }; out.push(w); }
    w.models.push(m);
    if (m.selected) w.selected = true;
  }
  return out.sort((a, b) => a.hw - b.hw);
}
