// Game feature: the job log and almanac entries a key leaves, plus run-window stamps. Every export is a `Game` method (see game.ts).

import * as engines from '../../cpu/sim/engines';
import { JobState } from '@/core/sim/memmap';
import { dexEntry } from '../../jobs/sim/jobdex';
import * as jobLogSim from '../../jobs/sim/joblog';
import type { Game } from '@/worker/game/game';
import type { Key } from '@/worker/game/internal';

/** The program wrote its result onto the plugged key: the key holds it now. */
export function afterMachine(this: Game): void {
  const k = this.plugged;
  const pk = this.pchKey;
  if (k && pk && pk.done && !k.done) {
    k.done = true;
    k.doneAt = this.baseTick;
    this.closeWindow(k);
    if (!this.os) {
      k.doneBeforeOs = true;
    }
    k.result = pk.result;
    this.progress.firstJobDone = true;
    this.note('job', `key ${k.id} holds its result: ${k.result}`);
  }
}

/** The tick the machine took the job. A key restored from an older save has none (0): its arrival stands in, so the wait reads as nothing rather than as the whole game. */
export function startOf(this: Game, k: Key): number {
  return Math.max(k.pluggedAt, k.arrival);
}

/** The tick the job began to run (`ranAt`); a key that was never seen running (an older save) falls back to when the machine took it. */
export function ranOf(this: Game, k: Key): number {
  return Math.max(this.startOf(k), k.ranAt ?? 0);
}

/**
 * Per base tick, under an OS: a job the kernel has just begun gets `ranAt`, and its counter window restarts there, so the run
 * excludes the ingest and the queue wait. Only the first time (a re-ingest after a reboot keeps it). The jobs are the plugged key
 * and the spool; a job that starts and ends inside one tick is never seen running and keeps the older reading. A job reloaded from a
 * save is stamped here too (its counters restarted at the load), so its window covers only the run since.
 */
export function stampRan(this: Game): void {
  if (!this.os) {
    // A key reloaded in the port: the machine boots cold and loads it, so the run (and its counters) start over at the first tick it is on.
    const k = this.plugged;
    if (k?.reloaded && !k.done && k.ranAt === undefined) {
      k.ranAt = this.baseTick;
      k.c0 = this.countersNow();
    }
    return;
  }
  for (const j of this.kernelJobs()) {
    if (j.state !== JobState.Running) {
      continue;
    }
    const k = this.plugged?.id === j.key ? this.plugged : this.spool.find((x) => x.id === j.key);
    if (!k || k.ranAt !== undefined || k.done) {
      continue;
    }
    k.ranAt = this.baseTick;
    k.c0 = this.countersNow();
  }
}

function isPipelineEngine(eng: object | null): eng is engines.PipelineEngine {
  return eng !== null && 'view' in eng;
}

export function countersNow(this: Game): number[] | undefined {
  const eng = this.machine.engine;
  if (!isPipelineEngine(eng)) {
    return undefined;
  }
  return [...eng.view.counters].slice(0, engines.COUNTER_NAMES.length);
}

/** The result has landed: how much the counters moved since the machine took the job. */
export function closeWindow(this: Game, k: Key): void {
  const now = this.countersNow();
  k.win = now ? jobLogSim.windowOf(k.c0, now) : undefined;
  if (!k.win) {
    delete k.win;
  }
}

/** The counters of the running job so far (the log's window, still open), or nothing when the machine has none for it. */
export function liveOf(this: Game, k: Key): { live?: jobLogSim.JobWindow; gpu?: true } {
  const now = this.countersNow();
  const live = now ? jobLogSim.windowOf(k.c0, now) : undefined;
  return live ? { live, ...(this.onCard(k) ? { gpu: true as const } : {}) } : {};
}

/** The job's work runs on a graphics card: a `gpu` class job while a working card is fitted (without one the CPU does it and its stalls are real). The CPU only spins on the card's status. */
export function onCard(this: Game, k: Key): boolean {
  return k.cls === 'gpu' && this.gpuTarget() !== undefined;
}

/** The job log: one line for a job that ended (docs/JOBS.md "The log"). */
export function addLog(this: Game, opts: { k: Key; outcome: jobLogSim.JobOutcome; pay: number; late: boolean }): void {
  const { k, outcome, pay, late } = opts;
  const done = outcome === 'done';
  this.jobLog.push({
    id: k.id,
    type: k.type,
    scale: k.scale,
    outcome,
    arrival: k.arrival,
    start: done ? this.startOf(k) : this.baseTick,
    ...(done && k.ranAt !== undefined ? { ran: Math.max(this.startOf(k), k.ranAt) } : {}),
    finish: done ? k.doneAt : this.baseTick,
    end: this.baseTick,
    deadline: k.deadline,
    payout: pay,
    late,
    attempts: k.attempts,
    os: this.os?.spec.tier ?? 0,
    ...(done && this.onCard(k) ? { gpu: true as const } : {}),
    ...(done && k.reloaded ? { reloaded: true as const } : {}),
    ...(done && k.win ? { win: { ...k.win } } : {}),
  });
  if (this.jobLog.length > jobLogSim.JOB_LOG_CAP) {
    this.jobLog.splice(0, this.jobLog.length - jobLogSim.JOB_LOG_CAP);
  }
}

export function dexSeen(this: Game, k: Key): void {
  if (dexEntry(k.type) && !this.dex[k.type]) {
    this.dex[k.type] = { seen: this.baseTick, runs: 0, best: 0 };
  }
}

export function dexDone(this: Game, k: Key): void {
  this.dexSeen(k);
  const r = this.dex[k.type];
  if (!r) {
    return;
  }
  const ticks = Math.max(1, k.doneAt - this.ranOf(k)); // the fastest run is the machine's, not the queue's luck
  r.runs++;
  r.best = r.best === 0 ? ticks : Math.min(r.best, ticks);
}
