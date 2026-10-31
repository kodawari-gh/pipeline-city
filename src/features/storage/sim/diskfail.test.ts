import { describe, expect, it } from "vitest";
import { Game, type Phase } from "@/worker/game/game";
import { ECONOMY } from "../../economy/sim/economy";
import { rig } from "@/worker/game/testkit";

// Hardware tests, not level tests.
ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

function runUntil(g: Game, phase: Phase, max = 4000): void {
  let t = 0;
  while (g.currentPhase() !== phase && t++ < max) g.advanceBaseTick();
  expect(g.currentPhase()).toBe(phase);
}

/** An OS rig (HDD holds the OS) plus a second drive `spec`, formatted by the OS at `fsTier`, booted to idle. */
function withData(spec: "ssd1" | "nvme2" | "raid2", fsTier = 4): { g: Game; id: string } {
  const g = rig("hdd0");
  if (g.powered) g.powerButton();
  g.os!.spec = { ...g.os!.spec, fsTier };
  const b = g.purchase(spec);
  if (!b.ok) throw new Error(b.reason);
  expect(g.install(b.invId).ok).toBe(true);
  const id = g.board.devices.find((d) => d.spec === spec)!.id;
  expect(g.formatDrive(id)).toMatchObject({ ok: true });
  g.powerButton();
  runUntil(g, "idle-os");
  return { g, id };
}

describe("canServe", () => {
  it("serves an intact dataset on a mounted drive with the OS up", () => {
    const { g, id } = withData("ssd1");
    const f = g.disks.get(id)!.fs.create("c1", "dataset", 8)!;
    expect(g.canServe(id, f.id)).toBe(true);
    expect(g.canServe(id, 999)).toBe(false);
  });

  it("is false when the OS is down (machine off)", () => {
    const { g, id } = withData("ssd1");
    const f = g.disks.get(id)!.fs.create("c1", "dataset", 8)!;
    g.powerButton();
    expect(g.canServe(id, f.id)).toBe(false);
  });

  it("is false while the drive is not mounted", () => {
    const g = rig("hdd0");
    if (g.powered) g.powerButton();
    g.os!.spec = { ...g.os!.spec, fsTier: 2 };
    const b = g.purchase("ssd1");
    if (!b.ok) throw new Error(b.reason);
    g.install(b.invId);
    const id = g.board.devices.find((d) => d.spec === "ssd1")!.id;
    g.powerButton();
    runUntil(g, "idle-os");
    expect(g.canServe(id, 1)).toBe(false); // unformatted: unmounted, nothing to serve
  });

  it("is false when the drive is burnt, and the burn loses every dataset on it", () => {
    const { g, id } = withData("ssd1");
    const disk = g.disks.get(id)!;
    const f = disk.fs.create("c1", "dataset", 8)!;
    g.board.devices.find((d) => d.id === id)!.burnt = true;
    g.syncStorage();
    expect(disk.fs.file(f.id)!.lost).toBe(true);
    expect(g.canServe(id, f.id)).toBe(false);
    const run = g.snapshot().storage.find((s) => s.deviceId === id)!;
    expect(run.fs.runs.some((r) => r.kind === "lost")).toBe(true);
    expect(run.lostBlocks).toBe(8);
  });

  it("is false for a file whose blocks went bad", () => {
    const { g, id } = withData("ssd1");
    const disk = g.disks.get(id)!;
    const f = disk.fs.create("c1", "dataset", 8)!;
    disk.failGroup(Math.floor(f.extents[0]!.first / 8));
    expect(g.canServe(id, f.id)).toBe(false);
  });

  it("is false when the drive queue is deeper than its queue depth", () => {
    const { g, id } = withData("nvme2");
    const disk = g.disks.get(id)!;
    const f = disk.fs.create("c1", "dataset", 8)!;
    disk.queued = disk.queueDepth;
    expect(g.canServe(id, f.id)).toBe(true);
    disk.queued = disk.queueDepth + 1;
    expect(g.canServe(id, f.id)).toBe(false);
  });

  it("deeper queues for faster tiers", () => {
    const depth = (spec: "ssd1" | "nvme2"): number => {
      const w = withData(spec);
      return w.g.disks.get(w.id)!.queueDepth;
    };
    expect(depth("ssd1")).toBeLessThan(depth("nvme2"));
  });
});

describe("RAID mirror (raid2)", () => {
  it("is a purchasable item, no longer planned", () => {
    const g = rig("hdd0");
    expect(g.purchase("raid2").ok).toBe(true);
  });

  it("needs filesystem tier 4 to mount", () => {
    const g = rig("hdd0");
    if (g.powered) g.powerButton();
    g.os!.spec = { ...g.os!.spec, fsTier: 3 };
    const b = g.purchase("raid2");
    if (!b.ok) throw new Error(b.reason);
    expect(g.install(b.invId).ok).toBe(true);
    const id = g.board.devices.find((d) => d.spec === "raid2")!.id;
    g.diskFor(g.board.devices.find((d) => d.id === id)!).mount = "clean";
    g.powerButton();
    runUntil(g, "idle-os");
    expect(g.driveCanHold(id, "dataset")).toBe(false);
    expect(g.snapshot().storage.find((s) => s.deviceId === id)!.mount.phase).toBe("unmounted");
  });

  it("cannot hold the OS", () => {
    const g = rig("hdd0", { os: false });
    if (g.powered) g.powerButton();
    g.uninstall(g.board.devices.find((d) => d.spec === "hdd0")!.id);
    const b = g.purchase("raid2");
    if (!b.ok) throw new Error(b.reason);
    g.install(b.invId);
    const o = g.purchase("os1");
    if (!o.ok) throw new Error(o.reason);
    const r = g.install(o.invId);
    expect(r.ok).toBe(false);
  });

  it("mounts at tier 4 and keeps a dataset when one member's block goes bad", () => {
    const { g, id } = withData("raid2", 4);
    const disk = g.disks.get(id)!;
    expect(disk.twin).not.toBeNull();
    expect(g.driveCanHold(id, "dataset")).toBe(true);
    const f = disk.fs.create("c1", "dataset", 8)!;
    const grp = Math.floor(f.extents[0]!.first / 8);
    disk.failGroup(grp);
    expect(f.lost).toBe(false);
    expect(g.canServe(id, f.id)).toBe(true);
    const snap = g.snapshot().storage.find((s) => s.deviceId === id)!;
    expect(snap.mirror).toBe(true);
    expect(snap.badGroups).toBe(1);
    expect(snap.lostBlocks).toBe(0);
    disk.twin!.failGroup(grp);
    expect(g.canServe(id, f.id)).toBe(false);
    expect(g.snapshot().storage.find((s) => s.deviceId === id)!.lostBlocks).toBe(8);
  });

  it("a plain drive loses the same dataset on one bad group", () => {
    const { g, id } = withData("ssd1");
    const disk = g.disks.get(id)!;
    const f = disk.fs.create("c1", "dataset", 8)!;
    disk.failGroup(Math.floor(f.extents[0]!.first / 8));
    expect(f.lost).toBe(true);
  });
});

describe("snapshot", () => {
  it("carries wearPct, badGroups, lostBlocks and the queue", () => {
    const { g, id } = withData("ssd1");
    const disk = g.disks.get(id)!;
    const s0 = g.snapshot().storage.find((s) => s.deviceId === id)!;
    expect(s0).toMatchObject({ wearPct: 0, badGroups: 0, lostBlocks: 0, mirror: false });
    expect(s0.queueDepth).toBe(disk.queueDepth);
    for (let i = 0; i < 300; i++) disk.noteWrite(0);
    const s1 = g.snapshot().storage.find((s) => s.deviceId === id)!;
    expect(s1.wearPct).toBeGreaterThan(0);
  });

  it("wear differs by tier: the same writes wear a SATA SSD more than an NVMe", () => {
    const a = withData("ssd1");
    const b = withData("nvme2");
    for (let i = 0; i < 200; i++) { a.g.disks.get(a.id)!.noteWrite(0); b.g.disks.get(b.id)!.noteWrite(0); }
    expect(a.g.disks.get(a.id)!.wearPct).toBeGreaterThan(b.g.disks.get(b.id)!.wearPct);
  });
});
