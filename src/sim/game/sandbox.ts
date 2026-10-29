// Game feature: the sandbox tools (refused outside the sandbox). Every export is a `Game` method (see game.ts).

import { TEMPLATES } from "../gen";
import type { Game } from "./game";
import { NOT_SANDBOX } from "./internal";
import { JOB_DEX } from "./jobdex";
import { JOB_CLASSES, jobClass, levelDef, MAX_LEVEL, type JobClassId } from "./levels";
import type { Result } from "./types";

/**
 * Sandbox: add a key to the tray: a generator template (any `cli*`) at `scale` 1..16, or a job class id (`db`, `web`,
 * `gpu`, ...; the class sets template and scale, so it carries its needs and may be unrunnable).
 */
export function spawnKey(this: Game, template: string, scale = 1): Result<{ keyId: number }> {
  if (!this.sandbox) return NOT_SANDBOX;
  const cls = typeof template === "string" ? jobClass(template) : undefined;
  if (!cls && (typeof template !== "string" || !Object.prototype.hasOwnProperty.call(TEMPLATES, template))) return { ok: false, reason: `unknown job template "${String(template)}"` };
  if (!Number.isInteger(scale) || scale < 1 || scale > 16) return { ok: false, reason: "scale must be a whole number from 1 to 16" };
  if (this.tray.waiting().length >= this.cfg.queueCap) return { ok: false, reason: `the tray is full (${this.cfg.queueCap} keys)` };
  const keyId = this.nextKeyId;
  try {
    if (cls) this.enqueue(cls.template, cls.scale, cls.id);
    else this.enqueue(template, scale);
  } catch (e) {
    if (e instanceof RangeError) return { ok: false, reason: e.message }; // a scale this job's buffer or display cannot hold
    throw e;
  }
  this.note("sandbox", `spawned key ${keyId} (${template} x${scale})`);
  return { ok: true, keyId };
}

/** Sandbox: pin the rules level (patience, payout, demand and the arrival mix) at `level` (1 to 18). Refused in a campaign. */
export function setLevel(this: Game, level: number): Result<{ level: number }> {
  if (!this.sandbox) return NOT_SANDBOX;
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) return { ok: false, reason: `level must be a whole number from 1 to ${MAX_LEVEL}` };
  this.sandboxLevel = level;
  this.note("sandbox", `rules level set to ${level} (${levelDef(level).name})`);
  return { ok: true, level };
}

/**
 * Sandbox: choose which job classes arrive on their own. `off` lists the classes that stop arriving (an empty list turns them all back on);
 * with every class of the level off nothing arrives. `spawnKey` still adds any class by hand. Refused in a campaign.
 */
export function setJobClasses(this: Game, off: readonly string[]): Result<{ off: JobClassId[] }> {
  if (!this.sandbox) return NOT_SANDBOX;
  const known = new Set<string>(JOB_CLASSES.map((c) => c.id));
  const bad = off.find((id) => !known.has(id));
  if (bad !== undefined) return { ok: false, reason: `unknown job class '${bad}'` };
  this.sandboxOff = new Set(off as JobClassId[]);
  this.note("sandbox", this.sandboxOff.size ? `arrivals off: ${[...this.sandboxOff].join(", ")}` : "every job class arrives again");
  return { ok: true, off: [...this.sandboxOff] };
}

/**
 * Sandbox: choose which kinds of job (job dex ids such as `fib`, `mandel`) arrive on their own, finer than `setJobClasses`: `off` lists the kinds that stop
 * (empty = all arrive). A class whose kinds at the pinned level are all off sends nothing. `spawnKey` still adds any. Refused in a campaign.
 */
export function setJobKinds(this: Game, off: readonly string[]): Result<{ off: string[] }> {
  if (!this.sandbox) return NOT_SANDBOX;
  const known = new Set(JOB_DEX.filter((e) => !e.planned).map((e) => e.id));
  const bad = off.find((id) => !known.has(id));
  if (bad !== undefined) return { ok: false, reason: `unknown kind of job '${bad}'` };
  this.sandboxKindsOff = new Set(off);
  this.note("sandbox", this.sandboxKindsOff.size ? `${this.sandboxKindsOff.size} kinds of job off` : "every kind of job arrives again");
  return { ok: true, off: [...this.sandboxKindsOff] };
}

/** Sandbox: throw away every key in the tray (the plugged key and keys the OS holds stay). */
export function clearQueue(this: Game): Result<{ removed: number }> {
  if (!this.sandbox) return NOT_SANDBOX;
  const removed = this.tray.waiting().length;
  this.tray.set([]);
  this.note("sandbox", `tray cleared (${removed} keys)`);
  return { ok: true, removed };
}

/** Sandbox: un-burn every part and the board, cool everything to ambient, clear the PSU trip. Works powered or not. */
export function repairAll(this: Game): Result<{ repaired: number; tripCleared: boolean }> {
  if (!this.sandbox) return NOT_SANDBOX;
  let repaired = 0;
  for (const d of this.board.devices) if (d.burnt) { delete d.burnt; repaired++; }
  if (this.board.burnt) { delete this.board.burnt; repaired++; }
  const tripCleared = this.thermal.power.tripped;
  this.thermal.coolAll();
  this.note("sandbox", `repaired everything (${repaired} burnt parts${tripCleared ? ", PSU trip cleared" : ""})`);
  return { ok: true, repaired, tripCleared };
}

/**
 * Sandbox: set the reputation (clamped to the economy's range). The turnaround average is set to match and waiting
 * keys that are older than it are re-dated to now, so the next snapshot shows exactly this value; it then moves as usual.
 */
export function setReputation(this: Game, value: number): Result<{ reputation: number }> {
  if (!this.sandbox) return NOT_SANDBOX;
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, reason: "reputation must be a number" };
  const rep = Math.min(this.cfg.repMax, Math.max(this.cfg.repMin, value));
  this.avgTurnaround = Math.max(1, this.targetTurnaround() / rep);
  for (const k of this.tray.waiting()) {
    if (this.baseTick - k.arrival > this.avgTurnaround) {
      k.arrival = this.baseTick;
      k.deadline = this.baseTick + this.deadlineTicks();
    }
  }
  this.note("sandbox", `reputation set to ${rep.toFixed(2)}`);
  return { ok: true, reputation: this.reputation() };
}
