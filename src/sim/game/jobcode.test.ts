import { describe, expect, it } from "vitest";
import { CODE_SOURCE, HIGH_LEVEL, mixShares, OP_CLASSES, profileOf, reliance } from "./jobcode";
import { JOB_DEX } from "./jobdex";

describe("the code view of a job", () => {
  it("every playable almanac entry has a program to read and a C++ and a Python version", () => {
    for (const e of JOB_DEX.filter((x) => !x.planned)) {
      expect(CODE_SOURCE[e.id], e.id).toBeDefined();
      expect(HIGH_LEVEL[e.id]!.cpp.length, e.id).toBeGreaterThan(80);
      expect(HIGH_LEVEL[e.id]!.python.length, e.id).toBeGreaterThan(60);
    }
  });

  it("runs the real program: it halts, shows the expected text, and the counts add up", () => {
    for (const [id, src] of Object.entries(CODE_SOURCE)) {
      const p = profileOf(src.template, src.scales[0]!);
      expect(p.steps, id).toBeGreaterThan(10);
      expect(OP_CLASSES.reduce((n, c) => n + p.mix[c], 0), id).toBe(p.steps);
      expect(p.lines.reduce((n, l) => n + l.count, 0), id).toBe(p.steps);
      expect(p.mix.sys, id).toBe(1); // the one ecall
      expect(p.display.length, id).toBeGreaterThan(3);
      expect(p.codeWords + p.dataWords, id).toBe(p.lines.length);
      expect(p.lines.some((l) => l.labels.includes("main")), id).toBe(true);
    }
  });

  it("tells the jobs apart by what they lean on", () => {
    const r = (id: string, scale = 1) => reliance(profileOf(CODE_SOURCE[id]!.template, scale));
    expect(profileOf("cli.calc", 2).mix.mul).toBeGreaterThan(profileOf("cli.log", 2).mix.mul);
    expect(r("calc", 4).memory).toBeLessThan(r("db").memory); // a multiply chain against a table of lookups
    expect(r("scan", 4).memory).toBeGreaterThan(r("calc", 4).memory);
    expect(mixShares(profileOf("db.index", 1)).ld).toBeGreaterThan(0.03);
    const db = profileOf("db.index", 1);
    expect(db.pages).toBeGreaterThanOrEqual(128); // the whole 32K table, one page per record
    expect(profileOf("db.index", 4).pages).toBeGreaterThan(db.pages * 3);
    expect(db.taken).toBeGreaterThan(0);
  });
});
