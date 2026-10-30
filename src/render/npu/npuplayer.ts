import { GpuFaultCode, NPU_NO_BIAS, NpuOp } from '../../sim/isa/memmap';
import type { NpuStep, NpuView } from '../../sim/machine/npu';
import { regionsOf, type NpuShow, type NpuStepShow, type RegionEntry } from './npuglyph';

// What the card view shows each frame (`NpuShow`): the snapshot as it is while a launch is in flight, and otherwise a slow-motion replay of the launches that
// finished since the last look (a descriptor takes a handful of card ticks, a launch a few dozen, far less than a frame of the game, so without the
// replay an inference would come and go unseen). The replay knows each descriptor, its cost, the card memory it touched and the accumulator after
// it, which the card logs for the view; it is the same picture the card showed, just slower.

/** How long the launch takes to cross the link, in a replay (ms), and how long a descriptor lasts for a given cost in card ticks. */
export const REPLAY_HOP_MS = 500;
export const replayStepMs = (e: Pick<NpuStep, 'cost' | 'fault'>): number => (e.fault ? 500 : Math.min(1700, 360 + e.cost * 12));
/** The most launches kept waiting for their replay. */
export const REPLAY_QUEUE = 3;

const unit = (v: number): number => Math.max(0, Math.min(1, v));

const stepShow = (e: Pick<NpuStep, 'op' | 'a' | 'b' | 'cost' | 'fault' | 'reads' | 'writes'>, progress: number): NpuStepShow => {
  const w = e.writes[0], side = w ? Math.round(Math.sqrt((w[1] - w[0]) / 4)) : 0;
  return { op: e.op, a: e.a, b: e.b, progress: unit(progress), cost: e.cost, fault: e.fault, reads: e.reads, writes: e.writes, n: e.op === NpuOp.Layer ? side : 0 };
};

/** The accumulator before step `index` of launch `run` (the card clears it at the start of a launch). */
const accBefore = (log: readonly NpuStep[], run: number, index: number, size: number): number[] => log.find((e) => e.run === run && e.index === index - 1)?.acc ?? new Array<number>(size).fill(0);

/** The card now, from its snapshot. */
export function liveShow(v: NpuView, ms: number): NpuShow {
  const e = v.index >= 0 ? v.log.find((x) => x.run === v.run && x.index === v.index) : undefined, K2 = v.grid * v.grid;
  return {
    phase: v.phase, progress: v.phase === 'in' || v.phase === 'out' ? unit(v.span > 0 ? 1 - v.wait / v.span : 1) : 1, grid: v.grid, memBytes: v.memBytes, descAt: v.descAt, count: v.count,
    list: v.list.map((d) => ({ op: d.op, a: d.a, b: d.b })), index: v.index,
    step: e ? stepShow(e, v.phase === 'run' ? 1 - v.stepWait / Math.max(1, v.stepSpan) : 1) : null,
    acc: v.acc, prevAcc: e ? accBefore(v.log, v.run, v.index, K2) : v.acc, tiles: v.tiles, cycles: v.cycles,
    busy: v.busy, error: v.error, done: v.done, fault: v.fault, fill: v.fill, regions: regionsOf(v.list, v.grid, v.descAt, v.count), touch: null, replay: false, ms,
  };
}

/** A logged step as the region finder reads it: a layer's parameters come from the byte ranges the card logged for it (the block, the weights, the inputs, the biases; the result written). */
const entryOf = (e: NpuStep): RegionEntry => {
  const w = e.writes[0], n = w ? Math.round(Math.sqrt((w[1] - w[0]) / 4)) : 0;
  const layer = e.op === NpuOp.Layer && w && e.reads.length >= 3 ? { w: e.reads[1]![0], x: e.reads[2]![0], out: w[0], bias: e.reads[3]?.[0] ?? NPU_NO_BIAS, n } : undefined;
  return { op: e.op, a: e.a, b: e.b, ...(layer ? { layer } : {}) };
};

/** The length of a launch's replay (ms). */
export const replayLength = (steps: readonly NpuStep[]): number => 2 * REPLAY_HOP_MS + steps.reduce((n, e) => n + replayStepMs(e), 0);

/** A finished launch (its steps, in order) `t` ms into its replay. */
export function replayShow(steps: readonly NpuStep[], v: NpuView, t: number, ms: number): NpuShow {
  const K = v.grid, K2 = K * K, total = steps.reduce((n, e) => n + replayStepMs(e), 0), first = steps[0]!, last = steps[steps.length - 1]!;
  const base = { ...liveShow(v, ms), grid: K, replay: true, busy: true, count: first.count, list: steps.map((e) => ({ op: e.op, a: e.a, b: e.b })), regions: regionsOf(steps.map(entryOf), K, v.descAt, first.count) };
  const zeros = new Array<number>(K2).fill(0);
  if (t < REPLAY_HOP_MS) return { ...base, phase: 'in', progress: unit(t / REPLAY_HOP_MS), index: -1, step: null, acc: zeros, prevAcc: zeros, tiles: [false, false, false, false], cycles: 0, done: false, error: false, fault: 0 };
  let at = t - REPLAY_HOP_MS, cycles = 0;
  const tiles = [false, false, false, false];
  for (const e of steps) {
    const len = replayStepMs(e);
    if (e.op === NpuOp.Load && e.a >= 0 && e.a < tiles.length && !e.fault && at > 0) tiles[e.a] = true;
    if (at < len) {
      const p = at / len;
      return { ...base, phase: 'run', progress: 1, index: e.index, step: stepShow(e, p), acc: e.acc, prevAcc: accBefore(steps, e.run, e.index, K2), tiles, cycles: cycles + Math.floor(e.cost * p), done: false, error: false, fault: 0 };
    }
    at -= len;
    cycles += e.cost;
  }
  const fault = steps.some((e) => e.fault);
  return {
    ...base, phase: 'out', progress: unit((t - REPLAY_HOP_MS - total) / REPLAY_HOP_MS), index: last.index, step: stepShow(last, 1), acc: last.acc, prevAcc: accBefore(steps, last.run, last.index, K2),
    tiles, cycles, done: !fault, error: fault, fault: fault ? GpuFaultCode.Kernel : 0,
  };
}

export class NpuPlayer {
  private seen = -1;
  private live = new Set<number>();
  private queue: NpuStep[][] = [];
  private cur: NpuStep[] | null = null;
  private t = 0;
  /** The newest snapshot. */
  private v: NpuView | undefined;

  /** Take the newest snapshot; the launches that finished since the last one wait for their replay (the first sight of a card replays nothing, nor does a launch seen in flight). */
  feed(v: NpuView | undefined): void {
    this.v = v;
    if (!v) { this.seen = -1; this.queue = []; this.cur = null; this.live.clear(); return; }
    const top = v.log.length ? v.log[v.log.length - 1]!.seq : 0;
    if (this.seen < 0) { this.seen = top; return; }
    if (v.busy) this.live.add(v.run);
    const fresh = v.log.filter((e) => e.seq > this.seen && !this.live.has(e.run));
    this.seen = Math.max(this.seen, top);
    if (!v.busy) {
      // the launches whose steps came in since the last look, each in order
      for (const run of new Set(fresh.map((e) => e.run))) this.queue.push(fresh.filter((e) => e.run === run));
      if (this.queue.length > REPLAY_QUEUE) this.queue = this.queue.slice(-REPLAY_QUEUE);
      if (this.live.size > 8) this.live = new Set([...this.live].slice(-4));
    }
  }

  /** Move the replay on by `dtMs`; a launch in flight in the card itself is shown live instead and the queue waits. */
  advance(dtMs: number): void {
    if (this.v?.busy) return;
    if (!this.cur && this.queue.length) { this.cur = this.queue.shift()!; this.t = 0; }
    if (!this.cur) return;
    this.t += dtMs;
    if (this.t >= replayLength(this.cur)) this.cur = null;
  }

  get replaying(): boolean { return !!this.cur && !this.v?.busy; }

  /** Names the launch on show (a replayed one, or the card's own count of launches), so a view can tell a new launch from the same one a frame later. */
  get token(): string { return this.replaying ? `r${this.cur![0]!.seq}` : `l${this.v?.launches ?? 0}`; }

  /** The card as it should look now, or null without a card. */
  show(ms: number): NpuShow | null {
    const v = this.v;
    if (!v) return null;
    if (this.cur && !v.busy) return replayShow(this.cur, v, this.t, ms);
    return liveShow(v, ms);
  }
}
