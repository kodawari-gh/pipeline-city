// Game feature: cloud-storage contracts (docs/JOBS.md "Contracts"). Offers come to the job log, the player accepts or ignores them, an accepted one
// puts a dataset file on a mounted drive and holds it for a number of ticks, with read requests at seeded intervals. The model (terms, schedule) is
// in contracts.ts. Every export is a `Game` method (see game.ts).

import { deviceSpec, type InstalledDevice, type StorageSpec } from "../../board/sim";
import { BLOCK_BYTES } from "@/core/sim/memmap";
import { Prng } from "@/core/sim/prng";
import {
  CONTRACT_KINDS, CONTRACT_LOG_BASE, contractKind, datasetBytes, kibOf, nextReadGap, rollTerms, type Contract, type ContractOffer,
} from "./contracts";
import { holdPay, lossPenalty, readFee } from "./economy";
import type { Game } from "@/worker/game/game";
import { JOB_LOG_CAP, type JobOutcome } from "../../jobs/sim/joblog";
import { jobClass, levelPayMul } from "./levels";
import type { ContractOfferSnap, ContractSnap, ContractsSnap, Result } from "@/worker/game/types";

/** Contracts are on offer from the level the class starts at, outside the sandbox (its money is a constant). */
export function contractsOpen(this: Game): boolean {
  const cls = jobClass("cloud");
  return !!cls && !this.sandbox && this.level >= cls.firstLevel && this.progress.poweredOn;
}

/** Why drive `d` cannot hold the offer's dataset now, or null. */
export function contractDriveWhy(this: Game, offer: ContractOffer, d: InstalledDevice): string | null {
  const s = deviceSpec(d) as StorageSpec;
  if (d.burnt) return `${s.name} is burnt out`;
  if (!this.osUp()) return "the OS must be up: power the machine on";
  if (this.os!.spec.fsTier < 2) return `${this.os!.spec.name} cannot store files: Paged OS 2.0 or better`;
  if (s.mirror && this.os!.spec.fsTier < 4) return `${s.name} is a RAID module: it needs Multicore OS 4.0`;
  if (!this.driveUp(d.id)) return `${s.name} is not mounted`;
  if (!this.driveCanHold(d.id, "dataset")) return `${s.name} is not formatted clean`;
  if (s.tier < offer.minDriveTier) return `it needs a SATA SSD or better, ${s.name} is too slow`;
  const free = this.disks.get(d.id)!.fs.freeBlocks();
  if (free < offer.blocks) return `${s.name} has ${free} free blocks, the dataset needs ${offer.blocks}`;
  return null;
}

/** The drive an offer would go on: `deviceId` if given, else the slowest drive that qualifies (the fast ones stay free). With the reason when there is none. */
export function contractPlan(this: Game, offer: ContractOffer, deviceId?: string): { deviceId: string | null; why: string | null } {
  const drives = this.board.devices.filter((d) => deviceSpec(d).kind === "storage");
  if (deviceId !== undefined) {
    const d = drives.find((x) => x.id === deviceId);
    if (!d) return { deviceId: null, why: `no drive "${deviceId}"` };
    const why = this.contractDriveWhy(offer, d);
    return why ? { deviceId: null, why } : { deviceId: d.id, why: null };
  }
  if (drives.length === 0) return { deviceId: null, why: "install a storage drive first" };
  const ok = drives.filter((d) => !this.contractDriveWhy(offer, d)).sort((a, b) => deviceSpec(a).tier - deviceSpec(b).tier);
  if (ok.length > 0) return { deviceId: ok[0]!.id, why: null };
  // The reason of the drive that came closest (the one the player is most likely to fix): the first with a reason that is not about the OS being down.
  const whys = drives.map((d) => this.contractDriveWhy(offer, d)!);
  return { deviceId: null, why: whys.find((w) => /free blocks|SSD/.test(w)) ?? whys[0]! };
}

/** Accept an offer: the dataset goes onto a drive and the hold begins. */
export function acceptContract(this: Game, offerId: number, deviceId?: string): Result<{ contractId: number }> {
  const offer = this.contractOffers.find((o) => o.id === offerId);
  if (!offer) return { ok: false, reason: "that offer is gone" };
  if (!this.contractsOpen()) return { ok: false, reason: "no contracts are open" };
  const plan = this.contractPlan(offer, deviceId);
  if (!plan.deviceId) return { ok: false, reason: plan.why ?? "no drive can hold it" };
  const dev = this.board.devices.find((d) => d.id === plan.deviceId)!;
  const disk = this.disks.get(dev.id)!;
  const file = disk.fs.create(`c${offer.id}`, "dataset", offer.blocks, { seed: offer.seed });
  if (!file) return { ok: false, reason: "the drive has no room for the dataset" };
  disk.fs.write(file.id, datasetBytes(offer.seed, offer.blocks));
  const kind = contractKind(offer.kind)!;
  const mirrored = !!disk.twin;
  const rng = new Prng(offer.seed);
  const { id: _offerId, offeredAt: _at, expiresAt: _exp, ...terms } = offer;
  const c: Contract = {
    ...terms, id: this.nextContractId++, deviceId: dev.id, drive: deviceSpec(dev).name, fileId: file.id, startedAt: this.baseTick, endsAt: this.baseTick + offer.duration,
    mirrored, rate: holdPay(this.cfg, kibOf(offer.blocks), kind.hot, mirrored, offer.levelPay), owed: 0, rng: 0, nextRead: 0, pending: [], served: 0, missed: 0, earned: 0, fees: 0,
  };
  c.nextRead = this.baseTick + nextReadGap(rng, offer.readEvery);
  c.rng = rng.getState();
  this.contracts.push(c);
  this.dex[c.kind] ??= { seen: this.baseTick, runs: 0, best: 0 };
  this.contractOffers = this.contractOffers.filter((o) => o.id !== offerId);
  this.note("contract", `${c.client}: ${kind.name} accepted on ${c.drive}`);
  return { ok: true, contractId: c.id };
}

/** Turn an offer down. It just goes away: no penalty. */
export function ignoreContract(this: Game, offerId: number): Result<{ offerId: number }> {
  if (!this.contractOffers.some((o) => o.id === offerId)) return { ok: false, reason: "that offer is gone" };
  this.contractOffers = this.contractOffers.filter((o) => o.id !== offerId);
  return { ok: true, offerId };
}

/** One base tick of contracts: offers appear and expire, held data pays, reads are requested and served, contracts end. */
export function contractTick(this: Game): void {
  const cfg = this.cfg.contracts;
  const open = this.contractsOpen();
  this.contractOffers = this.contractOffers.filter((o) => this.baseTick < o.expiresAt);
  if (open && this.baseTick % cfg.offerEvery === 0 && this.contractOffers.length < cfg.offerCap) {
    const kinds = CONTRACT_KINDS.filter((k) => !this.sandboxKindsOff.has(k.id));
    const kind = kinds[this.contractRng.nextInt(kinds.length)]!;
    const terms = rollTerms(this.contractRng, kind, levelPayMul(this.level));
    this.contractOffers.push({ ...terms, id: this.nextContractId++, offeredAt: this.baseTick, expiresAt: this.baseTick + cfg.offerTtl });
  }
  const busy = new Set<string>(); // a drive serves one read per tick
  for (const c of [...this.contracts]) {
    const disk = this.disks.get(c.deviceId);
    const file = disk?.fs.file(c.fileId);
    const dev = this.board.devices.find((d) => d.id === c.deviceId);
    if (!disk || !file || file.lost || !dev || dev.burnt) { this.settleContract(c, "lost"); continue; }
    const kind = contractKind(c.kind)!;
    const up = this.driveUp(c.deviceId);
    if (up) {
      c.owed += c.rate;
      const whole = Math.floor(c.owed);
      if (whole > 0) { c.owed -= whole; c.earned += whole; if (!this.sandbox) this.money += whole; }
    }
    // a new read request
    if (this.baseTick >= c.nextRead) {
      const rng = new Prng(c.rng);
      c.nextRead = this.baseTick + nextReadGap(rng, c.readEvery);
      c.rng = rng.getState();
      if (this.canServe(c.deviceId, c.fileId)) {
        c.pending.push({ due: this.baseTick + c.readDeadline, left: c.readTicks });
        disk.queued++;
      } else this.missRead(c, kind.hot);
    }
    // serve the oldest read when the drive is free this tick
    if (up && c.pending.length > 0 && !busy.has(c.deviceId)) {
      busy.add(c.deviceId);
      const head = c.pending[0]!;
      if (--head.left <= 0) { c.pending.shift(); disk.queued = Math.max(0, disk.queued - 1); c.served++; }
    }
    // reads past their deadline are missed
    for (const r of c.pending.filter((p) => this.baseTick >= p.due && p.left > 0)) {
      c.pending.splice(c.pending.indexOf(r), 1);
      disk.queued = Math.max(0, disk.queued - 1);
      this.missRead(c, kind.hot);
    }
    if (c.missed > c.maxMisses) this.settleContract(c, "breached");
    else if (this.baseTick >= c.endsAt) this.settleContract(c, "completed");
  }
}

/** A read was not served: the client charges the fee. */
export function missRead(this: Game, c: Contract, hot: boolean): void {
  const fee = readFee(this.cfg, hot, c.levelPay);
  c.missed++;
  c.fees += fee;
  if (!this.sandbox) this.money = Math.max(0, this.money - fee);
}

/** End a contract: pay or charge, free the dataset, and write the log line. */
export function settleContract(this: Game, c: Contract, outcome: Extract<JobOutcome, "lost" | "breached" | "completed">): void {
  const cfg = this.cfg.contracts;
  const kind = contractKind(c.kind)!;
  const disk = this.disks.get(c.deviceId);
  if (disk) {
    disk.queued = Math.max(0, disk.queued - c.pending.length);
    disk.fs.remove(c.fileId);
  }
  let net = c.earned - c.fees;
  if (outcome === "completed") {
    const bonus = Math.round(c.earned * cfg.completeBonus);
    c.earned += bonus;
    net += bonus;
    if (!this.sandbox) this.money += bonus;
    this.addClientBase(this.reputation());
    const rec = this.dex[c.kind];
    if (rec) { rec.runs++; rec.best = rec.best === 0 ? c.duration : Math.min(rec.best, c.duration); }
  } else {
    const penalty = lossPenalty(this.cfg, kibOf(c.blocks), c.levelPay, outcome === "breached");
    c.fees += penalty;
    net -= penalty;
    if (!this.sandbox) this.money = Math.max(0, this.money - penalty);
    const units = outcome === "lost" ? cfg.lossRepUnits : cfg.breachRepUnits;
    this.avgTurnaround += this.cfg.emaAlpha * (this.cfg.giveUpTurnaround * this.patience() - this.avgTurnaround) * units;
  }
  this.contracts = this.contracts.filter((x) => x.id !== c.id);
  this.jobLog.push({
    id: CONTRACT_LOG_BASE + c.id, type: c.kind, scale: 1, outcome, arrival: c.startedAt, start: c.startedAt, finish: Math.min(this.baseTick, c.endsAt), end: this.baseTick,
    deadline: c.endsAt, payout: net, late: false, attempts: 1, os: this.os?.spec.tier ?? 0,
    contract: { client: c.client, drive: c.drive, blocks: c.blocks, mirrored: c.mirrored, served: c.served, missed: c.missed, earned: c.earned, fees: c.fees },
  });
  if (this.jobLog.length > JOB_LOG_CAP) this.jobLog.splice(0, this.jobLog.length - JOB_LOG_CAP);
  const word = outcome === "completed" ? `held to the end: $${net}` : outcome === "lost" ? "data LOST" : "breached";
  this.note("contract", `${c.client}: ${kind.name} ${word}`);
}

/** The contracts section of the snapshot: the open offers (with where each would go, or why it cannot) and the contracts running. */
export function contractsSnap(this: Game): ContractsSnap {
  const open = this.contractsOpen();
  const drives = this.board.devices.filter((d) => deviceSpec(d).kind === "storage");
  const offers: ContractOfferSnap[] = open ? this.contractOffers.map((o) => {
    const kind = contractKind(o.kind)!;
    const plan = this.contractPlan(o);
    const kib = kibOf(o.blocks);
    return {
      id: o.id, kind: o.kind, name: kind.name, client: o.client, hot: kind.hot, bytes: o.blocks * BLOCK_BYTES, duration: o.duration, readEvery: o.readEvery,
      minDriveTier: o.minDriveTier, rate: holdPay(this.cfg, kib, kind.hot, false, o.levelPay), mirrorRate: holdPay(this.cfg, kib, kind.hot, true, o.levelPay),
      fee: readFee(this.cfg, kind.hot, o.levelPay), penalty: lossPenalty(this.cfg, kib, o.levelPay), expiresIn: Math.max(0, o.expiresAt - this.baseTick),
      canAccept: plan.deviceId !== null, why: plan.why, deviceId: plan.deviceId,
      drives: drives.map((d) => ({ deviceId: d.id, name: deviceSpec(d).name, why: this.contractDriveWhy(o, d) })),
    };
  }) : [];
  const active: ContractSnap[] = this.contracts.map((c) => {
    const disk = this.disks.get(c.deviceId);
    const file = disk?.fs.file(c.fileId);
    const lost = !file || file.lost;
    const health: ContractSnap["health"] = lost ? "lost" : this.canServe(c.deviceId, c.fileId) ? "ok" : "unservable";
    return {
      id: c.id, kind: c.kind, name: contractKind(c.kind)!.name, client: c.client, deviceId: c.deviceId, drive: c.drive, bytes: c.blocks * BLOCK_BYTES, mirrored: c.mirrored,
      duration: c.duration, left: Math.max(0, c.endsAt - this.baseTick), health, nextRead: Math.max(0, c.nextRead - this.baseTick), pending: c.pending.length,
      served: c.served, missed: c.missed, maxMisses: c.maxMisses, rate: c.rate, earned: c.earned, fees: c.fees, hot: contractKind(c.kind)!.hot,
    };
  });
  return { open, offers, active };
}
