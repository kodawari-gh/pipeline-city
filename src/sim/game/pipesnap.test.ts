import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { createEngine, type PipelineEngine } from "../engines";
import { Machine } from "../machine";
import { pipeSnapOf } from "./pipesnap";

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

  it("is plain data (it goes through postMessage)", () => {
    const e = run(createEngine({ kind: "ooo", width: 2, robSize: 8, schedSize: 6, fetchQueue: 4 }) as PipelineEngine, 25);
    const s = pipeSnapOf(e);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(JSON.stringify(s).length).toBeLessThan(2500);
  });
});
