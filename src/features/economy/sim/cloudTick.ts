// Game feature: one tick of cloud-storage contracts, missed reads, and settlement. Every export is a `Game` method (see game.ts).

import { Prng } from '@/core/sim/prng';
import * as contractsSim from './contracts';
import { lossPenalty, readFee } from './economy';
import type { Game } from '@/worker/game/game';
import * as jobLogSim from '../../jobs/sim/joblog';
import { levelPayMul } from './levels';

interface QueuedDisk {
  queued: number;
}

function requireKind(id: string): contractsSim.ContractKind {
  const kind = contractsSim.contractKind(id);
  if (kind === undefined) {
    throw new Error(`unknown contract kind ${id}`);
  }
  return kind;
}

function expireAndRollOffers(this: Game): void {
  const cfg = this.cfg.contracts;
  this.contractOffers = this.contractOffers.filter((o) => this.baseTick < o.expiresAt);
  if (!this.contractsOpen() || this.baseTick % cfg.offerEvery !== 0 || this.contractOffers.length >= cfg.offerCap) {
    return;
  }
  const kinds = contractsSim.CONTRACT_KINDS.filter((k) => !this.sandboxKindsOff.has(k.id));
  if (kinds.length === 0) {
    return;
  }
  const kind = kinds[this.contractRng.nextInt(kinds.length)];
  if (kind === undefined) {
    return;
  }
  const terms = contractsSim.rollTerms(this.contractRng, kind, levelPayMul(this.level));
  this.contractOffers.push({
    ...terms,
    id: this.nextContractId++,
    offeredAt: this.baseTick,
    expiresAt: this.baseTick + cfg.offerTtl,
  });
}

function accrueHold(this: Game, c: contractsSim.Contract): void {
  if (!this.driveUp(c.deviceId)) {
    return;
  }
  c.owed += c.rate;
  const whole = Math.floor(c.owed);
  if (whole <= 0) {
    return;
  }
  c.owed -= whole;
  c.earned += whole;
  if (!this.sandbox) {
    this.money += whole;
  }
}

function maybeRequestRead(this: Game, opts: { c: contractsSim.Contract; disk: QueuedDisk; hot: boolean }): void {
  const { c, disk, hot } = opts;
  if (this.baseTick < c.nextRead) {
    return;
  }
  const rng = new Prng(c.rng);
  c.nextRead = this.baseTick + contractsSim.nextReadGap(rng, c.readEvery);
  c.rng = rng.getState();
  if (this.canServe(c.deviceId, c.fileId)) {
    c.pending.push({ due: this.baseTick + c.readDeadline, left: c.readTicks });
    disk.queued++;
    return;
  }
  this.missRead(c, hot);
}

function servePendingReads(
  this: Game,
  opts: { c: contractsSim.Contract; disk: QueuedDisk; busy: Set<string>; hot: boolean },
): void {
  const { c, disk, busy, hot } = opts;
  const up = this.driveUp(c.deviceId);
  if (up && c.pending.length > 0 && !busy.has(c.deviceId)) {
    busy.add(c.deviceId);
    const [head] = c.pending;
    if (head !== undefined && --head.left <= 0) {
      c.pending.shift();
      disk.queued = Math.max(0, disk.queued - 1);
      c.served++;
    }
  }
  for (const r of c.pending.filter((p) => this.baseTick >= p.due && p.left > 0)) {
    c.pending.splice(c.pending.indexOf(r), 1);
    disk.queued = Math.max(0, disk.queued - 1);
    this.missRead(c, hot);
  }
}

function maybeSettle(this: Game, c: contractsSim.Contract): void {
  if (c.missed > c.maxMisses) {
    this.settleContract(c, 'breached');
    return;
  }
  if (this.baseTick >= c.endsAt) {
    this.settleContract(c, 'completed');
  }
}

function tickOneContract(this: Game, c: contractsSim.Contract, busy: Set<string>): void {
  const disk = this.disks.get(c.deviceId);
  const file = disk?.fs.file(c.fileId);
  const dev = this.board.devices.find((d) => d.id === c.deviceId);
  if (disk === undefined || file === undefined || file.lost || dev === undefined || dev.burnt === true) {
    this.settleContract(c, 'lost');
    return;
  }
  const kind = requireKind(c.kind);
  accrueHold.call(this, c);
  maybeRequestRead.call(this, { c, disk, hot: kind.hot });
  servePendingReads.call(this, { c, disk, busy, hot: kind.hot });
  maybeSettle.call(this, c);
}

/** One base tick of contracts: offers appear and expire, held data pays, reads are requested and served, contracts end. */
export function contractTick(this: Game): void {
  expireAndRollOffers.call(this);
  const busy = new Set<string>(); // a drive serves one read per tick
  const live = this.contracts.map((c) => c);
  for (const c of live) {
    tickOneContract.call(this, c, busy);
  }
}

/** A read was not served: the client charges the fee. */
export function missRead(this: Game, c: contractsSim.Contract, hot: boolean): void {
  const fee = readFee(this.cfg, hot, c.levelPay);
  c.missed++;
  c.fees += fee;
  if (!this.sandbox) {
    this.money = Math.max(0, this.money - fee);
  }
}

type SettleOutcome = Extract<jobLogSim.JobOutcome, 'lost' | 'breached' | 'completed'>;

function applyCompleted(this: Game, c: contractsSim.Contract): number {
  const bonus = Math.round(c.earned * this.cfg.contracts.completeBonus);
  c.earned += bonus;
  if (!this.sandbox) {
    this.money += bonus;
  }
  this.addClientBase(this.reputation());
  const rec = this.dex[c.kind];
  if (rec) {
    rec.runs++;
    rec.best = rec.best === 0 ? c.duration : Math.min(rec.best, c.duration);
  }
  return bonus;
}

function applyFailed(this: Game, c: contractsSim.Contract, outcome: SettleOutcome): number {
  const cfg = this.cfg.contracts;
  const penalty = lossPenalty({
    cfg: this.cfg,
    kib: contractsSim.kibOf(c.blocks),
    levelPay: c.levelPay,
    breach: outcome === 'breached',
  });
  c.fees += penalty;
  if (!this.sandbox) {
    this.money = Math.max(0, this.money - penalty);
  }
  const units = outcome === 'lost' ? cfg.lossRepUnits : cfg.breachRepUnits;
  this.avgTurnaround += this.cfg.emaAlpha * (this.cfg.giveUpTurnaround * this.patience() - this.avgTurnaround) * units;
  return penalty;
}

function writeContractLog(this: Game, opts: { c: contractsSim.Contract; outcome: SettleOutcome; net: number }): void {
  const { c, outcome, net } = opts;
  this.jobLog.push({
    id: contractsSim.CONTRACT_LOG_BASE + c.id,
    type: c.kind,
    scale: 1,
    outcome,
    arrival: c.startedAt,
    start: c.startedAt,
    finish: Math.min(this.baseTick, c.endsAt),
    end: this.baseTick,
    deadline: c.endsAt,
    payout: net,
    late: false,
    attempts: 1,
    os: this.os?.spec.tier ?? 0,
    contract: {
      client: c.client,
      drive: c.drive,
      blocks: c.blocks,
      mirrored: c.mirrored,
      served: c.served,
      missed: c.missed,
      earned: c.earned,
      fees: c.fees,
    },
  });
  if (this.jobLog.length > jobLogSim.JOB_LOG_CAP) {
    this.jobLog.splice(0, this.jobLog.length - jobLogSim.JOB_LOG_CAP);
  }
}

function settleWord(outcome: SettleOutcome, net: number): string {
  if (outcome === 'completed') {
    return `held to the end: $${net}`;
  }
  if (outcome === 'lost') {
    return 'data LOST';
  }
  return 'breached';
}

/** End a contract: pay or charge, free the dataset, and write the log line. */
export function settleContract(this: Game, c: contractsSim.Contract, outcome: SettleOutcome): void {
  const kind = requireKind(c.kind);
  const disk = this.disks.get(c.deviceId);
  if (disk) {
    disk.queued = Math.max(0, disk.queued - c.pending.length);
    disk.fs.remove(c.fileId);
  }
  let net = c.earned - c.fees;
  if (outcome === 'completed') {
    net += applyCompleted.call(this, c);
  } else {
    net -= applyFailed.call(this, c, outcome);
  }
  this.contracts = this.contracts.filter((x) => x.id !== c.id);
  writeContractLog.call(this, { c, outcome, net });
  this.note('contract', `${c.client}: ${kind.name} ${settleWord(outcome, net)}`);
}
