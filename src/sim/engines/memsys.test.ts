import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { Machine } from "../machine";
import { InOrderEngine } from "./inorder";
import { MemSystem } from "./memsys";
import { OooEngine } from "./ooo";
import { Counter } from "./view";

// Scan 16 lines (256 bytes) once with a 4-line L1.
const SCAN = `
    li s3, 4096
    li t0, 0
    li t1, 256
  scan:
    add t2, s3, t0
    lw a0, 0(t2)
    addi t0, t0, 16
    bne t0, t1, scan
    ecall`;

const SETTINGS = { cacheLines: 4, l2Lines: 32 } as const;
const MEM = { lineBytes: 16, missPenalty: 4, l2Lines: 32, l2Penalty: 2 } as const;

function runOn(engine: InOrderEngine | OooEngine, mem?: MemSystem): { cycles: number; c: Float64Array } {
  const m = new Machine();
  if (mem) engine.useMemSystem(mem);
  m.attach(engine, assemble(SCAN).program);
  while (!engine.halted) engine.step();
  return { cycles: engine.cycle, c: engine.view.counters };
}

describe("MemSystem", () => {
  it("an engine without a shared one builds its own, as before", () => {
    const a = runOn(new InOrderEngine(SETTINGS)), b = runOn(new InOrderEngine(SETTINGS));
    expect(a.cycles).toBe(b.cycles);
    expect(a.c[Counter.L2Misses]).toBe(16);
    expect(a.c[Counter.L2Hits]).toBe(0);
  });

  it("two engines share one L2: what the first filled, the second finds", () => {
    const alone = runOn(new InOrderEngine(SETTINGS));
    const mem = new MemSystem(MEM);
    const first = runOn(new InOrderEngine(SETTINGS), mem);
    const second = runOn(new InOrderEngine(SETTINGS), mem);
    expect(first.cycles).toBe(alone.cycles); // a cold shared L2 is the engine's own
    expect(first.c[Counter.L2Misses]).toBe(16);
    expect(second.c[Counter.L2Misses]).toBe(0); // the second engine's reset does not clear what it does not own
    expect(second.c[Counter.L2Hits]).toBe(16);
    expect(second.c[Counter.CacheMisses]).toBe(first.c[Counter.CacheMisses]);
    expect(second.cycles).toBeLessThan(first.cycles);
  });

  it("an out-of-order engine can share it with an in-order one", () => {
    const mem = new MemSystem(MEM);
    runOn(new InOrderEngine(SETTINGS), mem);
    const o = runOn(new OooEngine(SETTINGS), mem);
    expect(o.c[Counter.L2Hits]).toBe(16);
  });

  it("the L2 of the shared system shows in each engine's stored state", () => {
    const mem = new MemSystem(MEM);
    const a = new InOrderEngine(SETTINGS), b = new InOrderEngine(SETTINGS);
    runOn(a, mem);
    runOn(b, mem);
    expect(a.storedState().l2!.tags).toEqual(b.storedState().l2!.tags);
    expect(a.storedState().l2!.tags.filter((t) => t >= 0).length).toBe(16);
  });

  it("rejects a negative L2 penalty", () => {
    expect(() => new MemSystem({ ...MEM, l2Penalty: -1 })).toThrow(RangeError);
  });
});
