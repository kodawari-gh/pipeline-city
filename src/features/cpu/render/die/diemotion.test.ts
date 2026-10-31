import { describe, expect, it } from 'vitest';
import { assemble } from '../../sim/asm';
import { createEngine, type EngineConfig, type PipelineEngine } from '../../sim/engines';
import { Machine } from '@/core/sim';
import { traceOf, type TraceSnap } from '../../sim/pipesnap';
import type { CpuPlan, PlanInput } from '../core/cpuplan';
import { planInput } from '../core/cpuplan';
import { cpuPlan } from '../core/cpuplans';
import { CYCLES_PER_SEC, Hosts, packetsFor, Player, pointAt, routeBetween } from './diemotion';

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

const CONFIGS: { name: string; cfg: EngineConfig; plan: PlanInput }[] = [
  { name: 'unpipelined', cfg: { kind: 'unpipelined' }, plan: planInput({ kind: 'unpipelined' }) },
  { name: 'inorder', cfg: { kind: 'inorder', forwarding: false }, plan: planInput({ kind: 'inorder', forwarding: false, cacheLines: 8 }) },
  { name: 'inorder2 +caches', cfg: { kind: 'inorder2', forwarding: true, cacheLines: 16, icacheLines: 8, l2Lines: 32 }, plan: planInput({ kind: 'inorder2', forwarding: true, cacheLines: 16, icacheLines: 8, l2Lines: 32 }) },
  { name: 'ooo', cfg: { kind: 'ooo', robSize: 8, commitWidth: 4, cacheLines: 16 }, plan: planInput({ kind: 'ooo', robSize: 8, commitWidth: 4, cacheLines: 16 }) },
  { name: 'ooo wide', cfg: { kind: 'ooo', width: 4, robSize: 32, schedSize: 16, fetchQueue: 8, cacheLines: 64, icacheLines: 32, l2Lines: 128 }, plan: planInput({ kind: 'ooo', width: 4, robSize: 32, schedSize: 16, fetchQueue: 8, cacheLines: 64, icacheLines: 32, l2Lines: 128 }) },
];

function trace(cfg: EngineConfig, cycles: number): TraceSnap {
  const e = createEngine({ ...cfg, missPenalty: 6 } as EngineConfig) as PipelineEngine;
  const m = new Machine();
  m.attach(e, assemble(SRC).program);
  for (let i = 0; i < cycles && !e.halted; i++) e.step();
  return traceOf(e.view, e.cycle);
}

describe.each(CONFIGS)('motion: $name', ({ cfg, plan: pi }) => {
  const plan: CpuPlan = cpuPlan(pi);
  const tr = trace(cfg, 200);

  it('every step an instruction takes between two blocks has a route along the wires', () => {
    const H = new Hosts(plan);
    let steps = 0;
    for (const r of tr.rows) {
      const op = r.text.split(' ')[0]!;
      for (let k = 0; k + 1 < tr.n; k++) {
        const a = r.codes[k]!, b = r.codes[k + 1]!;
        if (a === ' ' || b === ' ' || a === 'x' || b === 'x' || a === b) continue;
        const ha = H.host(a, 0, op, r.id), hb = H.host(b, 0, op, r.id);
        expect(ha, `${a} host`).not.toBeNull();
        expect(hb, `${b} host`).not.toBeNull();
        const rt = routeBetween(plan, ha!.block.id, hb!.block.id);
        expect(rt, `${a}->${b}: ${ha!.block.id} to ${hb!.block.id}`).not.toBeNull();
        expect(rt!.len).toBeGreaterThan(0);
        steps++;
      }
    }
    expect(steps).toBeGreaterThan(10);
  });

  it('a pulse is only ever on a trace of the die (an end of a link, or a point along one), never across a block', () => {
    const p = new Player(plan);
    p.push(tr);
    const segs: [number, number, number, number][] = [];
    for (const l of plan.links) for (let i = 1; i < l.pts.length; i++) segs.push([l.pts[i - 1]![0], l.pts[i - 1]![1], l.pts[i]![0], l.pts[i]![1]]);
    const near = (x: number, y: number) => segs.some(([ax, ay, bx, by]) => {
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) < 0.5;
    });
    let now = 1000, seen = 0, off = 0;
    for (let f = 0; f < 600; f++) {
      now += 16;
      for (const c of p.update(now).chips) {
        if (c.wx === undefined) continue;
        seen++;
        if (!near(c.wx, c.wy!)) off++;
      }
    }
    expect(seen).toBeGreaterThan(20);
    expect(off).toBe(0);
  });

  it('the replay is continuous: no chip moves more than a short hop between two frames, and all stay on the die', () => {
    const p = new Player(plan);
    p.push(tr);
    let now = 1000;
    let prev = new Map<string, { x: number; y: number }>();
    let moved = 0, frames = 0;
    for (let f = 0; f < 600; f++) {
      now += 16;
      const fr = p.update(now);
      const cur = new Map<string, { x: number; y: number }>();
      for (const c of fr.chips) {
        expect(c.x, c.key).toBeGreaterThanOrEqual(plan.die.x);
        expect(c.x, c.key).toBeLessThanOrEqual(plan.die.x + plan.die.w);
        expect(c.y, c.key).toBeGreaterThanOrEqual(plan.die.y);
        expect(c.y, c.key).toBeLessThanOrEqual(plan.die.y + plan.die.h);
        expect(c.alpha).toBeGreaterThanOrEqual(0);
        expect(c.alpha).toBeLessThanOrEqual(1.0001);
        const q = prev.get(c.key);
        if (q) {
          const d = Math.hypot(c.x - q.x, c.y - q.y);
          // a chip crosses at most a die's width in one cycle: at 60 fps that is far under this
          expect(d, `${c.key} frame ${f}`).toBeLessThan(plan.die.w / (CYCLES_PER_SEC * 2));
          if (d > 0.5) moved++;
        }
        cur.set(c.key, { x: c.x, y: c.y });
      }
      prev = cur;
      frames++;
    }
    expect(frames).toBe(600);
    expect(moved).toBeGreaterThan(100); // things really move, frame after frame
  });

  it('plays CYCLES_PER_SEC cycles a second and ticks once per cycle', () => {
    const p = new Player(plan);
    p.push(tr);
    let now = 5000, ticks = 0;
    p.update(now);
    const t0 = p.update(now + 1).tau;
    for (let i = 0; i < 60; i++) { now += 1000 / 60; if (p.update(now).tick) ticks++; }
    const dt = p.update(now + 1).tau - t0;
    expect(dt).toBeGreaterThan(CYCLES_PER_SEC * 0.9);
    expect(dt).toBeLessThan(CYCLES_PER_SEC * 1.2);
    expect(ticks).toBeGreaterThanOrEqual(Math.floor(CYCLES_PER_SEC) - 1);
    expect(ticks).toBeLessThanOrEqual(Math.ceil(CYCLES_PER_SEC) + 1);
  });

  it('is deterministic', () => {
    const run = () => {
      const p = new Player(plan);
      p.push(tr);
      const out: string[] = [];
      for (let f = 1; f <= 200; f++) out.push(JSON.stringify(p.update(f * 16).chips.map((c) => [c.key, Math.round(c.x), Math.round(c.y), c.alpha.toFixed(2)])));
      return out.join('|');
    };
    expect(run()).toBe(run());
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
  const plan = cpuPlan(CONFIGS[1]!.plan);
  const a = trace(CONFIGS[1]!.cfg, 100), b = trace(CONFIGS[1]!.cfg, 160);

  it('waits for the window to finish, then starts the newest with the old one fading', () => {
    const p = new Player(plan);
    p.push(a);
    let now = 0;
    p.update(now += 16);
    p.push(b); // arrives while the first still plays
    const w0 = p.update(now += 16).window;
    let fading = 0, w1 = w0;
    for (let f = 0; f < 600 && w1 === w0; f++) { const fr = p.update(now += 16); w1 = fr.window; if (fr.fading.length) fading++; }
    expect(w1).not.toBe(w0);
    // after the switch the old window fades for about half a second
    for (let f = 0; f < 20; f++) { if (p.update(now += 16).fading.length) fading++; }
    expect(fading).toBeGreaterThan(5);
    // the new window starts at its first cycle
    expect(p.update(now += 16).tau).toBeLessThan(CYCLES_PER_SEC);
  });

  it('with nothing newer it holds the last frame instead of looping', () => {
    const p = new Player(plan);
    p.push(a);
    let now = 0;
    let fr = p.update(now += 16);
    for (let f = 0; f < 1200; f++) fr = p.update(now += 16);
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
    p.push(a); p.push(a); p.push(undefined); p.push({ end: 5, n: 24, rows: [] });
    p.update(0); p.update(100);
    expect(p.update(200).window).toBe(1);
  });
});

describe('routes and points', () => {
  const plan = cpuPlan(CONFIGS[1]!.plan);
  it('fetch to write-back runs through the pipeline registers in order', () => {
    const rt = routeBetween(plan, 'fetch', 'wb')!;
    expect(rt).not.toBeNull();
    const ids = rt.links.map((l) => l.link.id);
    expect(ids.join(' ')).toMatch(/if-l0.*l0-dec.*dec-l1.*l1-alu.*alu-l2.*l2-lsu.*lsu-l3.*l3-wb/);
  });

  it('pointAt walks a polyline by length', () => {
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 10]];
    expect(pointAt(pts, 0)).toEqual([0, 0]);
    expect(pointAt(pts, 0.5)).toEqual([10, 0]);
    expect(pointAt(pts, 1)).toEqual([10, 10]);
    expect(pointAt(pts, 0.75)).toEqual([10, 5]);
    expect(pointAt([[3, 4]], 0.5)).toEqual([3, 4]);
  });

  it('there is no route to a block that does not exist', () => {
    expect(routeBetween(plan, 'fetch', 'nope')).toBeNull();
  });
});

describe('stepping a paused die', () => {
  const win = (end: number, n = 24) => ({ end, n, rows: [{ id: end, pc: 0, text: 'addi a0, a0, 1', codes: 'F'.repeat(n) }] });
  it('shows a window that arrives while paused at once, at its last cycle, and keeps a history to seek in', () => {
    const plan = cpuPlan(CONFIGS[1]!.plan);
    const p = new Player(plan);
    let now = 0;
    p.push(win(100)); p.update(now += 16, true);
    expect(p.shown()).toBe(100);
    p.push(win(101)); p.update(now += 16, true);
    expect(p.shown()).toBe(101); // the step moved the die, though game time did not run
    expect(p.range()).toEqual({ lo: 77, hi: 101 });
    expect(p.seek(90)).toBe(true);
    p.update(now += 16, true);
    expect(p.shown()).toBe(90);
    expect(p.seek(500)).toBe(false);
  });
});
