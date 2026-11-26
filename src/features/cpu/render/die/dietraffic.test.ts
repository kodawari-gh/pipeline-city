import { describe, expect, it } from 'vitest';
import { snap } from '@/core/ui/testdata';
import { Machine } from '@/core/sim';
import { assemble } from '../../sim/asm';
import { createEngine, InOrderEngine, OooEngine, UnpipelinedEngine } from '../../sim/engines';
import type * as engineTypes from '../../sim/engines';
import { pipeSnapOf } from '../../sim/pipesnap';
import type * as snapTypes from '../../sim/pipesnap';
import { planInput } from '../core/cpuplan';
import { cpuPlan } from '../core/cpuplans';
import { CYCLES_PER_SEC } from './diemotion';
import { DieTraffic, accessTouch, fetchTouch } from './dietraffic';
import type * as trafficTypes from './dietraffic';

/** The timed engine `cfg` builds (every kind but the reference one is one). */
function pipelineOf(cfg: engineTypes.EngineConfig): engineTypes.PipelineEngine {
  const e = createEngine(cfg);
  if (!(e instanceof InOrderEngine || e instanceof OooEngine || e instanceof UnpipelinedEngine)) {
    throw new TypeError(`${cfg.kind} is not a timed engine`);
  }
  return e;
}

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

/** An engine config with a timed engine (every kind but the reference one), so it takes timing settings. */
type TimedConfig = Exclude<engineTypes.EngineConfig, { kind: 'ref' }>;

const ENGINES: { name: string; cfg: TimedConfig }[] = [
  { name: 'in-order', cfg: { kind: 'inorder', forwarding: true, cacheLines: 16 } },
  { name: 'out-of-order', cfg: { kind: 'ooo', robSize: 16, width: 2, cacheLines: 16 } },
];

/** What the worker sends for one pipeline after `cycles` cycles of the loop: the recent cycles and the writes of the window. */
function snapOf(cfg: TimedConfig, cycles: number): snapTypes.PipeSnap {
  const e = pipelineOf({ ...cfg, missPenalty: 6 });
  const m = new Machine();
  m.attach(e, assemble(SRC).program);
  for (let i = 0; i < cycles && !e.halted; i++) {
    e.step();
  }
  return pipeSnapOf(e, m.ram);
}

/** The frame times of `seconds` of game time from `from`, a frame at a time (60 a second). */
function frameTimes(from: number, seconds: number): number[] {
  const out: number[] = [];
  for (let now = from; now < from + seconds * 1000; now += 1000 / 60) {
    out.push(now);
  }
  return out;
}

/** Play the frames at `times`, and give what the replay told. */
function record(
  t: DieTraffic,
  times: number[],
  paused: boolean,
): { touches: trafficTypes.MemoryTouch[]; irqs: number[] } {
  const touches: trafficTypes.MemoryTouch[] = [],
    irqs: number[] = [];
  t.onMemory = (e) => {
    touches.push(e);
  };
  t.onInterrupt = (line) => {
    irqs.push(line);
  };
  for (const now of times) {
    t.frame(now, paused);
  }
  return { touches, irqs };
}

/** Play `seconds` of game time from `from`, a frame at a time (60 a second), and give what the replay told. */
const play = (t: DieTraffic, from: number, seconds: number) => record(t, frameTimes(from, seconds), false);
/** The same, with the game paused. */
const playPaused = (t: DieTraffic, from: number, seconds: number) => record(t, frameTimes(from, seconds), true);

/** One logical core of a multicore snapshot, on its first thread. */
const live = (o: Omit<snapTypes.CoreLive, 'thread'>): snapTypes.CoreLive => ({ ...o, thread: 0 });

// the window is 24 cycles, played at CYCLES_PER_SEC: a few seconds tell all of it
const SECONDS = 24 / CYCLES_PER_SEC + 2;

/** The touches of a replay of `make()`, as text. */
const touchText = (make: () => DieTraffic): string =>
  play(make(), 1000, SECONDS)
    .touches.map((x) => `${x.kind}:${x.addr}:${Math.round(x.at)}`)
    .join('|');

/** The logical cores the touches were put down to, in order. */
const coresOf = (touches: trafficTypes.MemoryTouch[]) =>
  [...new Set(touches.map((x) => x.core))].toSorted((a, b) => (a ?? -1) - (b ?? -1));

describe.each(ENGINES)('DieTraffic: $name core', ({ cfg }) => {
  const snapshot = snap({ pipe: snapOf(cfg, 120) });
  const make = () => {
    const t = new DieTraffic();
    t.setPlan(cpuPlan(planInput(cfg)));
    t.update(snapshot);
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
    const seen: trafficTypes.MemoryTouch[] = [];
    t.onMemory = (e) => {
      seen.push(e);
    };
    let now = 1000;
    for (let i = 0; i < 400; i++) {
      now += 1000 / 60;
      const before = seen.length;
      t.frame(now);
      for (const e of seen.slice(before)) {
        expect(e.at).toBeGreaterThanOrEqual(now);
      }
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
    t.update(snap({ pipe: { width: 1, stages: [] } }));
    expect(play(t, 0, 2).touches).toStrictEqual([]);
  });

  it('holds still while the game is paused: the cycles it has not played stay unplayed', () => {
    const t = make();
    const stopped = playPaused(t, 1000, 5).touches.length;
    const run = play(make(), 1000, 5).touches.length;
    expect(stopped).toBeLessThan(run);
  });

  it('is the same every time it is played', () => {
    expect(touchText(make)).toBe(touchText(make));
  });

  it('stops when the CPU goes: no plan, no replay', () => {
    const t = make();
    t.setPlan(null);
    t.update(snapshot);
    expect(play(t, 1000, SECONDS).touches).toStrictEqual([]);
  });
});

describe('fetchTouch and accessTouch', () => {
  it('a fetch reaches for the instruction at its address, a little after the beat', () => {
    const t = fetchTouch(0x40, 'alu', 1000);
    expect(t).toMatchObject({ kind: 'fetch', addr: 0x40, cls: 'alu' });
    expect(t.at).toBeGreaterThan(1000);
  });

  it('a logged load is a load and a logged store a store, at the address the engine used', () => {
    expect(accessTouch({ a: 0, b: 0x10_04 }, 0)).toMatchObject({ kind: 'load', addr: 0x10_04, cls: 'ld' });
    expect(accessTouch({ a: 1, b: 0x20_00 }, 0)).toMatchObject({ kind: 'store', addr: 0x20_00, cls: 'st' });
  });

  it('reads the address as an unsigned word (a device window is up in the high half)', () => {
    expect(accessTouch({ a: 0, b: -4 }, 0).addr).toBe(0xff_ff_ff_fc);
  });
});

describe('DieTraffic on a multicore die', () => {
  const cfg: TimedConfig = { kind: 'inorder', forwarding: true, cacheLines: 8 };
  const make = (lives: snapTypes.CoreLive[]) => {
    const t = new DieTraffic();
    t.setPlan(cpuPlan(planInput(cfg, { cores: 2, l2Lines: 32 })));
    t.update(snap({ cores: { selected: 0, live: lives, tiles: [snapOf(cfg, 120), snapOf(cfg, 150)] } }));
    return t;
  };

  it('replays each hardware core, and puts its reaches down to the logical core that runs on it', () => {
    const { touches } = play(
      make([live({ core: 0, hw: 0, parked: false, job: 1 }), live({ core: 1, hw: 1, parked: false, job: 2 })]),
      1000,
      SECONDS,
    );
    expect(coresOf(touches)).toStrictEqual([0, 1]);
    expect(touches.filter((x) => x.core === 0).length).toBeGreaterThan(5);
    expect(touches.filter((x) => x.core === 1).length).toBeGreaterThan(5);
  });

  it('on a hardware core that holds several logical ones, the one with a job is the one named', () => {
    const { touches } = play(
      make([
        live({ core: 0, hw: 0, parked: true, job: 0 }),
        live({ core: 1, hw: 0, parked: false, job: 3 }),
        live({ core: 2, hw: 1, parked: false, job: 2 }),
      ]),
      1000,
      SECONDS,
    );
    expect(new Set(touches.map((x) => x.core))).toStrictEqual(new Set([1, 2]));
  });

  it('a die with no snapshot of its cores is silent', () => {
    const t = new DieTraffic();
    t.setPlan(cpuPlan(planInput(cfg, { cores: 2, l2Lines: 32 })));
    t.update(snap());
    expect(play(t, 0, 2).touches).toStrictEqual([]);
  });
});
