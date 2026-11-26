// The almanac's lookups (docs/JOBS.md "The Almanac"): an entry's number, group and stage for the player, and its needs as the monitor words them.

import { describeNeed } from '../../../economy/sim/levels';
import { DEX_GROUPS, JOB_DEX } from './catalog';
import { taskLevel, taskNeeds } from './tasks';
import type { DexEntry, DexGroup, DexRecord, DexState } from './types';

/** The number of an entry in the collection (1, 2, ...): the order the groups show them in. */
export const dexNumber = (id: string): number => DEX_GROUPS.flatMap((g) => g.ids).indexOf(id) + 1;

export const dexEntry = (id: string): DexEntry | undefined => JOB_DEX.find((e) => e.id === id);

/** The group an entry belongs to. */
export const dexGroup = (id: string): DexGroup | undefined => DEX_GROUPS.find((g) => g.ids.includes(id));

export function dexState(e: DexEntry, rec: DexRecord | undefined): DexState {
  if (e.planned === true) {
    return 'planned';
  }
  if (!rec) {
    return 'unseen';
  }
  return rec.runs > 0 ? 'done' : 'seen';
}

/** What the class needs, as the phrases the monitor uses; and the level it arrives at. */
export function dexNeeds(e: DexEntry): { needs: string[]; firstLevel: number } {
  return { needs: taskNeeds(e).map((n) => describeNeed(n).long), firstLevel: taskLevel(e) };
}

/** What the class needs as chips: the kind (for an icon), the short label and the long phrase. */
export function needChips(e: DexEntry): { kind: string; short: string; long: string }[] {
  return taskNeeds(e).map((n) => {
    const { short, long } = describeNeed(n);
    return { kind: n.kind, short, long };
  });
}
