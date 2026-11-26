// Game feature: queued and immediate part swaps. Every export is a `Game` method (see game.ts).

// Game feature: building the machine. Install and uninstall parts, the queued swap, cables, the inventory and its
// snapshot, clocks, and the sandbox's maximum rig. Every export is a `Game` method (see game.ts).

import { getRouterSpec } from '@/features/network/sim';
import type { Game } from '@/worker/game/game';
import type { Result } from '@/worker/game/types';

/**
 * The player's install: no manual power cycling. Off: install. On and idle: power off, install, power back on (a
 * refusal to boot is reported). On and working a job: queue the swap, it happens the moment the job is done
 * (`pendingSwaps` in the snapshot; several can wait, each for its own slot, and they share one power cycle). `install` stays the strict, powered-off primitive.
 */
export function swapInstall(this: Game, invId: string, slotId?: string): Result<{ pending: boolean }> {
  const item = this.inventory.find((i) => i.id === invId);
  if (!item) {
    return { ok: false, reason: `no inventory item "${invId}"` };
  }
  if (getRouterSpec(item.spec) || !this.powered) {
    const r = this.install(invId, slotId);
    return r.ok ? { ok: true, pending: false } : r;
  }
  const snap = this.inventorySnap().find((i) => i.id === invId);
  if (snap === undefined) {
    return { ok: false, reason: `no inventory item "${invId}"` };
  }
  if (!snap.installable) {
    return { ok: false, reason: snap.reason ?? 'nowhere to put this' };
  }
  if (this.jobInFlight()) {
    if (this.pendingSwaps.some((p) => p.invId === invId)) {
      return { ok: false, reason: `${snap.name} is already waiting to be fitted` };
    }
    // pick the slot now, so two queued parts never aim at the same one
    const taken = new Set(this.pendingSwaps.map((p) => p.slotId));
    const slot = slotId ?? [...snap.freeSlots, ...snap.swapSlots].find((s) => !taken.has(s));
    if (slot === undefined || slot === '') {
      return { ok: false, reason: 'every slot this part fits is already taken by a queued part' };
    }
    if (taken.has(slot)) {
      return { ok: false, reason: `another queued part is already waiting for ${slot}` };
    }
    this.pendingSwaps.push({ invId, slotId: slot });
    this.note('install', `${snap.name} will be swapped in as soon as the job is done`);
    return { ok: true, pending: true };
  }
  return this.swapNow({ invId, slotId, name: snap.name });
}

/** Take one queued install out of the queue (all of them without an id). The part stays in the inventory. */
export function cancelSwap(this: Game, invId?: string): Result<{ cancelled: number }> {
  const before = this.pendingSwaps.length;
  this.pendingSwaps = invId === undefined ? [] : this.pendingSwaps.filter((p) => p.invId !== invId);
  const cancelled = before - this.pendingSwaps.length;
  if (!cancelled) {
    return { ok: false, reason: 'no queued install to cancel' };
  }
  this.note('install', cancelled === 1 ? 'queued install cancelled' : `${cancelled} queued installs cancelled`);
  return { ok: true, cancelled };
}

/** A job the machine would lose (or hold up) if it powered off now. */
export function jobInFlight(this: Game): boolean {
  if (this.os && this.kernelJobs().length > 0) {
    return true;
  }
  return this.plugged !== null && !this.plugged.done;
}

/** Power off (paying a finished key first), install, and power back on when it was on. */
export function swapNow(
  this: Game,
  opts: { invId: string; slotId?: string | undefined; name: string },
): Result<{ pending: boolean }> {
  const r = this.swapMany([opts]);
  return r.ok ? { ok: true, pending: false } : r;
}

/** Power off once (paying a finished key first), install every part in turn, and power back on once if the machine was on. A part that no longer fits is skipped and noted. */
export function swapMany(
  this: Game,
  items: { invId: string; slotId?: string | undefined; name: string }[],
): Result<{ fitted: number }> {
  if (this.plugged?.done === true) {
    this.ejectKey();
  }
  const wasOn = this.powered;
  if (wasOn) {
    this.powerButton();
  }
  let fitted = 0,
    why = '';
  for (const it of items) {
    const r = this.install(it.invId, it.slotId);
    if (r.ok) {
      fitted++;
    } else {
      why = r.reason;
      if (items.length > 1) {
        this.note('fault', `${it.name} could not be fitted: ${r.reason}`);
      }
    }
  }
  if (!fitted) {
    if (wasOn) {
      this.powerButton();
    }
    return { ok: false, reason: why || 'nothing to fit' };
  }
  if (wasOn) {
    const on = this.powerButton();
    if (!on.ok) {
      return {
        ok: false,
        reason: `${items.map((i) => i.name).join(', ')} installed, but the machine cannot start: ${on.reason}`,
      };
    }
  }
  return { ok: true, fitted };
}

export function applyPendingSwap(this: Game): void {
  if (this.pendingSwaps.length === 0 || this.jobInFlight()) {
    return;
  }
  const queue = this.pendingSwaps;
  this.pendingSwaps = [];
  const items: { invId: string; slotId: string; name: string }[] = [];
  for (const p of queue) {
    const snap = this.inventorySnap().find((i) => i.id === p.invId);
    if (!snap || !snap.installable) {
      this.note('install', 'a queued swap was dropped: it no longer fits');
    } else {
      items.push({ invId: p.invId, slotId: p.slotId, name: snap.name });
    }
  }
  if (items.length === 0) {
    return;
  }
  const r = this.swapMany(items);
  if (!r.ok) {
    this.note('fault', r.reason);
  }
}

/** The router is external (own power): it goes into its spot, or comes out, whether the PC is on or off. */
