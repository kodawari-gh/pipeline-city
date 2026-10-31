// The optional CPU features (docs/CPU.md "Optional parts"): instruction cache, set-associative data cache, shared L2, 2-bit and bigger
// predictor. They only change timing; every program must still match the reference, and with them off nothing may move.
import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { generate, runReference, TEMPLATE_NAMES } from "@/features/jobs/sim/gen";
import { createEngine, Counter, type EngineConfig, type PipelineEngine } from "./index";
import { genData, genProgram } from "./testgen";
import { firstMemDiff, runEngine, runProgram, runRef } from "./testutil";

const FEATURES = { icacheLines: 8, cacheLines: 16, ways: 2, l2Lines: 32, predEntries: 128, predBits: 2 } as const;

const KINDS: { name: string; cfg: EngineConfig }[] = [
  { name: "unpipelined", cfg: { kind: "unpipelined", cacheLines: 16, ways: 2, l2Lines: 32 } },
  { name: "inorder", cfg: { kind: "inorder", forwarding: true, ...FEATURES } },
  { name: "inorder nofwd", cfg: { kind: "inorder", forwarding: false, ...FEATURES } },
  { name: "inorder2", cfg: { kind: "inorder2", forwarding: true, ...FEATURES } },
  { name: "ooo", cfg: { kind: "ooo", width: 2, robSize: 16, schedSize: 8, fetchQueue: 8, ...FEATURES } },
  { name: "ooo wide", cfg: { kind: "ooo", width: 4, robSize: 32, schedSize: 16, fetchQueue: 8, ...FEATURES, ways: 4 } },
];
const make = (cfg: EngineConfig, extra: Record<string, unknown> = {}) => createEngine({ ...cfg, ...extra } as EngineConfig) as PipelineEngine;

describe.each(KINDS)("features stay correct vs the reference: $name", ({ cfg }) => {
  it("random programs, with cache invalidations and predictor flips", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const src = genProgram(seed, 40), data = genData(seed), ref = runRef(src, data);
      for (const chaos of [undefined, { seed: seed + 1, p: 0.12 }]) {
        const got = runEngine(make(cfg), src, data, chaos);
        expect(got.regs, `seed ${seed}`).toEqual(ref.regs);
        expect(firstMemDiff(got.mem, ref.mem), `seed ${seed}`).toBe(-1);
        expect(got.counters[Counter.Retired], `seed ${seed} retired`).toBe(ref.cycles);
      }
    }
  });

  it("tiny caches and zero penalties", () => {
    for (let seed = 300; seed < 308; seed++) {
      const src = genProgram(seed), data = genData(seed), ref = runRef(src, data);
      for (const extra of [{ missPenalty: 0, l2Penalty: 0 }, { cacheLines: 2, ways: 2, icacheLines: 1, l2Lines: 2, missPenalty: 6 }]) {
        const got = runEngine(make(cfg, extra), src, data, { seed, p: 0.1 });
        expect(got.regs).toEqual(ref.regs);
        expect(firstMemDiff(got.mem, ref.mem)).toBe(-1);
      }
    }
  });

  it("generated game programs", () => {
    for (const t of [...new Set(["cli", "cli.scan", ...TEMPLATE_NAMES])].filter((x) => !x.startsWith("secure.") && !x.startsWith("gpu."))) {
      const g = generate(t, 11, { scale: 1 });
      const ref = runReference(g);
      const m = runProgram(make(cfg), g.program);
      expect(Array.from(m.regs), t).toEqual(Array.from(ref.cpu.regs));
      expect(m.display.text(), t).toBe(ref.text);
    }
  });
});

const run = (cfg: EngineConfig, src: string) => {
  const e = make(cfg);
  runEngine(e, src);
  return { cycles: e.cycle, c: e.view.counters };
};

describe("off means off", () => {
  it("explicit zeros and one-way, one-bit settings are the same machine as no settings", () => {
    const src = genProgram(5, 50);
    for (const kind of ["unpipelined", "inorder", "inorder2", "ooo"] as const) {
      const a = run({ kind } as EngineConfig, src);
      const b = run({ kind, icacheLines: 0, l2Lines: 0, ways: 1, predEntries: 64, predBits: 1 } as EngineConfig, src);
      expect(b.cycles, kind).toBe(a.cycles);
      expect(Array.from(b.c), kind).toEqual(Array.from(a.c));
      expect(a.c[Counter.ICacheMisses]! + a.c[Counter.L2Hits]! + a.c[Counter.L2Misses]!, kind).toBe(0);
    }
  });
});

// A loop that calls a subroutine placed far from it, 20 times. Fetch in sequence is a stream and always free; only a jump has to find its
// target: the first call finds a cold line (a miss), every later call, return and loop-back is a hit. Without an instruction cache every
// jump waits `redirectPenalty` (the game sets it; the engine default 0 is ideal instruction memory).
const PAD = Array.from({ length: 40 }, () => "  nop").join("\n");
const LOOP = `
  li t0, 0
  li t1, 20
loop:
  call sub
  addi t0, t0, 1
  bne  t0, t1, loop
  ecall
${PAD}
sub:
  addi a0, a0, 1
  ret`;

describe("instruction cache", () => {
  for (const kind of ["inorder", "inorder2", "ooo"] as const) {
    it(`${kind}: the first jump to a cold line misses, every later jump to it hits`, () => {
      const on = run({ kind, icacheLines: 8 } as EngineConfig, LOOP);
      const misses = on.c[Counter.ICacheMisses]!, hits = on.c[Counter.ICacheHits]!;
      expect(misses).toBeGreaterThan(0);
      expect(misses).toBeLessThanOrEqual(4);
      expect(hits).toBeGreaterThan(misses * 8);
      expect(on.c[Counter.StallIFetch]).toBeGreaterThan(0);
      // against ideal instruction memory the cost is only the cold misses
      const ideal = run({ kind } as EngineConfig, LOOP);
      expect(on.cycles).toBeGreaterThan(ideal.cycles);
      expect(on.cycles - ideal.cycles).toBeLessThanOrEqual(misses * 8);
      expect(ideal.c[Counter.ICacheMisses]).toBe(0);
    });

    it(`${kind}: with a redirect penalty (the game's instruction memory) the cache saves it on every hit`, () => {
      const off = run({ kind, redirectPenalty: 2 } as EngineConfig, LOOP);
      const on = run({ kind, icacheLines: 8, redirectPenalty: 2 } as EngineConfig, LOOP);
      expect(off.c[Counter.StallIFetch]).toBeGreaterThan(20 * 3 * 2 - 10); // call, ret and loop-back, 2 cycles each, 20 times
      expect(on.cycles).toBeLessThan(off.cycles * 0.85);
    });
  }

  it("a redirect penalty of zero changes nothing (the default)", () => {
    expect(run({ kind: "inorder", redirectPenalty: 0 }, LOOP).cycles).toBe(run({ kind: "inorder" }, LOOP).cycles);
  });

  it("a loop bigger than the cache keeps missing; a bigger cache holds it", () => {
    const body = Array.from({ length: 40 }, (_, k) => `  addi t${(k % 3) + 2}, t${(k % 3) + 2}, 1`).join("\n");
    const src = `  li t0, 0\n  li a1, 10\nloop:\n${body}\n  addi t0, t0, 1\n  bne t0, a1, loop\n  ecall`;
    const small = run({ kind: "inorder", icacheLines: 2 }, src);
    const big = run({ kind: "inorder", icacheLines: 64 }, src);
    expect(small.c[Counter.ICacheMisses]!).toBeGreaterThan(big.c[Counter.ICacheMisses]! * 4);
    expect(small.cycles).toBeGreaterThan(big.cycles);
  });
});

describe("set-associative data cache", () => {
  // Two addresses one cache-size apart map to the same set of a direct-mapped cache and fight; two ways hold both.
  const SRC = `
    li s0, 4096
    li s1, 4160        # 4096 + 64: the same line of a 4-line, 16-byte direct-mapped cache
    li t0, 0
    li t1, 30
  loop:
    lw a0, 0(s0)
    lw a1, 0(s1)
    add a2, a0, a1
    addi t0, t0, 1
    bne t0, t1, loop
    ecall`;
  for (const kind of ["unpipelined", "inorder", "ooo"] as const) {
    it(`${kind}: two ways turn the conflict misses into hits`, () => {
      const dm = run({ kind, cacheLines: 4 } as EngineConfig, SRC);
      const sa = run({ kind, cacheLines: 4, ways: 2 } as EngineConfig, SRC);
      expect(dm.c[Counter.CacheMisses]!).toBeGreaterThanOrEqual(50);
      expect(sa.c[Counter.CacheMisses]!).toBeLessThanOrEqual(3);
      expect(sa.cycles).toBeLessThan(dm.cycles);
    });
  }

  it("least recently used replacement: the line touched most recently survives a third conflicting line", () => {
    const src = `
      li s0, 4096
      li s1, 4160
      li s2, 4224
      lw a0, 0(s0)
      lw a0, 0(s1)
      lw a0, 0(s0)      # s0 is now the most recently used
      lw a0, 0(s2)      # evicts s1, not s0
      lw a0, 0(s0)      # hit
      lw a0, 0(s1)      # miss
      ecall`;
    const r = run({ kind: "unpipelined", cacheLines: 4, ways: 2 }, src);
    expect(r.c[Counter.CacheMisses]).toBe(4); // s0, s1, s2, s1 again
    expect(r.c[Counter.CacheHits]).toBe(2);
  });
});

describe("shared L2", () => {
  // Scan 16 lines (256 bytes) twice with a 4-line L1: the second scan misses the L1 again but hits a big L2.
  const SRC = `
    li s3, 4096
    li s0, 0
    li s1, 2
  pass:
    li t0, 0
    li t1, 256
  scan:
    add t2, s3, t0
    lw a0, 0(t2)
    addi t0, t0, 16
    bne t0, t1, scan
    addi s0, s0, 1
    bne s0, s1, pass
    ecall`;
  for (const kind of ["unpipelined", "inorder", "ooo"] as const) {
    it(`${kind}: the second pass hits the L2 and costs less than RAM`, () => {
      const none = run({ kind, cacheLines: 4 } as EngineConfig, SRC);
      const l2 = run({ kind, cacheLines: 4, l2Lines: 32 } as EngineConfig, SRC);
      expect(l2.c[Counter.L2Misses]).toBe(16);
      expect(l2.c[Counter.L2Hits]).toBe(16);
      expect(l2.c[Counter.CacheMisses]).toBe(none.c[Counter.CacheMisses]);
      expect(l2.cycles).toBeLessThan(none.cycles);
    });
  }

  it("the instruction side shares it: an I-cache miss on a line the data side loaded hits the L2", () => {
    const a = run({ kind: "inorder", icacheLines: 8, l2Lines: 32 }, LOOP);
    const b = run({ kind: "inorder", icacheLines: 8 }, LOOP);
    expect(a.c[Counter.L2Misses]!).toBeGreaterThan(0); // the cold jump target goes through the L2
    expect(a.cycles).toBeLessThanOrEqual(b.cycles);
  });
});

describe("predictor", () => {
  // Inner loop of 8 iterations inside an outer loop of 30: a 1-bit predictor misses the exit and the next entry (2 per pass),
  // a 2-bit one only the exit.
  const SRC = `
    li s0, 0
    li s1, 30
  outer:
    li t0, 0
    li t1, 8
  inner:
    addi t0, t0, 1
    bne t0, t1, inner
    addi s0, s0, 1
    bne s0, s1, outer
    ecall`;
  for (const kind of ["inorder", "inorder2", "ooo"] as const) {
    it(`${kind}: two bits halve the mispredicts of a nested loop`, () => {
      const one = run({ kind } as EngineConfig, SRC);
      const two = run({ kind, predBits: 2 } as EngineConfig, SRC);
      const m1 = one.c[Counter.BranchMispredicts]!, m2 = two.c[Counter.BranchMispredicts]!;
      expect(m2).toBeLessThan(m1 * 0.7);
      expect(two.cycles).toBeLessThan(one.cycles);
    });
  }

  it("a bigger table stops two branches fighting over one entry", () => {
    // a never-taken branch and the loop branch 64 words apart share an entry in a 64-entry table and keep unlearning each other
    const pad = Array.from({ length: 62 }, () => "  nop").join("\n");
    const src = `
      li t0, 0
      li t1, 40
    top:
      beq a3, t1, out
      addi t0, t0, 1
    ${pad}
      bne t0, t1, top
    out:
      ecall`;
    const small = run({ kind: "inorder", predEntries: 64 }, src);
    const big = run({ kind: "inorder", predEntries: 256 }, src);
    expect(small.c[Counter.BranchMispredicts]!).toBeGreaterThan(40);
    expect(big.c[Counter.BranchMispredicts]!).toBeLessThan(small.c[Counter.BranchMispredicts]! * 0.3);
  });

  it("a flip toggles the prediction of a 2-bit entry and keeps its strength", () => {
    const e = make({ kind: "inorder", predBits: 2 });
    const m = runEngine(e, "  li t0, 0\n  li t1, 6\nl:\n  addi t0, t0, 1\n  bne t0, t1, l\n  ecall");
    expect(m.regs[7]).toBe(6); // t0
    e.flipPredictor();
    e.flipPredictor();
    expect(() => e.flipPredictor(0x20)).not.toThrow();
  });

  it("rejects settings that are not real", () => {
    expect(() => make({ kind: "inorder", predBits: 3 as never })).toThrow(RangeError);
    expect(() => make({ kind: "inorder", predEntries: 0 })).toThrow(RangeError);
    expect(() => make({ kind: "inorder", cacheLines: 4, ways: 8 })).toThrow(RangeError);
    expect(() => make({ kind: "inorder", cacheLines: 4, ways: 3 })).toThrow(RangeError);
  });
});

describe("determinism", () => {
  it("the same program on the same featured engine gives the same cycles and counters", () => {
    const src = genProgram(9, 60);
    for (const { name, cfg } of KINDS) {
      const a = run(cfg, src), b = run(cfg, src);
      expect(b.cycles, name).toBe(a.cycles);
      expect(Array.from(b.c), name).toEqual(Array.from(a.c));
    }
  });

  it("assembles", () => { expect(assemble(LOOP).program.length).toBeGreaterThan(40); });
});
