// Game feature: the inventory snapshot and whether a part can be fitted. Every export is a `Game` method (see game.ts).

// Game feature: building the machine. Install and uninstall parts, the queued swap, cables, the inventory and its
// snapshot, clocks, and the sandbox's maximum rig. Every export is a `Game` method (see game.ts).

import {
  boardFromJson,
  boardSlots,
  boardToJson,
  BOARD_TIERS,
  CASE_TIERS,
  caseHolds,
  deviceSpec,
  getSpec,
  slotAccepts,
  slotFits,
  slotRefusal,
  upgradeBoard,
  upgradeCase,
} from '..';
import { requireDefined } from '../requireDefined';
import type * as boardSimTypes from '..';
import { getRouterSpec, routerByTier } from '@/features/network/sim';
import type * as networkSimTypes from '@/features/network/sim';
import { getOsSpec } from '@/features/os/sim';
import type * as osSimTypes from '@/features/os/sim';
import { boardTierOf, caseTierOf, caseTooSmall, sellValue } from '@/features/economy/sim/economy';
import type { Game } from '@/worker/game/game';
import type { InvItem } from '@/worker/game/internal';
import type { InventorySnap } from '@/worker/game/types';

export function canInstall(this: Game, invId: string): boolean {
  const it = this.inventorySnap().find((i) => i.id === invId);
  return it !== undefined && it.installable;
}

export function inventoryItems(this: Game): readonly { id: string; spec: string }[] {
  return this.inventory;
}

type InvItemSnap = Omit<InventorySnap, 'sellPrice'>;

function snapReason(ok: boolean, off: boolean, why: string | undefined): Pick<InvItemSnap, 'reason'> {
  if (ok) {
    return {};
  }
  if (!off) {
    return { reason: 'power the machine off first' };
  }
  return why === undefined ? {} : { reason: why };
}

function snapRouter(game: Game, it: InvItem, router: networkSimTypes.RouterSpec): InvItemSnap {
  // External and self-powered: it installs whether the PC is on or off, into the single router spot.
  const free = game.routerTier === 0 ? ['router'] : [];
  const swap = game.routerTier > 0 && router.tier !== game.routerTier ? ['router'] : [];
  const ok = free.length + swap.length > 0;
  const why = ok
    ? undefined
    : `a ${requireDefined(routerByTier(game.routerTier), 'no installed router').name} is already installed (this is a spare)`;
  return {
    id: it.id,
    spec: it.spec,
    kind: 'router',
    name: router.name,
    freeSlots: free,
    swapSlots: swap,
    installable: ok,
    ...snapReason(ok, true, why),
  };
}

function snapOs(opts: { game: Game; it: InvItem; os: osSimTypes.OsSpec; off: boolean }): InvItemSnap {
  const { game, it, os, off } = opts;
  const free: string[] = [];
  let why: string | undefined;
  if (os.later === true) {
    why = `${os.name} is not available yet`;
  } else if (game.os) {
    why = `${game.os.spec.name} is already installed`;
  }
  if (why === undefined) {
    for (const d of game.board.devices) {
      if (deviceSpec(d).kind !== 'storage') {
        continue;
      }
      const block = game.osBlock(os, d);
      if (block !== undefined && block !== null && block !== '') {
        why ??= block;
      } else {
        free.push(d.slot);
      }
    }
    if (free.length === 0) {
      why ??= 'install a storage drive first';
    }
  }
  const ok = free.length > 0 && off;
  let reason: string | undefined;
  if (!ok) {
    reason = !off && free.length > 0 ? 'power the machine off first' : why;
  }
  return {
    id: it.id,
    spec: it.spec,
    kind: 'os',
    name: os.name,
    freeSlots: free,
    swapSlots: [],
    installable: ok,
    ...(reason === undefined ? {} : { reason }),
  };
}

function snapCase(opts: { game: Game; it: InvItem; caseTier: number; off: boolean }): InvItemSnap {
  const { game, it, caseTier, off } = opts;
  const r = upgradeCase(boardFromJson(boardToJson(game.board)), caseTier);
  const ok = r.ok && off;
  return {
    id: it.id,
    spec: it.spec,
    kind: 'case',
    name: requireDefined(CASE_TIERS[caseTier], 'unknown case tier').name,
    freeSlots: r.ok ? ['case'] : [],
    swapSlots: [],
    installable: ok,
    ...snapReason(ok, off, r.ok ? undefined : r.reason),
  };
}

function snapBoard(opts: { game: Game; it: InvItem; tier: number; off: boolean }): InvItemSnap {
  const { game, it, tier, off } = opts;
  const trial = boardFromJson(boardToJson(game.board));
  const r =
    game.caseGated() && !caseHolds(trial, tier)
      ? { ok: false as const, reason: caseTooSmall(trial, tier) }
      : upgradeBoard(trial, tier);
  const ok = r.ok && off;
  return {
    id: it.id,
    spec: it.spec,
    kind: 'board',
    name: requireDefined(BOARD_TIERS[tier], 'unknown board tier').name,
    freeSlots: r.ok ? ['board'] : [],
    swapSlots: [],
    installable: ok,
    ...snapReason(ok, off, r.ok ? undefined : r.reason),
  };
}

function noFitWhy(spec: boardSimTypes.DeviceSpec, why: string | undefined): string {
  if (spec.kind === 'fan') {
    return `nothing in this machine takes a ${spec.size} mm fan`;
  }
  return why ?? `no ${spec.slot} slot for ${spec.name}`;
}

function snapPart(opts: { game: Game; it: InvItem; spec: boardSimTypes.DeviceSpec; off: boolean }): InvItemSnap {
  const { game, it, spec, off } = opts;
  const free: string[] = [];
  const swap: string[] = [];
  let why: string | undefined;
  for (const s of boardSlots(game.board)) {
    if (!slotAccepts(s.type, spec.slot)) {
      continue;
    }
    if (!slotFits(s, spec)) {
      why ??= slotRefusal(s, spec) ?? why;
      continue;
    }
    const occ = game.board.devices.find((d) => d.slot === s.id);
    if (occ && deviceSpec(occ).kind !== spec.kind) {
      continue;
    }
    const r = game.placeInto({ board: boardFromJson(boardToJson(game.board)), specId: it.spec, slotId: s.id });
    if (r.ok) {
      (occ ? swap : free).push(s.id);
    } else {
      why ??= r.reason;
    }
  }
  if (free.length + swap.length === 0) {
    why = noFitWhy(spec, why);
  }
  const installable = free.length + swap.length > 0 && off;
  return {
    id: it.id,
    spec: it.spec,
    kind: spec.kind,
    name: spec.name,
    freeSlots: free,
    swapSlots: swap,
    installable,
    ...snapReason(installable, off, why),
  };
}

function itemSnap(game: Game, it: InvItem, off: boolean): InvItemSnap {
  const router = getRouterSpec(it.spec);
  if (router) {
    return snapRouter(game, it, router);
  }
  const os = getOsSpec(it.spec);
  if (os) {
    return snapOs({ game, it, os, off });
  }
  const caseTier = caseTierOf(it.spec);
  if (caseTier !== undefined) {
    return snapCase({ game, it, caseTier, off });
  }
  const tier = boardTierOf(it.spec);
  if (tier !== undefined) {
    return snapBoard({ game, it, tier, off });
  }
  return snapPart({ game, it, spec: requireDefined(getSpec(it.spec), `unknown device "${it.spec}"`), off });
}

export function inventorySnap(this: Game): InventorySnap[] {
  // Power does not matter to the player: `swapInstall` cycles it (or waits for the job).
  const off = true;
  const snaps: InventorySnap[] = [];
  for (const it of this.inventory) {
    const snap: InventorySnap = itemSnap(this, it, off);
    snap.sellPrice = this.sandbox ? 0 : sellValue(it.spec);
    snaps.push(snap);
  }
  return snaps;
}
