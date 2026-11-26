// Overclock maths for the clock dial: heat zones on the clock axis and the steady temperature at a clock.

import { AMBIENT_C, getSpec } from '@/features/board/sim/specs';
import type { CoolerSpec, CpuSpec } from '@/features/board/sim';
import type { DeviceSnap, Snapshot } from '@/worker/game/game';

/**
 * Overclock zones on the clock axis, from the sim's own steady-state heat model (thermal.ts): the clock at which a
 * full-load CPU with this cooler settles at its throttle and unstable temperatures. Raw values (may lie outside the
 * clock range); the dial clamps them when it draws.
 */
export interface ClockZones {
  min: number;
  max: number;
  throttleAt: number;
  unstableAt: number;
}

export function clockZones(cpu: CpuSpec, cooler: CoolerSpec | undefined): ClockZones {
  const coeff = cpu.thermal.passive + (cooler?.coolingPerC ?? 0);
  const heat = cpu.loadW * cpu.heatFactor;
  const at = (t: number) => (heat > 0 ? cpu.clock.base * Math.cbrt(((t - AMBIENT_C) * coeff) / heat) : cpu.clock.max);
  return {
    min: cpu.clock.min,
    max: cpu.clock.max,
    throttleAt: at(cpu.thermal.throttleC),
    unstableAt: at(cpu.thermal.unstableC),
  };
}

/** Steady temperature estimate (C) at a clock, same model as `clockZones`. */
export function estTempC(cpu: CpuSpec, cooler: CoolerSpec | undefined, clock: number): number {
  const r = clock / cpu.clock.base;
  return AMBIENT_C + (cpu.loadW * cpu.heatFactor * r ** 3) / (cpu.thermal.passive + (cooler?.coolingPerC ?? 0));
}

export type ZoneName = 'safe' | 'throttle' | 'unstable';
export function zoneOf(z: ClockZones, clock: number): ZoneName {
  if (clock >= z.unstableAt) {
    return 'unstable';
  }
  if (clock >= z.throttleAt) {
    return 'throttle';
  }
  return 'safe';
}

/** The installed cooler, for the clock zones. */
export function installedCooler(s: Snapshot): CoolerSpec | undefined {
  const c = s.devices.find((d: DeviceSnap) => d.kind === 'cooler');
  const spec = c ? getSpec(c.spec) : undefined;
  return spec?.kind === 'cooler' ? spec : undefined;
}
