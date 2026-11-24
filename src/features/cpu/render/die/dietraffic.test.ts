import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/protocol';
import { Machine } from '@/core/sim';
import { assemble } from '../../sim/asm';
import { createEngine, type EngineConfig, type PipelineEngine } from '../../sim/engines';
import { pipeSnapOf, type CoreLive, type PipeSnap } from '../../sim/pipesnap';
import { planInput } from '../core/cpuplan';
import { cpuPlan } from '../core/cpuplans';
import { CYCLES_PER_SEC } from './diemotion';
import { DieTraffic, accessTouch, fetchTouch, type MemoryTouch } from './dietraffic';

// What the CPU reaches for, replayed with nothing drawn (docs/render/live.md "Activity"): the fetches, loads and stores of the real engines, told as the
// die's replay passes them, whichever engine the CPU has.

const BASE = 4096;
const SRC = `
  li s0, ${BASE}
  li t0, 0
  li t1, 400
loop:
  lw   a0, 0(s0)
  add  a1, a1, a0
  mul  a2, a1, a1
  sw   a2, 4(s0)
  addi t0, t0, 1
  addi s0, s0, 16
  bne  t0, t1, loop
  ecall`;
const PROGRAM_BYTES = assemble(SRC).program.length * 4;

const ENGINES: { name: string; cfg: EngineConfig }[] = [
  { name: 'in-order', cfg: { kind: 'inorder', forwarding: true, cacheLines: 16 } },
  { name: 'out-of-order', cfg: { kind: 'ooo', robSize: 16, width: 2, cacheLines: 16 } },
];

/** What the worker sends for one pipeline after `cycles` cycles of the loop: the recent cycles and the writes of the window. */
function snapOf(cfg: EngineConfig, cycles: number): PipeSnap {
  const e = createEngine({ ...cfg, missPenalty: 6 } as EngineConfig) as PipelineEngine;
  const m = new Machine();
  m.attach(e, assemble(SRC).program);
  for (let i = 0; i < cycles && !e.halted; i++) e.step();
  return pipeSnapOf(e, m.ram);
}

/** Play `seconds` of game time from `from`, a frame at a time (60 a second), and give what the replay told. */
function play(
  t: DieTraffic,
  from: number,
  seconds: number,
  paused = false,
): { touches: MemoryTouch[]; irqs: number[] } {
  const touches: MemoryTouch[] = [],
    irqs: number[] = [];
  t.onMemory = (e) => touches.push(e);
  t.onInterrupt = (line) => irqs.push(line);
  for (let now = from; now < from + seconds * 1000; now += 1000 / 60) t.frame(now, paused);
  return { touches, irqs };
}

// the window is 24 cycles, played at CYCLES_PER_SEC: a few seconds tell all of it
const SECONDS = 24 / CYCLES_PER_SEC + 2;

describe.each(ENGINES)('DieTraffic: $name core', ({ cfg }) => {
  const snap = { pipe: snapOf(cfg, 120) } as unknown as Snapshot;
  const make = () => {
    const t = new DieTraffic();
    t.setPlan(cpuPlan(planInput(cfg)));
    t.update(snap);
    return t;
  };

  it('tells where the core fetches from: the program, a word at a time', () => {
    const { touches } = play(make(), 1000, SECONDS);
    const fetch = touches.filter((x) => x.kind === 'fetch');
    expect(fetch.length).toBeGreaterThan(10);
    for (const f of fetch) {
      expect(f.addr % 4).toBe(0);
      expect(f.addr).toBeLessThan(PROGRAM_BYTES);
    }
  });

  it('tells the loads and the stores of the loop, at the addresses the engine used', () => {
    const { touches } = play(make(), 1000, SECONDS);
    const loads = touches.filter((x) => x.kind === 'load'),
      stores = touches.filter((x) => x.kind === 'store');
    expect(loads.length).toBeGreaterThan(0);
    expect(stores.length).toBeGreaterThan(0);
    for (const l of loads) {
      expect(l.addr).toBeGreaterThanOrEqual(BASE);
      expect((l.addr - BASE) % 16).toBe(0);
      expect(l.cls).toBe('ld');
    }
    for (const s of stores) {
      expect(s.addr).toBeGreaterThanOrEqual(BASE);
      expect((s.addr - BASE - 4) % 16).toBe(0);
      expect(s.cls).toBe('st');
    }
  });

  it('puts every reach at or after the frame that tells it, never before', () => {
    const t = make();
    const seen: MemoryTouch[] = [];
    t.onMemory = (e) => seen.push(e);
    let now = 1000;
    for (let i = 0; i < 400; i++) {
      now += 1000 / 60;
      const before = seen.length;
      t.frame(now);
      for (const e of seen.slice(before)) expect(e.at).toBeGreaterThanOrEqual(now);
    }
    expect(seen.length).toBeGreaterThan(0);
  });

  it('names no core for a single core', () => {
    const { touches } = play(make(), 1000, SECONDS);
    expect(touches.length).toBeGreaterThan(0);
    expect(touches.every((x) => x.core === undefined)).toBe(true);
  });

  it('tells nothing for a machine with no trace', () => {
    const t = new DieTraffic();
    t.setPlan(cpuPlan(planInput(cfg)));
    t.update({ pipe: { width: 1, stages: [] } } as unknown as Snapshot);
    expect(play(t, 0, 2).touches).toEqual([]);
  });

  it('holds still while the game is paused: the cycles it has not played stay unplayed', () => {
    const t = make();
    const stopped = play(t, 1000, 5, true).touches.length;
    const run = play(make(), 1000, 5).touches.length;
    expect(stopped).toBeLessThan(run);
  });

  it('is the same every time it is played', () => {
    const run = () =>
      play(make(), 1000, SECONDS)
        .touches.map((x) => `${x.kind}:${x.addr}:${Math.round(x.at)}`)
        .join('|');
    expect(run()).toBe(run());
  });

  it('stops when the CPU goes: no plan, no replay', () => {
    const t = make();
    t.setPlan(null);
    t.update(snap);
    expect(play(t, 1000, SECONDS).touches).toEqual([]);
  });
});

describe('fetchTouch and accessTouch', () => {
  it('a fetch reaches for the instruction at its address, a little after the beat', () => {
    const t = fetchTouch(0x40, 'alu', 1000);
    expect(t).toMatchObject({ kind: 'fetch', addr: 0x40, cls: 'alu' });
    expect(t.at).toBeGreaterThan(1000);
  });

  it('a logged load is a load and a logged store a store, at the address the engine used', () => {
    expect(accessTouch({ a: 0, b: 0x1004 }, 0)).toMatchObject({ kind: 'load', addr: 0x1004, cls: 'ld' });
    expect(accessTouch({ a: 1, b: 0x2000 }, 0)).toMatchObject({ kind: 'store', addr: 0x2000, cls: 'st' });
  });

  it('reads the address as an unsigned word (a device window is up in the high half)', () => {
    expect(accessTouch({ a: 0, b: -4 }, 0).addr).toBe(0xfffffffc);
  });
});

describe('DieTraffic on a multicore die', () => {
  const cfg: EngineConfig = { kind: 'inorder', forwarding: true, cacheLines: 8 };
  const live = (core: number, hw: number, parked: boolean, job: number): CoreLive => ({
    core,
    hw,
    parked,
    job,
    thread: 0,
  });
  const make = (lives: CoreLive[]) => {
    const t = new DieTraffic();
    t.setPlan(cpuPlan(planInput(cfg, { cores: 2, l2Lines: 32 })));
    t.update({
      cores: { selected: 0, live: lives, tiles: [snapOf(cfg, 120), snapOf(cfg, 150)] },
    } as unknown as Snapshot);
    return t;
  };

  it('replays each hardware core, and puts its reaches down to the logical core that runs on it', () => {
    const { touches } = play(make([live(0, 0, false, 1), live(1, 1, false, 2)]), 1000, SECONDS);
    expect([...new Set(touches.map((x) => x.core))].sort()).toEqual([0, 1]);
    expect(touches.filter((x) => x.core === 0).length).toBeGreaterThan(5);
    expect(touches.filter((x) => x.core === 1).length).toBeGreaterThan(5);
  });

  it('on a hardware core that holds several logical ones, the one with a job is the one named', () => {
    const { touches } = play(make([live(0, 0, true, 0), live(1, 0, false, 3), live(2, 1, false, 2)]), 1000, SECONDS);
    expect(new Set(touches.map((x) => x.core))).toEqual(new Set([1, 2]));
  });

  it('a die with no snapshot of its cores is silent', () => {
    const t = new DieTraffic();
    t.setPlan(cpuPlan(planInput(cfg, { cores: 2, l2Lines: 32 })));
    t.update({} as unknown as Snapshot);
    expect(play(t, 0, 2).touches).toEqual([]);
  });
});
