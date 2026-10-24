// Player level UI, pure logic (no DOM, no signals): the HUD level bar, the milestone list, locked items, the level-up
// celebration, declining a job, job needs and the POST readout. See docs/PROGRESSION.md "UI the level system needs".

import type { Snapshot } from '../sim/game/game';
import { fmtNum } from './logic';

// ---------- HUD level bar ----------

export interface LevelBarModel {
  level: number;
  name: string;
  /** Sandbox: the level is the pinned rules level, there is no progress. */
  sandbox: boolean;
  /** The last level: no next threshold, the bar is full and shows a plus. */
  atMax: boolean;
  /** Fill, 0 to 100. */
  pct: number;
  /** "12 / 38" (the score and the next threshold), or the raw score at the last level. */
  label: string;
  tooltip: string;
}

/** Whole client-base points for display (the score is fractional). */
const pts = (n: number): number => Math.floor(n + 1e-9);

/** What the HUD bar shows. Pure: every number comes from `Snapshot.level`. */
export function levelBar(s: Snapshot): LevelBarModel {
  const l = s.level;
  const atMax = l.next === null;
  if (l.sandbox) {
    return {
      level: l.level, name: l.name, sandbox: true, atMax: false, pct: 0, label: `rules level ${l.level}`,
      tooltip: `Sandbox: the rules (how long clients wait, what they pay, which jobs arrive) are fixed at level ${l.level}, ${l.name}. Change it in the sandbox tools.`,
    };
  }
  const pct = atMax ? 100 : Math.min(100, Math.max(0, l.progress * 100));
  const label = atMax ? `${pts(l.clientBase)}` : `${pts(l.clientBase)} / ${l.next}`;
  const nextRow = l.upcoming[l.level];
  const nextNames = nextRow ? nextRow.unlocks.slice(0, 4).map((u) => u.name) : [];
  const more = nextRow && nextRow.unlocks.length > 4 ? ` and ${nextRow.unlocks.length - 4} more` : '';
  const lines = [
    `Level ${l.level}: ${l.name}.`,
    atMax
      ? `Client base ${pts(l.clientBase)}: you are at the top level.`
      : `Client base ${pts(l.clientBase)} of ${l.next} for level ${l.level + 1}.`,
    'Client base is how many clients trust you: every job you finish for a client adds to it, a little more when you are quick.',
    `Clients wait about ${Math.round(s.patience.deadlineTicks)} s. Payouts are x${fmtNum(l.payMul, 2)}.`,
  ];
  if (nextRow) lines.push(`Next level unlocks: ${nextNames.join(', ')}${more}.`);
  lines.push('Click for all the levels.');
  return { level: l.level, name: l.name, sandbox: false, atMax, pct, label, tooltip: lines.join(' ') };
}
