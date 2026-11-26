// Game feature: the contracts section of the snapshot. Every export is a `Game` method (see game.ts).

import * as boardSim from '../../board/sim';
import { BLOCK_BYTES } from '@/core/sim/memmap';
import * as contractsSim from './contracts';
import { holdPay, lossPenalty, readFee } from './economy';
import type { Game } from '@/worker/game/game';
import type { ContractOfferSnap, ContractSnap, ContractsSnap } from '@/worker/game/types';

function requireKind(id: string): contractsSim.ContractKind {
  const kind = contractsSim.contractKind(id);
  if (kind === undefined) {
    throw new Error(`unknown contract kind ${id}`);
  }
  return kind;
}

function offerSnap(this: Game, o: contractsSim.ContractOffer, drives: boardSim.InstalledDevice[]): ContractOfferSnap {
  const kind = requireKind(o.kind);
  const plan = this.contractPlan(o);
  const kib = contractsSim.kibOf(o.blocks);
  return {
    id: o.id,
    kind: o.kind,
    name: kind.name,
    client: o.client,
    hot: kind.hot,
    bytes: o.blocks * BLOCK_BYTES,
    duration: o.duration,
    readEvery: o.readEvery,
    minDriveTier: o.minDriveTier,
    rate: holdPay({ cfg: this.cfg, kib, hot: kind.hot, mirrored: false, levelPay: o.levelPay }),
    mirrorRate: holdPay({ cfg: this.cfg, kib, hot: kind.hot, mirrored: true, levelPay: o.levelPay }),
    fee: readFee(this.cfg, kind.hot, o.levelPay),
    penalty: lossPenalty({ cfg: this.cfg, kib, levelPay: o.levelPay }),
    expiresIn: Math.max(0, o.expiresAt - this.baseTick),
    canAccept: plan.deviceId !== null,
    why: plan.why,
    deviceId: plan.deviceId,
    drives: drives.map((d) => ({
      deviceId: d.id,
      name: boardSim.deviceSpec(d).name,
      why: this.contractDriveWhy(o, d),
    })),
  };
}

function contractHealth(this: Game, c: contractsSim.Contract, lost: boolean): ContractSnap['health'] {
  if (lost) {
    return 'lost';
  }
  if (this.canServe(c.deviceId, c.fileId)) {
    return 'ok';
  }
  return 'unservable';
}

function activeSnap(this: Game, c: contractsSim.Contract): ContractSnap {
  const disk = this.disks.get(c.deviceId);
  const file = disk?.fs.file(c.fileId);
  const lost = !file || file.lost;
  const kind = requireKind(c.kind);
  return {
    id: c.id,
    kind: c.kind,
    name: kind.name,
    client: c.client,
    deviceId: c.deviceId,
    drive: c.drive,
    bytes: c.blocks * BLOCK_BYTES,
    mirrored: c.mirrored,
    duration: c.duration,
    left: Math.max(0, c.endsAt - this.baseTick),
    health: contractHealth.call(this, c, lost),
    nextRead: Math.max(0, c.nextRead - this.baseTick),
    pending: c.pending.length,
    served: c.served,
    missed: c.missed,
    maxMisses: c.maxMisses,
    rate: c.rate,
    earned: c.earned,
    fees: c.fees,
    hot: kind.hot,
  };
}

/** The contracts section of the snapshot: the open offers (with where each would go, or why it cannot) and the contracts running. */
export function contractsSnap(this: Game): ContractsSnap {
  const open = this.contractsOpen();
  const drives = this.board.devices.filter((d) => boardSim.deviceSpec(d).kind === 'storage');
  const offers: ContractOfferSnap[] = open ? this.contractOffers.map((o) => offerSnap.call(this, o, drives)) : [];
  const active: ContractSnap[] = this.contracts.map((c) => activeSnap.call(this, c));
  return { open, offers, active };
}
