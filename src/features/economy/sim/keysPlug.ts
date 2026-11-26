// Game feature: plug, eject and pay a USB key. Every export is a `Game` method (see game.ts).

import { generate } from '../../jobs/sim/gen';
import { JOB_ROW } from '@/core/sim/memmap';
import { payout, slaFactor } from './economy';
import type { Game } from '@/worker/game/game';
import type { Key } from '@/worker/game/internal';
import { levelPayMul, needsMet } from './levels';
import type { Result } from '@/worker/game/types';

/** The player's plug: as `plugKey`, and a machine that is off switches on (a refusal to start is reported). */
export function plugAndBoot(this: Game, keyId: number): Result<{ key: number }> {
  const r = this.plugKey(keyId);
  if (!r.ok || this.powered) {
    return r;
  }
  const on = this.powerButton();
  return on.ok ? r : { ok: false, reason: `the key is in, but the machine cannot start: ${on.reason}` };
}

/** Plug a key from the tray into the USB port. One program at a time: a key already in the port must come out first. */
export function plugKey(this: Game, keyId: number): Result<{ key: number }> {
  if (this.plugged) {
    return { ok: false, reason: 'a key is already plugged in: remove it first' };
  }
  const peek = this.tray.waiting().find((k) => k.id === keyId);
  if (peek) {
    // A job the machine cannot run is refused at the port (with an OS, at ingest): it waits in the tray until it expires or is declined.
    const need = needsMet(peek.needs, this.caps());
    if (!need.ok) {
      this.note('key', `key ${peek.id} refused: needs ${need.missing.join(', ')}`);
      return { ok: false, reason: `cannot run this job: it needs ${need.missing.join(' and ')}` };
    }
  }
  const key = this.tray.take(keyId);
  if (!key) {
    return { ok: false, reason: `no key ${keyId} in the tray` };
  }
  let program: Uint32Array;
  try {
    ({ program } = generate(key.template, key.seed, {
      row: JOB_ROW,
      scale: key.scale,
      hosted: true,
      gpu: this.gpuTarget(),
      npu: this.npuTarget(),
    }));
  } catch (error) {
    this.tray.giveBack(key);
    return { ok: false, reason: `the key is unreadable (${error instanceof Error ? error.message : String(error)})` };
  }
  key.pluggedAt = this.baseTick;
  key.c0 = this.countersNow();
  // Without an OS the plug is the job's start; with one it runs when the kernel begins it (`stampRan`).
  delete key.reloaded;
  if (this.os) {
    delete key.ranAt;
  } else {
    key.ranAt = this.baseTick;
  }
  this.plugged = key;
  this.pchKey = { id: key.id, program, done: key.done, result: key.result };
  this.pch.plug(this.pchKey);
  this.progress.firstKeyPlugged = true;
  this.note('key', `key ${key.id} plugged in`);
  return { ok: true, key: key.id };
}

/**
 * Remove the plugged key. If it holds a result, the client collects it: payout and reputation are applied now
 * (turnaround is key arrival to this moment). If the job is not finished, it is aborted: the key goes back to the
 * tray unserved, and a machine that was loading or running crashes and reboots.
 */
export function ejectKey(this: Game): Result<{ payout: number; done: boolean }> {
  const key = this.plugged;
  if (!key) {
    return { ok: false, reason: 'no key is plugged in' };
  }
  // Under an OS the key stays in while the OS has its job: the result is written onto it and it pops out and pays by itself.
  if (this.os && this.powered && !key.done && this.kernelJobs().some((j) => j.key === key.id)) {
    return {
      ok: false,
      reason: 'the OS is working on this job: the key pops out by itself when the result is written',
    };
  }
  const phase = this.currentPhase();
  this.plugged = null;
  this.pchKey = null;
  this.pch.unplug();
  if (!key.done) {
    if (!this.os) {
      key.attempts++;
    }
    this.tray.giveBack(key);
    this.note('key', `key ${key.id} pulled before the job finished`);
    if (this.powered && !this.postError && (phase === 'loading' || phase === 'running' || phase === 'writing')) {
      this.coldBoot();
    }
    return { ok: true, payout: 0, done: false };
  }
  if (!this.progress.firstKeyEjected && !this.sandbox) {
    // Scripted for the guided start: the first happy client tells two friends, so the tutorial's next lesson never finds an empty tray.
    for (let i = 0; i < 2; i++) {
      this.enqueue({ template: 'cli', scale: 1, cls: 'cli' });
    }
    this.note('key', 'your first client told two friends: new keys are in the tray');
  }
  this.progress.firstKeyEjected = true;
  if (this.os) {
    // A key that finished before any OS existed and is merely pulled out now was not an OS job.
    if (key.doneBeforeOs !== true) {
      this.progress.firstOsJob = true;
    }
    this.freeKernelSlot(key.id); // delivery is the receipt: the kernel's slot for this job is free again
  }
  const pay = this.deliver(key, 'collected');
  return { ok: true, payout: pay, done: true };
}

/** The client has its result: payout, turnaround average, client base, `lastCompleted`. Returns the payout. */
export function deliver(this: Game, key: Key, how: string): number {
  const turnaround = this.baseTick - key.arrival;
  const late = this.baseTick > key.deadline;
  // A job with a latency SLA (web) pays by the SLA curve, which already ends at the late factor, instead of the late factor itself.
  const sla = this.slaOf(key);
  const base = payout({
    cfg: this.cfg,
    work: key.work * key.payMul,
    turnaround,
    late: sla === null && late,
    levelPay: levelPayMul(this.level),
  });
  const pay =
    sla === null
      ? base
      : Math.round(
          base * slaFactor({ cfg: this.cfg, turnaround, slaTicks: sla, deadlineTicks: key.deadline - key.arrival }),
        );
  if (!this.sandbox) {
    this.money += pay; // the sandbox balance is a constant
  }
  this.completed++;
  this.avgTurnaround += this.cfg.emaAlpha * (turnaround - this.avgTurnaround);
  this.addClientBase(this.reputation());
  this.lastCompleted = {
    id: key.id,
    template: key.template,
    payout: pay,
    turnaround,
    execTicks: key.doneAt - this.ranOf(key),
    late,
    attempts: key.attempts,
    completedAt: this.baseTick,
  };
  this.dexDone(key);
  this.addLog({ k: key, outcome: 'done', pay, late });
  this.note('payout', `key ${key.id} ${how}: $${pay}${late ? ' (late)' : ''}`);
  return pay;
}

/** Ids of the keys in the tray that the machine can run, oldest first (what a bot should plug). */
export function trayKeyIds(this: Game): number[] {
  const caps = this.caps();
  return this.tray
    .waiting()
    .filter((k) => needsMet(k.needs, caps).ok)
    .map((k) => k.id);
}
