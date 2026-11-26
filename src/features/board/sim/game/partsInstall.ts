// Game feature: installing and removing parts, the sandbox maximum rig. Every export is a `Game` method (see game.ts).

// Game feature: building the machine. Install and uninstall parts, the queued swap, cables, the inventory and its
// snapshot, clocks, and the sandbox's maximum rig. Every export is a `Game` method (see game.ts).

import {
  BOARD_TIERS,
  cablesOf,
  cableNeeded,
  CASE_TIERS,
  caseFor,
  caseHolds,
  deviceSpec,
  fanSlots,
  getSpec,
  specList,
  specsOfKind,
  upgradeBoard,
  upgradeCase,
} from '..';
import { requireDefined } from '../requireDefined';
import type * as boardSimTypes from '..';
import { getRouterSpec, ISP_SPECS, ROUTER_SPECS } from '@/features/network/sim';
import { getOsSpec, OS_SPECS } from '@/features/os/sim';
import { boardTierOf, caseTierOf, caseTooSmall } from '@/features/economy/sim/economy';
import type { Game } from '@/worker/game/game';
import type { InvItem } from '@/worker/game/internal';
import type { Result } from '@/worker/game/types';

/**
 * The most powerful machine the game supports, built from the starter one with the sandbox's free purchases: the biggest case and board, the best CPU, cooler,
 * PSU and heatsinks, every DIMM slot filled with the best RAM, every M.2 slot with the fastest drive, the fastest network card, the best OS that is implemented, the
 * best router and ISP plan, and the ethernet cable on the card. Left powered off, with the other cables connected. "Best" is the top of each part's ladder
 * (`specsOfKind`, the tier tables), so a new tier is picked up without touching this.
 */
const mustOk = <T>(what: string, r: Result<T>): T => {
  if (!r.ok) {
    throw new Error(`maximum machine: ${what}: ${r.reason}`);
  }
  return r;
};

const buyAndInstall = (game: Game, spec: string, slot?: string) => {
  const bought = mustOk(`buy ${spec}`, game.purchase(spec));
  return mustOk(`install ${spec}`, game.install(bought.invId, slot));
};

const topSpec = (kind: boardSimTypes.DeviceKind): string => {
  const l = specsOfKind(kind);
  return requireDefined(l.at(-1), `no ${kind} in the catalog`).id;
};

export function buildMaxRig(this: Game): void {
  const boardTier = BOARD_TIERS.length - 1;
  const { slots } = requireDefined(BOARD_TIERS[boardTier], 'no top board tier');
  buyAndInstall(this, `case${CASE_TIERS.length - 1}`);
  buyAndInstall(this, `board${boardTier}`);
  for (const kind of ['psu', 'cpu', 'cooler', 'vrm-sink', 'ram-sink'] as const) {
    buyAndInstall(this, topSpec(kind));
  }
  buyAndInstall(this, topSpec('radiator'), 'rad-top');
  // every fan spot (the case mounts, the heatsinks' spots) gets the best fan of its size
  for (const s of fanSlots(this.board)) {
    if (this.board.devices.some((d) => d.slot === s.id)) {
      continue;
    }
    const [best] = specList
      .filter((f): f is boardSimTypes.FanSpec => f.kind === 'fan' && f.size === s.size)
      .toSorted((a, b) => b.airflow - a.airflow);
    if (best) {
      buyAndInstall(this, best.id, s.id);
    }
  }
  for (let i = 0; i < (slots.dimm ?? 0); i++) {
    buyAndInstall(this, topSpec('ram'), `dimm${i}`);
  }
  const bootDriveSpec = specsOfKind('storage').findLast((s) => s.mirror !== true);
  const bootDrive = requireDefined(bootDriveSpec, 'no boot drive in the catalog').id;
  for (let i = 0; i < (slots.m2 ?? 0); i++) {
    buyAndInstall(this, bootDrive, `m2${i}`);
  }
  buyAndInstall(this, topSpec('nic'));
  const os = OS_SPECS.toReversed().find((o) => o.later !== true);
  if (os) {
    buyAndInstall(this, os.id);
  }
  const topRouter = requireDefined(ROUTER_SPECS.at(-1), 'no router in the catalog');
  buyAndInstall(this, topRouter.id);
  const topIsp = requireDefined(ISP_SPECS.at(-1), 'no ISP plan in the catalog');
  mustOk('buy the ISP plan', this.purchase(topIsp.id));
  const nic = this.board.devices.find((d) => deviceSpec(d).kind === 'nic');
  if (nic) {
    mustOk('plug the ethernet cable', this.connectCable('lan', nic.id));
  }
  // swaps can unplug a cable whose source part changed: plug the others again
  for (const c of cablesOf(this.board)) {
    if (c.id !== 'lan' && this.cables[c.id] !== true && cableNeeded(this.board, c.id)) {
      mustOk(`plug ${c.id}`, this.connectCable(c.id));
    }
  }
  this.log = [];
}

function installCase(game: Game, item: InvItem, caseTier: number): Result<{ deviceId: string | null; slot: string }> {
  const was = game.board.caseTier;
  const r = upgradeCase(game.board, caseTier);
  if (!r.ok) {
    return r;
  }
  game.removeItem(item.id);
  game.inventory.push({ id: `inv${game.nextInvId++}`, spec: `case${was}` }); // the case it replaced is a spare now
  game.afterBoardChange(); // fans of another size come off the mounts
  game.note(
    'install',
    `${requireDefined(CASE_TIERS[caseTier], 'unknown case tier').name} installed: the board and every part moved in`,
  );
  return { ok: true, deviceId: null, slot: 'case' };
}

function installBoardUpgrade(
  game: Game,
  item: InvItem,
  tier: number,
): Result<{ deviceId: string | null; slot: string }> {
  const was = game.board.tier,
    dead = game.board.burnt === true;
  if (game.caseGated() && !caseHolds(game.board, tier)) {
    return { ok: false, reason: caseTooSmall(game.board, tier) };
  }
  const r = upgradeBoard(game.board, tier);
  if (!r.ok) {
    return r;
  }
  if (!caseHolds(game.board, tier)) {
    game.board.caseTier = caseFor(tier); // ungated: the case follows the board
  }
  game.removeItem(item.id);
  if (!dead) {
    game.inventory.push({ id: `inv${game.nextInvId++}`, spec: `board${was}` }); // the board it replaced is a spare now (a dead one is scrapped)
  }
  game.afterBoardChange();
  game.note('install', `${requireDefined(BOARD_TIERS[tier], 'unknown board tier').name} installed`);
  return { ok: true, deviceId: null, slot: 'board' };
}

/**
 * Install an inventory item. With a `slotId` it goes there (a free slot, or an occupied slot of the same kind to
 * swap: the old part returns to the inventory, a burnt one is scrapped). Without, the first free compatible slot,
 * else it swaps with the installed part of its kind. A board item (`board1`) upgrades the board in place and
 * carries every part over. Only while the machine is off. Unplugs cables whose source part left.
 */
export function install(this: Game, invId: string, slotId?: string): Result<{ deviceId: string | null; slot: string }> {
  const item = this.inventory.find((i) => i.id === invId);
  if (!item) {
    return { ok: false, reason: `no inventory item "${invId}"` };
  }
  const routerSpec = getRouterSpec(item.spec);
  if (routerSpec) {
    return this.installRouter({ item, r: routerSpec, slotId });
  }
  if (this.powered) {
    return { ok: false, reason: 'power the machine off first' };
  }
  const osSpec = getOsSpec(item.spec);
  if (osSpec) {
    return this.installOs(item, osSpec, slotId);
  }
  const caseTier = caseTierOf(item.spec);
  if (caseTier !== undefined) {
    return installCase(this, item, caseTier);
  }
  const tier = boardTierOf(item.spec);
  if (tier !== undefined) {
    return installBoardUpgrade(this, item, tier);
  }
  const r = this.placeInto({ board: this.board, specId: item.spec, slotId });
  if (!r.ok) {
    return r;
  }
  this.removeItem(item.id);
  if (r.replaced) {
    const old = r.replaced;
    this.releaseOs(old);
    this.disks.delete(old.id);
    if (old.burnt !== true) {
      this.inventory.push({ id: `inv${this.nextInvId++}`, spec: old.spec });
    }
  }
  this.afterBoardChange();
  const fitted = requireDefined(getSpec(item.spec), `unknown device "${item.spec}"`);
  this.flagInstalled(fitted.kind);
  this.note('install', `${fitted.name} installed in ${r.slot}`);
  return { ok: true, deviceId: r.id, slot: r.slot };
}
