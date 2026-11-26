// Timing sanity, observability and determinism of the wide engines (inorder2, ooo).
import { assert, describe, expect, it } from 'vitest';
import { assemble } from '../../asm';
import { generate } from '@/features/jobs/sim/gen';
import { Machine } from '@/core/sim';
import {
  InOrderEngine,
  OooEngine,
  Counter,
  StageCode,
  STAGE_CODE_CHARS,
  Occ,
  RobState,
  Unit,
  createEngine,
} from '../index';
import type * as engineTypes from '../index';
import type { PipelineEngine } from '../contract';
import { genData, genProgram } from '../testgen';
import { runEngine, runProgram } from '../testutil';
import { EngineRoot } from '../root';

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

const C = Counter;
const io1 = (x = {}) => new InOrderEngine({ missPenalty: 0, ...x });
const io2 = (x = {}) => new InOrderEngine({ width: 2, missPenalty: 0, ...x });
const ooo = (x = {}) => new OooEngine(x);

function run(e: PipelineEngine, src: string) {
  const o = runEngine(e, src);
  return { cycles: o.cycles, c: o.counters, regs: o.regs };
}
const indep = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `addi ${['t0', 't1', 't2', 't3', 't4', 's0', 'a0', 'a1'][i % 8]}, zero, ${i + 1}`,
  ).join('\n');

/** Runs `e` to its end: the cycle the instruction at each of `pcs` first retired in (-1: never). */
function retireCycles(e: PipelineEngine, pcs: number[]): number[] {
  const done = pcs.map(() => -1);
  const t = e.view.timeline;
  while (!e.halted) {
    e.step();
    for (let r = 0; r < t.rows; r++) {
      const k = pcs.indexOf(must(t.pc[r]));
      if (k !== -1 && done[k] === -1 && t.codes[r * t.cols + (e.cycle % t.cols)] === StageCode.R) {
        done[k] = e.cycle;
      }
    }
  }
  return done;
}

/** What the occupancy arrays of an out-of-order view hold right now, counted entry by entry. */
function occupancyOf(v: engineTypes.OooView) {
  let rob = 0,
    robWait = 0;
  for (const [i, id] of v.robId.entries()) {
    if (id >= 0) {
      rob++;
      robWait += v.robState[i] === RobState.Waiting ? 1 : 0;
    }
  }
  const busyUnits = [0, 1, 2, 3].filter((u) => must(v.unitId[u]) >= 0);
  return {
    rob,
    robWait,
    sched: v.schedId.filter((id) => id >= 0).length,
    units: busyUnits.length,
    unitsLeft: busyUnits.map((u) => v.unitLeft[u]),
    fetch: v.fetchId.filter((id) => id >= 0).length,
  };
}

/** Runs `e` to its end: the fate of every flushed instruction the timeline showed, each cycle it showed one. */
function flushedFates(e: PipelineEngine): (number | undefined)[] {
  const fates: (number | undefined)[] = [];
  const t = e.view.timeline;
  while (!e.halted) {
    e.step();
    for (let r = 0; r < t.rows; r++) {
      if (t.codes[r * t.cols + (e.cycle % t.cols)] === StageCode.Flushed) {
        fates.push(t.fate[r]);
      }
    }
  }
  return fates;
}

/** Ticks the machine's clock until its engine halts, at most `ticks` times. */
function runClock(m: Machine, ticks: number): void {
  for (let i = 0; i < ticks && !must(m.engine).halted; i++) {
    m.advanceBaseTick();
  }
}

describe('inorder2 pairing', () => {
  it('independent code runs at about two per cycle', () => {
    const src = `${indep(16)}\necall`;
    const a = run(io1(), src),
      b = run(io2(), src);
    expect(b.cycles).toBeLessThan(a.cycles);
    expect(b.c[C.Retired]).toBe(17);
    expect(b.c[C.DualIssues]).toBeGreaterThanOrEqual(7);
    expect(b.cycles).toBeLessThan(0.7 * a.cycles);
  });

  it('RAW and WAW inside a bundle split it', () => {
    const raw = run(io2(), `${'addi t0, t0, 1\n'.repeat(12)}ecall`);
    expect(raw.c[C.DualIssues]).toBeLessThanOrEqual(1); // only the last addi can pair with the ecall
    expect(raw.c[C.PairBreaks]).toBeGreaterThan(0);
    const waw = run(io2(), `${'addi t0, zero, 1\naddi t0, zero, 2\n'.repeat(6)}ecall`);
    expect(waw.c[C.DualIssues]).toBeLessThanOrEqual(1);
  });

  it('only one memory op per bundle', () => {
    const mem = run(io2(), `li s3, 4096\n${'lw t0, 0(s3)\nlw t1, 4(s3)\n'.repeat(4)}ecall`);
    const alu = run(io2(), `li s3, 4096\n${'lw t0, 0(s3)\naddi t1, zero, 1\n'.repeat(4)}ecall`);
    expect(mem.c[C.PairBreaks]).toBeGreaterThan(must(alu.c[C.PairBreaks]));
    expect(alu.cycles).toBeLessThan(mem.cycles);
  });

  it('a branch ends its bundle; load-use still costs one bubble; mispredicts flush', () => {
    const lu = run(io2(), `li s3, 4096\nlw t0, 0(s3)\nadd t1, t0, t0\necall`);
    expect(lu.c[C.StallLoad]).toBe(1);
    const br = run(io2(), `li t0, 1\nbne t0, zero, skip\naddi a0, a0, 1\naddi a0, a0, 2\nskip:\necall`);
    expect(br.c[C.Flushes]).toBe(1);
    expect(br.c[C.StallFlush]).toBe(2);
    expect(br.regs[3]).toBe(0);
  });

  it('shared port still costs fetch bubbles; forwarding off still waits', () => {
    const src = `li s3, 4096\nlw t0, 0(s3)\n${indep(8)}\necall`;
    expect(run(io2({ sharedPort: true }), src).c[C.StallStruct]).toBeGreaterThan(0);
    const nf = run(io2({ forwarding: false }), `li t0, 1\nadd t1, t0, t0\necall`);
    expect(nf.c[C.StallData]).toBeGreaterThan(0);
  });

  it('is faster than width 1 on generated programs', () => {
    for (const t of ['cli', 'cli.scan']) {
      let w1 = 0,
        w2 = 0;
      for (let s = 1; s <= 6; s++) {
        const g = generate(t, s, { scale: 2 });
        const a = new InOrderEngine(),
          b = new InOrderEngine({ width: 2 });
        runProgram(a, g.program);
        runProgram(b, g.program);
        w1 += a.cycle;
        w2 += b.cycle;
      }
      expect(w2).toBeLessThan(w1);
    }
  });
});

describe('ooo timing', () => {
  it('independent instructions overtake a stalled (missing) load', () => {
    const miss = { missPenalty: 12 };
    // Four independent instructions fit in the default ROB: they finish long before the missing load does.
    const src = `li s3, 4096\nlw t0, 0(s3)\nadd t1, t0, t0\n${indep(4)}\necall`;
    const e = ooo(miss);
    new Machine().attach(e, assemble(src).program);
    const done = retireCycles(e, [4, 12 + 4 * 3]);
    const loadDone = must(done[0]),
      lastIndepDone = must(done[1]);
    expect(loadDone).toBeGreaterThan(0);
    expect(lastIndepDone).toBeGreaterThan(0);
    expect(lastIndepDone).toBeLessThan(loadDone - 8);
    // With room to look ahead the miss hides more independent work: faster than inorder2 on the same program.
    const long = `li s3, 4096\nlw t0, 0(s3)\nadd t1, t0, t0\n${indep(24)}\necall`;
    const a = run(new InOrderEngine({ width: 2, ...miss }), long);
    const b = run(ooo({ ...miss, robSize: 32, schedSize: 16, fetchQueue: 8, commitWidth: 4 }), long);
    expect(b.cycles).toBeLessThan(a.cycles - 3);
  });

  it('beats inorder2 on the cache-hostile scan job', () => {
    for (const cfg of [
      {},
      { robSize: 16, schedSize: 8, fetchQueue: 6 },
      { robSize: 32, schedSize: 16, fetchQueue: 8 },
    ]) {
      let cpi2 = 0,
        cpiO = 0;
      for (let s = 1; s <= 6; s++) {
        const g = generate('cli.scan', s, { scale: 4 });
        const a = new InOrderEngine({ width: 2 }),
          b = new OooEngine(cfg);
        runProgram(a, g.program);
        runProgram(b, g.program);
        cpi2 += a.cycle / must(a.view.counters[C.Retired]);
        cpiO += b.cycle / must(b.view.counters[C.Retired]);
      }
      expect(cpiO, `config ${JSON.stringify(cfg)}`).toBeLessThan(cpi2);
    }
  });

  it('bigger structures never hurt and the ROB-full stall shows up when it is tiny', () => {
    const g = generate('cli.scan', 3, { scale: 4 });
    const go = (cfg: object) => {
      const e = new OooEngine(cfg);
      runProgram(e, g.program);
      return e;
    };
    const tiny = go({ robSize: 2, schedSize: 2, fetchQueue: 2 }),
      def = go({}),
      big = go({ robSize: 32, schedSize: 16, fetchQueue: 8 });
    expect(tiny.view.counters[C.StallRobFull]).toBeGreaterThan(0);
    expect(tiny.cycle).toBeGreaterThan(def.cycle);
    expect(big.cycle).toBeLessThanOrEqual(def.cycle);
  });

  it('a mispredicted branch squashes younger work and costs cycles', () => {
    const src = `li t0, 1\nbne t0, zero, skip\naddi a0, a0, 1\naddi a1, a1, 2\naddi a2, a2, 3\nskip:\naddi a3, a3, 4\necall`;
    const wrong = ooo();
    new Machine().attach(wrong, assemble(src).program);
    while (!wrong.halted) {
      wrong.step();
    }
    const right = ooo();
    new Machine().attach(right, assemble(src).program);
    right.flipPredictor(4); // bne at pc 4: predict taken
    while (!right.halted) {
      right.step();
    }
    expect(wrong.view.counters[C.BranchMispredicts]).toBe(1);
    expect(wrong.view.counters[C.FlushedInstrs]).toBeGreaterThan(0);
    expect(right.view.counters[C.Flushes]).toBe(0);
    expect(wrong.cycle - right.cycle).toBeGreaterThanOrEqual(2);
    expect(wrong.cycle - right.cycle).toBeLessThanOrEqual(6);
    expect(wrong.view.counters[C.Retired]).toBe(4);
  });

  it('store-to-load forwarding avoids the cache; loads wait for older stores', () => {
    const fwd = ooo();
    new Machine().attach(fwd, assemble(`li s3, 4096\nli t0, 7\nsw t0, 0(s3)\nlw t1, 0(s3)\necall`).program);
    while (!fwd.halted) {
      fwd.step();
    }
    expect(fwd.view.counters[C.LoadForwards]).toBe(1);
    expect(fwd.view.counters[C.CacheMisses]).toBe(0);
    // The store address comes from a slow mul chain; the load must wait for it.
    const slow = ooo();
    new Machine().attach(
      slow,
      assemble(
        `li s3, 4096\nli t2, 1\nmul t3, t2, t2\nmul t3, t3, t3\naddi t3, t3, -1\nadd t4, s3, t3\nsw t2, 0(t4)\nlw t1, 64(s3)\necall`,
      ).program,
    );
    while (!slow.halted) {
      slow.step();
    }
    expect(slow.view.counters[C.LoadWaits]).toBeGreaterThan(0);
  });

  it('an illegal instruction on the wrong path is harmless, on the right path it throws', () => {
    const wrongPath = run(ooo(), `li t0, 0\nbeq t0, zero, ok\n.word 0\n.word 0\nok:\nli a0, 5\necall`);
    expect(wrongPath.regs[3]).toBe(5);
    expect(() => run(ooo(), `li t0, 1\n.word 0\necall`)).toThrow(RangeError);
  });

  it('rejects bad options', () => {
    expect(() => new OooEngine({ robSize: 1 })).toThrow(RangeError);
    expect(() => new OooEngine({ fetchQueue: 1 })).toThrow(RangeError);
    expect(() => new InOrderEngine({ width: 0 })).toThrow(RangeError);
  });
});

describe('ooo view', () => {
  it('occupancy arrays are consistent every cycle and the timeline uses F D S X R C', () => {
    const g = generate('cli.scan', 2, { scale: 2 });
    const e = new OooEngine({ robSize: 8, schedSize: 4 });
    new Machine().attach(e, g.program);
    const v: engineTypes.OooView = e.view;
    const seen = new Set<number>();
    const t = v.timeline;
    while (!e.halted) {
      e.step();
      const { rob, robWait, sched, units, unitsLeft, fetch } = occupancyOf(v);
      expect(rob).toBe(v.occ[Occ.Rob]);
      expect(sched).toBe(v.occ[Occ.Sched]);
      expect(sched).toBe(robWait); // every waiting ROB entry is in the scheduler
      for (const left of unitsLeft) {
        expect(left).toBeGreaterThan(0);
      }
      expect(units).toBe(v.occ[Occ.Units]);
      expect(fetch).toBe(v.occ[Occ.Fetch]);
      expect(rob).toBeLessThanOrEqual(8);
      for (let r = 0; r < t.rows; r++) {
        seen.add(must(t.codes[r * t.cols + (e.cycle % t.cols)]));
      }
    }
    for (const code of [StageCode.F, StageCode.D, StageCode.S, StageCode.X, StageCode.R, StageCode.C]) {
      expect(seen.has(code), `${STAGE_CODE_CHARS[code]}`).toBe(true);
    }
    expect(v.counters[C.Cycles]).toBe(e.cycle);
    expect(must(v.counters[C.RobOccupancySum]) / e.cycle).toBeGreaterThan(1);
    expect(v.unitId[Unit.LSU]).toBe(-1); // idle at halt
  });

  it('flushed instructions show x and fate Flushed in the timeline', () => {
    const e = ooo();
    new Machine().attach(e, assemble(`li t0, 1\nbne t0, zero, s\naddi a0, a0, 1\naddi a1, a1, 1\ns:\necall`).program);
    const fates = flushedFates(e);
    expect(fates.length).toBeGreaterThan(0);
    for (const fate of fates) {
      expect(fate).toBe(2);
    }
  });
});

describe('determinism', () => {
  it('same seed gives identical cycles and counters on the wide engines; different seeds differ', () => {
    const makers: (() => PipelineEngine)[] = [
      () => new InOrderEngine({ width: 2 }),
      () => new OooEngine(),
      () => pipelineOf({ kind: 'ooo', robSize: 16 }),
    ];
    for (const make of makers) {
      const go = (seed: number) => {
        const o = runEngine(make(), genProgram(seed), genData(seed), { seed, p: 0.1 });
        return JSON.stringify([o.regs, [...o.mem], o.cycles, o.counters]);
      };
      expect(go(5)).toBe(go(5));
      expect(go(5)).not.toBe(go(6));
    }
  });

  it('reset gives a cold, repeatable run', () => {
    const g = generate('cli.scan', 1);
    const e = new OooEngine();
    const m = new Machine();
    m.attach(e, g.program);
    while (!e.halted) {
      e.step();
    }
    const first = [e.cycle, [...e.view.counters]];
    m.attach(e, g.program);
    while (!e.halted) {
      e.step();
    }
    expect([e.cycle, [...e.view.counters]]).toStrictEqual(first);
  });
});

describe('createEngine and the Machine clock', () => {
  it('builds the new kinds and runs them under the scheduler', () => {
    const prog = generate('cli', 3).program;
    for (const cfg of [
      { kind: 'inorder2' },
      { kind: 'inorder2', forwarding: false, sharedPort: true },
      { kind: 'ooo' },
      { kind: 'ooo', robSize: 24, schedSize: 12, fetchQueue: 8 },
    ] as const) {
      const m = new Machine();
      m.attach(createEngine(cfg), prog);
      runClock(m, 400);
      expect(must(m.engine).halted).toBe(true);
    }
    const wide2 = createEngine({ kind: 'inorder2' });
    assert.instanceOf(wide2, InOrderEngine);
    expect(wide2.width).toBe(2);
    expect(createEngine({ kind: 'ooo' })).toBeInstanceOf(OooEngine);
  });
});
