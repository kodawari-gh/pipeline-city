import { describe, expect, it } from 'vitest';
import { assemble } from '../../sim/asm';
import { createEngine } from '../../sim/engines';
import type * as engineTypes from '../../sim/engines';
import { Machine } from '@/core/sim';
import { traceOf } from '../../sim/pipesnap';
import type * as snapTypes from '../../sim/pipesnap';
import { planInput } from '../core/cpuplan';
import type * as planTypes from '../core/cpuplan';
import { cpuPlan } from '../core/cpuplans';
import { CYCLES_PER_SEC, Hosts, packetsFor, Player, pointAt, routeBetween } from './diemotion';
import { EngineRoot } from '../../sim/engines/root';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** The timed engine `cfg` builds (every kind but the reference one is one). */
function pipelineOf(cfg: engineTypes.EngineConfig): engineTypes.PipelineEngine {
  const e = createEngine(cfg);
  if (!(e instanceof EngineRoot)) {
    throw new TypeError(`${cfg.kind} is not a timed engine`);
  }
  return e;
}

// The die's motion (docs/DIE.md "Motion"), against the real engines: every instruction glides along real wires, the replay is smooth,
// and the data that moves with it travels on links that exist.

const SRC = `
  li s0, 4096
  li t0, 0
  li t1, 40
loop:
  lw   a0, 0(s0)
  add  a1, a1, a0
  mul  a2, a1, a1
  sw   a2, 4(s0)
  addi t0, t0, 1
  addi s0, s0, 16
  bne  t0, t1, loop
  ecall`;

/** An engine config with a timed engine (every kind but the reference one), so it takes timing settings. */
type TimedConfig = Exclude<engineTypes.EngineConfig, { kind: 'ref' }>;

const CONFIGS: { name: string; cfg: TimedConfig; plan: planTypes.PlanInput }[] = [
  { name: 'unpipelined', cfg: { kind: 'unpipelined' }, plan: planInput({ kind: 'unpipelined' }) },
  {
    name: 'inorder',
    cfg: { kind: 'inorder', forwarding: false },
    plan: planInput({ kind: 'inorder', forwarding: false, cacheLines: 8 }),
  },
  {
    name: 'inorder2 +caches',
    cfg: { kind: 'inorder2', forwarding: true, cacheLines: 16, icacheLines: 8, l2Lines: 32 },
    plan: planInput({ kind: 'inorder2', forwarding: true, cacheLines: 16, icacheLines: 8, l2Lines: 32 }),
  },
  {
    name: 'ooo',
    cfg: { kind: 'ooo', robSize: 8, commitWidth: 4, cacheLines: 16 },
    plan: planInput({ kind: 'ooo', robSize: 8, commitWidth: 4, cacheLines: 16 }),
  },
  {
    name: 'ooo wide',
    cfg: {
      kind: 'ooo',
      width: 4,
      robSize: 32,
      schedSize: 16,
      fetchQueue: 8,
      cacheLines: 64,
      icacheLines: 32,
      l2Lines: 128,
    },
    plan: planInput({
      kind: 'ooo',
      width: 4,
      robSize: 32,
      schedSize: 16,
      fetchQueue: 8,
      cacheLines: 64,
      icacheLines: 32,
      l2Lines: 128,
    }),
  },
];

function trace(cfg: TimedConfig, cycles: number): snapTypes.TraceSnap {
  const e = pipelineOf({ ...cfg, missPenalty: 6 });
  const m = new Machine();
  m.attach(e, assemble(SRC).program);
  for (let i = 0; i < cycles && !e.halted; i++) {
    e.step();
  }
  return traceOf(e.view, e.cycle);
}

/** Every step an instruction of `tr` takes from one stage to another (not idle, not killed, not staying). */
function stepsOf(tr: snapTypes.TraceSnap) {
  const out: { id: number; op: string; a: string; b: string }[] = [];
  for (const r of tr.rows) {
    const op = must(r.text.split(' ')[0]);
    for (let k = 0; k + 1 < tr.n; k++) {
      const a = must(r.codes[k]),
        b = must(r.codes[k + 1]);
      if (a !== ' ' && b !== ' ' && a !== 'x' && b !== 'x' && a !== b) {
        out.push({ id: r.id, op, a, b });
      }
    }
  }
  return out;
}

/** Is the point (x, y) on a trace of `plan` (an end of a link, or a point along one)? */
function onTrace(plan: planTypes.CpuPlan, x: number, y: number): boolean {
  return plan.links.some((l) =>
    l.pts.slice(1).some((v, i) => {
      const [ax, ay] = must(l.pts[i]),
        [bx, by] = v;
      const dx = bx - ax,
        dy = by - ay,
        len2 = dx * dx + dy * dy || 1,
        t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) < 0.5;
    }),
  );
}

/** Plays `frames` frames of `p`, 16 ms apart after `start`: where each chip is in every frame. */
function playFrames(p: Player, start: number, frames: number) {
  const out: { key: string; x: number; y: number; alpha: number }[][] = [];
  for (let f = 1; f <= frames; f++) {
    out.push(p.update(start + f * 16).chips.map((c) => ({ key: c.key, x: c.x, y: c.y, alpha: c.alpha })));
  }
  return out;
}

/** How far each chip moved since the frame before, for the chips that were in it. */
function hopsOf(frames: ReturnType<typeof playFrames>) {
  const out: { key: string; f: number; d: number }[] = [];
  for (let f = 1; f < frames.length; f++) {
    const prev = new Map(must(frames[f - 1]).map((c) => [c.key, c]));
    for (const c of must(frames[f])) {
      const q = prev.get(c.key);
      if (q) {
        out.push({ key: c.key, f, d: Math.hypot(c.x - q.x, c.y - q.y) });
      }
    }
  }
  return out;
}

/** Two hundred frames of a fresh player of `tr`, as text. */
function replay(plan: planTypes.CpuPlan, tr: snapTypes.TraceSnap): string {
  const p = new Player(plan);
  p.push(tr);
  const out: string[] = [];
  for (let f = 1; f <= 200; f++) {
    out.push(
      JSON.stringify(p.update(f * 16).chips.map((c) => [c.key, Math.round(c.x), Math.round(c.y), c.alpha.toFixed(2)])),
    );
  }
  return out.join('|');
}

/** Plays `p` a frame (16 ms) at a time from `now` until its window changes, for at most 600 frames: the window it ends on, the clock, and how many frames showed a fading window. */
function playToNextWindow(p: Player, now: number, from: number) {
  let t = now,
    w = from,
    fading = 0;
  for (let f = 0; f < 600 && w === from; f++) {
    const fr = p.update((t += 16));
    w = fr.window;
    fading += fr.fading.length > 0 ? 1 : 0;
  }
  return { now: t, window: w, fading };
}

/** A stored window of `n` cycles that ends at `end`, with one instruction fetching all along. */
const win = (end: number, n = 24) => ({
  end,
  n,
  rows: [{ id: end, pc: 0, text: 'addi a0, a0, 1', codes: 'F'.repeat(n) }],
});

describe.each(CONFIGS)('motion: $name', ({ cfg, plan: pi }) => {
  const plan: planTypes.CpuPlan = cpuPlan(pi);
  const tr = trace(cfg, 200);

  it('every step an instruction takes between two blocks has a route along the wires', () => {
    const H = new Hosts(plan);
    const steps = stepsOf(tr);
    for (const { id, op, a, b } of steps) {
      const ha = H.host(a, 0, op, id),
        hb = H.host(b, 0, op, id);
      expect(ha, `${a} host`).not.toBeNull();
      expect(hb, `${b} host`).not.toBeNull();
      const rt = routeBetween(plan, must(ha).block.id, must(hb).block.id);
      expect(rt, `${a}->${b}: ${must(ha).block.id} to ${must(hb).block.id}`).not.toBeNull();
      expect(must(rt).len).toBeGreaterThan(0);
    }
    expect(steps.length).toBeGreaterThan(10);
  });

  it('a pulse is only ever on a trace of the die (an end of a link, or a point along one), never across a block', () => {
    const p = new Player(plan);
    p.push(tr);
    const pulses: { x: number; y: number }[] = [];
    for (let f = 1; f <= 600; f++) {
      for (const c of p.update(1000 + f * 16).chips.filter((ch) => ch.wx !== undefined)) {
        pulses.push({ x: must(c.wx), y: must(c.wy) });
      }
    }
    expect(pulses.length).toBeGreaterThan(20);
    expect(pulses.filter((q) => !onTrace(plan, q.x, q.y))).toStrictEqual([]);
  });

  it('the replay is continuous: no chip moves more than a short hop between two frames, and all stay on the die', () => {
    const p = new Player(plan);
    p.push(tr);
    const frames = playFrames(p, 1000, 600);
    for (const c of frames.flat()) {
      expect(c.x, `chip ${c.key}`).toBeGreaterThanOrEqual(plan.die.x);
      expect(c.x, `chip ${c.key}`).toBeLessThanOrEqual(plan.die.x + plan.die.w);
      expect(c.y, `chip ${c.key}`).toBeGreaterThanOrEqual(plan.die.y);
      expect(c.y, `chip ${c.key}`).toBeLessThanOrEqual(plan.die.y + plan.die.h);
      expect(c.alpha).toBeGreaterThanOrEqual(0);
      expect(c.alpha).toBeLessThanOrEqual(1.0001);
    }
    const hops = hopsOf(frames);
    for (const h of hops) {
      // a chip crosses at most a die's width in one cycle: at 60 fps that is far under this
      expect(h.d, `${h.key} frame ${h.f}`).toBeLessThan(plan.die.w / (CYCLES_PER_SEC * 2));
    }
    expect(frames).toHaveLength(600);
    expect(hops.filter((h) => h.d > 0.5).length).toBeGreaterThan(100); // things really move, frame after frame
  });

  it('plays CYCLES_PER_SEC cycles a second and ticks once per cycle', () => {
    const p = new Player(plan);
    p.push(tr);
    let now = 5000;
    p.update(now);
    const t0 = p.update(now + 1).tau;
    const ticked: boolean[] = [];
    for (let i = 0; i < 60; i++) {
      now += 1000 / 60;
      ticked.push(p.update(now).tick);
    }
    const ticks = ticked.filter(Boolean).length;
    const dt = p.update(now + 1).tau - t0;
    expect(dt).toBeGreaterThan(CYCLES_PER_SEC * 0.9);
    expect(dt).toBeLessThan(CYCLES_PER_SEC * 1.2);
    expect(ticks).toBeGreaterThanOrEqual(Math.floor(CYCLES_PER_SEC) - 1);
    expect(ticks).toBeLessThanOrEqual(Math.ceil(CYCLES_PER_SEC) + 1);
  });

  it('is deterministic', () => {
    expect(replay(plan, tr)).toBe(replay(plan, tr));
  });

  it('the packets a beat sends all travel on links of the plan', () => {
    const p = new Player(plan);
    p.push(tr);
    let sent = 0;
    const kinds = new Set<string>();
    for (let f = 1; f < 700; f++) {
      for (const ev of p.update(f * 16).beats) {
        kinds.add(ev.to);
        for (const pk of packetsFor(plan, ev)) {
          expect(plan.links).toContain(pk.link);
          expect(pk.delay).toBeGreaterThanOrEqual(0);
          sent++;
        }
      }
    }
    expect(sent).toBeGreaterThan(15);
    expect(kinds.has('F')).toBe(true);
  });
});

describe('the window handover', () => {
  const plan = cpuPlan(must(CONFIGS[1]).plan);
  const a = trace(must(CONFIGS[1]).cfg, 100),
    b = trace(must(CONFIGS[1]).cfg, 160);

  it('waits for the window to finish, then starts the newest with the old one fading', () => {
    const p = new Player(plan);
    p.push(a);
    let now = 0;
    p.update((now += 16));
    p.push(b); // arrives while the first still plays
    const w0 = p.update((now += 16)).window;
    const played = playToNextWindow(p, now, w0);
    ({ now } = played);
    expect(played.window).not.toBe(w0);
    // after the switch the old window fades for about half a second
    const after: number[] = [];
    for (let f = 0; f < 20; f++) {
      after.push(p.update((now += 16)).fading.length);
    }
    expect(played.fading + after.filter((n) => n > 0).length).toBeGreaterThan(5);
    // the new window starts at its first cycle
    expect(p.update((now += 16)).tau).toBeLessThan(CYCLES_PER_SEC);
  });

  it('with nothing newer it holds the last frame instead of looping', () => {
    const p = new Player(plan);
    p.push(a);
    let now = 0;
    let fr = p.update((now += 16));
    for (let f = 0; f < 1200; f++) {
      fr = p.update((now += 16));
    }
    expect(fr.window).toBe(1);
    expect(fr.tau).toBeLessThan(a.n + 1);
  });

  it('a paused clock freezes it exactly', () => {
    const p = new Player(plan);
    p.push(a);
    p.update(1000);
    const x = JSON.stringify(p.update(1500).chips);
    expect(JSON.stringify(p.update(1500).chips)).toBe(x);
  });

  it('ignores a trace it already has and an empty one', () => {
    const p = new Player(plan);
    const traces: (snapTypes.TraceSnap | undefined)[] = [a, a, undefined, { end: 5, n: 24, rows: [] }];
    for (const seg of traces) {
      p.push(seg);
    }
    p.update(0);
    p.update(100);
    expect(p.update(200).window).toBe(1);
  });
});

describe('routes and points', () => {
  const plan = cpuPlan(must(CONFIGS[1]).plan);
  it('fetch to write-back runs through the pipeline registers in order', () => {
    const rt = must(routeBetween(plan, 'fetch', 'wb'));
    expect(rt).not.toBeNull();
    const ids = rt.links.map((l) => l.link.id);
    expect(ids.join(' ')).toMatch(/if-l0.*l0-dec.*dec-l1.*l1-alu.*alu-l2.*l2-lsu.*lsu-l3.*l3-wb/u);
  });

  it('pointAt walks a polyline by length', () => {
    const pts: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    expect(pointAt(pts, 0)).toStrictEqual([0, 0]);
    expect(pointAt(pts, 0.5)).toStrictEqual([10, 0]);
    expect(pointAt(pts, 1)).toStrictEqual([10, 10]);
    expect(pointAt(pts, 0.75)).toStrictEqual([10, 5]);
    expect(pointAt([[3, 4]], 0.5)).toStrictEqual([3, 4]);
  });

  it('there is no route to a block that does not exist', () => {
    expect(routeBetween(plan, 'fetch', 'nope')).toBeNull();
  });
});

describe('stepping a paused die', () => {
  it('shows a window that arrives while paused at once, at its last cycle, and keeps a history to seek in', () => {
    const plan = cpuPlan(must(CONFIGS[1]).plan);
    const p = new Player(plan);
    let now = 0;
    p.push(win(100));
    p.update((now += 16), true);
    expect(p.shown()).toBe(100);
    p.push(win(101));
    p.update((now += 16), true);
    expect(p.shown()).toBe(101); // the step moved the die, though game time did not run
    expect(p.range()).toStrictEqual({ lo: 77, hi: 101 });
    expect(p.seek(90)).toBe(true);
    p.update((now += 16), true);
    expect(p.shown()).toBe(90);
    expect(p.seek(500)).toBe(false);
  });
});
