import { describe, expect, it } from "vitest";
import { BLOCK_BYTES, STORAGE_BASE, STORAGE_BUF, STORAGE_REG, StorageStatus } from "../isa/memmap";
import { specsOfKind } from "../board";
import { Disk, StoragePort } from "./storage";
import { Machine } from "./machine";

/** A machine with one storage port at 1 device tick per base tick, so `advanceBaseTick` is one device tick. */
function rig(latency = 5, blockTicks = 3, blocks = 16) {
  const m = new Machine({ ramSize: 4096 });
  const port = new StoragePort("sata0", 0);
  m.addDevice(port);
  m.clock.setRate("sata0", { mul: 1, div: 1 });
  const disk = new Disk(blocks * BLOCK_BYTES, latency, blockTicks);
  port.attach(disk);
  const read = (lba: number): number => {
    m.bus.store32(STORAGE_BASE + STORAGE_REG.LBA, lba);
    m.bus.store32(STORAGE_BASE + STORAGE_REG.CMD, 1);
    let n = 0;
    while (m.bus.load32(STORAGE_BASE + STORAGE_REG.STATUS) & StorageStatus.Busy) { m.advanceBaseTick(); n++; }
    return n;
  };
  return { m, port, disk, read };
}

describe("block device on the bus", () => {
  it("reports presence, capacity and an idle status", () => {
    const { m } = rig();
    const st = m.bus.load32(STORAGE_BASE + STORAGE_REG.STATUS);
    expect(st & StorageStatus.Present).toBeTruthy();
    expect(st & StorageStatus.Busy).toBe(0);
    expect(m.bus.load32(STORAGE_BASE + STORAGE_REG.BLOCKS)).toBe(16);
  });

  it("writes a block through the buffer and reads it back, after the access latency", () => {
    const { m, disk, read } = rig(5, 3);
    for (let i = 0; i < 64; i++) m.bus.store32(STORAGE_BASE + STORAGE_BUF + 4 * i, 0x1000 + i);
    m.bus.store32(STORAGE_BASE + STORAGE_REG.LBA, 9);
    m.bus.store32(STORAGE_BASE + STORAGE_REG.CMD, 2);
    expect(m.bus.load32(STORAGE_BASE + STORAGE_REG.STATUS) & StorageStatus.Busy).toBeTruthy();
    expect(disk.bytesWritten).toBe(0); // not committed until the device ticks run out
    let n = 0;
    while (m.bus.load32(STORAGE_BASE + STORAGE_REG.STATUS) & StorageStatus.Busy) { m.advanceBaseTick(); n++; }
    expect(n).toBe(5 + 3); // seek + one block
    expect(disk.bytesWritten).toBe(BLOCK_BYTES);
    expect(disk.usedBlocks).toBe(1);
    for (let i = 0; i < 64; i++) m.bus.store32(STORAGE_BASE + STORAGE_BUF + 4 * i, 0);
    read(9);
    expect(m.bus.load32(STORAGE_BASE + STORAGE_BUF + 4 * 63)).toBe(0x1000 + 63);
    expect(disk.bytesRead).toBe(BLOCK_BYTES);
  });

  it("a read right after the previous block skips the seek (sequential access)", () => {
    const { read } = rig(20, 4);
    expect(read(2)).toBe(24); // first access: seek + block
    expect(read(3)).toBe(4); // next block: just the transfer
    expect(read(3)).toBe(24); // same block again is not sequential
    expect(read(9)).toBe(24); // a jump is a seek
  });

  it("flags errors instead of hanging: bad block, no media, command while busy", () => {
    const { m, port, read } = rig();
    m.bus.store32(STORAGE_BASE + STORAGE_REG.LBA, 999);
    m.bus.store32(STORAGE_BASE + STORAGE_REG.CMD, 1);
    const st = m.bus.load32(STORAGE_BASE + STORAGE_REG.STATUS);
    expect(st & StorageStatus.Error).toBeTruthy();
    expect(st & StorageStatus.Busy).toBe(0);
    m.bus.store32(STORAGE_BASE + STORAGE_REG.LBA, 1);
    m.bus.store32(STORAGE_BASE + STORAGE_REG.CMD, 1);
    m.bus.store32(STORAGE_BASE + STORAGE_REG.CMD, 1); // second command while busy
    expect(m.bus.load32(STORAGE_BASE + STORAGE_REG.STATUS) & StorageStatus.Error).toBeTruthy();
    port.attach(null);
    expect(m.bus.load32(STORAGE_BASE + STORAGE_REG.STATUS) & StorageStatus.Present).toBe(0);
    expect(read(0)).toBe(0);
  });

  it("an LBA above 255 survives the byte-wise register write", () => {
    const { m, disk } = rig(1, 1, 600);
    disk.data[300 * BLOCK_BYTES] = 77;
    m.bus.store32(STORAGE_BASE + STORAGE_REG.LBA, 300);
    m.bus.store32(STORAGE_BASE + STORAGE_REG.CMD, 1);
    while (m.bus.load32(STORAGE_BASE + STORAGE_REG.STATUS) & StorageStatus.Busy) m.advanceBaseTick();
    expect(m.bus.load8(STORAGE_BASE + STORAGE_BUF)).toBe(77);
  });
});

describe("storage tiers", () => {
  const [hdd, ssd, nvme] = specsOfKind("storage");

  it("is a ladder: HDD (SATA), SATA SSD, NVMe (M.2), faster and pricier each step", () => {
    expect([hdd!.id, ssd!.id, nvme!.id]).toEqual(["hdd0", "ssd1", "nvme2"]);
    expect([hdd!.slot, ssd!.slot, nvme!.slot]).toEqual(["sata", "sata", "m2"]);
    expect(hdd!.price).toBeLessThan(ssd!.price);
    expect(ssd!.price).toBeLessThan(nvme!.price);
    expect(hdd!.idleW).toBeGreaterThanOrEqual(ssd!.idleW); // the HDD spins
  });

  it("latency and sustained throughput in seconds improve with the tier (simulated, not looked up)", () => {
    // Read 8 sequential blocks through a port running at the tier's own base clock (device ticks per second = clock * 36).
    const timeFor = (s: typeof hdd, blocks: number): number => {
      const m = new Machine({ ramSize: 4096 });
      const port = new StoragePort("sata0", 0);
      m.addDevice(port);
      m.clock.setRate("sata0", { mul: Math.round(s!.clock.base * 36), div: 1 });
      port.attach(new Disk(s!.capacityBytes, s!.latencyTicks, s!.blockTicks));
      let sub = 0;
      for (let b = 0; b < blocks; b++) {
        m.bus.store32(STORAGE_BASE + STORAGE_REG.LBA, b);
        m.bus.store32(STORAGE_BASE + STORAGE_REG.CMD, 1);
        while (m.bus.load32(STORAGE_BASE + STORAGE_REG.STATUS) & StorageStatus.Busy) { m.clock.advance(1); sub++; }
      }
      return sub / 1000;
    };
    const first = [hdd, ssd, nvme].map((s) => timeFor(s, 1));
    const eight = [hdd, ssd, nvme].map((s) => timeFor(s, 8));
    expect(first[0]!).toBeGreaterThan(first[1]!);
    expect(first[1]!).toBeGreaterThan(first[2]!);
    expect(eight[0]!).toBeGreaterThan(eight[1]!);
    expect(eight[1]!).toBeGreaterThan(eight[2]!);
    // throughput: the marginal block costs blockTicks / clock
    const perBlock = [hdd, ssd, nvme].map((s, i) => (eight[i]! - first[i]!) / 7);
    expect(perBlock[0]!).toBeGreaterThan(perBlock[1]!);
    expect(perBlock[1]!).toBeGreaterThan(perBlock[2]!);
    expect(first[0]! / first[2]!).toBeGreaterThan(20); // HDD seek is the dominant cost
  });
});
