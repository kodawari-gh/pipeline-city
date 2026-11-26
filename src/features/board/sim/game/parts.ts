// Game feature: clocks, inventory housekeeping and the aftermath of a board change. Every export is a `Game` method (see game.ts).

// Game feature: building the machine. Install and uninstall parts, the queued swap, cables, the inventory and its
// snapshot, clocks, and the sandbox's maximum rig. Every export is a `Game` method (see game.ts).

import {
  cableName,
  cablesOf,
  deviceSpec,
  findDevices,
  getSpec,
  pruneCables,
  setClock,
  strayFans,
  uninstall as boardUninstall,
} from '..';
import type * as boardSimTypes from '..';
import type { Game } from '@/worker/game/game';
import type { Progress } from '@/worker/game/save';

export function setCpuClock(this: Game, clock: number): { ok: true } | { ok: false; reason: string } {
  const [cpu] = findDevices(this.board, 'cpu');
  if (!cpu) {
    return { ok: false, reason: 'no CPU' };
  }
  const r = setClock(this.board, cpu.id, clock);
  if (r.ok) {
    this.syncRates(this.powered);
  }
  return r;
}

/** Set the requested clock of one memory stick (RAM overclock/underclock), in its spec's range. */
export function setRamClock(this: Game, deviceId: string, clock: number): { ok: true } | { ok: false; reason: string } {
  const d = this.board.devices.find((x) => x.id === deviceId);
  if (!d || getSpec(d.spec)?.kind !== 'ram') {
    return { ok: false, reason: 'no such memory stick' };
  }
  const r = setClock(this.board, d.id, clock);
  if (r.ok) {
    this.syncRates(this.powered);
  }
  return r;
}

/** Whether `install(invId)` would succeed now (the machine must be off, so a powered one says no). */
export function removeItem(this: Game, invId: string): void {
  this.inventory = this.inventory.filter((i) => i.id !== invId);
}

export function flagInstalled(this: Game, kind: boardSimTypes.DeviceKind): void {
  const flag: Partial<Record<boardSimTypes.DeviceKind, keyof Progress>> = {
    cpu: 'cpuInstalled',
    psu: 'psuInstalled',
    ram: 'ramInstalled',
    display: 'monitorInstalled',
    storage: 'storageInstalled',
    cooler: 'coolerInstalled',
  };
  const f = flag[kind];
  if (f) {
    this.progress[f] = true;
  }
  // a sandbox machine is plugged into the wall as its parts go in (Build my PC plugs each cord by hand: the player watches it go in)
  if (this.sandbox && !this.looseFit) {
    if (kind === 'psu') {
      this.cables['pcmains'] = true;
    }
    if (kind === 'display') {
      this.cables['monmains'] = true;
    }
  }
}

/** Send every fan whose spot is gone or takes another size (a heatsink, case or board swapped) back to the inventory. */
export function dropStrayFans(this: Game): void {
  for (const f of strayFans(this.board)) {
    boardUninstall(this.board, f.id);
    if (!f.burnt) {
      this.inventory.push({ id: `inv${this.nextInvId++}`, spec: f.spec });
    }
    this.note('install', `${deviceSpec(f).name} came off: its spot is gone`);
  }
}

/** Take off the fans that lost their spot, and unplug cables whose source part is gone. */
export function afterBoardChange(this: Game): void {
  this.dropStrayFans();
  // the cable of a case mount that is gone (a smaller case) comes out
  const mounts = new Set<string>(cablesOf(this.board).map((c) => c.id));
  for (const k of Object.keys(this.cables) as boardSimTypes.CableId[]) {
    if (k.startsWith('fan:') && this.cables[k] && !mounts.has(k)) {
      this.cables[k] = false;
    }
  }
  // A cable plugged into a network card that left the board comes out with it.
  if (this.lan && this.lan !== 'board' && !this.board.devices.some((d) => d.id === this.lan)) {
    this.lan = null;
    this.cables['lan'] = false;
    this.note('cable', 'Ethernet cable came unplugged');
  }
  // A video cable plugged into a card that left the board (or into a card while the display is no longer a graphics one) comes out too.
  if (this.video !== 'board') {
    const [disp] = findDevices(this.board, 'display');
    if (!this.videoCard() || !disp || !(deviceSpec(disp) as boardSimTypes.DisplaySpec).graphics) {
      this.video = 'board';
      this.cables['video'] = false;
      this.note('cable', 'Video cable came unplugged');
    }
  }
  for (const c of pruneCables(this.board, this.cables)) {
    this.note('cable', `${cableName(c)} came unplugged`);
  }
  if (!this.cables['video']) {
    this.video = 'board';
  }
}

/**
 * Put `specId` into a slot of `board` (mutates it, restoring it exactly on failure): the given slot, else the first
 * free compatible one, else swap with the installed part of the same kind. Returns the swapped-out device, if any.
 */
