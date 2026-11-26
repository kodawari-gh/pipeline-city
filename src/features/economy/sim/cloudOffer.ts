// Game feature: cloud-storage contract offers. Accept, ignore, and choose a drive. Every export is a `Game` method (see game.ts).

import * as boardSim from '../../board/sim';
import { Prng } from '@/core/sim/prng';
import * as contractsSim from './contracts';
import { holdPay } from './economy';
import type { Game } from '@/worker/game/game';
import { jobClass } from './levels';
import type { Result } from '@/worker/game/types';

/** Contracts are on offer from the level the class starts at, outside the sandbox (its money is a constant). */
export function contractsOpen(this: Game): boolean {
  const cls = jobClass('cloud');
  return cls !== undefined && !this.sandbox && this.level >= cls.firstLevel && this.progress.poweredOn;
}

/** Why drive `d` cannot hold the offer's dataset now, or null. */
export function contractDriveWhy(
  this: Game,
  offer: contractsSim.ContractOffer,
  d: boardSim.InstalledDevice,
): string | null {
  const s = boardSim.deviceSpec(d);
  if (s.kind !== 'storage') {
    return `${s.name} is not a drive`;
  }
  if (d.burnt === true) {
    return `${s.name} is burnt out`;
  }
  if (!this.osUp()) {
    return 'the OS must be up: power the machine on';
  }
  const { os } = this;
  if (os === undefined || os === null) {
    return 'the OS must be up: power the machine on';
  }
  if (os.spec.fsTier < 2) {
    return `${os.spec.name} cannot store files: Paged OS 2.0 or better`;
  }
  if (s.mirror === true && os.spec.fsTier < 4) {
    return `${s.name} is a RAID module: it needs Multicore OS 4.0`;
  }
  if (!this.driveUp(d.id)) {
    return `${s.name} is not mounted`;
  }
  if (!this.driveCanHold(d.id, 'dataset')) {
    return `${s.name} is not formatted clean`;
  }
  if (s.tier < offer.minDriveTier) {
    return `it needs a SATA SSD or better, ${s.name} is too slow`;
  }
  const reserve = this.osCfg.dataReserve[d.id];
  if (reserve !== undefined && this.datasetBlocks(d.id) + offer.blocks > reserve) {
    return `${s.name} reserves ${reserve} blocks for datasets and ${this.datasetBlocks(d.id)} are in use: raise the reserve in the OS window`;
  }
  const held = this.disks.get(d.id);
  if (held === undefined) {
    return `${s.name} is not mounted`;
  }
  const free = held.fs.freeBlocks();
  if (free < offer.blocks) {
    return `${s.name} has ${free} free blocks, the dataset needs ${offer.blocks}`;
  }
  return null;
}

/** The drive an offer would go on: `deviceId` if given, else the slowest drive that qualifies (the fast ones stay free). With the reason when there is none. */
export function contractPlan(
  this: Game,
  offer: contractsSim.ContractOffer,
  deviceId?: string,
): { deviceId: string | null; why: string | null } {
  const drives = this.board.devices.filter((d) => boardSim.deviceSpec(d).kind === 'storage');
  if (deviceId !== undefined) {
    const d = drives.find((x) => x.id === deviceId);
    if (!d) {
      return { deviceId: null, why: `no drive "${deviceId}"` };
    }
    const why = this.contractDriveWhy(offer, d);
    return why === null ? { deviceId: d.id, why: null } : { deviceId: null, why };
  }
  if (drives.length === 0) {
    return { deviceId: null, why: 'install a storage drive first' };
  }
  const ok = drives
    .filter((d) => this.contractDriveWhy(offer, d) === null)
    .toSorted((a, b) => boardSim.deviceSpec(a).tier - boardSim.deviceSpec(b).tier);
  const [best] = ok;
  if (best !== undefined) {
    return { deviceId: best.id, why: null };
  }
  // The reason of the drive that came closest (the one the player is most likely to fix): the first with a reason that is not about the OS being down.
  const whys = drives.map((d) => this.contractDriveWhy(offer, d)).filter((w): w is string => w !== null);
  return { deviceId: null, why: whys.find((w) => /free blocks|SSD/u.test(w)) ?? whys[0] ?? 'no drive can hold it' };
}

/** Accept an offer: the dataset goes onto a drive and the hold begins. */
export function acceptContract(this: Game, offerId: number, deviceId?: string): Result<{ contractId: number }> {
  const offer = this.contractOffers.find((o) => o.id === offerId);
  if (!offer) {
    return { ok: false, reason: 'that offer is gone' };
  }
  if (!this.contractsOpen()) {
    return { ok: false, reason: 'no contracts are open' };
  }
  const plan = this.contractPlan(offer, deviceId);
  if (plan.deviceId === null) {
    return { ok: false, reason: plan.why ?? 'no drive can hold it' };
  }
  const dev = this.board.devices.find((d) => d.id === plan.deviceId);
  const disk = dev === undefined ? undefined : this.disks.get(dev.id);
  if (dev !== undefined && disk !== undefined) {
    const file = disk.fs.create(`c${offer.id}`, 'dataset', offer.blocks, { seed: offer.seed });
    if (!file) {
      return { ok: false, reason: 'the drive has no room for the dataset' };
    }
    disk.fs.write(file.id, contractsSim.datasetBytes(offer.seed, offer.blocks));
    const c = beginContract(this, { offer, dev, disk, fileId: file.id });
    this.contractOffers = this.contractOffers.filter((o) => o.id !== offerId);
    return { ok: true, contractId: c.id };
  }
  return { ok: false, reason: plan.why ?? 'no drive can hold it' };
}

function requireKind(id: string): contractsSim.ContractKind {
  const kind = contractsSim.contractKind(id);
  if (kind === undefined) {
    throw new Error(`unknown contract kind ${id}`);
  }
  return kind;
}

function beginContract(
  game: Game,
  opts: {
    offer: contractsSim.ContractOffer;
    dev: boardSim.InstalledDevice;
    disk: NonNullable<ReturnType<Game['disks']['get']>>;
    fileId: number;
  },
): contractsSim.Contract {
  const { offer, dev, disk, fileId } = opts;
  const kind = requireKind(offer.kind);
  const mirrored = disk.twin !== null;
  const rng = new Prng(offer.seed);
  const nextRead = game.baseTick + contractsSim.nextReadGap(rng, offer.readEvery);
  const rngState = rng.getState();
  const { id: _offerId, offeredAt: _at, expiresAt: _exp, ...terms } = offer;
  const c: contractsSim.Contract = {
    ...terms,
    id: game.nextContractId++,
    deviceId: dev.id,
    drive: boardSim.deviceSpec(dev).name,
    fileId,
    startedAt: game.baseTick,
    endsAt: game.baseTick + offer.duration,
    mirrored,
    rate: holdPay({
      cfg: game.cfg,
      kib: contractsSim.kibOf(offer.blocks),
      hot: kind.hot,
      mirrored,
      levelPay: offer.levelPay,
    }),
    owed: 0,
    rng: rngState,
    nextRead,
    pending: [],
    served: 0,
    missed: 0,
    earned: 0,
    fees: 0,
  };
  game.contracts.push(c);
  game.dex[c.kind] ??= { seen: game.baseTick, runs: 0, best: 0 };
  game.note('contract', `${c.client}: ${kind.name} accepted on ${c.drive}`);
  return c;
}

/** Turn an offer down. It just goes away: no penalty. */
export function ignoreContract(this: Game, offerId: number): Result<{ offerId: number }> {
  if (!this.contractOffers.some((o) => o.id === offerId)) {
    return { ok: false, reason: 'that offer is gone' };
  }
  this.contractOffers = this.contractOffers.filter((o) => o.id !== offerId);
  return { ok: true, offerId };
}
