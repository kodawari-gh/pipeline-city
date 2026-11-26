// Player levels table and unlock info (docs/PROGRESSION.md). Balance numbers for LEVELS live here.

import { BOARD_TIERS, CASE_TIERS, getSpec } from '../../board/sim';
import { getIspSpec, getRouterSpec } from '../../network/sim';
import { getOsSpec } from '../../os/sim';
import type { JobClassId } from './levelsClasses';

export interface LevelDef {
  level: number;
  name: string;
  /** Client base needed to be at this level. */
  threshold: number;
  /** Multiplies the reputation target, the key deadline and the give-up turnaround. */
  patienceMul: number;
  /** Multiplies every payout. */
  payMul: number;
  /** Multiplies `baseDemandPerTick`. */
  demandMul: number;
  /** Percent of arrivals per class (rows sum to 100). */
  mix: Partial<Record<JobClassId, number>>;
  /** Offer ids that become buyable here (spec ids, `boardN`, `osN`, and planned ids that have no spec yet). */
  unlocks: string[];
}

export const LEVELS: readonly LevelDef[] = [
  {
    level: 1,
    name: 'Garage Bench',
    threshold: 0,
    patienceMul: 4,
    payMul: 1,
    demandMul: 1,
    mix: { cli: 100 },
    unlocks: ['cpu1', 'ram1', 'cooler1', 'fan120', 'psu1', 'vsink0'],
  },
  {
    level: 2,
    name: 'Hobby Shop',
    threshold: 3,
    patienceMul: 4,
    payMul: 1.11,
    demandMul: 1.12,
    mix: { cli: 100 },
    unlocks: ['vsink1', 'rsink0', 'hdd0', 'case1', 'board1'],
  },
  {
    level: 3,
    name: 'Local Gigs',
    threshold: 6,
    patienceMul: 3,
    payMul: 1.23,
    demandMul: 1.24,
    mix: { cli: 100 },
    unlocks: ['ssd1', 'os1', 'ram1b'],
  },
  {
    level: 4,
    name: 'Small Office',
    threshold: 9,
    patienceMul: 2.4,
    payMul: 1.37,
    demandMul: 1.36,
    mix: { cli: 85, web: 15 },
    unlocks: ['router1', 'isp1'],
  },
  {
    level: 5,
    name: 'Storefront',
    threshold: 40,
    patienceMul: 2,
    payMul: 1.52,
    demandMul: 1.48,
    mix: { cli: 40, scan: 25, db: 20, web: 15 },
    unlocks: ['psu2', 'ram2', 'rsink1', 'case2', 'board2'],
  },
  {
    level: 6,
    name: 'Neighbourhood',
    threshold: 110,
    patienceMul: 1.7,
    payMul: 1.69,
    demandMul: 1.6,
    mix: { cli: 37, scan: 23, db: 22, web: 18 },
    unlocks: ['cpu2', 'cooler2', 'rad1', 'isp2'],
  },
  {
    level: 7,
    name: 'District',
    threshold: 155,
    patienceMul: 1.45,
    payMul: 1.87,
    demandMul: 1.72,
    mix: { cli: 33, scan: 22, db: 24, web: 21 },
    unlocks: ['nvme2', 'vsink2', 'rsink2', 'fan40', 'rad2', 'fan92x', 'fan120x', 'router2', 'nic1'],
  },
  {
    level: 8,
    name: 'Town Hub',
    threshold: 215,
    patienceMul: 1.25,
    payMul: 2.08,
    demandMul: 1.84,
    mix: { cli: 28, scan: 22, db: 25, web: 25 },
    unlocks: ['cpu3', 'os2'],
  },
  {
    level: 9,
    name: 'Business Park',
    threshold: 285,
    patienceMul: 1.05,
    payMul: 2.3,
    demandMul: 1.96,
    mix: { cli: 25, scan: 18, db: 20, web: 22, secure: 15 },
    unlocks: ['tpm1', 'ram3', 'case3', 'fan140', 'fan140x', 'board3', 'isp3', 'cpu2f', 'cpu2m', 'cpu2d'],
  },
  {
    level: 10,
    name: 'Tech Quarter',
    threshold: 360,
    patienceMul: 0.9,
    payMul: 2.56,
    demandMul: 2.08,
    mix: { cli: 20, scan: 15, db: 15, web: 18, secure: 12, gpu: 20 },
    unlocks: ['gpu1', 'psu3', 'display1'],
  },
  {
    level: 11,
    name: 'Campus',
    threshold: 450,
    patienceMul: 0.8,
    payMul: 2.84,
    demandMul: 2.2,
    mix: { cli: 18, scan: 12, db: 14, web: 18, secure: 12, gpu: 26 },
    unlocks: ['cpu4', 'rad3', 'router3', 'nic2', 'cpu3f', 'cpu3m', 'ram4', 'cpu3t'],
  },
  {
    level: 12,
    name: 'Data Annex',
    threshold: 550,
    patienceMul: 0.72,
    payMul: 3.15,
    demandMul: 2.32,
    mix: { cli: 15, scan: 10, db: 12, web: 18, secure: 10, gpu: 20, npu: 15 },
    unlocks: ['npu1'],
  },
  {
    level: 13,
    name: 'Colocation',
    threshold: 650,
    patienceMul: 0.66,
    payMul: 3.5,
    demandMul: 2.44,
    mix: { cli: 12, scan: 8, db: 12, web: 18, secure: 10, gpu: 20, npu: 20 },
    unlocks: ['tpm2', 'os3', 'cpu4f', 'cpu4m', 'ram5'],
  },
  {
    level: 14,
    name: 'Compute Floor',
    threshold: 770,
    patienceMul: 0.62,
    payMul: 3.88,
    demandMul: 2.56,
    mix: { cli: 10, scan: 8, db: 10, web: 16, secure: 10, gpu: 18, npu: 16, hpc: 12 },
    unlocks: ['cpu5s', 'cpu5h', 'gpu2', 'isp4', 'os4'],
  },
  {
    level: 15,
    name: 'Enterprise',
    threshold: 900,
    patienceMul: 0.58,
    payMul: 4.31,
    demandMul: 2.68,
    mix: { cli: 8, scan: 6, db: 10, web: 16, secure: 10, gpu: 18, npu: 16, hpc: 16 },
    unlocks: ['psu4', 'board4', 'cpu4w'],
  },
  {
    level: 16,
    name: 'Hyperscale',
    threshold: 1050,
    patienceMul: 0.55,
    payMul: 4.78,
    demandMul: 2.8,
    mix: { cli: 6, scan: 5, db: 9, web: 16, secure: 10, gpu: 18, npu: 17, hpc: 19 },
    unlocks: ['gpu3', 'npu2', 'raid2'],
  },
  {
    level: 17,
    name: 'Metro Grid',
    threshold: 1200,
    patienceMul: 0.52,
    payMul: 5.31,
    demandMul: 2.92,
    mix: { cli: 5, scan: 4, db: 8, web: 15, secure: 10, gpu: 18, npu: 18, hpc: 22 },
    unlocks: ['nic3', 'router4'],
  },
  {
    level: 18,
    name: 'Metropolis',
    threshold: 1350,
    patienceMul: 0.5,
    payMul: 5.9,
    demandMul: 3.04,
    mix: { cli: 4, scan: 3, db: 7, web: 14, secure: 10, gpu: 18, npu: 18, hpc: 26 },
    unlocks: ['isp5'],
  },
];

export const MAX_LEVEL = LEVELS.length;

/** Items of the start crate: level 1, never gated. */
export const START_CRATE: readonly string[] = ['cpu0', 'ram0', 'psu0', 'cooler0', 'fan92', 'display0', 'board0'];

/** Items in the unlock table that have no spec in the catalog yet: listed (milestone screen), never purchasable. */
const PLANNED_ITEMS: Readonly<Record<string, { name: string; kind: string }>> = {
  board4: { name: 'Server board', kind: 'board' },
};

export const isPlannedItem = (id: string): boolean => id in PLANNED_ITEMS;

/** Level a purchasable id unlocks at: 1 for the start crate and for anything the table does not list. */
export function unlockLevelOf(id: string): number {
  for (const l of LEVELS) {
    if (l.unlocks.includes(id)) {
      return l.level;
    }
  }
  return 1;
}

export interface ItemInfo {
  id: string;
  name: string;
  kind: string;
  planned: boolean;
}

/** Name and kind of an unlock-table id (real spec, board tier, OS or planned item). */
export function itemInfo(id: string): ItemInfo {
  const planned = PLANNED_ITEMS[id];
  if (planned) {
    return { id, ...planned, planned: true };
  }
  const board = /^board(?<tier>[0-9]+)$/u.exec(id);
  if (board) {
    return { id, name: BOARD_TIERS[Number(board[1])]?.name ?? id, kind: 'board', planned: false };
  }
  const pcCase = /^case(?<tier>[0-9]+)$/u.exec(id);
  if (pcCase) {
    return { id, name: CASE_TIERS[Number(pcCase[1])]?.name ?? id, kind: 'case', planned: false };
  }
  const router = getRouterSpec(id);
  if (router) {
    return { id, name: router.name, kind: 'router', planned: false };
  }
  const isp = getIspSpec(id);
  if (isp) {
    return { id, name: `${isp.name} plan`, kind: 'isp', planned: false };
  }
  const os = getOsSpec(id);
  if (os) {
    return { id, name: os.name, kind: 'os', planned: os.later === true };
  }
  const spec = getSpec(id);
  return { id, name: spec?.name ?? id, kind: spec?.kind ?? '?', planned: false };
}
