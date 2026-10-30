import { describe, expect, it } from "vitest";
import { BLOCK_BYTES, STORAGE_REG } from "../isa/memmap";
import { canHold, JOURNAL_BLOCKS, mountCost } from "./fs";
import { Disk, StoragePort } from "./storage";

/** A formatted drive (`clean`): the ledger tests allocate datasets on it. */
const disk = (blocks = 64) => {
  const d = new Disk(blocks * BLOCK_BYTES, 10, 2);
  d.mount = "clean";
  return d;
};

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
    expect(d.mount).toBe("unformatted");
  });

  it("shows blocks written outside any file as meta", () => {
    const d = disk();
    d.markUsed(3);
    expect(d.fs.runs().find((r) => r.start === 3)).toMatchObject({ kind: "meta", len: 1 });
  });
});

describe("mount state and tiers", () => {
  it("a blank drive is unformatted and holds nothing; only a clean drive accepts datasets", () => {
    const d = new Disk(64 * BLOCK_BYTES, 10, 2);
    expect(d.mount).toBe("unformatted");
    expect(canHold(d, "dataset")).toBe(false);
    expect(canHold(d, "spool")).toBe(false);
    expect(d.fs.create("a", "dataset", 4)).toBeNull();
    d.mount = "clean";
    expect(canHold(d, "dataset")).toBe(true);
    for (const m of ["dirty", "damaged"] as const) {
      d.mount = m;
      expect(canHold(d, "dataset")).toBe(false);
      expect(canHold(d, "spool")).toBe(true);
      expect(d.fs.create("a", "dataset", 4)).toBeNull();
    }
  });

  it("scan cost grows with the used blocks and the drive's block time", () => {
    const d = disk(256);
    d.fs.create("os", "os", 8, { at: 0 });
    const small = mountCost(d, false).scan;
    d.fs.create("a", "dataset", 200);
    expect(mountCost(d, false).scan).toBeGreaterThan(small);
    const slow = new Disk(256 * BLOCK_BYTES, 10, 20);
    slow.reserve(0, 200);
    const fast = new Disk(256 * BLOCK_BYTES, 10, 2);
    fast.reserve(0, 200);
    expect(mountCost(slow, false).scan).toBeGreaterThan(mountCost(fast, false).scan);
  });

  it("repair is a full pass without a journal and a short replay with one", () => {
    const d = disk(256);
    d.fs.create("a", "dataset", 200);
    const full = mountCost(d, false).repair;
    const replay = mountCost(d, true).repair;
    expect(full).toBe(200 * 2);
    expect(replay).toBe(JOURNAL_BLOCKS * 2 + 10);
    expect(replay).toBeLessThan(full);
  });

  it("a write in flight when the power goes leaves the drive dirty, an idle drive stays clean", () => {
    const d = disk();
    const port = new StoragePort("sata0", 0);
    port.attach(d);
    port.cutPower();
    expect(d.mount).toBe("clean");
    port.write(STORAGE_REG.LBA, 5);
    port.write(STORAGE_REG.CMD, 2);
    expect(port.isBusy).toBe(true);
    port.cutPower();
    expect(d.mount).toBe("dirty");
  });

  it("a read in flight does not dirty the drive", () => {
    const d = disk();
    const port = new StoragePort("sata0", 0);
    port.attach(d);
    port.write(STORAGE_REG.CMD, 1);
    port.cutPower();
    expect(d.mount).toBe("clean");
  });
});
