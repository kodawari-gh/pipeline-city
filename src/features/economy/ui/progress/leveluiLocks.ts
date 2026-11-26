// Level-gate lock model and the level-up celebration.

import type { Snapshot } from '@/worker/game/game';
import type { MilestoneUnlock } from './leveluiRows';
import { kindIcon } from './leveluiIcons';

export interface LevelLock {
  level: number;
  name: string;
}

/**
 * The hover text of an item that the player level still gates. The level reason comes first; the money or hardware
 * reasons that will apply once it is open follow, so the player sees the whole picture.
 */
export function lockTooltip(
  lock: LevelLock,
  also: { blocked?: string | undefined; priceShort?: number | undefined } = {},
): string {
  const parts = [`Unlocks at Level ${lock.level}, ${lock.name}. Keep serving clients to grow your client base.`];
  if (also.blocked !== undefined && also.blocked !== '') {
    parts.push(`Then: ${also.blocked}.`);
  }
  if (also.priceShort !== undefined && also.priceShort > 0) {
    parts.push('It will also need more money than you have now.');
  }
  return parts.join(' ');
}

/** The short badge text ("Level 4"). */
export const lockBadge = (lock: LevelLock): string => `Level ${lock.level}`;

/** The item is gated by exactly the next level: it carries a subtle outline so the player sees what is coming. */
export const isNextLevelLock = (lock: LevelLock | undefined, current: number): boolean =>
  lock !== undefined && lock.level === current + 1;

/**
 * Shelf order: items open now first (their order kept), then the gated ones by the level that opens them (order kept
 * within a level). A stable sort, so the tier order inside each group is the caller's.
 */
export function unlockedFirst<T>(items: readonly T[], lockOf: (t: T) => LevelLock | undefined): T[] {
  return items
    .map((t, i) => ({ t, i, lv: lockOf(t)?.level ?? 0 }))
    .toSorted((a, b) => a.lv - b.lv || a.i - b.i)
    .map((x) => x.t);
}

// ---------- level-up celebration ----------

export interface Celebration {
  level: number;
  name: string;
  unlocked: MilestoneUnlock[];
  at: number;
}

/**
 * The banner to show for this snapshot, or null. `seen` is the highest level this viewer has already been told about
 * (null if unknown). A level-up shows when the sim stamped `leveledUpAt` (it is null after a load or a start, so a reload
 * and a legacy save never replay) and the level is above `seen`. Not in the sandbox.
 */
export function celebrationFor(s: Snapshot, seen: number | null): Celebration | null {
  const l = s.level;
  if (l.sandbox || s.sandbox || l.leveledUpAt === null || seen === null || l.level <= seen) {
    return null;
  }
  return {
    level: l.level,
    name: l.name,
    at: l.leveledUpAt,
    unlocked: l.recentlyUnlocked.map((u) => ({
      id: u.id,
      name: u.name,
      kind: u.kind,
      planned: u.planned,
      icon: kindIcon(u.kind),
    })),
  };
}

/**
 * The seen level to keep after looking at `s`. Unknown becomes the current level; no stamp (a load, a start, a new game)
 * rebases to the current level; a level above `seen` with a stamp is kept (the banner is still owed).
 */
export function reconcileSeen(s: Snapshot, seen: number | null): number {
  const l = s.level;
  if (seen === null || l.sandbox || s.sandbox || l.leveledUpAt === null || l.level < seen) {
    return l.level;
  }
  return seen;
}
