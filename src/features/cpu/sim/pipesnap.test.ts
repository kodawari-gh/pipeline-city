import { describe, expect, it } from 'vitest';
import { assemble } from './asm';
import { createEngine } from './engines';
import type * as engineTypes from './engines';
import { Machine } from '@/core/sim';
import { pipeSnapOf, ramMapOf, RAM_BUCKETS, STEP_TRACE_CYCLES, TRACE_CYCLES } from './pipesnap';
import type * as snapTypes from './pipesnap';
import { Ev } from './engines/events';
import { EngineRoot } from './engines/root';

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

// The die's live state in the snapshot (docs/DIE.md): the stages of an in-order engine per lane, the structures of the out-of-order one.

const SRC = `
  addi t0, zero, 0
  addi t1, zero, 8
loop:
  lw   t2, 0(zero)
  addi t0, t0, 1
  mul  t3, t0, t0
  sw   t3, 4(zero)
  bne  t0, t1, loop
  ecall
`;

function run(engine: engineTypes.PipelineEngine, cycles: number) {
  const m = new Machine();
  m.attach(engine, assemble(SRC).program);
  for (let i = 0; i < cycles && !engine.halted; i++) {
    engine.step();
  }
  return engine;
}

/** Does stage slot `x` hold an instruction with its mnemonic? */
const busy = (x: snapTypes.PipeSnap['stages'][number]): boolean => x.kind === 1 && x.op !== '';

/** Steps the two-wide `e` up to 30 more cycles: did both lanes of some stage hold an instruction at once? */
function bothLanesBusy(e: engineTypes.PipelineEngine): boolean {
  for (let c = 0; c < 30 && !e.halted; c++) {
    e.step();
    const t = pipeSnapOf(e).stages;
    for (let st = 0; st < 5; st++) {
      if (must(t[st * 2]).kind === 1 && must(t[st * 2 + 1]).kind === 1) {
        return true;
      }
    }
  }
  return false;
}

/** One event of the stored window (`StoredSnap.events` is flat [cycle, kind, a, b, c, d]). */
interface Event {
  cycle: number;
  kind: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

/** The flat events of the stored window, split into one tuple each. */
function eventsOf(ev: number[]): Event[] {
  const out: Event[] = [];
  for (let i = 0; i + 6 <= ev.length; i += 6) {
    out.push({
      cycle: must(ev[i]),
      kind: must(ev[i + 1]),
      a: must(ev[i + 2]),
      b: must(ev[i + 3]),
      c: must(ev[i + 4]),
      d: must(ev[i + 5]),
    });
  }
  return out;
}
/** The register writes of the window, oldest first. */
const regWrites = (ev: number[]) =>
  eventsOf(ev)
    .filter((e) => e.kind === Ev.Reg)
    .map((e) => ({ cycle: e.cycle, reg: e.a, now: e.b, old: e.c }));
/** The fills of the data cache (cache 0) in the window, oldest first. */
const dataFills = (ev: number[]) =>
  eventsOf(ev)
    .filter((e) => e.kind === Ev.Fill && e.a === 0)
    .map((e) => ({ cycle: e.cycle, slot: e.b, line: e.c, evicted: e.d }));
/** The slots of a cache that hold a line, with its tag. */
const cachedLines = (tags: number[]): [slot: number, tag: number][] =>
  tags.flatMap((t, slot): [number, number][] => (t < 0 ? [] : [[slot, t]]));

describe('the trace of a step', () => {
  it('carries 24 cycles by default and up to 64 when asked (a step of the paused machine), with the writes of all of them', () => {
    const e = run(pipelineOf({ kind: 'inorder', forwarding: true }), 100);
    const a = pipeSnapOf(e, new Uint8Array(65_536)),
      b = pipeSnapOf(e, new Uint8Array(65_536), STEP_TRACE_CYCLES);
    expect(must(a.trace).n).toBe(TRACE_CYCLES);
    expect(must(b.trace).n).toBeGreaterThan(TRACE_CYCLES); // (this short program ends before 64 cycles)
    expect(must(b.trace).n).toBeLessThanOrEqual(STEP_TRACE_CYCLES);
    expect(must(b.trace).end).toBe(must(a.trace).end);
    expect(must(b.stored).events.length).toBeGreaterThan(must(a.stored).events.length);
  });
});

describe('pipeSnapOf', () => {
  it('a scalar in-order engine: five stages, one lane', () => {
    const e = run(pipelineOf({ kind: 'inorder', forwarding: true }), 20);
    const s = pipeSnapOf(e);
    expect(s.width).toBe(1);
    expect(s.stages).toHaveLength(5);
    expect(s.ooo).toBeUndefined();
    expect(s.stages.some(busy)).toBe(true);
  });

  it('a two-wide engine: ten slots, indexed stage * width + lane', () => {
    const e = run(pipelineOf({ kind: 'inorder2', forwarding: true }), 20);
    const s = pipeSnapOf(e);
    expect(s.width).toBe(2);
    expect(s.stages).toHaveLength(10);
    // both lanes of some stage held an instruction at some point: the second lane is real
    expect(bothLanesBusy(e)).toBe(true);
  });

  it('the out-of-order engine: queues, scheduler, reorder buffer and units, sized by the config', () => {
    const e = run(pipelineOf({ kind: 'ooo', width: 2, robSize: 8, schedSize: 6, fetchQueue: 4 }), 25);
    const s = pipeSnapOf(e);
    expect(s.stages).toStrictEqual([]);
    const o = must(s.ooo);
    expect(o.rob).toHaveLength(8);
    expect(o.sched).toHaveLength(6);
    expect(o.decode).toHaveLength(2);
    expect(o.units).toHaveLength(4);
    expect(o.fetchQ.length).toBeLessThanOrEqual(4);
    expect(o.robCount).toBeGreaterThan(0);
    expect(o.robHead).toBeGreaterThanOrEqual(0);
    expect(o.robHead).toBeLessThan(8);
    // the live ring entries carry a mnemonic and a state past Empty
    for (let k = 0; k < o.robCount; k++) {
      const e2 = must(o.rob[(o.robHead + k) % 8]);
      expect(e2.op).not.toBe('');
      expect(e2.state).toBeGreaterThan(0);
    }
  });

  it('the trace holds the last cycles of every instruction that was in flight, one code character per cycle', () => {
    const e = run(pipelineOf({ kind: 'inorder', forwarding: true }), 40);
    const tr = must(pipeSnapOf(e).trace);
    expect(tr.end).toBe(e.cycle);
    expect(tr.n).toBe(24);
    expect(tr.rows.length).toBeGreaterThan(10);
    for (const r of tr.rows) {
      expect(r.codes).toHaveLength(tr.n);
      expect(r.codes).toMatch(/^[ FDXMWx]+$/u);
      expect(r.text.length).toBeGreaterThan(1);
    }
    // an instruction that went all the way through shows its stages in order: F D X M W
    const full = tr.rows.find((r) => /F+D+X+M+W/u.test(r.codes.replaceAll(' ', '')));
    expect(full).toBeDefined();
    // ids ascend
    for (let i = 1; i < tr.rows.length; i++) {
      expect(must(tr.rows[i]).id).toBeGreaterThan(must(tr.rows[i - 1]).id);
    }
  });

  it('the out-of-order trace uses its own stages (S scheduler, R result, C commit)', () => {
    const e = run(pipelineOf({ kind: 'ooo', width: 2, robSize: 8, schedSize: 6, fetchQueue: 4 }), 60);
    const all = must(pipeSnapOf(e).trace)
      .rows.map((r) => r.codes)
      .join('');
    for (const ch of 'FDSXRC') {
      expect(all, `stage ${ch}`).toContain(ch);
    }
  });

  it('there is no trace before the first cycle', () => {
    const e = pipelineOf({ kind: 'inorder' });
    const m = new Machine();
    m.attach(e, assemble(SRC).program);
    expect(pipeSnapOf(e).trace).toBeUndefined();
  });

  it('is plain data (it goes through postMessage)', () => {
    const e = run(pipelineOf({ kind: 'ooo', width: 2, robSize: 8, schedSize: 6, fetchQueue: 4 }), 25);
    const s = pipeSnapOf(e);
    const json = JSON.stringify(s);
    expect(JSON.parse(json)).toStrictEqual(s);
    expect(json.length).toBeLessThan(6000);
  });
});

const CFGS = [
  { name: 'unpipelined', cfg: { kind: 'unpipelined' } },
  { name: 'inorder', cfg: { kind: 'inorder', forwarding: true } },
  {
    name: 'inorder2 +caches',
    cfg: { kind: 'inorder2', forwarding: true, cacheLines: 16, icacheLines: 8, l2Lines: 32, predBits: 2 },
  },
  { name: 'ooo', cfg: { kind: 'ooo', width: 2, robSize: 8, schedSize: 6, fetchQueue: 4, cacheLines: 8, ways: 2 } },
] as const;

describe.each(CFGS)('what is stored: $name', ({ cfg }) => {
  const make = () => {
    const e = pipelineOf({ ...cfg, missPenalty: 4 });
    const m = new Machine();
    m.attach(e, assemble(SRC).program);
    return { e, m };
  };

  it("the registers in the snapshot are the machine's", () => {
    const { e, m } = make();
    for (let i = 0; i < 60; i++) {
      e.step();
    }
    const st = must(pipeSnapOf(e, m.ram).stored);
    expect(st.regs).toStrictEqual([...m.regs]);
  });

  it("rewinding the window's register writes and playing them forward gives the register file at every cycle", () => {
    const { e, m } = make();
    const hist: number[][] = [];
    const at = new Map<number, number[]>();
    for (let i = 0; i < 90; i++) {
      e.step();
      at.set(e.cycle, [...m.regs]);
      hist.push([]);
    }
    const sn = pipeSnapOf(e, m.ram);
    const tr = must(sn.trace),
      st = must(sn.stored);
    const start = tr.end - tr.n + 1;
    const regs = [...st.regs];
    const ev = st.events;
    for (const { reg, old } of regWrites(ev).toReversed()) {
      regs[reg] = old;
    } // undo, newest first
    expect(regs).toStrictEqual(at.get(start - 1));
    // forward: after each cycle's writes the file is what the machine had
    for (let c = start; c <= tr.end; c++) {
      for (const { reg, now } of regWrites(ev).filter((w) => w.cycle === c)) {
        regs[reg] = now;
      }
      expect(regs, `cycle ${c}`).toStrictEqual(at.get(c));
    }
  });

  it("the data cache's lines can be rewound with the window's fills", () => {
    const { e, m } = make();
    const tags = new Map<number, number[]>();
    for (let i = 0; i < 90; i++) {
      e.step();
      tags.set(e.cycle, [...e.storedState().d.tags]);
    }
    const sn = pipeSnapOf(e, m.ram);
    const tr = must(sn.trace),
      st = must(sn.stored);
    const start = tr.end - tr.n + 1;
    const t = [...st.d.tags];
    const ev = st.events;
    for (const { slot, evicted } of dataFills(ev).toReversed()) {
      t[slot] = evicted;
    }
    expect(t).toStrictEqual(tags.get(start - 1));
    for (let c = start; c <= tr.end; c++) {
      for (const { slot, line } of dataFills(ev).filter((f) => f.cycle === c)) {
        t[slot] = line;
      }
      expect(t, `cycle ${c}`).toStrictEqual(tags.get(c));
    }
  });

  it('the words of a cached line are what RAM holds, and the predictor table has its size', () => {
    const { e, m } = make();
    for (let i = 0; i < 120; i++) {
      e.step();
    }
    const st = must(pipeSnapOf(e, m.ram).stored);
    const per = st.d.lineBytes / 4;
    for (const [slot, t] of cachedLines(st.d.tags)) {
      for (let k = 0; k < per; k++) {
        expect(st.d.words[slot * per + k]).toBe(Math.trunc(m.bus.load32(t * st.d.lineBytes + 4 * k)));
      }
    }
    expect(st.pred.table).toHaveLength(st.pred.entries);
  });
});

describe('the RAM map', () => {
  it('shows the program where it was loaded and nothing elsewhere', () => {
    const m = new Machine();
    const prog = assemble(SRC).program;
    m.loadProgram(prog);
    const map = ramMapOf(m.ram);
    expect(map.bytes).toBe(m.ram.length);
    expect(map.filled).toHaveLength(RAM_BUCKETS);
    expect(map.filled[0]).toBeGreaterThan(0);
    expect(map.code[0]).toBeGreaterThan(0);
    expect(map.filled.slice(8).every((v) => v === 0)).toBe(true);
  });

  it('data that is not instructions counts as filled but not as code', () => {
    const m = new Machine();
    for (let i = 0; i < 256; i++) {
      m.ram[0x10_00 + i] = 0xff;
    }
    const map = ramMapOf(m.ram);
    const b = Math.floor(0x10_00 / (m.ram.length / RAM_BUCKETS));
    expect(map.filled[b]).toBeGreaterThan(0);
    expect(map.code[b]).toBe(0);
  });
});
