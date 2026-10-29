// Game feature: the USB key's life. Plug, eject, pay, decline, the auto-eject, and the job log and almanac entries a key leaves.
// Every export is a `Game` method (see game.ts).

import { COUNTER_NAMES, type PipelineEngine } from "../engines";
import { generate } from "../gen";
import { JOB_ROW, JobState, PchPhase } from "../isa/memmap";
import { dexEntry } from "./jobdex";
import { JOB_LOG_CAP, windowOf, type JobOutcome, type JobWindow } from "./joblog";
import { payout, slaFactor } from "./economy";
import type { Game } from "./game";
import type { Key } from "./internal";
import { levelPayMul, needsMet } from "./levels";
import type { Result } from "./types";

/** The player's plug: as `plugKey`, and a machine that is off switches on (a refusal to start is reported). */
export function plugAndBoot(this: Game, keyId: number): Result<{ key: number }> {
  const r = this.plugKey(keyId);
  if (!r.ok || this.powered) return r;
  const on = this.powerButton();
  return on.ok ? r : { ok: false, reason: `the key is in, but the machine cannot start: ${on.reason}` };
}

/** Plug a key from the tray into the USB port. One program at a time: a key already in the port must come out first. */
export function plugKey(this: Game, keyId: number): Result<{ key: number }> {
  if (this.plugged) return { ok: false, reason: "a key is already plugged in: remove it first" };
  if (this.netKey) return { ok: false, reason: "the port is busy with a network job for a moment" };
  const peek = this.tray.waiting().find((k) => k.id === keyId);
  if (peek) {
    // A job the machine cannot run is refused at the port (with an OS, at ingest): it waits in the tray until it expires or is declined.
    const need = needsMet(peek.needs, this.caps());
    if (!need.ok) {
      this.note("key", `key ${peek.id} refused: needs ${need.missing.join(", ")}`);
      return { ok: false, reason: `cannot run this job: it needs ${need.missing.join(" and ")}` };
    }
  }
  const key = this.tray.take(keyId);
  if (!key) return { ok: false, reason: `no key ${keyId} in the tray` };
  let program: Uint32Array;
  try {
    program = generate(key.template, key.seed, { row: JOB_ROW, scale: key.scale, hosted: true, gpu: this.gpuTarget(), npu: this.npuTarget() }).program;
  } catch (e) {
    this.tray.giveBack(key);
    return { ok: false, reason: `the key is unreadable (${(e as Error).message})` };
  }
  key.pluggedAt = this.baseTick;
  key.c0 = this.countersNow();
  this.plugged = key;
  this.pchKey = { id: key.id, program, done: key.done, result: key.result };
  this.pch.plug(this.pchKey);
  this.progress.firstKeyPlugged = true;
  this.note("key", `key ${key.id} plugged in`);
  return { ok: true, key: key.id };
}

/**
 * Remove the plugged key. If it holds a result, the client collects it: payout and reputation are applied now
 * (turnaround is key arrival to this moment). If the job is not finished, it is aborted: the key goes back to the
 * tray unserved, and a machine that was loading or running crashes and reboots.
 */
export function ejectKey(this: Game): Result<{ payout: number; done: boolean }> {
  const key = this.plugged;
  if (!key) return { ok: false, reason: "no key is plugged in" };
  // Under an OS the key stays in while the OS has its job: the result is written onto it and it pops out and pays by itself.
  if (this.os && this.powered && !key.done && this.kernelJobs().some((j) => j.key === key.id)) {
    return { ok: false, reason: "the OS is working on this job: the key pops out by itself when the result is written" };
  }
  const phase = this.currentPhase();
  this.plugged = null;
  this.pchKey = null;
  this.pch.unplug();
  if (!key.done) {
    if (!this.os) key.attempts++;
    this.tray.giveBack(key);
    this.note("key", `key ${key.id} pulled before the job finished`);
    if (this.powered && !this.postError && (phase === "loading" || phase === "running" || phase === "writing")) this.coldBoot();
    return { ok: true, payout: 0, done: false };
  }
  if (!this.progress.firstKeyEjected && !this.sandbox) {
    // Scripted for the guided start: the first happy client tells two friends, so the tutorial's next lesson never finds an empty tray.
    for (let i = 0; i < 2; i++) this.enqueue("cli", 1, "cli");
    this.note("key", "your first client told two friends: new keys are in the tray");
  }
  this.progress.firstKeyEjected = true;
  if (this.os) {
    // A key that finished before any OS existed and is merely pulled out now was not an OS job.
    if (!key.doneBeforeOs) this.progress.firstOsJob = true;
    this.freeKernelSlot(key.id); // delivery is the receipt: the kernel's slot for this job is free again
  }
  const pay = this.deliver(key, "collected");
  return { ok: true, payout: pay, done: true };
}

/** The client has its result: payout, turnaround average, client base, `lastCompleted`. Returns the payout. */
export function deliver(this: Game, key: Key, how: string): number {
  const turnaround = this.baseTick - key.arrival;
  const late = this.baseTick > key.deadline;
  // A job with a latency SLA (web) pays by the SLA curve, which already ends at the late factor, instead of the late factor itself.
  const sla = this.slaOf(key);
  const base = payout(this.cfg, key.work * key.payMul, turnaround, sla === null && late, levelPayMul(this.level));
  const pay = sla === null ? base : Math.round(base * slaFactor(this.cfg, turnaround, sla, key.deadline - key.arrival));
  if (!this.sandbox) this.money += pay; // the sandbox balance is a constant
  this.completed++;
  this.avgTurnaround += this.cfg.emaAlpha * (turnaround - this.avgTurnaround);
  this.addClientBase(this.reputation());
  this.lastCompleted = {
    id: key.id, template: key.template, payout: pay, turnaround, execTicks: key.doneAt - this.startOf(key), late,
    attempts: key.attempts, completedAt: this.baseTick,
  };
  this.dexDone(key);
  this.addLog(key, "done", pay, late);
  this.note("payout", `key ${key.id} ${how}: $${pay}${late ? " (late)" : ""}`);
  return pay;
}

/** Ids of the keys in the tray that the machine can run, oldest first (what a bot should plug). */
export function trayKeyIds(this: Game): number[] {
  const caps = this.caps();
  return this.tray.waiting().filter((k) => needsMet(k.needs, caps).ok).map((k) => k.id);
}

/**
 * Decline a waiting job: a tray key, or a key the OS ingested that has not started (docs/PROGRESSION.md "Declining").
 * The client leaves at once; the small reputation cost is `targetTurnaround x patienceMul` fed into the turnaround
 * average (one third of an expiry), nothing in the sandbox. Pays nothing and gives no client-base points.
 * Refused for the plugged key, a running job and a result waiting for collection.
 */
export function declineKey(this: Game, keyId: number): Result<{ keyId: number }> {
  if (this.plugged?.id === keyId) return { ok: false, reason: "plugged: the key is in the USB port, remove it first" };
  const retired = this.tray.waiting().some((k) => k.id === keyId && k.retired);
  const inTray = this.tray.waiting().some((k) => k.id === keyId);
  const inOffers = this.offersQ.waiting().some((k) => k.id === keyId);
  const spooled = this.spool.find((k) => k.id === keyId);
  const gone = this.tray.waiting().find((k) => k.id === keyId) ?? this.offersQ.waiting().find((k) => k.id === keyId) ?? spooled;
  if (inOffers) {
    this.offersQ.take(keyId);
  } else if (this.downloads.some((t) => t.key.id === keyId) || this.rx.some((k) => k.id === keyId)) {
    return { ok: false, reason: "downloading: the job is on the wire" };
  } else if (spooled) {
    if (this.uploads.some((t) => t.key.id === keyId)) return { ok: false, reason: "uploading: the result is being sent" };
    const job = this.kernelJobs().find((j) => j.key === keyId);
    if (job?.state === JobState.Running) return { ok: false, reason: "running: the job is being run" };
    if (job?.state === JobState.Result) return { ok: false, reason: "result ready: it is being delivered" };
    if (job) this.freeKernelSlot(keyId);
    this.spool = this.spool.filter((k) => k.id !== keyId);
  } else if (!inTray) {
    return { ok: false, reason: `no waiting job ${keyId}` };
  } else {
    this.tray.take(keyId);
  }
  this.declined++;
  if (gone) this.addLog(gone, "declined", 0, false);
  // A retired key costs nothing to decline (docs/NETWORK.md "Retired keys"): its client already went online.
  if (!this.sandbox && !retired) this.avgTurnaround += this.cfg.emaAlpha * (this.targetTurnaround() - this.avgTurnaround);
  this.note("decline", `declined job ${keyId}${this.sandbox ? " (free in the sandbox)" : retired ? " (free: retired)" : ""}`);
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
  return !!k && !k.done && this.kernelJobs().some((j) => j.key === k.id && (j.state === JobState.Queued || j.state === JobState.Running));
}

/** A finished key ejects itself `autoEjectTicks` after its result is in, and pays. No OS: after the machine halts on JOB DONE, and the machine powers off. With an OS: after the flash, and the machine stays on. */
export function autoEject(this: Game): void {
  const k = this.plugged;
  // No OS: after JOB DONE (halted). With an OS: once the result has landed on the key (the flash is over).
  const ready = !!k && k.done && (this.os ? this.pch.phase !== PchPhase.OsFlash : this.pch.phase === PchPhase.Halted);
  if (!this.cfg.autoEjectTicks || !ready) { this.autoEjectWait = 0; return; }
  if (++this.autoEjectWait >= this.cfg.autoEjectTicks) {
    this.autoEjectWait = 0;
    this.ejectKey();
    if (!this.os) this.powerButton(); // no OS: the machine switches itself off too. With an OS it just goes on.
  }
}

/** The program wrote its result onto the plugged key: the key holds it now. */
export function afterMachine(this: Game): void {
  const k = this.plugged;
  const pk = this.pchKey;
  if (k && pk && pk.done && !k.done) {
    k.done = true;
    k.doneAt = this.baseTick;
    this.closeWindow(k);
    if (!this.os) k.doneBeforeOs = true;
    k.result = pk.result;
    this.progress.firstJobDone = true;
    this.note("job", `key ${k.id} holds its result: ${k.result}`);
  }
}

/** The tick the machine took the job. A key restored from an older save has none (0): its arrival stands in, so the wait reads as nothing rather than as the whole game. */
export function startOf(this: Game, k: Key): number {
  return Math.max(k.pluggedAt, k.arrival);
}

export function countersNow(this: Game): number[] | undefined {
  const eng = this.machine.engine as PipelineEngine | null;
  return eng?.view ? Array.from(eng.view.counters).slice(0, COUNTER_NAMES.length) : undefined;
}

/** The result has landed: how much the counters moved since the machine took the job. */
export function closeWindow(this: Game, k: Key): void {
  const now = this.countersNow();
  k.win = now ? windowOf(k.c0, now) : undefined;
  if (!k.win) delete k.win;
}

/** The counters of the running job so far (the log's window, still open), or nothing when the machine has none for it. */
export function liveOf(this: Game, k: Key): { live?: JobWindow } {
  const now = this.countersNow();
  const live = now ? windowOf(k.c0, now) : undefined;
  return live ? { live } : {};
}

/** The job log: one line for a job that ended (docs/JOBS.md "The log"). */
export function addLog(this: Game, k: Key, outcome: JobOutcome, pay: number, late: boolean): void {
  const done = outcome === "done";
  this.jobLog.push({
    id: k.id, type: k.type, scale: k.scale, outcome, arrival: k.arrival,
    start: done ? this.startOf(k) : this.baseTick, finish: done ? k.doneAt : this.baseTick, end: this.baseTick,
    deadline: k.deadline, payout: pay, late, attempts: k.attempts, os: this.os?.spec.tier ?? 0,
    ...(done && k.win ? { win: { ...k.win } } : {}),
  });
  if (this.jobLog.length > JOB_LOG_CAP) this.jobLog.splice(0, this.jobLog.length - JOB_LOG_CAP);
}

export function dexSeen(this: Game, k: Key): void {
  if (dexEntry(k.type) && !this.dex[k.type]) this.dex[k.type] = { seen: this.baseTick, runs: 0, best: 0 };
}

export function dexDone(this: Game, k: Key): void {
  this.dexSeen(k);
  const r = this.dex[k.type];
  if (!r) return;
  const ticks = Math.max(1, k.doneAt - this.startOf(k));
  r.runs++;
  r.best = r.best === 0 ? ticks : Math.min(r.best, ticks);
}
