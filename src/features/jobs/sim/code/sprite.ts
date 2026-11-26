// A job's program drawn as a picture (docs/JOBS.md "The Almanac"): the almanac's sprite for the job, made from its profile.

import type { CodeProfile, OpClass } from './types';

/** One cell of a job's picture: the kind of instruction it is and how often it ran (0 = never, 1 = the busiest word). */
interface SpriteCell {
  cls: OpClass;
  heat: number;
}

/** A job's program drawn as a picture: one cell per instruction word, in order, wrapped into rows. */
export interface Sprite {
  cols: number;
  rows: number;
  cells: SpriteCell[];
}

/**
 * The picture of a program (the almanac's sprite for the job): every word that ran, coloured by what the instruction does and as bright as it was busy.
 * Two jobs look different at a glance (a tight loop of multiplies against a long run of loads and stores), and it is the program itself, not a drawing.
 */
export function spriteOf(p: CodeProfile, maxCells = 400): Sprite {
  let last = -1;
  for (const [i, l] of p.lines.entries()) {
    if (l.count > 0) {
      last = i;
    }
  }
  const lines = p.lines.slice(0, last + 1).slice(0, maxCells);
  const lg = Math.log(Math.max(...lines.map((l) => l.count), 1) + 1);
  const cells = lines.map((l): SpriteCell => ({
    cls: l.cls,
    heat: l.count > 0 ? Math.max(0.18, Math.log(l.count + 1) / lg) : 0,
  }));
  const side = Math.ceil(Math.sqrt(Math.max(1, cells.length) * 2.2));
  const cols = Math.max(6, Math.min(32, side));
  return { cols, rows: Math.max(1, Math.ceil(cells.length / cols)), cells };
}
