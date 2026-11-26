// Level lookups, arrival mix and the milestone snapshot.

import * as levelsClasses from './levelsClasses';
import * as levelsTable from './levelsTable';

/** Points one delivered job adds to the client base. */
export function pointsFor(reputation: number): number {
  return Math.min(2, Math.max(0.5, reputation));
}

/** The highest level whose threshold the client base has reached (monotonic in the score). */
export function levelFor(clientBase: number): number {
  let n = 1;
  for (const l of levelsTable.LEVELS) {
    if (clientBase >= l.threshold) {
      n = l.level;
    }
  }
  return n;
}

export function levelDef(level: number): levelsTable.LevelDef {
  const i = Math.min(levelsTable.MAX_LEVEL, Math.max(1, Math.round(level))) - 1;
  const row = levelsTable.LEVELS[i] ?? levelsTable.LEVELS[0];
  if (row === undefined) {
    throw new Error('LEVELS is empty');
  }
  return row;
}
export const patienceMul = (level: number): number => levelDef(level).patienceMul;
export const levelPayMul = (level: number): number => levelDef(level).payMul;
export const levelDemandMul = (level: number): number => levelDef(level).demandMul;

/**
 * Arrival weights per class at `level`. A class ramps from 0 to its table share over `rampTicks` after its first level
 * was reached (`levelTicks[firstLevel]`; unknown means fully ramped), heavy classes scale with the reputation
 * (clamped 0.5 to 1.5). The weights are not normalised; pick with `r * total`.
 */
export function jobMix(opts: {
  level: number;
  reputation: number;
  levelTicks: Readonly<Record<number, number>>;
  tick: number;
}): [levelsClasses.JobClassDef, number][] {
  const { level, reputation, levelTicks, tick } = opts;
  const shares = levelDef(level).mix;
  const heavy = Math.min(1.5, Math.max(0.5, reputation));
  const out: [levelsClasses.JobClassDef, number][] = [];
  for (const c of levelsClasses.JOB_CLASSES) {
    const share = shares[c.id];
    if (share === undefined || share === 0) {
      continue;
    }
    const since = levelTicks[c.firstLevel];
    const ramp = c.rampTicks > 0 && since !== undefined ? Math.min(1, Math.max(0, (tick - since) / c.rampTicks)) : 1;
    out.push([c, share * ramp * (c.heavy ? heavy : 1)]);
  }
  return out;
}

/** Pick a class from `jobMix` with a uniform draw `r` in [0, 1). */
export function pickClass(mix: [levelsClasses.JobClassDef, number][], r: number): levelsClasses.JobClassDef {
  const total = mix.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [c, w] of mix) {
    if (x < w) {
      return c;
    }
    x -= w;
  }
  const last = mix.at(-1);
  if (last === undefined) {
    throw new Error('jobMix is empty');
  }
  return last[0];
}

// ---------- snapshot data ----------

export interface LevelRowSnap {
  level: number;
  name: string;
  threshold: number;
  patienceMul: number;
  payMul: number;
  unlocks: { id: string; name: string; kind: string; planned: boolean }[];
  /** Job classes that first arrive at this level. */
  newJobs: string[];
}

/** Every level for the milestone screen (static). */
export function levelRows(): LevelRowSnap[] {
  return levelsTable.LEVELS.map((l) => ({
    level: l.level,
    name: l.name,
    threshold: l.threshold,
    patienceMul: l.patienceMul,
    payMul: l.payMul,
    unlocks: l.unlocks.map(levelsTable.itemInfo),
    newJobs: levelsClasses.JOB_CLASSES.filter((c) => c.firstLevel === l.level).map((c) => c.id),
  }));
}
