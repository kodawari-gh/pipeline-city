// Game feature: placing a part into a slot, with a swap if the slot is taken. Every export is a `Game` method (see game.ts).

// Game feature: building the machine. Install and uninstall parts, the queued swap, cables, the inventory and its
// snapshot, clocks, and the sandbox's maximum rig. Every export is a `Game` method (see game.ts).

import {
  boardFromJson,
  boardSlots,
  boardToJson,
  deviceSpec,
  findDevices,
  freeSlots,
  getSpec,
  install as boardInstall,
  slotRefusal,
  uninstall as boardUninstall,
} from '..';
import { requireDefined } from '../requireDefined';
import type * as boardSimTypes from '..';
import { routerByTier } from '@/features/network/sim';
import type * as networkSimTypes from '@/features/network/sim';
import { getOsSpec } from '@/features/os/sim';
import type { Game } from '@/worker/game/game';
import type { InvItem } from '@/worker/game/internal';
import type { Result } from '@/worker/game/types';

/** The router is external (own power): it goes into its spot, or comes out, whether the PC is on or off. */
export function installRouter(
  this: Game,
  opts: { item: InvItem; r: networkSimTypes.RouterSpec; slotId?: string | undefined },
): Result<{ deviceId: string | null; slot: string }> {
  const { item, r, slotId } = opts;
  if (slotId !== undefined && slotId !== 'router') {
    return { ok: false, reason: `${r.name} goes into the router spot next to the monitor, not "${slotId}"` };
  }
  if (this.routerTier === r.tier) {
    return {
      ok: false,
      reason: `a ${requireDefined(routerByTier(this.routerTier), 'installed router').name} is already in the router spot`,
    };
  }
  const old = routerByTier(this.routerTier);
  if (old) {
    this.inventory.push({ id: `inv${this.nextInvId++}`, spec: old.id });
  }
  this.removeItem(item.id);
  this.routerTier = r.tier;
  this.progress.routerInstalled = true;
  this.note('install', `${r.name} placed next to the monitor`);
  return { ok: true, deviceId: null, slot: 'router' };
}

/** Take an installed part out; it goes to the inventory (a burnt part is scrapped). Only while off ("router" comes out any time). */
export function uninstall(this: Game, deviceId: string): Result<{ invId: string | null }> {
  if (deviceId === 'router') {
    const old = routerByTier(this.routerTier);
    if (!old) {
      return { ok: false, reason: 'no router is installed' };
    }
    this.routerTier = 0;
    this.cables['lan'] = false;
    this.lan = null;
    const invId = `inv${this.nextInvId++}`;
    this.inventory.push({ id: invId, spec: old.id });
    this.note('install', `${old.name} removed`);
    return { ok: true, invId };
  }
  if (this.powered) {
    return { ok: false, reason: 'power the machine off first' };
  }
  const dev = this.board.devices.find((d) => d.id === deviceId);
  if (!dev) {
    return { ok: false, reason: `no installed device "${deviceId}"` };
  }
  if (this.os?.deviceId === deviceId && !this.looseFit) {
    return { ok: false, reason: `the OS is installed on ${deviceSpec(dev).name}: uninstall the OS first` };
  }
  this.releaseOs(dev);
  const r = boardUninstall(this.board, deviceId);
  if (!r.ok) {
    return r;
  }
  this.disks.delete(deviceId);
  let invId: string | null = null;
  if (dev.burnt !== true) {
    invId = `inv${this.nextInvId++}`;
    this.inventory.push({ id: invId, spec: dev.spec });
  }
  // The cooler mounts on the CPU: taking the CPU out takes the cooler with it, back into the inventory.
  if (deviceSpec(dev).kind === 'cpu' && findDevices(this.board, 'cpu').length === 0) {
    for (const c of findDevices(this.board, 'cooler')) {
      boardUninstall(this.board, c.id);
      if (c.burnt !== true) {
        this.inventory.push({ id: `inv${this.nextInvId++}`, spec: c.spec });
      }
      this.note('install', `${deviceSpec(c).name} removed with the CPU`);
    }
  }
  this.afterBoardChange();
  this.note('install', `${deviceSpec(dev).name} removed`);
  return { ok: true, invId };
}

/**
 * Build my PC (`looseFit`): the drive that holds the OS leaves, so the OS goes back to the inventory with a wiped drive, and the socket it left is
 * remembered (`keepOs` puts it back there). In any other game the drive is refused before this, and nothing happens.
 */
export function releaseOs(this: Game, dev: boardSimTypes.InstalledDevice): void {
  if (!this.looseFit || this.os?.deviceId !== dev.id) {
    return;
  }
  this.osSlot = dev.slot;
  this.uninstallOs();
}

/**
 * Build my PC (`looseFit`): the OS follows its drive. With no OS installed and one in the inventory, it goes on the drive in the socket it left, or on the
 * first drive that can hold it; with no such drive it waits there. The stage calls it when a job ends (a part that is only in the way comes out and goes
 * back, and the OS must land where it was). A game with no loose fit, a running machine or no OS item: nothing happens.
 */
export function keepOs(this: Game): void {
  if (!this.looseFit || this.os || this.powered) {
    return;
  }
  const item = this.inventory.find((i) => getOsSpec(i.spec));
  const spec = item && getOsSpec(item.spec);
  if (!item || !spec) {
    return;
  }
  const drives = this.board.devices
    .filter((d) => deviceSpec(d).kind === 'storage')
    .toSorted((a, b) => Number(b.slot === this.osSlot) - Number(a.slot === this.osSlot));
  const home = drives.find((d) => {
    const block = this.osBlock(spec, d);
    return block === undefined || block === null || block === '';
  });
  if (home) {
    this.installOs(item, spec, home.slot);
  }
}

export function mustInstall(
  this: Game,
  spec: string,
  opts?: { invId?: string | undefined; slot?: string | undefined },
): void {
  const r = boardInstall(this.board, spec, opts?.slot);
  if (!r.ok) {
    throw new Error(`starting board: ${r.reason}`);
  }
  if (opts?.invId !== undefined && opts.invId !== '') {
    this.removeItem(opts.invId);
  }
  this.flagInstalled(requireDefined(getSpec(spec), 'unknown device').kind);
}

function commitPlacement(opts: {
  game: Game;
  board: boardSimTypes.Board;
  specId: string;
  kind: boardSimTypes.DeviceKind;
  slot: string;
  occupant: boardSimTypes.InstalledDevice | undefined;
}): Result<{ id: string; slot: string; replaced?: boardSimTypes.InstalledDevice }> {
  const { game, board, specId, kind, slot, occupant } = opts;
  if (occupant && occupant.id === game.os?.deviceId && !game.looseFit) {
    return { ok: false, reason: `the OS is installed on ${deviceSpec(occupant).name}: uninstall the OS first` };
  }
  if (kind === 'cooler' && findDevices(board, 'cpu').length === 0) {
    return { ok: false, reason: 'install the CPU first: the cooler mounts on it' };
  }
  const backup = boardToJson(board);
  if (occupant) {
    boardUninstall(board, occupant.id);
  }
  const r = boardInstall(board, specId, { slotId: slot, power: !game.looseFit });
  if (!r.ok) {
    const b = boardFromJson(backup);
    board.devices = b.devices;
    board.nextId = b.nextId;
    return r;
  }
  return occupant ? { ...r, replaced: occupant } : r;
}

export function placeInto(
  this: Game,
  opts: { board: boardSimTypes.Board; specId: string; slotId?: string | undefined },
): Result<{ id: string; slot: string; replaced?: boardSimTypes.InstalledDevice }> {
  const { board, specId, slotId } = opts;
  const spec = getSpec(specId);
  if (!spec) {
    return { ok: false, reason: `unknown device "${specId}"` };
  }
  let slot = slotId;
  let occupant: boardSimTypes.InstalledDevice | undefined;
  if (slot === undefined) {
    slot = freeSlots(board, spec.slot, spec)[0]?.id;
    if (slot === undefined) {
      const slots = boardSlots(board);
      occupant = findDevices(board, spec.kind).find((d) => {
        const info = slots.find((s) => s.id === d.slot);
        return info !== undefined && slotRefusal(info, spec) === null;
      });
      if (occupant === undefined) {
        return boardInstall(board, specId, { power: !this.looseFit }); // fails with the board's own reason
      }
      ({ slot } = occupant);
    }
  } else {
    const info = boardSlots(board).find((s) => s.id === slot);
    if (info === undefined) {
      return { ok: false, reason: `board has no slot "${slot}"` };
    }
    const refusal = slotRefusal(info, spec);
    if (refusal !== null && refusal !== '') {
      return { ok: false, reason: refusal };
    }
    occupant = board.devices.find((d) => d.slot === slot);
    if (occupant && deviceSpec(occupant).kind !== spec.kind) {
      return { ok: false, reason: `slot "${slot}" is occupied by ${deviceSpec(occupant).name}` };
    }
  }
  return commitPlacement({ game: this, board, specId, kind: spec.kind, slot, occupant });
}

/** Does a board need a case that holds it? Not in the sandbox (there the case follows the board) nor when the config says so. */
export function caseGated(this: Game): boolean {
  return !this.sandbox && this.cfg.caseGating;
}
