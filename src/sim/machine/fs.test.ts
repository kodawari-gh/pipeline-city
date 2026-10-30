import { describe, expect, it } from "vitest";
import { BLOCK_BYTES } from "../isa/memmap";
import { Disk } from "./storage";

const disk = (blocks = 64) => new Disk(blocks * BLOCK_BYTES, 10, 2);

describe("DiskFs", () => {
  it("starts as one free run", () => {
    const d = disk();
    expect(d.fs.runs()).toEqual([{ start: 0, len: 64, kind: "free", file: 0, filled: false }]);
    expect(d.fs.fragmentation()).toBe(0);
  });

  it("allocates a fixed region and marks it used", () => {
    const d = disk();
    const f = d.fs.create("os", "os", 8, { at: 0 })!;
    expect(f.extents).toEqual([{ first: 0, len: 8 }]);
    expect(d.usedBlocks).toBe(8);
    expect(d.fs.create("x", "dataset", 4, { at: 4 })).toBeNull();
  });

  it("a soft file owns blocks but fills as they are written", () => {
    const d = disk();
    d.fs.create("os", "spool", 16, { at: 8, soft: true });
    expect(d.usedBlocks).toBe(0);
    d.markUsed(8);
    d.markUsed(9);
    const runs = d.fs.runs().filter((r) => r.kind === "spool");
    expect(runs.map((r) => [r.start, r.len, r.filled])).toEqual([[8, 2, true], [10, 14, false]]);
    expect(d.fs.usage().byKind.spool).toBe(2);
    expect(d.fs.create("c", "dataset", 60)).toBeNull(); // the soft area is not free space
  });

  it("first-fit allocation splits over free runs and removal frees them", () => {
    const d = disk(16);
    const a = d.fs.create("a", "dataset", 4)!;
    const b = d.fs.create("b", "dataset", 4)!;
    d.fs.create("c", "dataset", 4);
    d.fs.remove(a.id);
    d.fs.remove(b.id);
    expect(d.fs.fragmentation()).toBeGreaterThan(0);
    const big = d.fs.create("d", "dataset", 10)!;
    expect(big.extents.length).toBe(2);
    expect(d.usedBlocks).toBe(14);
  });

  it("reports fragmentation when free space is split", () => {
    const d = disk(16);
    const f = [0, 1, 2, 3].map((i) => d.fs.create(`f${i}`, "dataset", 4)!);
    d.fs.remove(f[0]!.id);
    d.fs.remove(f[2]!.id);
    expect(d.fs.fragmentation()).toBeCloseTo(0.5);
  });

  it("refuses a file on a full drive", () => {
    const d = disk(8);
    expect(d.fs.create("a", "dataset", 8)).not.toBeNull();
    expect(d.fs.create("b", "dataset", 1)).toBeNull();
  });

  it("format() forgets every file", () => {
    const d = disk();
    d.fs.create("a", "dataset", 4);
    d.format();
    expect(d.fs.list()).toEqual([]);
    expect(d.usedBlocks).toBe(0);
  });

  it("shows blocks written outside any file as meta", () => {
    const d = disk();
    d.markUsed(3);
    expect(d.fs.runs().find((r) => r.start === 3)).toMatchObject({ kind: "meta", len: 1 });
  });
});
