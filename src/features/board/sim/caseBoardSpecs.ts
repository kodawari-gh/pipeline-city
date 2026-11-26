// Board and case tiers: the motherboards with their slots and VRMs, and the PC cases with their fan mounts.
// BALANCE IS A PLACEHOLDER: every number here is a round, plausible guess to be tuned by playing.

import type { FanSize, SlotType } from './specTypes';

/** A slot's width as a player reads it: no real slot is wider than x16, so the sim's 32 is a x16 connector at twice the rate. */
export const pcieLabel = (width: number): string => (width > 16 ? 'x16 Gen5' : `x${width}`);

/** A voltage regulator on the board (see docs/VRM.md): phases of buck converters feeding the CPU or the memory. */
export interface VrmSpec {
  phases: number;
  ampsPerPhase: number;
  /** Best efficiency (0..1), reached at moderate per-phase load. */
  peakEfficiency: number;
  /** Voltage ripple 0..1 (lower is better quality): raises the error chance when unstable. */
  ripple: number;
  /** Joules per degree C. */
  mass: number;
  /** Passive heat loss to the case, W per degree C above ambient. */
  passive: number;
  throttleC: number;
  unstableC: number;
  damageC: number;
}

/** Board features beyond slots. `ethernetMbps` is the onboard port ("board" uplink of the network). */
export interface BoardFeatures {
  /** Onboard ethernet speed in Mbit/s, 0 = none. */
  ethernetMbps: number;
  usbPorts: number;
  displayPorts: number;
}

/** Board tiers: slot counts by type (a slot a tier lacks is absent), features and the VRM. */
export interface BoardTierSpec {
  tier: number;
  name: string;
  /** Price to buy it (also the price of a replacement of the same tier when the board is burnt). */
  price: number;
  slots: Partial<Record<SlotType, number>>;
  /** Lane width of each `pcie` slot, in slot order (`pcie0`, `pcie1`, ...): a card fits a slot at least as wide as its `pcieWidth`. 32 is the bandwidth of 32 lanes: a real x16 connector at twice the rate (`pcieLabel`). */
  pcieWidths: number[];
  features: BoardFeatures;
  /** The CPU core regulator. */
  vrm: VrmSpec;
  /** The memory regulator (feeds every DIMM). */
  ramVrm: VrmSpec;
  visual: string;
}

/**
 * PC cases: the chassis the board lives in (docs/BOARD.md "Cases"). A case of tier `t` holds boards up to tier `maxBoard` (a form
 * factor: mini-ITX, micro-ATX, ATX, E-ATX), so a bigger board needs a bigger case first. The campaign starts in the Mini tower.
 */
export interface CaseTierSpec {
  tier: number;
  name: string;
  /** Price of the case (placeholder). */
  price: number;
  /** The biggest board tier it holds. */
  maxBoard: number;
  /** The form factor of the biggest board it holds, for the player's eyes. */
  form: string;
  visual: string;
  /** The fan mounts it has: front, top and rear (the Mini tower has a rear grille, no mount), each for a fan of `fanSize`. It comes without fans. The renderer's layout must show the same counts (`layout.test.ts`). */
  fans: { front: number; top: number; rear: boolean };
  /** The size of fan its mounts take, mm. */
  fanSize: FanSize;
}

export const CASE_TIERS: readonly CaseTierSpec[] = [
  {
    tier: 0,
    name: 'Mini tower',
    price: 25,
    maxBoard: 0,
    form: 'mini-ITX',
    visual: 'case-mini',
    fans: { front: 2, top: 0, rear: false },
    fanSize: 92,
  },
  {
    tier: 1,
    name: 'Micro tower',
    price: 70,
    maxBoard: 1,
    form: 'micro-ATX',
    visual: 'case-micro',
    fans: { front: 3, top: 1, rear: true },
    fanSize: 92,
  },
  {
    tier: 2,
    name: 'Mid tower',
    price: 160,
    maxBoard: 2,
    form: 'ATX',
    visual: 'case-mid',
    fans: { front: 3, top: 2, rear: true },
    fanSize: 120,
  },
  {
    tier: 3,
    name: 'Full tower',
    price: 320,
    maxBoard: 3,
    form: 'E-ATX',
    visual: 'case-full',
    fans: { front: 3, top: 2, rear: true },
    fanSize: 140,
  },
];

/** The fan mounts of a case tier, ids `front0..`, `top0..` and `rear`: each takes a fan of the case's size, with a cable to the fan hub. */
export function caseMounts(tier: number): string[] {
  const f = CASE_TIERS[tier]?.fans;
  if (!f) {
    return [];
  }
  return [
    ...Array.from({ length: f.front }, (_, k) => `front${k}`),
    ...Array.from({ length: f.top }, (_, k) => `top${k}`),
    ...(f.rear ? ['rear'] : []),
  ];
}

/** The smallest case tier that holds a board tier. */
export const caseFor = (boardTier: number): number => CASE_TIERS.findIndex((c) => c.maxBoard >= boardTier);

const vrmTemps = { throttleC: 90, unstableC: 105, damageC: 120 };

export const BOARD_TIERS: readonly BoardTierSpec[] = [
  {
    tier: 0,
    name: 'Starter',
    price: 40,
    visual: 'board-starter',
    pcieWidths: [16],
    slots: { cpu: 1, dimm: 1, pcie: 1, sata: 2, usb: 1, atx: 1, cooler: 1, display: 1, 'vrm-sink': 1, 'ram-sink': 1 },
    features: { ethernetMbps: 0, usbPorts: 1, displayPorts: 1 },
    vrm: { phases: 2, ampsPerPhase: 12, peakEfficiency: 0.8, ripple: 0.6, mass: 20, passive: 0.15, ...vrmTemps },
    ramVrm: { phases: 2, ampsPerPhase: 6, peakEfficiency: 0.78, ripple: 0.6, mass: 15, passive: 0.15, ...vrmTemps },
  },
  {
    tier: 1,
    name: 'Basic',
    price: 150,
    visual: 'board-basic',
    pcieWidths: [16, 4],
    slots: { cpu: 1, dimm: 2, pcie: 2, sata: 3, usb: 2, atx: 1, cooler: 1, display: 1, 'vrm-sink': 1, 'ram-sink': 1 },
    features: { ethernetMbps: 100, usbPorts: 2, displayPorts: 1 },
    vrm: { phases: 3, ampsPerPhase: 12, peakEfficiency: 0.84, ripple: 0.45, mass: 30, passive: 0.2, ...vrmTemps },
    ramVrm: { phases: 2, ampsPerPhase: 8, peakEfficiency: 0.82, ripple: 0.45, mass: 22, passive: 0.2, ...vrmTemps },
  },
  {
    tier: 2,
    name: 'Mainstream',
    price: 300,
    visual: 'board-mainstream',
    pcieWidths: [16, 8, 4],
    slots: {
      cpu: 1,
      dimm: 4,
      pcie: 3,
      sata: 4,
      m2: 2,
      usb: 3,
      tpm: 1,
      'atx-plus': 1,
      cooler: 1,
      display: 1,
      'vrm-sink': 1,
      'ram-sink': 1,
    },
    features: { ethernetMbps: 100, usbPorts: 3, displayPorts: 2 },
    vrm: { phases: 4, ampsPerPhase: 15, peakEfficiency: 0.88, ripple: 0.25, mass: 45, passive: 0.3, ...vrmTemps },
    ramVrm: { phases: 3, ampsPerPhase: 10, peakEfficiency: 0.86, ripple: 0.25, mass: 32, passive: 0.3, ...vrmTemps },
  },
  {
    tier: 3,
    name: 'Enthusiast',
    price: 700,
    visual: 'board-enthusiast',
    pcieWidths: [32, 16, 8, 4],
    slots: {
      cpu: 1,
      dimm: 8,
      pcie: 4,
      sata: 8,
      m2: 3,
      usb: 4,
      tpm: 1,
      'atx-plus': 1,
      cooler: 1,
      display: 1,
      'vrm-sink': 1,
      'ram-sink': 1,
    },
    features: { ethernetMbps: 1000, usbPorts: 4, displayPorts: 2 },
    vrm: { phases: 6, ampsPerPhase: 20, peakEfficiency: 0.92, ripple: 0.1, mass: 60, passive: 0.4, ...vrmTemps },
    ramVrm: { phases: 4, ampsPerPhase: 15, peakEfficiency: 0.9, ripple: 0.1, mass: 45, passive: 0.4, ...vrmTemps },
  },
];
