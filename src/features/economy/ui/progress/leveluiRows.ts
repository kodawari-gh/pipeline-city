// Milestone list and whether an unlock has part art.

import { describeNeed, jobClass } from '../../sim/levels';
import { ECONOMY } from '../../sim/economy';
import type { Snapshot } from '@/worker/game/game';
import { dexGroup, JOB_DEX, taskLevel } from '@/features/jobs/sim/jobdex';
import * as leveluiIcons from './leveluiIcons';
import type { IconKey } from './leveluiIcons';

/** The kinds of job that first arrive at a level, apart from the ones that come with their class (the class has its own chip). */
function newKindsAt(level: number): { id: string; label: string; icon: IconKey; hint: string }[] {
  return JOB_DEX.filter(
    (e) => e.planned !== true && taskLevel(e) === level && taskLevel(e) > (jobClass(e.cls)?.firstLevel ?? 1),
  ).map((e) => {
    const needs = (e.needs ?? jobClass(e.cls)?.needs ?? []).map((n) => describeNeed(n).long);
    return {
      id: e.id,
      label: e.name,
      icon: leveluiIcons.GROUP_ICON[dexGroup(e.id)?.id ?? ''] ?? 'box',
      hint: needs.length > 0 ? `Needs ${needs.join(' and ')}.` : 'Needs nothing special.',
    };
  });
}

type MilestoneStatus = 'passed' | 'current' | 'upcoming';

export interface MilestoneUnlock {
  id: string;
  name: string;
  kind: string;
  planned: boolean;
  icon: IconKey;
}

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

function milestoneStatus(level: number, cur: number): MilestoneStatus {
  if (level < cur) {
    return 'passed';
  }
  if (level === cur) {
    return 'current';
  }
  return 'upcoming';
}

function patienceChange(
  prev: { patienceMul: number } | null | undefined,
  patienceMul: number,
): MilestoneRow['patience'] {
  if (!prev) {
    return null;
  }
  return patienceMul < prev.patienceMul ? 'stricter' : 'same';
}

function payChange(prev: { payMul: number } | null | undefined, payMul: number): MilestoneRow['pay'] {
  if (!prev) {
    return null;
  }
  return payMul > prev.payMul ? 'bigger' : 'same';
}

/** The ladder for the milestone screen. In the sandbox the pinned rules level is "current" and nothing is "passed" by score. */
export function milestoneRows(s: Snapshot): MilestoneRow[] {
  const cur = s.level.level;
  const rows = s.level.upcoming;
  return rows.map((r, i) => {
    const prev = i > 0 ? (rows[i - 1] ?? null) : null;
    return {
      level: r.level,
      name: r.name,
      threshold: r.threshold,
      status: milestoneStatus(r.level, cur),
      unlocks: r.unlocks.map((u) => ({ ...u, icon: leveluiIcons.kindIcon(u.kind) })),
      newJobs: [
        ...r.newJobs.map((id) => ({
          id,
          ...(leveluiIcons.JOB_CLASS_LABEL[id] ?? { label: id, icon: 'box' as const, hint: '' }),
        })),
        ...newKindsAt(r.level),
      ],
      waitS: Math.round(ECONOMY.deadlineTicks * r.patienceMul),
      payMul: r.payMul,
      patience: patienceChange(prev, r.patienceMul),
      pay: payChange(prev, r.payMul),
      progress: r.level === cur ? Math.min(1, Math.max(0, s.level.progress)) : 0,
    };
  });
}

/** Whether `PartArt` can draw this unlock-table id (a real part, a board tier or an OS). */
export function hasArt(id: string, kind: string, planned: boolean): boolean {
  if (planned) {
    return false;
  }
  return (
    /^board\d+$/u.test(id) ||
    ['cpu', 'ram', 'cooler', 'fan', 'psu', 'display', 'vrm-sink', 'ram-sink', 'storage', 'os'].includes(kind)
  );
}
