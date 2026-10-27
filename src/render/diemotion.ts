import type { Block, CpuPlan, Link, Pt } from './cpuplan';
import { Ev, Which } from '../sim/engines/common';
import { REG_NAMES } from '../sim/isa';
import type { CacheSnap, StoredSnap, TraceSnap } from '../sim/game/pipesnap';

// How the die moves (docs/DIE.md "Motion"). Pure geometry and timing, no Pixi, so it is testable.
//
// A snapshot is a sampled instant and the engine runs 100 or more cycles between two of them, so the die cannot show the machine in real
// time. It plays back a *slow motion replay*: the last 24 cycles the engine ran (`TraceSnap`), one cycle every 1/CYCLES_PER_SEC seconds,
// every instruction gliding from block to block along the die's own wires, then the newest window when this one is over. Each cycle is
// long enough to watch: an instruction crosses the five stages in about a second, a stall is an instruction that waits, a flush is a row
// of red chips fading out.

/** How fast the replay runs, in engine cycles per second of game time. */
export const CYCLES_PER_SEC = 4.5;
/** Seconds the old window takes to fade while the next one starts. */
export const FADE_S = 0.5;
/** Cycles to hold the last frame of a window before the next window replaces it. */
const HOLD = 0.4;
/** Windows kept for the scrubber. */
const HISTORY = 120;

export type OpClass = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'sys';

export function opClass(op: string): OpClass {
  if (op === 'mul') return 'mul';
  if (op === 'lw' || op === 'lb' || op === 'lbu') return 'ld';
  if (op === 'sw' || op === 'sb') return 'st';
  if (op === 'jal' || op === 'jalr' || op[0] === 'b') return 'br';
  if (op === 'ecall' || op === 'iret') return 'sys';
  return 'alu';
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

// ---------------------------------------------------------------- routes along the wires

export interface Route { pts: Pt[]; len: number; links: { link: Link; reverse: boolean }[] }

const ROUTE_KINDS: ReadonlySet<string> = new Set(['data', 'mem', 'control', 'mmio']);
const centre = (b: Block): Pt => [b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const routes = new WeakMap<CpuPlan, Map<string, Route | null>>();

/** The shortest way from one block's middle to another's along the plan's data wires (through the blocks in between), or null. */
export function routeBetween(plan: CpuPlan, from: string, to: string): Route | null {
  let cache = routes.get(plan);
  if (!cache) { cache = new Map(); routes.set(plan, cache); }
  const key = from + '>' + to;
  if (cache.has(key)) return cache.get(key) ?? null;
  const by = new Map(plan.blocks.map((b) => [b.id, b]));
  const a = by.get(from), b = by.get(to);
  let out: Route | null = null;
  if (a && b) {
    if (from === to) out = { pts: [centre(a), centre(a)], len: 0, links: [] };
    else {
      // Dijkstra over blocks; an edge is a link walked either way
      const dd = new Map<string, number>([[from, 0]]);
      const prev = new Map<string, { id: string; link: Link; reverse: boolean }>();
      const todo = new Set<string>([from]);
      while (todo.size) {
        let u = '', best = Infinity;
        for (const id of todo) if (dd.get(id)! < best) { best = dd.get(id)!; u = id; }
        todo.delete(u);
        if (u === to) break;
        for (const l of plan.links) {
          if (!ROUTE_KINDS.has(l.kind)) continue;
          const rev = l.to === u && (l.from !== u);
          if (l.from !== u && !rev) continue;
          const v = rev ? l.from : l.to;
          if (!by.has(v)) continue;
          const w = l.pts.reduce((s, p, i) => (i ? s + dist(p, l.pts[i - 1]!) : 0), 0) + dist(centre(by.get(u)!), centre(by.get(v)!)) * 0.3;
          const nd = dd.get(u)! + w;
          if (nd < (dd.get(v) ?? Infinity)) { dd.set(v, nd); prev.set(v, { id: u, link: l, reverse: rev }); todo.add(v); }
        }
      }
      const straight = dist(centre(a), centre(b));
      if (prev.has(to)) {
        const hops: { id: string; link: Link; reverse: boolean }[] = [];
        for (let v = to; v !== from; v = prev.get(v)!.id) hops.unshift({ ...prev.get(v)!, id: v });
        const pts: Pt[] = [centre(a)];
        for (const h of hops) {
          const lp = h.reverse ? [...h.link.pts].reverse() : h.link.pts;
          pts.push(...lp);
          pts.push(centre(by.get(h.id)!));
        }
        let len = 0;
        for (let i = 1; i < pts.length; i++) len += dist(pts[i]!, pts[i - 1]!);
        if (len <= straight * 3 + 500) out = { pts, len, links: hops.map((h) => ({ link: h.link, reverse: h.reverse })) };
      }
      if (!out) out = { pts: [centre(a), centre(b)], len: straight, links: [] };
    }
  }
  cache.set(key, out);
  return out;
}

/** The way one step of an instruction goes: along the wires if they join the two blocks in a few hops, else a straight glide (the unpipelined die has no wires between its stages). */
export function stepRoute(plan: CpuPlan, from: string, to: string, maxHops = 3): Route | null {
  const rt = routeBetween(plan, from, to);
  if (!rt) return null;
  if (rt.links.length > 0 && rt.links.length <= maxHops) return rt;
  const a = rt.pts[0]!, b = rt.pts[rt.pts.length - 1]!;
  return { pts: [a, b], len: dist(a, b), links: [] };
}

/** The point a fraction `u` (0..1) of the way along a polyline, by length. */
export function pointAt(pts: Pt[], u: number): Pt {
  if (pts.length === 1) return pts[0]!;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i]!, pts[i - 1]!);
  if (total === 0) return pts[0]!;
  let d = clamp01(u) * total;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i]!, pts[i - 1]!);
    if (d <= seg || i === pts.length - 1) {
      const t = seg > 0 ? Math.min(1, d / seg) : 0;
      return [pts[i - 1]![0] + (pts[i]![0] - pts[i - 1]![0]) * t, pts[i - 1]![1] + (pts[i]![1] - pts[i - 1]![1]) * t];
    }
    d -= seg;
  }
  return pts[pts.length - 1]!;
}

/** The link joining two blocks, and whether it is walked backwards. */
export function linkBetween(plan: CpuPlan, from: string, to: string, kinds?: readonly string[]): { link: Link; reverse: boolean } | null {
  for (const l of plan.links) {
    if (kinds && !kinds.includes(l.kind)) continue;
    if (l.from === from && l.to === to) return { link: l, reverse: false };
    if (l.from === to && l.to === from) return { link: l, reverse: true };
  }
  return null;
}

// ---------------------------------------------------------------- where an instruction is, by stage code

/** The blocks an instruction visits, by the engine's stage codes. */
export class Hosts {
  private byId: Map<string, Block>;
  private frames = new Map<number, Block>();
  readonly ooo: boolean;
  constructor(readonly plan: CpuPlan) {
    this.byId = new Map(plan.blocks.map((b) => [b.id, b]));
    this.ooo = plan.arch === 'ooo';
    for (const b of plan.blocks) if (b.kind === 'stage' && b.stage !== undefined && !b.core) this.frames.set(b.stage, b);
  }

  private inFrame(stage: number, kind: string, lane: number): Block | undefined {
    const f = this.frames.get(stage);
    if (!f) return undefined;
    const in_ = this.plan.blocks.filter((b) => b.parent === f.id && b.kind === kind);
    return in_.find((b) => b.lane === lane) ?? in_[0];
  }

  private first(kind: string, pred: (b: Block) => boolean = () => true): Block | undefined {
    return this.plan.blocks.find((b) => b.kind === kind && pred(b));
  }

  /** The block for stage code `ch` (F D X M W S R C) of an instruction in `lane` with mnemonic `op`; null if the die has no such place. */
  host(ch: string, lane: number, op: string, id: number): { block: Block; visible: boolean } | null {
    if (this.ooo) {
      switch (ch) {
        case 'F': { const b = this.byId.get('fetch'); return b ? { block: b, visible: true } : null; }
        case 'D': { const b = this.plan.blocks.find((x) => x.kind === 'decode' && (x.lane ?? 0) === lane) ?? this.first('decode'); return b ? { block: b, visible: true } : null; }
        case 'S': { const b = this.first('sched'); return b ? { block: b, visible: false } : null; }
        case 'X': {
          const cls = opClass(op);
          const unit = cls === 'mul' ? 'MUL' : cls === 'ld' || cls === 'st' ? 'LSU' : id % 2 ? 'ALU1' : 'ALU0';
          const b = this.plan.blocks.find((x) => x.unit === unit);
          return b ? { block: b, visible: true } : null;
        }
        case 'R': { const b = this.first('rob'); return b ? { block: b, visible: false } : null; }
        case 'C': { const b = this.first('regfile'); return b ? { block: b, visible: true } : null; }
      }
      return null;
    }
    const b = ch === 'F' ? this.inFrame(0, 'fetch', lane)
      : ch === 'D' ? this.inFrame(1, 'decode', lane)
      : ch === 'X' ? this.inFrame(2, 'alu', lane)
      : ch === 'M' ? this.inFrame(3, 'lsu', lane)
      : ch === 'W' ? this.inFrame(4, 'wb', lane) : undefined;
    return b ? { block: b, visible: true } : null;
  }

  /** Where a chip goes when its instruction is done: the register file. */
  get exit(): Block | undefined { return this.first('regfile'); }
}

// ---------------------------------------------------------------- what is stored, rewound and replayed

/** A cache as the replay shows it: the line in each slot at the cycle being shown, and the words of the lines whose words are known. */
export interface CacheView {
  lines: number; ways: number; lineBytes: number;
  tags: number[];
  /** Words of a line (by line number), as RAM held them at the snapshot. Unknown for a line that came and went inside the window. */
  words: Map<number, number[]>;
  /** The replay clock (window * 1000 + cycle shown) of the last hit or fill of each slot, -1 never. */
  hitAt: number[];
  fillAt: number[];
}

/** One write the machine did (see `Ev`). */
export interface StoreEvent { cycle: number; kind: number; a: number; b: number; c: number; d: number }

function cacheView(c: CacheSnap): CacheView {
  const words = new Map<number, number[]>();
  const per = c.lineBytes / 4;
  c.tags.forEach((t, slot) => { if (t >= 0) words.set(t, c.words.slice(slot * per, slot * per + per)); });
  return { lines: c.lines, ways: c.ways, lineBytes: c.lineBytes, tags: c.tags.slice(), words, hitAt: new Array(c.lines).fill(-1), fillAt: new Array(c.lines).fill(-1) };
}

/**
 * The register file, the cache lines and the predictor counters of the cycle being replayed: the snapshot's state is the end of the window, so
 * the window's writes are undone (newest first) to get the state at its start, and applied again cycle by cycle as the replay passes them.
 */
export class StoreReplay {
  regs: number[];
  regAt: number[];
  readAt: number[];
  d: CacheView; i?: CacheView; l2?: CacheView;
  pred: { entries: number; bits: number; table: number[]; at: number[] };
  /** The TLB at the snapshot (not rewound: it shows what is in it now). */
  tlb?: { vpn: number[]; frame: number[] };
  readonly events: StoreEvent[] = [];
  private byCycle = new Map<number, StoreEvent[]>();

  constructor(st: StoredSnap) {
    this.regs = st.regs.slice();
    this.tlb = st.tlb;
    this.regAt = new Array(this.regs.length).fill(-1);
    this.readAt = new Array(this.regs.length).fill(-1);
    this.d = cacheView(st.d);
    if (st.i) this.i = cacheView(st.i);
    if (st.l2) this.l2 = cacheView(st.l2);
    this.pred = { entries: st.pred.entries, bits: st.pred.bits, table: st.pred.table.slice(), at: new Array(st.pred.entries).fill(-1) };
    for (let k = 0; k < st.events.length; k += 6) {
      const e = { cycle: st.events[k]!, kind: st.events[k + 1]!, a: st.events[k + 2]!, b: st.events[k + 3]!, c: st.events[k + 4]!, d: st.events[k + 5]! };
      this.events.push(e);
      const l = this.byCycle.get(e.cycle);
      if (l) l.push(e); else this.byCycle.set(e.cycle, [e]);
    }
    for (let k = this.events.length - 1; k >= 0; k--) this.apply(this.events[k]!, true, -1);
  }

  private cache(which: number): CacheView | undefined { return which === Which.D ? this.d : which === Which.I ? this.i : this.l2; }

  private apply(e: StoreEvent, undo: boolean, at: number): void {
    switch (e.kind) {
      case Ev.Reg: this.regs[e.a] = undo ? e.c : e.b; if (!undo) this.regAt[e.a] = at; break;
      case Ev.Fill: { const c = this.cache(e.a); if (c) { c.tags[e.b] = undo ? e.d : e.c; if (!undo) c.fillAt[e.b] = at; } break; }
      case Ev.Hit: { const c = this.cache(e.a); if (c && !undo) c.hitAt[e.b] = at; break; }
      case Ev.Pred: this.pred.table[e.a] = undo ? e.c : e.b; if (!undo) this.pred.at[e.a] = at; break;
    }
  }

  /** The writes of engine cycle `cycle` happen now (`at` is the replay clock). Returns them. */
  step(cycle: number, at: number): StoreEvent[] {
    const l = this.byCycle.get(cycle) ?? [];
    for (const e of l) this.apply(e, false, at);
    return l;
  }
}

/** The registers an instruction reads, by its disassembly ("sw a2, 4(s0)" reads a2 and s0; "add a1, a1, a0" reads a1 and a0). */
export function regsRead(text: string): number[] {
  const sp = text.indexOf(' ');
  if (sp < 0) return [];
  const op = text.slice(0, sp);
  const names = text.slice(sp + 1).split(/[\s,()]+/).filter((x) => x && (REG_NAMES as readonly string[]).includes(x));
  const idx = names.map((n) => (REG_NAMES as readonly string[]).indexOf(n));
  const noDest = op === 'sw' || op === 'sb' || op[0] === 'b' || op === 'ecall' || op === 'iret';
  const out = noDest ? idx : idx.slice(1);
  return [...new Set(out)].filter((r) => r !== 0);
}

// ---------------------------------------------------------------- the replay

export interface ChipState {
  /** `<window>:<instruction id>`, stable while the chip lives. */
  key: string;
  id: number;
  op: string;
  text: string;
  x: number; y: number; scale: number; alpha: number;
  /** The instruction waits here (the same stage two cycles running, in order engines). */
  stalled: boolean;
  /** Flushed: wrong-path work being thrown away. */
  flushed: boolean;
  /** The block it is in (or leaving). */
  host: string;
  /** Its address and raw word. */
  pc: number; word: number;
  /** The stage it is in (F D X M W S R C, x flushed), the stage it goes to next and how far along that step it is (0..1): the token changes with them. */
  stage: string; next: string; e: number;
}

/** Something that happens at a cycle boundary: the die turns it into packets on the wires. */
export interface BeatEvent {
  /** The stage code the instruction enters (F D X M W S R C) or `x` for a flush. */
  to: string;
  lane: number;
  op: string;
  id: number;
  /** The engine cycle of the beat, the instruction's disassembly and pc. */
  cycle: number;
  text: string;
  pc: number;
  /** Cycles the instruction stays in this stage (counted from this beat to the end of the window at most). */
  dwell: number;
  /** An in-order instruction that stays in M for more than one cycle: a data cache miss. */
  miss: boolean;
}

export interface Frame {
  /** What is stored at the cycle shown (null without a stored state). */
  store: StoreReplay | null;
  /** The writes of the cycles this update crossed (they have just happened). */
  applied: StoreEvent[];
  /** Cycles into the current window (fractional). */
  tau: number;
  chips: ChipState[];
  /** The previous window, fading. */
  fading: ChipState[];
  /** Beats crossed by this update. */
  beats: BeatEvent[];
  /** A cycle boundary was crossed (the clock ticks). */
  tick: boolean;
  /** Which window of the trace is playing (changes when the next one starts). */
  window: number;
  /** The engine cycle shown. */
  cycle: number;
}

interface PreparedRow { id: number; pc: number; word: number; op: string; text: string; codes: string; lanes: number[] }
interface Window { seq: number; end: number; n: number; rows: PreparedRow[]; store: StoreReplay | null }

function prepare(seg: TraceSnap, seq: number, stored?: StoredSnap): Window {
  // lane of an instruction in a stage: its rank among the instructions in that stage that cycle, oldest first
  const rows: PreparedRow[] = seg.rows.map((r) => ({ id: r.id, pc: r.pc ?? 0, word: r.word ?? 0, op: r.text.split(' ')[0] ?? '', text: r.text, codes: r.codes, lanes: new Array<number>(r.codes.length).fill(0) }));
  for (let k = 0; k < seg.n; k++) {
    const seen = new Map<string, number>();
    for (const r of rows) {
      const ch = r.codes[k]!;
      if (ch === ' ') continue;
      const lane = seen.get(ch) ?? 0;
      seen.set(ch, lane + 1);
      r.lanes[k] = lane;
    }
  }
  return { seq, end: seg.end, n: seg.n, rows, store: stored ? new StoreReplay(stored) : null };
}

export class Player {
  private cur: Window | null = null;
  private pending: Window | null = null;
  private seq = 0;
  private tau = 0;
  private lastNow = 0;
  private fadeFrom = -1e9;
  private fadeChips: ChipState[] = [];
  private hosts: Hosts;
  private lastShown = -1;
  /** The windows already seen, oldest first (the Trace panel's scrubber moves through them while the game is paused). */
  private history: { seg: TraceSnap; stored?: StoredSnap }[] = [];

  constructor(readonly plan: CpuPlan, private readonly cyclesPerSec = CYCLES_PER_SEC) {
    this.hosts = new Hosts(plan);
  }

  /** The engine cycles the replay can be moved to (the history of windows), or null when there is none. */
  range(): { lo: number; hi: number } | null {
    if (this.history.length === 0) return null;
    return { lo: this.history[0]!.seg.end - this.history[0]!.seg.n + 1, hi: this.history[this.history.length - 1]!.seg.end };
  }

  /** The engine cycle shown now (a window's first cycle until it plays), or -1. */
  shown(): number {
    const w = this.cur;
    return w ? w.end - w.n + 1 + Math.floor(Math.min(this.tau, w.n - 1)) : -1;
  }

  /**
   * Show the machine at engine `cycle`, frozen there: the window that holds it is taken from the history, the writes before the cycle are
   * applied at once and the cycle's own beats and writes play on the next update. Returns false when no window holds the cycle.
   */
  seek(cycle: number): boolean {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i]!, start = h.seg.end - h.seg.n + 1;
      if (cycle < start || cycle > h.seg.end) continue;
      this.show(prepare(h.seg, ++this.seq, h.stored), cycle - start);
      return true;
    }
    return false;
  }

  /** Put a window on screen at cycle `k` of it, the cycles before `k` already done. */
  private show(w: Window, k: number): void {
    this.cur = w; this.pending = null; this.tau = k;
    this.fadeChips = []; this.fadeFrom = -1e9;
    for (let j = 0; j < k; j++) w.store?.step(w.end - w.n + 1 + j, w.seq * 1000 + j);
    this.lastShown = k - 1;
  }

  /** A new snapshot's trace. Only the newest waiting window is kept: the replay is a sample of the run, not all of it. */
  push(seg: TraceSnap | undefined, stored?: StoredSnap): void {
    if (!seg || seg.rows.length === 0) return;
    if (this.cur && seg.end === this.cur.end) return;
    if (this.pending && seg.end === this.pending.end) return;
    if (this.cur && seg.end < this.cur.end - 1000) { this.cur = null; this.pending = null; this.history = []; } // a new attempt: the cycles started over
    this.history.push({ seg, stored });
    if (this.history.length > HISTORY) this.history.shift();
    this.pending = prepare(seg, ++this.seq, stored);
  }

  /** Forget everything (the machine was reset or the plan changed). */
  reset(): void { this.cur = null; this.pending = null; this.history = []; this.fadeChips = []; this.tau = 0; this.lastShown = -1; }

  /**
   * Advance to game time `now` (ms) and return what to draw. While the game is `paused` the replay does not play: a window that arrives
   * (a step of the machine) is shown at once at its last cycle, so each step moves the die to the cycle it ran.
   */
  update(now: number, paused = false): Frame {
    if (paused && this.pending) { const w = this.pending; this.show(w, w.n - 1); }
    const dt = this.lastNow ? Math.max(0, Math.min(0.25, (now - this.lastNow) / 1000)) : 0;
    this.lastNow = now;
    const beats: BeatEvent[] = [];
    const applied: StoreEvent[] = [];
    let tick = false;
    if (!this.cur && this.pending) { this.cur = this.pending; this.pending = null; this.tau = 0; this.lastShown = -1; }
    if (this.cur) {
      const before = this.tau;
      this.tau += dt * this.cyclesPerSec;
      const last = this.cur.n - 1;
      if (this.tau > last + HOLD && this.pending && this.pending.end !== this.cur.end) {
        // the next window: the old one fades while the new one starts
        this.fadeChips = this.chipsAt(this.cur, last);
        this.fadeFrom = now;
        this.cur = this.pending; this.pending = null; this.tau = 0; this.lastShown = -1;
      } else if (this.tau > last + HOLD) this.tau = last + HOLD;
      const t = Math.min(this.tau, this.cur.n - 1);
      // beats: every integer boundary passed since the last update (the first frame of a window counts its start)
      const k0 = this.lastShown < 0 ? 0 : Math.floor(this.lastShown) + 1;
      for (let k = k0; k <= Math.floor(t); k++) {
        beats.push(...this.beatsAt(this.cur, k));
        tick = true;
        if (this.cur.store) applied.push(...this.cur.store.step(this.cur.end - this.cur.n + 1 + k, this.cur.seq * 1000 + k));
      }
      this.lastShown = Math.max(this.lastShown, Math.floor(t));
      void before;
    }
    const fadeT = clamp01((now - this.fadeFrom) / (FADE_S * 1000));
    const fading = fadeT < 1 ? this.fadeChips.map((c) => ({ ...c, alpha: c.alpha * (1 - fadeT) })) : [];
    const w = this.cur;
    return { store: w?.store ?? null, applied, tau: this.tau, chips: w ? this.chipsAt(w, Math.min(this.tau, w.n - 1)) : [], fading, beats, tick, window: w?.seq ?? 0, cycle: w ? w.end - w.n + 1 + Math.floor(Math.min(this.tau, w.n - 1)) : 0 };
  }

  /** What every instruction is doing at the cycle being shown: its stage code. Oldest first. */
  now(): { id: number; op: string; ch: string; text: string; pc: number; lane: number }[] {
    const w = this.cur;
    if (!w) return [];
    const k = Math.min(w.n - 1, Math.floor(this.tau));
    const out: { id: number; op: string; ch: string; text: string; pc: number; lane: number }[] = [];
    for (const r of w.rows) { const ch = r.codes[k]!; if (ch !== ' ' && ch !== 'x') out.push({ id: r.id, op: r.op, ch, text: r.text, pc: r.pc, lane: r.lanes[k]! }); }
    return out;
  }

  /** The block an instruction in stage `ch` (lane `lane`) is in, or undefined where the die shows none. */
  hostOf(ch: string, lane: number, op: string, id: number): Block | undefined { return this.hosts.host(ch, lane, op, id)?.block; }

  /** What enters a stage at the start of cycle `k` of a window. */
  private beatsAt(w: Window, k: number): BeatEvent[] {
    const out: BeatEvent[] = [];
    for (const r of w.rows) {
      const a = r.codes[k]!;
      if (a === ' ') continue;
      const prev = k > 0 ? r.codes[k - 1]! : ' ';
      if (a === prev) continue;
      let j = k;
      while (j < w.n && r.codes[j] === a) j++;
      const dwell = j - k;
      out.push({ to: a, lane: r.lanes[k]!, op: r.op, id: r.id, miss: a === 'M' && !this.hosts.ooo && dwell > 1, dwell, cycle: w.end - w.n + 1 + k, text: r.text, pc: r.pc });
    }
    return out;
  }

  /** Every chip at time `tau` (cycles into the window). */
  chipsAt(w: Window, tau: number): ChipState[] {
    const k = Math.min(w.n - 1, Math.floor(tau));
    const f = k >= w.n - 1 ? 0 : tau - k;
    const e = smooth(f);
    const H = this.hosts;
    const out: ChipState[] = [];
    for (const r of w.rows) {
      const a = r.codes[k]!, b = k + 1 < w.n ? r.codes[k + 1]! : a;
      const base = { key: `${w.seq}:${r.id}`, id: r.id, op: r.op, text: r.text, stalled: false, flushed: false, pc: r.pc, word: r.word, stage: a === ' ' ? b : a, next: b === ' ' ? a : b, e };
      const at = (ch: string, kk: number) => H.host(ch, r.lanes[kk]!, r.op, r.id);
      if (a === ' ') {
        // about to enter: it fades in where it will be
        if (b !== ' ' && b !== 'x') {
          const h = at(b, k + 1);
          if (h && h.visible) out.push({ ...base, x: centre(h.block)[0], y: centre(h.block)[1], scale: 0.7 + 0.3 * e, alpha: e, host: h.block.id });
        }
        continue;
      }
      if (a === 'x') {
        // flushed: stays where it was last seen, red, and goes
        let ch = ' ', kk = k;
        for (let j = k - 1; j >= 0; j--) if (r.codes[j] !== ' ' && r.codes[j] !== 'x') { ch = r.codes[j]!; kk = j; break; }
        const h = ch === ' ' ? null : at(ch, kk);
        if (h && h.visible) out.push({ ...base, x: centre(h.block)[0], y: centre(h.block)[1] + 14 * e, scale: 1 - 0.4 * e, alpha: 1 - e, flushed: true, host: h.block.id });
        continue;
      }
      const ha = at(a, k);
      if (!ha) continue;
      const ca = centre(ha.block);
      if (b === ' ') {
        // done: slides into the register file (or fades where it is, when the die has none)
        const ex = H.exit;
        const last = a === 'W' || a === 'C';
        if (last && ex && k + 1 < w.n) {
          const rt = stepRoute(this.plan, ha.block.id, ex.id, 1);
          const p = rt ? pointAt(rt.pts, e * (rt.links.length ? 1 : 0.4)) : ca;
          out.push({ ...base, x: p[0], y: p[1], scale: 1 - 0.35 * e, alpha: ha.visible ? 1 - e : 0, host: ha.block.id });
        } else if (ha.visible) out.push({ ...base, x: ca[0], y: ca[1], scale: 1, alpha: k + 1 < w.n ? 1 - e : 1, host: ha.block.id });
        continue;
      }
      if (b === 'x') {
        if (ha.visible) out.push({ ...base, x: ca[0], y: ca[1], scale: 1, alpha: 1, host: ha.block.id });
        continue;
      }
      if (b === a) {
        // waits here; in an in-order engine that is a stall
        const hs = at(a, k + 1);
        const cs = hs && hs.block.id !== ha.block.id ? centre(hs.block) : ca;
        if (ha.visible) out.push({ ...base, x: ca[0] + (cs[0] - ca[0]) * e, y: ca[1] + (cs[1] - ca[1]) * e, scale: 1, alpha: 1, stalled: !H.ooo && (a === 'D' || a === 'F' || a === 'M'), host: ha.block.id });
        continue;
      }
      const hb = at(b, k + 1);
      if (!hb) { if (ha.visible) out.push({ ...base, x: ca[0], y: ca[1], scale: 1, alpha: 1, host: ha.block.id }); continue; }
      const rt = stepRoute(this.plan, ha.block.id, hb.block.id);
      const p = rt && rt.len > 0 ? pointAt(rt.pts, e) : (() => { const cb = centre(hb.block); return [ca[0] + (cb[0] - ca[0]) * e, ca[1] + (cb[1] - ca[1]) * e] as Pt; })();
      const alpha = (ha.visible ? 1 - e : 0) + (hb.visible ? e : 0);
      if (alpha <= 0.01) continue;
      out.push({ ...base, x: p[0], y: p[1], scale: 1 - 0.12 * Math.sin(Math.PI * e), alpha: Math.min(1, alpha), host: e < 0.5 ? ha.block.id : hb.block.id });
    }
    return out;
  }
}

// ---------------------------------------------------------------- packets: the data that moves with the instructions

export interface PacketPlan { link: Link; reverse: boolean; delay: number; color: 'inst' | 'bad' | 'mute' }

/** The writes the die has just seen, of the beat's cycle, by kind. */
export interface BeatContext { events: StoreEvent[] }

/**
 * The packets a beat sends along the wires, coloured by the instruction that causes them (`inst`): its address going out to memory and the
 * instruction word coming back from RAM through the memory controller and the system bus (through the L2 and the instruction cache when
 * the CPU has them), operands read from the registers, a load asking the data cache and the data coming back (from RAM on a miss), a store
 * writing through to RAM, a result written back. `delay` is in cycles after the beat.
 */
export function packetsFor(plan: CpuPlan, ev: BeatEvent, ctx: BeatContext = { events: [] }): PacketPlan[] {
  const out: PacketPlan[] = [];
  const has = (id: string) => plan.blocks.some((b) => b.id === id);
  /** Packets along a chain of blocks, each hop `step` cycles after the last; blocks the die lacks are skipped. */
  const chain = (ids: string[], delay: number, color: PacketPlan['color'] = 'inst', step = 0.3, kinds?: readonly string[]) => {
    const list = ids.filter(has).filter((x, i, all) => i === 0 || x !== all[i - 1]);
    for (let i = 1; i < list.length; i++) {
      const l = linkBetween(plan, list[i - 1]!, list[i]!, kinds);
      if (l) out.push({ ...l, delay: delay + (i - 1) * step, color });
    }
  };
  const cls = opClass(ev.op);
  const ooo = plan.arch === 'ooo';
  const unit = (id: number) => (cls === 'mul' ? 'mul' : cls === 'ld' || cls === 'st' ? 'lsu' : id % 2 ? 'alu1' : 'alu0');
  const dec = (lane: number) => (has('dec') ? 'dec' : `dec${lane}`);
  const at = (kind: number, which: number) => ctx.events.some((e) => e.kind === kind && e.a === which);
  const hasL2 = has('l2');
  switch (ev.to) {
    case 'F':
      chain(['pc', 'fetch'], 0);
      if (has('ic')) {
        if (at(Ev.Fill, Which.I)) {
          chain(['fetch', 'ic', hasL2 ? 'l2' : 'fabric', 'fabric', 'mc'], 0.1, 'mute', 0.25);
          chain(['mc', 'fabric', hasL2 ? 'l2' : 'fabric', 'ic', 'fetch'], 1.0, 'inst', 0.3);
        } else if (hasL2 && at(Ev.Hit, Which.L2)) chain(['l2', 'ic', 'fetch'], 0.2);
        else chain(['ic', 'fetch'], 0.2);
      } else {
        chain(['fetch', 'fabric', 'mc'], 0.1, 'mute', 0.2);
        chain(['mc', 'fabric', 'fetch'], 0.6, 'inst', 0.3);
      }
      break;
    case 'D':
      chain(['rf', dec(ev.lane)], 0.1);
      if (ooo) chain([dec(ev.lane), 'rat'], 0.4);
      break;
    case 'X':
      if (!ooo) {
        chain(['rf', 'lat1'], 0.1);
        if (cls === 'br') chain(['lat1', 'br'], 0.4);
      } else {
        chain(['sched', unit(ev.id)], 0);
        if (cls === 'ld') memAccess(0.3, ev.dwell > 2);
        else if (cls === 'st') chain(['lsu', 'dc'], 0.3);
      }
      break;
    case 'M':
      if (cls === 'ld') memAccess(0, ev.miss, Math.max(0, ev.dwell - 1));
      else if (cls === 'st') {
        chain(['lsu', 'dc'], 0);
        chain(['dc', hasL2 ? 'l2' : 'fabric', 'fabric', 'mc'], 0.4, 'inst', 0.25);
      }
      break;
    case 'W':
      chain(['wb', 'rf'], 0);
      break;
    case 'S':
      chain(['disp', 'sched'], 0); chain(['disp', 'rob'], 0.1);
      break;
    case 'R':
      chain([unit(ev.id), 'bus'], 0); chain(['bus', 'rob'], 0.4); chain(['bus', 'sched'], 0.4, 'inst', 0.3, ['wakeup']);
      break;
    case 'C':
      chain(['rob', 'rf'], 0);
      break;
    case 'x':
      chain(['br', 'npc'], 0, 'bad', 0.3, ['flush']); chain(['bus', 'npc'], 0, 'bad', 0.3, ['flush']);
      break;
  }
  return out;

  /** A load: the address goes to the data cache; on a hit the word comes straight back, on a miss the line comes from RAM through the bus (and the L2). */
  function memAccess(delay: number, miss: boolean, wait = 0) {
    chain(['lsu', 'dc'], delay);
    if (!miss) { chain(['dc', 'lsu'], delay + 0.5); return; }
    chain(['dc', hasL2 ? 'l2' : 'fabric', 'fabric', 'mc'], delay + 0.3, 'mute', 0.25);
    chain(['mc', 'fabric', hasL2 ? 'l2' : 'fabric', 'dc', 'lsu'], delay + 1 + wait * 0.6, 'inst', 0.3);
  }
}
