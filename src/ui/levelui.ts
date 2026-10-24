// Player level UI, pure logic (no DOM, no signals): the HUD level bar, the milestone list, locked items, the level-up
// celebration, declining a job, job needs and the POST readout. See docs/PROGRESSION.md "UI the level system needs".

import { ECONOMY } from '../sim/game/economy';
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

// ---------- milestone screen ----------

export type IconKey = 'bolt' | 'flame' | 'clock' | 'dollar' | 'memory' | 'cpu' | 'lock' | 'check' | 'box' | 'fan' | 'slot' | 'warn' | 'gauge'
  | 'net' | 'usb' | 'screen' | 'disk' | 'eff' | 'wave';

/** Icon for an unlock-table kind, for items that have no illustration yet (planned devices). */
export function kindIcon(kind: string): IconKey {
  switch (kind) {
    case 'cpu': case 'npu': case 'os': return 'cpu';
    case 'ram': return 'memory';
    case 'cooler': case 'fan': case 'vrm-sink': return 'fan';
    case 'psu': return 'bolt';
    case 'display': case 'gpu': return 'screen';
    case 'storage': case 'raid': return 'disk';
    case 'board': return 'slot';
    case 'router': case 'isp': case 'nic': return 'net';
    case 'tpm': return 'lock';
    default: return 'box';
  }
}

/** Plain name and icon of a job class, for "new jobs at this level". */
export const JOB_CLASS_LABEL: Record<string, { label: string; icon: IconKey; hint: string }> = {
  cli: { label: 'Plain jobs', icon: 'clock', hint: 'Small jobs any machine can run.' },
  scan: { label: 'Scans', icon: 'memory', hint: 'Memory-heavy scans: more work, better pay.' },
  db: { label: 'Database', icon: 'disk', hint: 'Needs an operating system and a SATA SSD or better.' },
  web: { label: 'Web', icon: 'net', hint: 'Needs a network link.' },
  secure: { label: 'Secure', icon: 'lock', hint: 'Needs a secure module (TPM).' },
  gpu: { label: 'GPU', icon: 'screen', hint: 'Needs a graphics card.' },
  npu: { label: 'AI', icon: 'cpu', hint: 'Needs a neural accelerator.' },
  hpc: { label: 'Heavy compute', icon: 'fan', hint: 'Needs a multicore processor.' },
};

export type MilestoneStatus = 'passed' | 'current' | 'upcoming';

export interface MilestoneUnlock { id: string; name: string; kind: string; planned: boolean; icon: IconKey }

export interface MilestoneRow {
  level: number;
  name: string;
  threshold: number;
  status: MilestoneStatus;
  unlocks: MilestoneUnlock[];
  newJobs: { id: string; label: string; icon: IconKey; hint: string }[];
  /** Seconds a client waits at this level. */
  waitS: number;
  payMul: number;
  /** Against the level before: the clients' patience, and the pay. Level 1 has nothing to compare with. */
  patience: 'stricter' | 'same' | null;
  pay: 'bigger' | 'same' | null;
  /** Progress inside the level (the current row only), 0 to 1. */
  progress: number;
}

/** The ladder for the milestone screen. In the sandbox the pinned rules level is "current" and nothing is "passed" by score. */
export function milestoneRows(s: Snapshot): MilestoneRow[] {
  const cur = s.level.level;
  const rows = s.level.upcoming;
  return rows.map((r, i) => {
    const prev = i > 0 ? rows[i - 1]! : null;
    return {
      level: r.level,
      name: r.name,
      threshold: r.threshold,
      status: r.level < cur ? 'passed' : r.level === cur ? 'current' : 'upcoming',
      unlocks: r.unlocks.map((u) => ({ ...u, icon: kindIcon(u.kind) })),
      newJobs: r.newJobs.map((id) => ({ id, ...(JOB_CLASS_LABEL[id] ?? { label: id, icon: 'box' as const, hint: '' }) })),
      waitS: Math.round(ECONOMY.deadlineTicks * r.patienceMul),
      payMul: r.payMul,
      patience: prev ? (r.patienceMul < prev.patienceMul ? 'stricter' : 'same') : null,
      pay: prev ? (r.payMul > prev.payMul ? 'bigger' : 'same') : null,
      progress: r.level === cur ? Math.min(1, Math.max(0, s.level.progress)) : 0,
    };
  });
}

/** Whether `PartArt` can draw this unlock-table id (a real part, a board tier or an OS). */
export function hasArt(id: string, kind: string, planned: boolean): boolean {
  if (planned) return false;
  return /^board\d+$/.test(id) || ['cpu', 'ram', 'cooler', 'psu', 'display', 'vrm-sink', 'storage', 'os'].includes(kind);
}
