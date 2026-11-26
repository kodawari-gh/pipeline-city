// The device catalog: every part spec in one list, and the lookups over it.

import { CARD_SPECS, DISPLAY_SPECS } from './cardSpecs';
import { COOLING_SPECS } from './coolingSpecs';
import { CPU_BRANCH_SPECS } from './cpuBranchSpecs';
import { CPU_SPECS } from './cpuSpecs';
import { FAN_SPECS } from './fanSpecs';
import { PSU_SPECS, RAM_SPECS } from './memPowerSpecs';
import type { DeviceKind, DeviceSpec, FanSize, FanSpec } from './specTypes';
import { NIC_SPECS, STORAGE_SPECS } from './storageNicSpecs';

export const specList: DeviceSpec[] = [
  ...CPU_SPECS,
  ...CPU_BRANCH_SPECS,
  ...RAM_SPECS,
  ...PSU_SPECS,
  ...COOLING_SPECS,
  ...FAN_SPECS,
  ...STORAGE_SPECS,
  ...NIC_SPECS,
  ...CARD_SPECS,
  ...DISPLAY_SPECS,
];

export const DEVICE_SPECS: Readonly<Record<string, DeviceSpec>> = Object.fromEntries(specList.map((s) => [s.id, s]));

export function getSpec(id: string): DeviceSpec | undefined {
  return DEVICE_SPECS[id];
}

/** Specs of one kind ordered by tier (the per-device upgrade ladder). */
export function specsOfKind<K extends DeviceKind>(kind: K): (DeviceSpec & { kind: K })[] {
  return specList.filter((s): s is DeviceSpec & { kind: K } => s.kind === kind).toSorted((a, b) => a.tier - b.tier);
}

/** The basic fan of a size (the one a migrated save and the starting machine get). */
export const basicFan = (size: FanSize): FanSpec => {
  const fan = specList.find((s): s is FanSpec => s.kind === 'fan' && s.size === size && s.tier === 0);
  if (fan === undefined) {
    throw new Error(`No tier 0 fan of size ${size} in the catalog`);
  }
  return fan;
};

/**
 * The share of a heatsink's rated cooling it gives with `air` of fans turning on it (the summed `airflow`): `bare` with none, 1 with one basic fan, and a
 * little more for each fan or grade beyond (the gain flattens: two fans give about a fifth more, not twice).
 */
export const fanShare = (bare: number, air: number): number => bare + (1 - bare) * Math.max(0, air) ** 0.35;
