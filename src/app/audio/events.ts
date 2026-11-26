// Snapshot log notes to cue ids. The rules are `logRules` in mixTokens.ts (first match wins). No sound on the first snapshot of a game.
import * as tokens from './mixTokens';
import type { GameEvent } from '../../worker/game/types';

const RULES = tokens.MIX.logRules.map((r) => ({
  kind: r.kind,
  cue: r.cue as tokens.CueId | null,
  re: r.match ? new RegExp(r.match, 'u') : null,
}));

/** The cue a log note plays, or null (no rule, or a rule with no cue such as `level`, which the key logic handles). */
export function cueForNote(e: Pick<GameEvent, 'kind' | 'text'>): tokens.CueId | null {
  for (const r of RULES) {
    if (r.kind === e.kind && (!r.re || r.re.test(e.text))) {
      return r.cue;
    }
  }
  return null;
}

/**
 * Finds the notes that are new since the last snapshot. `log` holds the last notes, oldest first, and several notes can share a tick.
 * The first call marks the log and returns nothing; so does a log whose last tick went back (a save was loaded).
 */
export function createNoteTracker() {
  let seenTick = -1;
  let seenAt = 0;
  let first = true;

  const mark = (log: GameEvent[]) => {
    seenTick = log.length > 0 ? log.at(-1)!.tick : -1;
    seenAt = log.filter((e) => e.tick === seenTick).length;
  };

  return {
    /** Load, new game or Main menu: the next snapshot's notes are old. */
    reset(): void {
      first = true;
      seenTick = -1;
      seenAt = 0;
    },
    fresh(log: GameEvent[]): GameEvent[] {
      if (first || (log.length > 0 && log.at(-1)!.tick < seenTick)) {
        first = false;
        mark(log);
        return [];
      }
      const out: GameEvent[] = [];
      let n = 0;
      for (const e of log) {
        if (e.tick < seenTick) {
          continue;
        }
        if (e.tick === seenTick && n++ < seenAt) {
          continue;
        }
        out.push(e);
      }
      mark(log);
      return out;
    },
  };
}
