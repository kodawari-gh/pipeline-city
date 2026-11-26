// Game feature: decline a waiting job, the plugged-key queries, and auto-eject. Every export is a `Game` method (see game.ts).

import { JobState, PchPhase } from '@/core/sim/memmap';
import type { Game } from '@/worker/game/game';
import type { Key } from '@/worker/game/internal';
import type { Result } from '@/worker/game/types';

function declineNote(sandbox: boolean, retired: boolean): string {
  if (sandbox) {
    return ' (free in the sandbox)';
  }
  if (retired) {
    return ' (free: retired)';
  }
  return '';
}

function takeSpooled(this: Game, keyId: number): Result {
  if (this.uploads.some((t) => t.key.id === keyId)) {
    return { ok: false, reason: 'uploading: the result is being sent' };
  }
  const job = this.kernelJobs().find((j) => j.key === keyId);
  if (job?.state === JobState.Running) {
    return { ok: false, reason: 'running: the job is being run' };
  }
  if (job?.state === JobState.Result || job?.state === JobState.Sending) {
    return { ok: false, reason: 'result ready: it is being delivered' };
  }
  if (job) {
    this.freeKernelSlot(keyId);
  }
  this.spool = this.spool.filter((k) => k.id !== keyId);
  return { ok: true };
}

function takeDeclined(this: Game, keyId: number): Result<{ gone: Key | undefined; retired: boolean }> {
  if (this.plugged?.id === keyId) {
    return { ok: false, reason: 'plugged: the key is in the USB port, remove it first' };
  }
  const retired = this.tray.waiting().some((k) => k.id === keyId && k.retired);
  const inTray = this.tray.waiting().some((k) => k.id === keyId);
  const inOffers = this.offersQ.waiting().some((k) => k.id === keyId);
  const spooled = this.spool.find((k) => k.id === keyId);
  const gone =
    this.tray.waiting().find((k) => k.id === keyId) ?? this.offersQ.waiting().find((k) => k.id === keyId) ?? spooled;
  if (inOffers) {
    this.offersQ.take(keyId);
  } else if (this.downloads.some((t) => t.key.id === keyId) || this.rx.some((k) => k.id === keyId)) {
    return { ok: false, reason: 'downloading: the job is on the wire' };
  } else if (spooled) {
    const taken = takeSpooled.call(this, keyId);
    if (!taken.ok) {
      return taken;
    }
  } else if (inTray) {
    this.tray.take(keyId);
  } else {
    return { ok: false, reason: `no waiting job ${keyId}` };
  }
  return { ok: true, gone, retired };
}

/**
 * Decline a waiting job: a tray key, or a key the OS ingested that has not started (docs/PROGRESSION.md "Declining").
 * The client leaves at once; the small reputation cost is `targetTurnaround x patienceMul` fed into the turnaround
 * average (one third of an expiry), nothing in the sandbox. Pays nothing and gives no client-base points.
 * Refused for the plugged key, a running job and a result waiting for collection.
 */
export function declineKey(this: Game, keyId: number): Result<{ keyId: number }> {
  const taken = takeDeclined.call(this, keyId);
  if (!taken.ok) {
    return taken;
  }
  this.declined++;
  if (taken.gone) {
    this.addLog({ k: taken.gone, outcome: 'declined', pay: 0, late: false });
  }
  // A retired key costs nothing to decline (docs/NETWORK.md "Retired keys"): its client already went online.
  if (!this.sandbox && !taken.retired) {
    this.avgTurnaround += this.cfg.emaAlpha * (this.targetTurnaround() - this.avgTurnaround);
  }
  this.note('decline', `declined job ${keyId}${declineNote(this.sandbox, taken.retired)}`);
  return { ok: true, keyId };
}

/** Decline an OS queue row (by its key id). The network phase adds offers to the same call. */
export function declineJob(this: Game, id: number): Result<{ keyId: number }> {
  return this.declineKey(id);
}

/** The plugged key's id and whether it holds a result, or null. */
export function pluggedKey(this: Game): { id: number; done: boolean } | null {
  return this.plugged && { id: this.plugged.id, done: this.plugged.done };
}

/** Under an OS: the plugged key is in the kernel's queue (queued or running), so it can be unplugged. For bots. */
export function pluggedIngested(this: Game): boolean {
  const k = this.plugged;
  return (
    k !== null &&
    !k.done &&
    this.kernelJobs().some((j) => j.key === k.id && (j.state === JobState.Queued || j.state === JobState.Running))
  );
}

/** A finished key ejects itself `autoEjectTicks` after its result is in, and pays. No OS: after the machine halts on JOB DONE, and the machine powers off. With an OS: after the flash, and the machine stays on. */
export function autoEject(this: Game): void {
  const k = this.plugged;
  // No OS: after JOB DONE (halted). With an OS: once the result has landed on the key (the flash is over).
  const ready =
    k !== null && k.done && (this.os ? this.pch.phase !== PchPhase.OsFlash : this.pch.phase === PchPhase.Halted);
  if (!this.cfg.autoEjectTicks || !ready) {
    this.autoEjectWait = 0;
    return;
  }
  if (++this.autoEjectWait >= this.cfg.autoEjectTicks) {
    this.autoEjectWait = 0;
    this.ejectKey();
    if (!this.os) {
      this.powerButton(); // no OS: the machine switches itself off too. With an OS it just goes on.
    }
  }
}
