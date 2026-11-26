// Game feature: the clients. Where keys come from (arrivals, the mix), what the machine can offer them, how long they wait,
// reputation, the client base and the level. Every export is a `Game` method (see game.ts).

import { deviceSpec } from '../../board/sim';
import { demandRate, payout, pickTemplate, reputation as reputationOf, slaFactor } from './economy';
import type { Game } from '@/worker/game/game';
import type { Key } from '@/worker/game/internal';
import { classBlocked, pickTask } from '../../jobs/sim/jobdex';
import * as levelsSim from './levels';

export { rebuild } from './clientsRebuild';

interface EnqueueOpts {
  template: string;
  scale?: number | undefined;
  cls?: string | undefined;
  net?: boolean | undefined;
  pick?: boolean | undefined;
}

/** A key arrives from a client: it goes in the tray, or the client gives up if the tray is full. */
export function enqueue(this: Game, opts: EnqueueOpts): boolean {
  let { template, scale = 1 } = opts;
  const { cls } = opts;
  const net = opts.net === true;
  const pick = opts.pick === true;
  const seed = this.machine.prng.nextU32();
  // A class with several kinds of job sends one the player's level has reached, chosen by the seed (no extra draw: the PRNG stream does not depend on it).
  const c = pick && cls ? levelsSim.jobClass(cls) : undefined;
  const task = c && pickTask(c, this.level, { seed, off: this.sandbox ? this.sandboxKindsOff : undefined });
  if (task) {
    ({ template } = task);
    scale = task.scale ?? c.scale;
  }
  const src = net ? this.offersQ : this.tray;
  if (src.waiting().length >= this.cfg.queueCap) {
    this.dropped++;
    // The client takes the key back: that counts against the turnaround average, so it costs reputation.
    this.avgTurnaround += this.cfg.emaAlpha * (this.cfg.giveUpTurnaround * this.patience() - this.avgTurnaround);
    this.note('drop', net ? 'offer list full: a client gave up' : 'tray full: a client gave up');
    return false;
  }
  const key = this.rebuild({
    id: this.nextKeyId++,
    template,
    seed,
    scale,
    arrival: this.baseTick,
    deadline: this.baseTick + this.deadlineTicks(),
    ...(cls ? { cls } : {}),
  });
  src.offer(key);
  this.dexSeen(key);
  return true;
}

export function arrivals(this: Game): void {
  const rate = this.demand();
  const { prng } = this.machine;
  // Two draws per tick whatever happens, so the PRNG stream does not depend on state.
  const hit = prng.next() < rate;
  const pick = prng.next();
  // No clients before the first boot: the market opens when the player's PC first comes up.
  if (hit && this.progress.poweredOn) {
    // Channel (docs/NETWORK.md "Arrival channels"): once the link has been up, work comes as offers and USB keys retire;
    // after a long dead link keys come back at a fraction of the rate (thinned from the same draw: no extra PRNG use).
    const fallback = this.usbFallback();
    let r = pick;
    if (fallback) {
      if (pick >= this.cfg.usbFallbackMul) {
        return;
      }
      r = pick / this.cfg.usbFallbackMul;
    }
    const toNet = this.networkLinked && !fallback;
    if (this.cfg.mix) {
      const m = pickTemplate({ mix: this.cfg.mix, ramBytes: this.installedRamBytes(), r, tick: this.baseTick });
      this.enqueue({ template: m.template, scale: m.scale, net: toNet });
    } else {
      // The web class needs a plan and has no share while no client is on the wire (no plan, or a long dead link).
      const mix = levelsSim
        .jobMix({ level: this.level, reputation: this.reputation(), levelTicks: this.levelTicks, tick: this.baseTick })
        .filter(
          ([c]) =>
            (c.id !== 'web' || (this.ispTier > 0 && !fallback)) &&
            !this.sandboxOff.has(c.id) &&
            !classBlocked(c, this.level, this.sandboxKindsOff),
        );
      if (mix.length === 0) {
        return; // the sandbox switched off every class (or every kind of them) of this level
      }
      const c: levelsSim.JobClassDef = levelsSim.pickClass(mix, r);
      this.enqueue({ template: c.template, scale: c.scale, cls: c.id, net: toNet || c.id === 'web', pick: true });
    }
  }
}

/** Key arrivals per tick now: the base rate times the level's demand multiplier times the reputation. */
export function demand(this: Game): number {
  return demandRate(this.cfg, this.reputation(), levelsSim.levelDemandMul(this.level));
}

/** What the machine can offer a job right now. `cores` counts logical cores (docs/MULTICORE.md: a job's need is its thread count). */
export function caps(this: Game): levelsSim.Caps {
  return this.capsWith(this.linkUsable);
}

/** Caps with the network need decided by the caller (`netOk`): admission asks about the link as it is right now. */
export function capsWith(this: Game, netOk: boolean): levelsSim.Caps {
  const storage = this.board.devices.filter((d) => !d.burnt && deviceSpec(d).kind === 'storage');
  const tpms = this.board.devices.filter((d) => !d.burnt && deviceSpec(d).kind === 'tpm');
  const tpm = tpms.length > 0;
  return {
    ...levelsSim.NO_CAPS,
    net: netOk,
    netTier: netOk ? this.ispTier : 0,
    tpm,
    tpmTier: tpm ? Math.max(...tpms.map((d) => deviceSpec(d).tier)) : 0,
    ecc: this.eccInstalled(),
    cores: this.cpuLogicalCores(),
    osTier: this.os?.spec.tier ?? 0,
    ramBytes: this.installedRamBytes(),
    ...this.fsCaps(),
    storageTier: storage.length > 0 ? Math.max(...storage.map((d) => deviceSpec(d).tier)) : -1,
  };
}

export function runnable(this: Game, k: Key, caps = this.caps()): boolean {
  return levelsSim.needsMet(k.needs, caps).ok;
}

/** The client takes back a job the machine cannot run once its deadline passes: a give-up in the turnaround average. */
export function expireKeys(this: Game): void {
  if (!this.progress.poweredOn) {
    return;
  }
  const caps = this.caps();
  // Retired keys (docs/NETWORK.md "Retired keys") leave silently at their deadline, runnable or not: no penalty, no count.
  for (const k of this.tray.waiting().filter((x) => x.retired && this.baseTick >= x.deadline)) {
    this.tray.take(k.id);
  }
  for (const k of [...this.tray.waiting(), ...this.offersQ.waiting()]) {
    if (this.baseTick < k.deadline || this.runnable(k, caps)) {
      continue;
    }
    this.tray.take(k.id);
    this.offersQ.take(k.id);
    this.expired++;
    this.addLog({ k, outcome: 'expired', pay: 0, late: true });
    this.avgTurnaround += this.cfg.emaAlpha * (this.cfg.giveUpTurnaround * this.patience() - this.avgTurnaround);
    this.note('expire', `a client took back job ${k.id} (${k.type}): the machine cannot run it`);
  }
}

/** A delivered job adds `clamp(reputation, 0.5, 2)` to the client base; reaching a threshold levels up (never down). */
export function addClientBase(this: Game, rep: number): void {
  if (this.sandbox) {
    return;
  }
  this.clientBase += levelsSim.pointsFor(rep);
  const to = levelsSim.levelFor(this.clientBase);
  if (to <= this.lvl) {
    return;
  }
  this.recentUnlocks = [];
  for (let l = this.lvl + 1; l <= to; l++) {
    this.levelTicks[l] = this.baseTick;
    this.recentUnlocks.push(...levelsSim.levelDef(l).unlocks.map(levelsSim.itemInfo));
  }
  this.lvl = to;
  this.leveledUpAt = this.baseTick;
  this.note('level', `Level ${to}: ${levelsSim.levelDef(to).name}`);
}

/** Turnaround that drives reputation: the average, or the oldest waiting key's age if that is worse. */
export function serviceTurnaround(this: Game): number {
  // Jobs the machine cannot run are left out: they cost reputation once, when they expire, not also while they wait.
  const caps = this.caps();
  // Retired USB keys (docs/NETWORK.md "Retired keys") are left out too: the client went online.
  const waiting = [
    ...this.tray.waiting().filter((k) => !k.retired && this.runnable(k, caps)),
    ...this.offersQ.waiting().filter((k) => this.runnable(k, caps)),
    ...this.downloads.map((t) => t.key),
    ...this.rx,
    ...this.spool.filter((k) => !this.uploads.some((t) => t.key.id === k.id)),
  ];
  const oldest = waiting.reduce<Key | undefined>((o, k) => (!o || k.arrival < o.arrival ? k : o), undefined);
  const age = oldest && this.progress.poweredOn ? this.baseTick - oldest.arrival : 0;
  return Math.max(this.avgTurnaround, age);
}

export function reputation(this: Game): number {
  return reputationOf(this.cfg, this.serviceTurnaround(), this.targetTurnaround());
}

/** Base ticks since the first boot (0 before it). */
export function sinceFirstBoot(this: Game): number {
  return this.firstBootTick === null ? 0 : Math.max(0, this.baseTick - this.firstBootTick);
}

/** Client patience multiplier now: the level's (docs/PROGRESSION.md). */
export function patience(this: Game): number {
  return levelsSim.patienceMul(this.level);
}

/** The turnaround that counts as fine for reputation right now. */
export function targetTurnaround(this: Game): number {
  return this.cfg.targetTurnaround * this.patience();
}

/** Ticks a key arriving now may take before it is late. */
export function deadlineTicks(this: Game): number {
  return Math.round(this.cfg.deadlineTicks * this.patience());
}

/** Ticks after arrival within which the job pays in full, or null for a job without an SLA. Scaled like the deadline: the key's own deadline carries the level's patience at its arrival. */
export function slaOf(this: Game, k: Key): number | null {
  const base = levelsSim.jobClass(k.cls)?.slaTicks;
  if (base === undefined) {
    return null;
  }
  return Math.round((base * (k.deadline - k.arrival)) / this.cfg.deadlineTicks);
}

/** What the job pays if served on target now; for a job with an SLA it falls once the SLA has run out. */
export function estimate(this: Game, k: Key): number {
  const full = payout({
    cfg: this.cfg,
    work: k.work * k.payMul,
    turnaround: this.cfg.targetTurnaround,
    late: false,
    levelPay: levelsSim.levelPayMul(this.level),
  });
  const sla = this.slaOf(k);
  if (sla === null || !this.progress.poweredOn) {
    return full;
  }
  return Math.round(
    full *
      slaFactor({
        cfg: this.cfg,
        turnaround: this.baseTick - k.arrival,
        slaTicks: sla,
        deadlineTicks: k.deadline - k.arrival,
      }),
  );
}
