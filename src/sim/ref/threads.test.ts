// Threaded jobs on the reference: the same text under every interleaving, and the header that marks a program as threaded.
import { afterAll, describe, expect, it } from "vitest";
import { disassemble } from "../isa";
import { generate, TEMPLATES } from "../gen";
import { parSum, THREAD_TOTAL } from "../gen/threadtest";
import { RefThreads, type Interleaving } from "./threads";

for (const t of [1, 2, 3, 4, 8]) TEMPLATES[`test.par${t}`] = parSum(t);
afterAll(() => { for (const t of [1, 2, 3, 4, 8]) delete TEMPLATES[`test.par${t}`]; });

const WAYS: Interleaving[] = [
  { kind: "round-robin" }, { kind: "burst", n: 5 }, { kind: "burst", n: 200 },
  { kind: "random", seed: 1 }, { kind: "random", seed: 2, max: 40 }, { kind: "random", seed: 3, max: 3 },
];

describe("threaded jobs", () => {
  it("a threaded program starts with the nop addi zero, zero, T and its meta says how many threads", () => {
    const g = generate("test.par3", 4, { row: 2, jobId: 5 });
    expect(g.meta.threads).toBe(3);
    expect(disassemble(g.program[0]!)).toBe("addi zero, zero, 3");
    expect(generate("cli.calc", 4).meta.threads).toBe(1);
    expect(generate("cli.calc", 4).asm).not.toContain("thread_end");
  });

  describe.each([2, 3, 4, 8])("%i threads", (t) => {
    it.each(WAYS.map((w, k) => [k, w] as const))("gives the expected text under interleaving %i", (_k, how) => {
      const g = generate(`test.par${t}`, 11, { row: 1, jobId: 7, scale: 2 });
      const run = new RefThreads(g.program, t);
      expect(run.run(how)).toBe(g.meta.expectedText);
      // the partials add up to the total, whoever ran when
      const dv = new DataView(run.mem.ram.bytes.buffer);
      const parts = Array.from({ length: t }, (_, k) => dv.getUint32(0x7f40 + 4 * k, true));
      expect(parts.reduce((s, v) => s + v, 0)).toBe(dv.getUint32(THREAD_TOTAL, true));
    });
  });

  it("one thread is the plain program", () => {
    const g = generate("test.par1", 3, { row: 0, jobId: 1 });
    expect(new RefThreads(g.program, 1).run()).toBe(g.meta.expectedText);
  });

  it("threads that wait for each other never finish on their own: a missing thread ends in a fault, not a hang", () => {
    const g = generate("test.par2", 3, { row: 0, jobId: 1 });
    const run = new RefThreads(g.program, 2);
    run.cpus[1]!.halted = true; // the second thread never arrives
    expect(() => run.run({ kind: "round-robin" }, 20_000)).toThrow(/exceeded/);
  });
});
