// Job need chips, deadline readout, decline copy, POST breakdown and the "more" shop offer.

import type { Snapshot } from '@/worker/game/game';
import { fmtMoney } from '@/core/ui/logic';
import type { IconKey } from './leveluiIcons';
import { ECONOMY } from '../../sim/economy';
import { getSpec } from '@/features/board/sim/specs';
import { levelDef, unlockLevelOf } from '../../sim/levels';
import * as leveluiLocks from './leveluiLocks';
import type { LevelLock } from './leveluiLocks';

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
  OS: 'an OS',
  SSD: 'a SATA SSD or better',
  DRIVE: 'a storage drive',
  NET: 'a network link',
  TPM: 'a TPM',
  GPU: 'a GPU',
  NPU: 'an NPU',
  CORES: 'a multicore CPU',
};
const NEED_ICON: Record<string, IconKey> = {
  OS: 'cpu',
  SSD: 'disk',
  DRIVE: 'disk',
  NET: 'net',
  TPM: 'lock',
  GPU: 'screen',
  NPU: 'cpu',
  CORES: 'fan',
};

export interface NeedChip {
  short: string;
  long: string;
  icon: IconKey;
  missing: boolean;
}

/** One chip per need (a device icon and its short name); `missing` ones are shown red. */
export function needChips(j: Pick<JobView, 'needs' | 'missing'>): NeedChip[] {
  return j.needs.map((short) => {
    const long = NEED_LONG[short] ?? short.toLowerCase();
    return { short, long, icon: NEED_ICON[short] ?? 'box', missing: j.missing.includes(long) };
  });
}

type Urgency = 'ok' | 'warn' | 'bad';

export interface DeadlineInfo {
  /** Ticks (seconds at 1x) until the client takes the job back. */
  left: number;
  /** 0..1 of the waiting window still to go. */
  frac: number;
  urgency: Urgency;
}

/** Deadline of a job the machine cannot run (null for a runnable one: it has the normal soft deadline). Red in the last quarter. */

function urgencyOf(frac: number): Urgency {
  if (frac <= 0.25) {
    return 'bad';
  }
  if (frac <= 0.5) {
    return 'warn';
  }
  return 'ok';
}

export function deadlineInfo(
  j: Pick<JobView, 'runnable' | 'arrivalTick' | 'expiresTick'>,
  now: number,
): DeadlineInfo | null {
  if (j.runnable) {
    return null;
  }
  const left = Math.max(0, j.expiresTick - now);
  const window = Math.max(1, j.expiresTick - j.arrivalTick);
  const frac = Math.min(1, left / window);
  return { left, frac, urgency: urgencyOf(frac) };
}

/** The plain line under an unrunnable job: what is missing and when the client leaves. */
export function cannotRunText(j: Pick<JobView, 'missing' | 'runnable'>): string | null {
  if (j.runnable || j.missing.length === 0) {
    return null;
  }
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
    ? {
        label: 'Sure? Costs reputation',
        title: 'Press again within 3 seconds to decline. A small reputation cost, and no payout.',
      }
    : { label: 'Decline', title: 'The client leaves. A small reputation cost, no payout. Press twice to confirm.' };
}

// ---------- POST time ----------

export interface PostPart {
  label: string;
  ticks: number;
  hint: string;
}

/**
 * What the boot wait (POST) is made of, in plain words. Mirrors the sim's `postTicks` (a base, the memory check by size and
 * by stick, and each device's own start-up), capped; the last line is scaled so the parts add up to the snapshot's total.
 */
export function postBreakdown(s: Snapshot): { total: number; parts: PostPart[] } {
  const c = ECONOMY.coldBoot;
  let kib = 0,
    sticks = 0,
    init = 0,
    devs = 0;
  for (const d of s.devices) {
    if (d.burnt) {
      continue;
    }
    const spec = getSpec(d.spec);
    if (!spec) {
      continue;
    }
    if (spec.kind === 'ram') {
      kib += spec.sizeBytes / 1024;
      sticks++;
    }
    const i = c.init[spec.id] ?? c.init[spec.kind] ?? 0;
    init += i;
    if (i > 0) {
      devs++;
    }
  }
  const raw: PostPart[] = [
    { label: 'Firmware', ticks: c.base, hint: 'The fixed cost of starting the board.' },
    {
      label: 'Memory check',
      ticks: Math.min(c.kiBCap, c.perKiB * kib),
      hint: `The firmware counts the ${Math.round(kib)}K of RAM; more memory takes longer (up to a limit).`,
    },
    {
      label: `${sticks} RAM stick${sticks === 1 ? '' : 's'}`,
      ticks: c.perStick * sticks,
      hint: 'Each memory stick is detected and trained.',
    },
    {
      label: `${devs} device${devs === 1 ? '' : 's'}`,
      ticks: init,
      hint: 'Processor, display and drives each take a moment to start.',
    },
  ].filter((p) => p.ticks > 0);
  const sum = raw.reduce((a, p) => a + p.ticks, 0);
  const scale = sum > 0 ? s.postTicks / sum : 1;
  return {
    total: s.postTicks,
    parts: raw.map((p) => ({ label: p.label, hint: p.hint, ticks: Math.round(p.ticks * scale) })),
  };
}

/**
 * The level lock of an item. The sim's `purchases[].locked` is the truth for an item on offer; an item the sim does not
 * list yet (the next board tier only, a planned OS) is placed by the unlock table, so it reads "Level 5" instead of "Later".
 */
export function lockOf(s: Snapshot, id: string, p?: { locked?: LevelLock; later?: boolean }): LevelLock | undefined {
  if (p?.locked) {
    return p.locked;
  }
  if (s.sandbox || s.level.sandbox || (p !== undefined && p.later !== true)) {
    return undefined;
  }
  const need = unlockLevelOf(id);
  return need > s.level.level ? { level: need, name: levelDef(need).name } : undefined;
}

/** What buying one more of a part you own would do: the small buy button on its tile or card. */
export interface MoreOffer {
  state: 'ready' | 'poor' | 'blocked' | 'level';
  price: number;
  free?: boolean | undefined;
  reason?: string;
  lock?: LevelLock;
}

/** The `more` offer of a tile or card: buying another copy of a part you own, from its purchase row. */
export function moreOffer(s: Snapshot, p: Snapshot['purchases'][number], lock: LevelLock | undefined): MoreOffer {
  const free = s.sandbox || undefined;
  if (lock) {
    return {
      state: 'level',
      price: p.price,
      free,
      lock,
      reason: leveluiLocks.lockTooltip(lock, { blocked: p.blocked, priceShort: free ? 0 : p.price - s.money }),
    };
  }
  if (p.blocked !== undefined && p.blocked !== '') {
    return { state: 'blocked', price: p.price, free, reason: p.blocked };
  }
  if (s.sandbox || p.affordable) {
    return { state: 'ready', price: p.price, free };
  }
  return { state: 'poor', price: p.price, reason: `Need ${fmtMoney(p.price - s.money)} more` };
}
