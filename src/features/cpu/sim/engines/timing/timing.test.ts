import { describe, expect, it } from "vitest";
import { assemble } from "../../asm";
import { Machine } from "@/core/sim";
import { Cause, Counter, InOrderEngine, SlotKind, Stage, UnpipelinedEngine, type InOrderSettings } from "../index";
import type { PipelineEngine } from "../common";
import { runEngine } from "../testutil";

const io = (s: InOrderSettings = {}) => new InOrderEngine({ missPenalty: 0, ...s });
const C = Counter;

function run(e: PipelineEngine, src: string) {
  const o = runEngine(e, src);
  const c = o.counters;
  return { cycles: o.cycles, c };
}

describe("in-order hazards (width 1)", () => {
  it("hazard-free code takes n + 4 cycles", () => {
    const r = run(io(), `addi t0, zero, 1\naddi t1, zero, 2\naddi t2, zero, 3\necall`);
    expect(r.cycles).toBe(4 + 4);
    expect(r.c[C.Retired]).toBe(4);
  });

  it("ALU RAW with forwarding costs 0 bubbles", () => {
    const r = run(io(), `li t0, 1\nadd t1, t0, t0\nadd t2, t1, t1\nsw t2, 0(sp)\necall`.replace("0(sp)", "-4(sp)"));
    expect(r.c[C.StallLoad]! + r.c[C.StallData]!).toBe(0);
    expect(r.cycles).toBe(5 + 4);
  });

  it("load-use with forwarding costs exactly 1 bubble; one filler instruction hides it", () => {
    const base = `li s3, 4096\nlw t0, 0(s3)\n`;
    const a = run(io(), base + `add t1, t0, t0\necall`);
    expect(a.c[C.StallLoad]).toBe(1);
    expect(a.c[C.StallData]).toBe(0);
    expect(a.cycles).toBe(4 + 4 + 1);
    const b = run(io(), base + `addi t2, zero, 1\nadd t1, t0, t0\necall`);
    expect(b.c[C.StallLoad]).toBe(0);
    expect(b.cycles).toBe(5 + 4);
  });

  it("without forwarding, RAW costs 2 / 1 / 0 bubbles at distance 1 / 2 / 3", () => {
    const nf = () => io({ forwarding: false });
    const d1 = run(nf(), `li t0, 1\nadd t1, t0, t0\necall`);
    expect(d1.c[C.StallData]).toBe(2);
    expect(d1.cycles).toBe(3 + 4 + 2);
    const d2 = run(nf(), `li t0, 1\nli t2, 2\nadd t1, t0, t0\necall`);
    expect(d2.c[C.StallData]).toBe(1);
    const d3 = run(nf(), `li t0, 1\nli t2, 2\nli t3, 3\nadd t1, t0, t0\necall`);
    expect(d3.c[C.StallData]).toBe(0);
    expect(d3.cycles).toBe(5 + 4);
  });

  it("taken branch mispredicted (predict not-taken) flushes 2 bubbles; correct prediction flushes none", () => {
    const src = `li t0, 1\nbne t0, zero, skip\naddi a0, a0, 1\naddi a0, a0, 2\nskip:\necall`;
    const miss = run(io(), src);
    expect(miss.c[C.Flushes]).toBe(1);
    expect(miss.c[C.BranchMispredicts]).toBe(1);
    expect(miss.c[C.StallFlush]).toBe(2);
    expect(miss.cycles).toBe(3 + 4 + 2);
    const e = io();
    new Machine().attach(e, assemble(src).program);
    e.flipPredictor(4); // bne is at pc 4: predict taken (reset clears the predictor, so flip after attach)
    while (!e.halted) e.step();
    expect(e.view.counters[C.Flushes]).toBe(0);
    expect(e.cycle).toBe(3 + 4);
  });

  it("not-taken branch is free when predicted not-taken, and a 1-bit predictor learns a loop", () => {
    const nt = run(io(), `li t0, 0\nbne t0, zero, skip\naddi a0, a0, 1\nskip:\necall`);
    expect(nt.c[C.Flushes]).toBe(0);
    // Loop of 5 iterations: first taken mispredicts (cold), then predicted taken until the exit mispredicts.
    const loop = run(io(), `li t0, 5\nl:\naddi t0, t0, -1\nbne t0, zero, l\necall`);
    expect(loop.c[C.Branches]).toBe(5);
    expect(loop.c[C.BranchMispredicts]).toBe(2);
  });

  it("jal is free (predecoded), ret costs a flush", () => {
    const r = run(io(), `call f\necall\nf:\nret`);
    expect(r.c[C.Flushes]).toBe(1);
    expect(r.c[C.StallFlush]).toBe(2);
  });

  it("shared memory port costs one struct bubble when fetch collides with a load", () => {
    const src = `li s3, 4096\nlw t0, 0(s3)\naddi t1, zero, 1\naddi t2, zero, 2\naddi t3, zero, 3\necall`;
    const a = run(io(), src);
    const b = run(io({ sharedPort: true }), src);
    expect(a.c[C.StallStruct]).toBe(0);
    expect(b.c[C.StallStruct]).toBe(1);
    expect(b.cycles).toBe(a.cycles + 1);
  });
});

describe("data cache", () => {
  const src = `li s3, 4096\nlw t0, 0(s3)\nlw t1, 4(s3)\necall`;
  it("a miss freezes the in-order pipe for exactly missPenalty cycles; the same line then hits", () => {
    for (const p of [1, 4, 9]) {
      const r = run(new InOrderEngine({ missPenalty: p }), src);
      expect(r.c[C.CacheMisses]).toBe(1);
      expect(r.c[C.CacheHits]).toBe(1);
      expect(r.c[C.StallCache]).toBe(p);
      expect(r.cycles).toBe(4 + 4 + p);
    }
  });

  it("unpipelined: 5 cycles per instruction plus the miss penalty in MEM", () => {
    const r = run(new UnpipelinedEngine({ missPenalty: 6 }), src);
    expect(r.c[C.StallCache]).toBe(6);
    expect(r.cycles).toBe(4 * 5 + 6);
  });

  it("invalidateCache() mid-run forces another miss", () => {
    const e = new InOrderEngine({ missPenalty: 3 });
    const m = new Machine();
    m.attach(e, assemble(`li s3, 4096\nlw t0, 0(s3)\nlw t1, 0(s3)\nlw t2, 0(s3)\nlw t3, 0(s3)\necall`).program);
    let invalidated = false;
    while (!e.halted) {
      e.step();
      if (!invalidated && e.view.counters[C.CacheHits]! >= 1) { e.invalidateCache(); invalidated = true; }
    }
    expect(e.view.counters[C.CacheMisses]).toBe(2);
    expect(e.view.counters[C.StallCache]).toBe(6);
  });

  it("direct-mapped conflict: two addresses one cache apart evict each other", () => {
    const e = new InOrderEngine({ missPenalty: 2, cacheLines: 4, cacheLineBytes: 16 }); // 64 bytes
    const r = run(e, `li s3, 4096\nlw t0, 0(s3)\nlw t1, 64(s3)\nlw t2, 0(s3)\necall`);
    expect(r.c[C.CacheMisses]).toBe(3);
  });
});

describe("unpipelined", () => {
  it("takes 5 cycles per instruction with no branch penalty", () => {
    const r = run(new UnpipelinedEngine({ missPenalty: 0 }), `li t0, 3\nl:\naddi t0, t0, -1\nbne t0, zero, l\necall`);
    expect(r.c[C.Retired]).toBe(1 + 3 * 2 + 1);
    expect(r.cycles).toBe(5 * r.c[C.Retired]!);
    expect(r.c[C.Flushes]).toBe(0);
  });
});

describe("view", () => {
  it("shows occupants, bubble causes and timeline codes", () => {
    const e = io();
    const m = new Machine();
    m.attach(e, assemble(`li s3, 4096\nlw t0, 0(s3)\nadd t1, t0, t0\necall`).program);
    const v = e.view;
    e.step();
    expect(v.stageKind[Stage.IF]).toBe(SlotKind.Instr);
    expect(v.stageId[Stage.IF]).toBe(0);
    expect(v.stageKind[Stage.ID]).toBe(SlotKind.Empty);
    let sawLoadBubble = false;
    while (!e.halted) {
      e.step();
      if (v.stageKind[Stage.EX] === SlotKind.Bubble && v.stageCause[Stage.EX] === Cause.Load) sawLoadBubble = true;
    }
    expect(sawLoadBubble).toBe(true);
    expect(v.counters[C.Cycles]).toBe(e.cycle);
    // Timeline: instruction 0 has fate retired and F at cycle 1.
    const t = v.timeline;
    expect(t.id[0]).toBe(0);
    expect(t.fate[0]).toBe(1);
    expect(t.pc[1]).toBe(4);
  });

  it("timeline ring recycles rows and columns", () => {
    const e = new InOrderEngine({ timelineRows: 8, timelineCols: 8, missPenalty: 0 });
    const m = new Machine();
    m.attach(e, assemble(`li t0, 30\nl:\naddi t0, t0, -1\nbne t0, zero, l\necall`).program);
    while (!e.halted) e.step();
    const t = e.view.timeline;
    expect(e.view.nextId).toBeGreaterThan(60);
    for (let r = 0; r < t.rows; r++) expect(t.id[r]! % t.rows).toBe(r);
  });
});
