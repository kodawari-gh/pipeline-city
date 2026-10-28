// Player level UI, pure logic (no DOM, no signals): the HUD level bar, the milestone list, locked items, the level-up
// celebration, declining a job, job needs and the POST readout. See docs/PROGRESSION.md "UI the level system needs".

import { getSpec } from '../../sim/board/specs';
import { ECONOMY } from '../../sim/game/economy';
import type { Snapshot } from '../../sim/game/game';
import { dexGroup, JOB_DEX, taskLevel } from '../../sim/game/jobdex';
import { describeNeed, jobClass, levelDef, unlockLevelOf } from '../../sim/game/levels';
import { fmtMoney, fmtNum } from '../logic';

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
  | 'net' | 'usb' | 'screen' | 'disk' | 'eff' | 'wave' | 'card' | 'grid';

/** Icon for an unlock-table kind, for items that have no illustration yet (planned devices). */
export function kindIcon(kind: string): IconKey {
  switch (kind) {
    case 'cpu': case 'os': return 'cpu';
    case 'npu': return 'grid';
    case 'ram': return 'memory';
    case 'cooler': case 'fan': case 'vrm-sink': case 'ram-sink': return 'fan';
    case 'psu': return 'bolt';
    case 'display': return 'screen';
    case 'gpu': return 'card';
    case 'storage': case 'raid': return 'disk';
    case 'board': case 'case': return 'slot';
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
  gpu: { label: 'GPU', icon: 'screen', hint: 'Array jobs: a graphics card makes them faster (they run without one, slowly).' },
  npu: { label: 'AI', icon: 'cpu', hint: 'Network jobs: a neural accelerator makes them faster (they run without one, slowly).' },
  hpc: { label: 'Heavy compute', icon: 'fan', hint: 'Needs a multicore processor.' },
};

/** The icon of each group of kinds of job, for a kind that arrives after its class did. */
const GROUP_ICON: Record<string, IconKey> = { everyday: 'clock', memory: 'memory', network: 'net', trust: 'lock', accel: 'card' };

/** The kinds of job that first arrive at a level, apart from the ones that come with their class (the class has its own chip). */
export function newKindsAt(level: number): { id: string; label: string; icon: IconKey; hint: string }[] {
  return JOB_DEX.filter((e) => !e.planned && taskLevel(e) === level && taskLevel(e) > (jobClass(e.cls)?.firstLevel ?? 1)).map((e) => {
    const needs = (e.needs ?? jobClass(e.cls)?.needs ?? []).map((n) => describeNeed(n).long);
    return { id: e.id, label: e.name, icon: GROUP_ICON[dexGroup(e.id)?.id ?? ''] ?? 'box', hint: needs.length ? `Needs ${needs.join(' and ')}.` : 'Needs nothing special.' };
  });
}

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
      newJobs: [...r.newJobs.map((id) => ({ id, ...(JOB_CLASS_LABEL[id] ?? { label: id, icon: 'box' as const, hint: '' }) })), ...newKindsAt(r.level)],
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
  return /^board\d+$/.test(id) || ['cpu', 'ram', 'cooler', 'psu', 'display', 'vrm-sink', 'ram-sink', 'storage', 'os'].includes(kind);
}

// ---------- locked items (the player level gates purchases) ----------

export interface LevelLock { level: number; name: string }

/**
 * The hover text of an item that the player level still gates. The level reason comes first; the money or hardware
 * reasons that will apply once it is open follow, so the player sees the whole picture.
 */
export function lockTooltip(lock: LevelLock, also: { blocked?: string; priceShort?: number } = {}): string {
  const parts = [`Unlocks at Level ${lock.level}, ${lock.name}. Keep serving clients to grow your client base.`];
  if (also.blocked) parts.push(`Then: ${also.blocked}.`);
  if (also.priceShort && also.priceShort > 0) parts.push('It will also need more money than you have now.');
  return parts.join(' ');
}

/** The short badge text ("Level 4"). */
export const lockBadge = (lock: LevelLock): string => `Level ${lock.level}`;

/** The item is gated by exactly the next level: it carries a subtle outline so the player sees what is coming. */
export const isNextLevelLock = (lock: LevelLock | undefined, current: number): boolean => !!lock && lock.level === current + 1;

/**
 * Shelf order: items open now first (their order kept), then the gated ones by the level that opens them (order kept
 * within a level). A stable sort, so the tier order inside each group is the caller's.
 */
export function unlockedFirst<T>(items: readonly T[], lockOf: (t: T) => LevelLock | undefined): T[] {
  return items
    .map((t, i) => ({ t, i, lv: lockOf(t)?.level ?? 0 }))
    .sort((a, b) => a.lv - b.lv || a.i - b.i)
    .map((x) => x.t);
}

// ---------- level-up celebration ----------

export interface Celebration { level: number; name: string; unlocked: MilestoneUnlock[]; at: number }

/**
 * The banner to show for this snapshot, or null. `seen` is the highest level this viewer has already been told about
 * (null if unknown). A level-up shows when the sim stamped `leveledUpAt` (it is null after a load or a start, so a reload
 * and a legacy save never replay) and the level is above `seen`. Not in the sandbox.
 */
export function celebrationFor(s: Snapshot, seen: number | null): Celebration | null {
  const l = s.level;
  if (l.sandbox || s.sandbox || l.leveledUpAt === null || seen === null || l.level <= seen) return null;
  return {
    level: l.level, name: l.name, at: l.leveledUpAt,
    unlocked: l.recentlyUnlocked.map((u) => ({ ...u, icon: kindIcon(u.kind) })),
  };
}

/**
 * The seen level to keep after looking at `s`. Unknown becomes the current level; no stamp (a load, a start, a new game)
 * rebases to the current level; a level above `seen` with a stamp is kept (the banner is still owed).
 */
export function reconcileSeen(s: Snapshot, seen: number | null): number {
  const l = s.level;
  if (seen === null || l.sandbox || s.sandbox || l.leveledUpAt === null || l.level < seen) return l.level;
  return seen;
}

// ---------- job needs, deadlines and declining ----------

/** The minimum a job needs from the snapshot to show chips, a deadline and a decline button. */
export interface JobView {
  id: number;
  label: string;
  /** `KeySnap.needs`: short chips of every need. */
  needs: string[];
  /** `KeySnap.missing`: long phrases of the needs the machine does not meet. */
  missing: string[];
  runnable: boolean;
  declinable: boolean;
  arrivalTick: number;
  expiresTick: number;
}

const NEED_LONG: Record<string, string> = {
  OS: 'an OS', SSD: 'a SATA SSD or better', DRIVE: 'a storage drive', NET: 'a network link', TPM: 'a TPM', GPU: 'a GPU', NPU: 'an NPU', CORES: 'a multicore CPU',
};
const NEED_ICON: Record<string, IconKey> = {
  OS: 'cpu', SSD: 'disk', DRIVE: 'disk', NET: 'net', TPM: 'lock', GPU: 'screen', NPU: 'cpu', CORES: 'fan',
};

export interface NeedChip { short: string; long: string; icon: IconKey; missing: boolean }

/** One chip per need (a device icon and its short name); `missing` ones are shown red. */
export function needChips(j: Pick<JobView, 'needs' | 'missing'>): NeedChip[] {
  return j.needs.map((short) => {
    const long = NEED_LONG[short] ?? short.toLowerCase();
    return { short, long, icon: NEED_ICON[short] ?? 'box', missing: j.missing.includes(long) };
  });
}

export type Urgency = 'ok' | 'warn' | 'bad';

export interface DeadlineInfo {
  /** Ticks (seconds at 1x) until the client takes the job back. */
  left: number;
  /** 0..1 of the waiting window still to go. */
  frac: number;
  urgency: Urgency;
}

/** Deadline of a job the machine cannot run (null for a runnable one: it has the normal soft deadline). Red in the last quarter. */
export function deadlineInfo(j: Pick<JobView, 'runnable' | 'arrivalTick' | 'expiresTick'>, now: number): DeadlineInfo | null {
  if (j.runnable) return null;
  const left = Math.max(0, j.expiresTick - now);
  const window = Math.max(1, j.expiresTick - j.arrivalTick);
  const frac = Math.min(1, left / window);
  return { left, frac, urgency: frac <= 0.25 ? 'bad' : frac <= 0.5 ? 'warn' : 'ok' };
}

/** The plain line under an unrunnable job: what is missing and when the client leaves. */
export function cannotRunText(j: Pick<JobView, 'missing' | 'runnable'>): string | null {
  if (j.runnable || !j.missing.length) return null;
  return `Cannot run yet: it needs ${j.missing.join(' and ')}.`;
}

/** Declining needs two presses within this window. */
export const DECLINE_ARM_MS = 3000;

/** The press that follows: the first (or one after the window) arms, a second within the window confirms. */
export function declineStep(armedAt: number | null, now: number): 'arm' | 'confirm' {
  return armedAt !== null && now - armedAt >= 0 && now - armedAt < DECLINE_ARM_MS ? 'confirm' : 'arm';
}

/** Words for the decline button and its tooltip. Free in the sandbox (no reputation cost, the sim feeds nothing). */
export function declineWords(sandbox: boolean, armed: boolean): { label: string; title: string } {
  if (sandbox) {
    return armed
      ? { label: 'Sure? Free here', title: 'Press again to send the client away. It is free in the sandbox.' }
      : { label: 'Decline', title: 'The client leaves and the job is gone. Free in the sandbox: no reputation cost.' };
  }
  return armed
    ? { label: 'Sure? Costs reputation', title: 'Press again within 3 seconds to decline. A small reputation cost, and no payout.' }
    : { label: 'Decline', title: 'The client leaves. A small reputation cost, no payout. Press twice to confirm.' };
}

// ---------- POST time ----------

export interface PostPart { label: string; ticks: number; hint: string }

/**
 * What the boot wait (POST) is made of, in plain words. Mirrors the sim's `postTicks` (a base, the memory check by size and
 * by stick, and each device's own start-up), capped; the last line is scaled so the parts add up to the snapshot's total.
 */
export function postBreakdown(s: Snapshot): { total: number; parts: PostPart[] } {
  const c = ECONOMY.coldBoot;
  let kib = 0, sticks = 0, init = 0, devs = 0;
  for (const d of s.devices) {
    if (d.burnt) continue;
    const spec = getSpec(d.spec);
    if (!spec) continue;
    if (spec.kind === 'ram') { kib += spec.sizeBytes / 1024; sticks++; }
    const i = c.init[spec.id] ?? c.init[spec.kind] ?? 0;
    init += i;
    if (i > 0) devs++;
  }
  const raw: PostPart[] = [
    { label: 'Firmware', ticks: c.base, hint: 'The fixed cost of starting the board.' },
    { label: 'Memory check', ticks: Math.min(c.kiBCap, c.perKiB * kib), hint: `The firmware counts the ${Math.round(kib)}K of RAM; more memory takes longer (up to a limit).` },
    { label: `${sticks} RAM stick${sticks === 1 ? '' : 's'}`, ticks: c.perStick * sticks, hint: 'Each memory stick is detected and trained.' },
    { label: `${devs} device${devs === 1 ? '' : 's'}`, ticks: init, hint: 'Processor, display and drives each take a moment to start.' },
  ].filter((p) => p.ticks > 0);
  const sum = raw.reduce((a, p) => a + p.ticks, 0);
  const scale = sum > 0 ? s.postTicks / sum : 1;
  return { total: s.postTicks, parts: raw.map((p) => ({ ...p, ticks: Math.round(p.ticks * scale) })) };
}

/**
 * The level lock of an item. The sim's `purchases[].locked` is the truth for an item on offer; an item the sim does not
 * list yet (the next board tier only, a planned OS) is placed by the unlock table, so it reads "Level 5" instead of "Later".
 */
export function lockOf(s: Snapshot, id: string, p?: { locked?: LevelLock; later?: boolean }): LevelLock | undefined {
  if (p?.locked) return p.locked;
  if (s.sandbox || s.level.sandbox || (p && !p.later)) return undefined;
  const need = unlockLevelOf(id);
  return need > s.level.level ? { level: need, name: levelDef(need).name } : undefined;
}

/** What buying one more of a part you own would do: the small buy button on its tile or card. */
export interface MoreOffer { state: 'ready' | 'poor' | 'blocked' | 'level'; price: number; free?: boolean; reason?: string; lock?: LevelLock }

/** The `more` offer of a tile or card: buying another copy of a part you own, from its purchase row. */
export function moreOffer(s: Snapshot, p: Snapshot['purchases'][number], lock: LevelLock | undefined): MoreOffer {
  const free = s.sandbox || undefined;
  if (lock) return { state: 'level', price: p.price, free, lock, reason: lockTooltip(lock, { blocked: p.blocked, priceShort: free ? 0 : p.price - s.money }) };
  if (p.blocked) return { state: 'blocked', price: p.price, free, reason: p.blocked };
  if (s.sandbox || p.affordable) return { state: 'ready', price: p.price, free };
  return { state: 'poor', price: p.price, reason: `Need ${fmtMoney(p.price - s.money)} more` };
}
