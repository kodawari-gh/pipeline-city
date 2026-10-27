import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { createEngine, type PipelineEngine } from "../engines";
import { Machine } from "../machine";
import { pipeSnapOf, ramMapOf, RAM_BUCKETS } from "./pipesnap";
import { Ev } from "../engines/common";

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

function run(engine: PipelineEngine, cycles: number) {
  const m = new Machine();
  m.attach(engine, assemble(SRC).program);
  for (let i = 0; i < cycles && !engine.halted; i++) engine.step();
  return engine;
}

describe("pipeSnapOf", () => {
  it("a scalar in-order engine: five stages, one lane", () => {
    const e = run(createEngine({ kind: "inorder", forwarding: true }) as PipelineEngine, 20);
    const s = pipeSnapOf(e);
    expect(s.width).toBe(1);
    expect(s.stages).toHaveLength(5);
    expect(s.ooo).toBeUndefined();
    expect(s.stages.some((x) => x.kind === 1 && x.op !== "")).toBe(true);
  });

  it("a two-wide engine: ten slots, indexed stage * width + lane", () => {
    const e = run(createEngine({ kind: "inorder2", forwarding: true }) as PipelineEngine, 20);
    const s = pipeSnapOf(e);
    expect(s.width).toBe(2);
    expect(s.stages).toHaveLength(10);
    // both lanes of some stage held an instruction at some point: the second lane is real
    let both = false;
    for (let c = 0; c < 30 && !e.halted && !both; c++) {
      e.step();
      const t = pipeSnapOf(e).stages;
      for (let st = 0; st < 5; st++) if (t[st * 2]!.kind === 1 && t[st * 2 + 1]!.kind === 1) both = true;
    }
    expect(both).toBe(true);
  });

  it("the out-of-order engine: queues, scheduler, reorder buffer and units, sized by the config", () => {
    const e = run(createEngine({ kind: "ooo", width: 2, robSize: 8, schedSize: 6, fetchQueue: 4 }) as PipelineEngine, 25);
    const s = pipeSnapOf(e);
    expect(s.stages).toEqual([]);
    const o = s.ooo!;
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
      const e2 = o.rob[(o.robHead + k) % 8]!;
      expect(e2.op).not.toBe("");
      expect(e2.state).toBeGreaterThan(0);
    }
  });

  it("the trace holds the last cycles of every instruction that was in flight, one code character per cycle", () => {
    const e = run(createEngine({ kind: "inorder", forwarding: true }) as PipelineEngine, 40);
    const tr = pipeSnapOf(e).trace!;
    expect(tr.end).toBe(e.cycle);
    expect(tr.n).toBe(24);
    expect(tr.rows.length).toBeGreaterThan(10);
    for (const r of tr.rows) {
      expect(r.codes).toHaveLength(tr.n);
      expect(r.codes).toMatch(/^[ FDXMWx]+$/);
      expect(r.text.length).toBeGreaterThan(1);
    }
    // an instruction that went all the way through shows its stages in order: F D X M W
    const full = tr.rows.find((r) => /F+D+X+M+W/.test(r.codes.replace(/ /g, "")));
    expect(full).toBeDefined();
    // ids ascend
    for (let i = 1; i < tr.rows.length; i++) expect(tr.rows[i]!.id).toBeGreaterThan(tr.rows[i - 1]!.id);
  });

  it("the out-of-order trace uses its own stages (S scheduler, R result, C commit)", () => {
    const e = run(createEngine({ kind: "ooo", width: 2, robSize: 8, schedSize: 6, fetchQueue: 4 }) as PipelineEngine, 60);
    const all = pipeSnapOf(e).trace!.rows.map((r) => r.codes).join("");
    for (const ch of "FDSXRC") expect(all, ch).toContain(ch);
  });

  it("there is no trace before the first cycle", () => {
    const e = createEngine({ kind: "inorder" }) as PipelineEngine;
    const m = new Machine();
    m.attach(e, assemble(SRC).program);
    expect(pipeSnapOf(e).trace).toBeUndefined();
  });

  it("is plain data (it goes through postMessage)", () => {
    const e = run(createEngine({ kind: "ooo", width: 2, robSize: 8, schedSize: 6, fetchQueue: 4 }) as PipelineEngine, 25);
    const s = pipeSnapOf(e);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(JSON.stringify(s).length).toBeLessThan(6000);
  });
});

const CFGS = [
  { name: "unpipelined", cfg: { kind: "unpipelined" } },
  { name: "inorder", cfg: { kind: "inorder", forwarding: true } },
  { name: "inorder2 +caches", cfg: { kind: "inorder2", forwarding: true, cacheLines: 16, icacheLines: 8, l2Lines: 32, predBits: 2 } },
  { name: "ooo", cfg: { kind: "ooo", width: 2, robSize: 8, schedSize: 6, fetchQueue: 4, cacheLines: 8, ways: 2 } },
] as const;

describe.each(CFGS)("what is stored: $name", ({ cfg }) => {
  const make = () => {
    const e = createEngine({ ...cfg, missPenalty: 4 } as never) as PipelineEngine;
    const m = new Machine();
    m.attach(e, assemble(SRC).program);
    return { e, m };
  };

  it("the registers in the snapshot are the machine's", () => {
    const { e, m } = make();
    for (let i = 0; i < 60; i++) e.step();
    const st = pipeSnapOf(e, m.ram).stored!;
    expect(st.regs).toEqual(Array.from(m.regs));
  });

  it("rewinding the window's register writes and playing them forward gives the register file at every cycle", () => {
    const { e, m } = make();
    const hist: number[][] = [];
    const at = new Map<number, number[]>();
    for (let i = 0; i < 90; i++) { e.step(); at.set(e.cycle, Array.from(m.regs)); hist.push([]); }
    const sn = pipeSnapOf(e, m.ram);
    const tr = sn.trace!, st = sn.stored!;
    const start = tr.end - tr.n + 1;
    const regs = st.regs.slice();
    const ev = st.events;
    for (let i = ev.length - 6; i >= 0; i -= 6) if (ev[i + 1] === Ev.Reg) regs[ev[i + 2]!] = ev[i + 4]!; // undo, newest first
    expect(regs).toEqual(at.get(start - 1));
    // forward: after each cycle's writes the file is what the machine had
    for (let c = start; c <= tr.end; c++) {
      for (let i = 0; i < ev.length; i += 6) if (ev[i] === c && ev[i + 1] === Ev.Reg) regs[ev[i + 2]!] = ev[i + 3]!;
      expect(regs, `cycle ${c}`).toEqual(at.get(c));
    }
  });

  it("the data cache's lines can be rewound with the window's fills", () => {
    const { e, m } = make();
    const tags = new Map<number, number[]>();
    for (let i = 0; i < 90; i++) { e.step(); tags.set(e.cycle, e.storedState().d.tags.slice()); }
    const sn = pipeSnapOf(e, m.ram);
    const tr = sn.trace!, st = sn.stored!;
    const start = tr.end - tr.n + 1;
    const t = st.d.tags.slice();
    const ev = st.events;
    for (let i = ev.length - 6; i >= 0; i -= 6) if (ev[i + 1] === Ev.Fill && ev[i + 2] === 0) t[ev[i + 3]!] = ev[i + 5]!;
    expect(t).toEqual(tags.get(start - 1));
    for (let c = start; c <= tr.end; c++) {
      for (let i = 0; i < ev.length; i += 6) if (ev[i] === c && ev[i + 1] === Ev.Fill && ev[i + 2] === 0) t[ev[i + 3]!] = ev[i + 4]!;
      expect(t, `cycle ${c}`).toEqual(tags.get(c));
    }
  });

  it("the words of a cached line are what RAM holds, and the predictor table has its size", () => {
    const { e, m } = make();
    for (let i = 0; i < 120; i++) e.step();
    const st = pipeSnapOf(e, m.ram).stored!;
    const per = st.d.lineBytes / 4;
    st.d.tags.forEach((t, slot) => {
      if (t < 0) return;
      for (let k = 0; k < per; k++) expect(st.d.words[slot * per + k]).toBe(m.bus.load32(t * st.d.lineBytes + 4 * k) | 0);
    });
    expect(st.pred.table).toHaveLength(st.pred.entries);
  });
});

describe("the RAM map", () => {
  it("shows the program where it was loaded and nothing elsewhere", () => {
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

  it("data that is not instructions counts as filled but not as code", () => {
    const m = new Machine();
    for (let i = 0; i < 256; i++) m.ram[0x1000 + i] = 0xff;
    const map = ramMapOf(m.ram);
    const b = Math.floor(0x1000 / (m.ram.length / RAM_BUCKETS));
    expect(map.filled[b]).toBeGreaterThan(0);
    expect(map.code[b]).toBe(0);
  });
});
