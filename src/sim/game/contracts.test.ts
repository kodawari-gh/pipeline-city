import { describe, expect, it } from "vitest";
import { BLOCK_BYTES } from "../isa/memmap";
import { Prng } from "../machine/prng";
import { CONTRACT_KINDS, datasetBytes, kibOf, nextReadGap, rollTerms, type ContractOffer } from "./contracts";
import { ECONOMY, holdPay, lossPenalty, readFee } from "./economy";
import { Game, type Phase } from "./game";
import { rig } from "./testkit";

// Hardware tests, not level tests.
ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

function runUntil(g: Game, phase: Phase, max = 4000): void {
  let t = 0;
  while (g.currentPhase() !== phase && t++ < max) g.advanceBaseTick();
  expect(g.currentPhase()).toBe(phase);
}
const ticks = (g: Game, n: number): void => { for (let i = 0; i < n; i++) g.advanceBaseTick(); };

/** A hand-made offer with fixed terms (no randomness). */
function offer(g: Game, over: Partial<ContractOffer> = {}): ContractOffer {
  const kind = CONTRACT_KINDS[0]!;
  const o: ContractOffer = {
    id: g.nextContractId++, offeredAt: g.baseTick, expiresAt: g.baseTick + 100_000, kind: "cloud.archive", client: "Acme Archives", seed: 5, blocks: 16, duration: 600,
    readEvery: 100, readDeadline: 40, readTicks: 4, minDriveTier: kind.minDriveTier, levelPay: 1, maxMisses: 3, ...over,
  };
  g.contractOffers.push(o);
  return o;
}

/** An OS rig at level 4 (OS drive: HDD) with a second drive `spec` formatted by the OS (filesystem tier `fsTier`), booted to idle. */
function cloudRig(spec: "ssd1" | "nvme2" | "raid2" | null = "ssd1", fsTier = 2): { g: Game; id: string } {
  const g = rig("hdd0", { startLevel: 4 });
  if (g.powered) g.powerButton();
  g.os!.spec = { ...g.os!.spec, fsTier };
  let id = g.os!.deviceId;
  if (spec) {
    const b = g.purchase(spec);
    if (!b.ok) throw new Error(b.reason);
    expect(g.install(b.invId).ok).toBe(true);
    id = g.board.devices.find((d) => d.spec === spec)!.id;
    expect(g.formatDrive(id)).toMatchObject({ ok: true });
  }
  g.powerButton();
  runUntil(g, "idle-os");
  return { g, id };
}

describe("contract model", () => {
  it("rolls terms inside the kind's ranges, from a seed", () => {
    for (const k of CONTRACT_KINDS) {
      const t = rollTerms(new Prng(3), k, 1.5);
      expect(t.blocks).toBeGreaterThanOrEqual(k.blocks[0]);
      expect(t.blocks).toBeLessThanOrEqual(k.blocks[1]);
      expect(t.duration).toBeGreaterThanOrEqual(k.duration[0]);
      expect(t.levelPay).toBe(1.5);
      expect(t.maxMisses).toBeGreaterThanOrEqual(2);
      expect(rollTerms(new Prng(3), k, 1.5)).toEqual(t);
    }
  });

  it("the read gap is 0.5 to 1.5 times the mean and repeatable", () => {
    const rng = new Prng(9);
    for (let i = 0; i < 50; i++) {
      const g = nextReadGap(rng, 100);
      expect(g).toBeGreaterThanOrEqual(50);
      expect(g).toBeLessThanOrEqual(150);
    }
    expect(nextReadGap(new Prng(9), 100)).toBe(nextReadGap(new Prng(9), 100));
  });

  it("the dataset content is regenerated from its seed", () => {
    expect(datasetBytes(7, 2)).toEqual(datasetBytes(7, 2));
    expect(datasetBytes(7, 2)).not.toEqual(datasetBytes(8, 2));
    expect(datasetBytes(7, 2)).toHaveLength(2 * BLOCK_BYTES);
  });

  it("economy helpers: hot pays more, mirrored pays a bonus, a breach costs less than a loss", () => {
    const kib = kibOf(16);
    expect(holdPay(ECONOMY, kib, true, false)).toBeGreaterThan(holdPay(ECONOMY, kib, false, false));
    expect(holdPay(ECONOMY, kib, false, true)).toBeCloseTo(holdPay(ECONOMY, kib, false, false) * (1 + ECONOMY.contracts.mirrorBonus));
    expect(readFee(ECONOMY, true)).toBeGreaterThan(readFee(ECONOMY, false));
    expect(lossPenalty(ECONOMY, kib, 1, true)).toBeLessThan(lossPenalty(ECONOMY, kib, 1));
    expect(holdPay(ECONOMY, kib, false, false, 2)).toBeCloseTo(2 * holdPay(ECONOMY, kib, false, false));
  });
});

describe("offers", () => {
  it("do not exist before the first level of the class, and never in the tray or the net queue", () => {
    const g = rig("hdd0", { startLevel: 3 });
    ticks(g, ECONOMY.contracts.offerEvery * 3);
    expect(g.contractOffers).toHaveLength(0);
    expect(g.snapshot().contracts!.open).toBe(false);
  });

  it("appear at level 4 over time, are capped, and leave the key queues alone", () => {
    const g = rig("hdd0", { startLevel: 4 });
    const tray = g.tray.waiting().length, offers = g.offersQ.waiting().length;
    ticks(g, ECONOMY.contracts.offerEvery * 8);
    expect(g.contractOffers.length).toBeGreaterThan(0);
    expect(g.contractOffers.length).toBeLessThanOrEqual(ECONOMY.contracts.offerCap);
    expect(g.tray.waiting().length).toBe(tray);
    expect(g.offersQ.waiting().length).toBe(offers);
    expect(g.snapshot().contracts!.open).toBe(true);
  });

  it("an ignored or unanswered offer never costs money or reputation", () => {
    const { g } = cloudRig();
    const money = g.money, rep = g.avgTurnaround;
    const a = offer(g), b = offer(g, { expiresAt: g.baseTick + 5 });
    expect(g.ignoreContract(a.id)).toMatchObject({ ok: true });
    expect(g.ignoreContract(a.id).ok).toBe(false);
    ticks(g, 10);
    expect(g.contractOffers.some((o) => o.id === b.id)).toBe(false);
    expect(g.money).toBe(money);
    expect(g.avgTurnaround).toBe(rep);
    expect(g.jobLog.filter((e) => e.contract)).toHaveLength(0);
  });
});

describe("accepting", () => {
  it("needs an OS", () => {
    const g = rig("hdd0", { os: false, startLevel: 4 });
    const o = offer(g);
    expect(g.acceptContract(o.id).ok).toBe(false);
    expect(g.contracts).toHaveLength(0);
  });

  it("needs a filesystem tier 2 OS (os1 cannot store files)", () => {
    const { g } = cloudRig(null, 1);
    const o = offer(g);
    const r = g.acceptContract(o.id);
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).toMatch(/Paged OS 2.0/);
    expect(g.snapshot().contracts!.offers[0]!.canAccept).toBe(false);
  });

  it("needs the OS up (not powered off) and a mounted clean drive", () => {
    const { g } = cloudRig();
    const o = offer(g);
    g.powerButton();
    expect(g.acceptContract(o.id).ok).toBe(false);
    const fresh = rig("hdd0", { startLevel: 4 });
    if (fresh.powered) fresh.powerButton();
    fresh.os!.spec = { ...fresh.os!.spec, fsTier: 2 };
    const b = fresh.purchase("ssd1");
    if (b.ok) fresh.install(b.invId);
    fresh.disks.get(fresh.board.devices.find((d) => d.spec === "ssd1")!.id) ?? fresh.diskFor(fresh.board.devices.find((d) => d.spec === "ssd1")!);
    fresh.powerButton();
    runUntil(fresh, "idle-os");
    const o2 = offer(fresh);
    // the SSD is unformatted: only the OS drive (formatted by the install) can hold it, and it works there
    const r = fresh.acceptContract(o2.id, fresh.board.devices.find((d) => d.spec === "ssd1")!.id);
    expect(r.ok).toBe(false);
  });

  it("puts a dataset file on the slowest drive that qualifies and records the contract", () => {
    const { g, id } = cloudRig("ssd1");
    const o = offer(g);
    const plan = g.contractPlan(o);
    expect(plan.deviceId).not.toBeNull();
    const r = g.acceptContract(o.id);
    expect(r.ok).toBe(true);
    expect(g.contractOffers).toHaveLength(0);
    const c = g.contracts[0]!;
    const disk = g.disks.get(c.deviceId)!;
    expect(disk.fs.file(c.fileId)).toMatchObject({ kind: "dataset", owner: `c${o.id}` });
    expect(disk.fs.file(c.fileId)!.extents.reduce((n, e) => n + e.len, 0)).toBe(16);
    expect(c.deviceId === id || c.deviceId === g.os!.deviceId).toBe(true);
    expect(c.endsAt - c.startedAt).toBe(600);
    expect(c.mirrored).toBe(false);
    expect(c.rate).toBeCloseTo(holdPay(ECONOMY, kibOf(16), false, false, 1));
  });

  it("is refused when the drive has no room", () => {
    const { g, id } = cloudRig("ssd1");
    for (const d of [id, g.os!.deviceId]) {
      const disk = g.disks.get(d)!;
      disk.fs.create("filler", "program", disk.fs.freeBlocks());
    }
    const o = offer(g, { blocks: 1 });
    const r = g.acceptContract(o.id);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/free blocks/);
    expect(g.contracts).toHaveLength(0);
  });

  it("a hot contract needs an SSD or better: the HDD refuses, the SSD takes it", () => {
    const hddOnly = cloudRig(null, 2);
    const hot = offer(hddOnly.g, { kind: "cloud.hot", minDriveTier: 1, blocks: 12 });
    const r = hddOnly.g.acceptContract(hot.id);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/SSD/);
    const { g } = cloudRig("ssd1");
    const hot2 = offer(g, { kind: "cloud.hot", minDriveTier: 1, blocks: 12 });
    expect(g.acceptContract(hot2.id).ok).toBe(true);
    expect(g.contracts[0]!.drive).toMatch(/SSD/);
  });
});

describe("holding", () => {
  it("pays per tick while the data is served, and adds a bonus and reputation at the end", () => {
    const { g } = cloudRig("ssd1");
    const o = offer(g, { duration: 300, readEvery: 100000 });
    g.acceptContract(o.id);
    const money = g.money, base = g.clientBase;
    ticks(g, 100);
    const earned = g.money - money;
    expect(earned).toBeGreaterThan(0);
    expect(Math.abs(earned - 100 * g.contracts[0]!.rate)).toBeLessThanOrEqual(1);
    ticks(g, 250);
    expect(g.contracts).toHaveLength(0);
    const e = g.jobLog.find((x) => x.contract)!;
    expect(e.outcome).toBe("completed");
    expect(e.id).toBeGreaterThanOrEqual(1_000_000);
    expect(e.type).toBe("cloud.archive");
    expect(e.contract).toMatchObject({ client: "Acme Archives", blocks: 16, mirrored: false });
    expect(e.payout).toBeGreaterThan(earned);
    expect(g.clientBase).toBeGreaterThan(base);
    expect(g.disks.get(g.os!.deviceId)!.fs.list("dataset")).toHaveLength(0);
    expect(g.snapshot().jobLog!.some((x) => x.contract)).toBe(true);
  });

  it("serves reads at seeded times and counts them", () => {
    const { g } = cloudRig("ssd1");
    const o = offer(g, { duration: 2000, readEvery: 60, readDeadline: 40, readTicks: 3, maxMisses: 50 });
    g.acceptContract(o.id);
    ticks(g, 600);
    const c = g.contracts[0]!;
    expect(c.served).toBeGreaterThan(3);
    expect(c.missed).toBe(0);
    // the same seed reads at the same times
    const again = cloudRig("ssd1");
    const o2 = offer(again.g, { duration: 2000, readEvery: 60, readDeadline: 40, readTicks: 3, maxMisses: 50 });
    again.g.acceptContract(o2.id);
    ticks(again.g, 600);
    expect(again.g.contracts[0]!.served).toBe(c.served);
  });
});

describe("unservable reads", () => {
  it("a powered-off machine misses every read: a fee each, no data lost", () => {
    const { g } = cloudRig("ssd1");
    const o = offer(g, { duration: 5000, readEvery: 50, maxMisses: 100 });
    g.acceptContract(o.id);
    g.powerButton();
    const money = g.money;
    ticks(g, 400);
    const c = g.contracts[0]!;
    expect(c.missed).toBeGreaterThan(2);
    expect(c.fees).toBeGreaterThan(0);
    expect(g.money).toBe(Math.max(0, money - c.fees));
    expect(g.disks.get(c.deviceId)!.fs.file(c.fileId)!.lost).toBe(false);
    expect(g.snapshot().contracts!.active[0]!.health).toBe("unservable");
  });

  it("too many missed reads breach the contract: a smaller penalty, some reputation, a log line", () => {
    const { g } = cloudRig("ssd1");
    const o = offer(g, { duration: 5000, readEvery: 30, maxMisses: 2 });
    g.acceptContract(o.id);
    g.powerButton();
    const rep = g.avgTurnaround;
    ticks(g, 400);
    expect(g.contracts).toHaveLength(0);
    const e = g.jobLog.find((x) => x.contract)!;
    expect(e.outcome).toBe("breached");
    expect(e.contract!.missed).toBeGreaterThan(2);
    expect(g.avgTurnaround).toBeGreaterThan(rep);
  });

  it("a read is refused when the drive queue is above its depth", () => {
    const { g } = cloudRig("ssd1");
    const o = offer(g, { duration: 5000, readEvery: 20, maxMisses: 100 });
    g.acceptContract(o.id);
    const disk = g.disks.get(g.contracts[0]!.deviceId)!;
    disk.queued = disk.queueDepth + 5;
    ticks(g, 100);
    expect(g.contracts[0]!.missed).toBeGreaterThan(0);
    expect(g.contracts[0]!.served).toBe(0);
  });

  it("an NVMe queue is deeper than a SATA one: the same pile-up misses on SATA, not on NVMe", () => {
    const load = (spec: "ssd1" | "nvme2"): number => {
      const { g, id } = cloudRig(spec);
      const o = offer(g, { duration: 5000, readEvery: 20, maxMisses: 100 });
      expect(g.acceptContract(o.id, id).ok).toBe(true);
      const disk = g.disks.get(g.contracts[0]!.deviceId)!;
      disk.queued = 8;
      ticks(g, 100);
      return g.contracts[0]!.missed;
    };
    expect(load("ssd1")).toBeGreaterThan(0);
    expect(load("nvme2")).toBe(0);
  });
});

describe("lost data", () => {
  it("bad blocks under the dataset lose the contract: penalty, reputation, log", () => {
    const { g } = cloudRig("ssd1");
    const o = offer(g, { duration: 5000, readEvery: 100000 });
    g.acceptContract(o.id);
    const c = g.contracts[0]!;
    const disk = g.disks.get(c.deviceId)!;
    const first = disk.fs.file(c.fileId)!.extents[0]!.first;
    const money = g.money, rep = g.avgTurnaround;
    disk.failGroup(Math.floor(first / 8));
    ticks(g, 2);
    expect(g.contracts).toHaveLength(0);
    const e = g.jobLog.find((x) => x.contract)!;
    expect(e.outcome).toBe("lost");
    expect(e.payout).toBeLessThan(0);
    expect(g.money).toBeLessThan(money);
    expect(g.avgTurnaround).toBeGreaterThan(rep);
    expect(disk.fs.list("dataset")).toHaveLength(0);
    expect(disk.badGroups).toBe(1);
  });

  it("a burnt drive loses the contract", () => {
    const { g } = cloudRig("ssd1");
    const o = offer(g, { duration: 5000, readEvery: 100000 });
    g.acceptContract(o.id);
    const c = g.contracts[0]!;
    g.board.devices.find((d) => d.id === c.deviceId)!.burnt = true;
    g.syncStorage();
    ticks(g, 2);
    expect(g.jobLog.find((x) => x.contract)!.outcome).toBe("lost");
  });

  it("the money never goes below zero", () => {
    const { g } = cloudRig("ssd1");
    const o = offer(g, { duration: 5000, readEvery: 100000 });
    g.acceptContract(o.id);
    g.money = 1;
    const c = g.contracts[0]!;
    g.disks.get(c.deviceId)!.fs.lose(c.fileId);
    ticks(g, 2);
    expect(g.money).toBe(0);
  });
});

describe("mirrored storage", () => {
  it("needs OS 4, pays a bonus and keeps the data when one member fails", () => {
    const three = cloudRig("raid2", 3);
    const o3 = offer(three.g);
    // only the OS drive qualifies at tier 3: the RAID module stays unmounted
    expect(three.g.contractPlan(o3).deviceId).toBe(three.g.os!.deviceId);
    expect(JSON.stringify(three.g.contractPlan(o3, three.id))).toMatch(/RAID module/);
    const { g, id } = cloudRig("raid2", 4);
    const o = offer(g, { duration: 5000, readEvery: 100000 });
    expect(g.acceptContract(o.id, id).ok).toBe(true);
    const c = g.contracts[0]!;
    expect(c.mirrored).toBe(true);
    expect(c.rate).toBeCloseTo(holdPay(ECONOMY, kibOf(16), false, true, 1));
    expect(c.rate).toBeGreaterThan(holdPay(ECONOMY, kibOf(16), false, false, 1));
    const disk = g.disks.get(id)!;
    disk.failGroup(Math.floor(disk.fs.file(c.fileId)!.extents[0]!.first / 8));
    ticks(g, 5);
    expect(g.contracts).toHaveLength(1);
    expect(g.contracts[0]!.missed).toBe(0);
    disk.twin!.failGroup(Math.floor(disk.fs.file(c.fileId)!.extents[0]!.first / 8));
    ticks(g, 2);
    expect(g.contracts).toHaveLength(0);
    expect(g.jobLog.find((x) => x.contract)!.outcome).toBe("lost");
  });
});

describe("snapshot", () => {
  it("lists offers with a drive and a reason, and running contracts with health", () => {
    const { g } = cloudRig("ssd1");
    offer(g);
    offer(g, { kind: "cloud.hot", minDriveTier: 1, blocks: 12 });
    const s = g.snapshot().contracts!;
    expect(s.offers).toHaveLength(2);
    expect(s.offers[0]!.canAccept).toBe(true);
    expect(s.offers[0]!.drives.length).toBeGreaterThan(0);
    expect(s.offers[1]!.hot).toBe(true);
    expect(s.offers[1]!.rate).toBeGreaterThan(s.offers[0]!.rate * 0.5);
    g.acceptContract(s.offers[0]!.id);
    const a = g.snapshot().contracts!.active[0]!;
    expect(a).toMatchObject({ health: "ok", client: "Acme Archives", mirrored: false });
    expect(a.left).toBeGreaterThan(0);
  });

  it("there are no contracts in the sandbox", () => {
    const g = new Game({ seed: 1, sandbox: true, preassembled: true, economy: { baseDemandPerTick: 0, startQueue: [] } });
    ticks(g, ECONOMY.contracts.offerEvery * 3);
    expect(g.contractOffers).toHaveLength(0);
    expect(g.snapshot().contracts!.open).toBe(false);
  });
});

describe("the fs need and the caps", () => {
  it("fs caps follow the mounted OS: tier and free bytes of a clean drive; none when the machine is off", async () => {
    const { needsMet } = await import("./levels");
    const { g } = cloudRig("ssd1");
    const caps = g.caps();
    expect(caps.fsTier).toBe(2);
    expect(caps.dataFreeBytes).toBeGreaterThan(0);
    expect(needsMet([{ kind: "fs", min: 2 }], caps).ok).toBe(true);
    expect(needsMet([{ kind: "fs", min: 4 }], caps).ok).toBe(false);
    expect(needsMet([{ kind: "fs", min: 2, freeBytes: 10_000_000 }], caps)).toMatchObject({ ok: false });
    expect(needsMet([{ kind: "fs", min: 2, freeBytes: 10_000_000 }], caps).missing[0]).toMatch(/free/);
    g.powerButton();
    expect(g.caps().fsTier).toBe(0);
    expect(needsMet([{ kind: "fs", min: 2 }], g.caps()).ok).toBe(false);
  });

  it("the cloud class and its almanac entries exist and never arrive as keys", async () => {
    const { jobClass, jobMix } = await import("./levels");
    const { dexEntry } = await import("./jobdex");
    expect(jobClass("cloud")).toMatchObject({ contract: true, firstLevel: 4 });
    expect(dexEntry("cloud.archive")).toMatchObject({ cls: "cloud", contract: true });
    expect(dexEntry("cloud.hot")!.needs).toContainEqual({ kind: "storage", minTier: 1 });
    for (let lvl = 1; lvl <= 18; lvl++) expect(jobMix(lvl, 1, {}, 0).some(([c]) => c.id === "cloud")).toBe(false);
  });
});
