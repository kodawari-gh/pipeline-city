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

describe("wear and bad blocks", () => {
  const worn = (opts: ConstructorParameters<typeof Disk>[3] = {}) => {
    const d = new Disk(64 * BLOCK_BYTES, 10, 2, { enduranceBlocks: 10, seed: 3, ...opts });
    d.mount = "clean";
    return d;
  };

  it("counts writes per 8-block group and turns a group bad past its endurance", () => {
    const d = worn();
    expect(d.groups).toBe(8);
    for (let i = 0; i < 5; i++) d.noteWrite(9);
    expect(d.wear[1]).toBe(5);
    expect(d.wear[0]).toBe(0);
    expect(d.badGroups).toBe(0);
    expect(d.wearPct).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) d.noteWrite(9);
    expect(d.badGroups).toBe(1);
    expect(d.isBad(8)).toBe(true);
    expect(d.isBad(16)).toBe(false);
    expect(d.wear[1]).toBeLessThanOrEqual(12); // a bad group stops counting
  });

  it("each group has its own endurance, +-20% around the spec", () => {
    const d = worn({ enduranceBlocks: 1000 });
    const limits = Array.from({ length: d.groups }, (_, g) => d.limitOf(g));
    for (const l of limits) { expect(l).toBeGreaterThanOrEqual(800); expect(l).toBeLessThanOrEqual(1200); }
    expect(new Set(limits).size).toBeGreaterThan(1);
  });

  it("a bad group loses the extents on it: the file keeps its record with a lost flag", () => {
    const d = worn();
    const a = d.fs.create("c1", "dataset", 8, { at: 0 })!;
    const b = d.fs.create("c2", "dataset", 8, { at: 8 })!;
    d.failGroup(1);
    expect(a.lost).toBe(false);
    expect(b.lost).toBe(true);
    expect(d.fs.lostBlocks()).toBe(8);
    expect(d.fs.usage().lostBlocks).toBe(8);
    const kinds = d.fs.runs().map((r) => r.kind);
    expect(kinds.slice(0, 2)).toEqual(["dataset", "lost"]);
    expect(d.mount).toBe("clean"); // datasets are not metadata
  });

  it("a bad block under free space shows as bad and is not allocated", () => {
    const d = worn();
    d.failGroup(2);
    expect(d.fs.runs().find((r) => r.kind === "bad")).toMatchObject({ start: 16, len: 8 });
    const f = d.fs.create("c", "dataset", 64 - 8)!;
    expect(f).not.toBeNull();
    expect(f.extents.some((e) => e.first <= 16 && e.first + e.len > 16)).toBe(false);
    expect(d.fs.create("c", "dataset", 1)).toBeNull(); // full: the bad group is not free
    expect(d.fs.create("c", "dataset", 4, { at: 16 })).toBeNull();
  });

  it("a bad block under the OS or metadata damages the filesystem", () => {
    const d = worn();
    d.fs.create("os", "os", 8, { at: 0 });
    d.failGroup(0);
    expect(d.mount).toBe("damaged");
    const e = worn();
    e.fs.create("os", "spool", 8, { at: 0, soft: true });
    e.failGroup(0);
    expect(e.mount).toBe("clean"); // spool loss is only a lost file
  });

  it("a format wipes the ledger but the media stays worn and bad", () => {
    const d = worn();
    d.fs.create("c", "dataset", 8, { at: 8 });
    d.noteWrite(0);
    d.failGroup(1);
    d.format();
    expect(d.fs.list()).toHaveLength(0);
    expect(d.badGroups).toBe(1);
    expect(d.isBad(8)).toBe(true);
    expect(d.wear[0]).toBe(1);
  });

  it("loseKind marks every file of a kind lost (a burnt drive)", () => {
    const d = worn();
    d.fs.create("a", "dataset", 4);
    d.fs.create("b", "dataset", 4);
    d.fs.create("os", "os", 4);
    expect(d.fs.loseKind("dataset")).toBe(2);
    expect(d.fs.list("dataset").every((f) => f.lost)).toBe(true);
    expect(d.fs.list("os")[0]!.lost).toBe(false);
    expect(d.fs.loseKind("dataset")).toBe(0);
  });

  it("a rare mechanical fault can fail a group early (spinning disk), repeatably for one seed", () => {
    const bad = (seed: number) => {
      const d = new Disk(64 * BLOCK_BYTES, 10, 2, { mechBadRate: 0.05, seed });
      for (let i = 0; i < 400; i++) d.noteWrite(i % 64);
      return d.badGroups;
    };
    expect(bad(5)).toBeGreaterThan(0);
    expect(bad(5)).toBe(bad(5));
    const none = new Disk(64 * BLOCK_BYTES, 10, 2, { seed: 5 });
    for (let i = 0; i < 400; i++) none.noteWrite(i % 64);
    expect(none.badGroups).toBe(0);
  });

  describe("a mirrored module", () => {
    const mirror = () => {
      const d = new Disk(64 * BLOCK_BYTES, 10, 2, { enduranceBlocks: 10, seed: 3, mirror: true });
      d.mount = "clean";
      return d;
    };

    it("survives the loss of one member's group, and loses data when both fail", () => {
      const d = mirror();
      const f = d.fs.create("c", "dataset", 8, { at: 0 })!;
      d.failGroup(0);
      expect(f.lost).toBe(false);
      expect(d.blockLost(0)).toBe(false);
      expect(d.fs.runs()[0]!.kind).toBe("dataset");
      d.twin!.failGroup(0);
      expect(f.lost).toBe(true);
      expect(d.fs.runs()[0]!.kind).toBe("lost");
    });

    it("writes wear both members", () => {
      const d = mirror();
      d.noteWrite(3);
      expect(d.wear[0]).toBe(1);
      expect(d.twin!.wear[0]).toBe(1);
    });

    it("a format wipes both members' ledgers", () => {
      const d = mirror();
      d.fs.create("c", "dataset", 4);
      d.format();
      expect(d.fs.list()).toHaveLength(0);
      expect(d.mount).toBe("unformatted");
    });
  });
});
