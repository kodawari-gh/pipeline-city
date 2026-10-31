// VRM maths (see docs/VRM.md): pure functions, no state. The thermal model owns the VRM's temperature and stress.
// All numbers are placeholders.

import type { VrmSpec } from "./specs";

/** Per-phase load above which the VRM is overloaded (unstable). */
export const VRM_OVERLOAD = 1;
/** Per-phase load above which the VRM accumulates burn-out stress even when cool. */
export const VRM_BURN_RATIO = 1.6;

/** Burn-out stress per tick while overloaded (or hot past unstableC) and hotter than throttleC: 10 stress burns the board. */
export const VRM_HOT_STRESS = 0.25;

/** CPU core voltage: 1 V at base clock, rising 0.3 V per unit of clock ratio (floored at 0.7 V). */
export function coreVoltage(r: number): number {
  return Math.max(0.7, 1 + 0.3 * (r - 1));
}

/** Memory voltage: 1.2 V at base clock, rising 0.3 V per unit of clock ratio (floored at 0.9 V). */
export function ramVoltage(r: number): number {
  return Math.max(0.9, 1.2 + 0.3 * (r - 1));
}

/** Amps the memory asks for: its total power over its voltage. */
export function ramDemand(ramW: number, r: number): number {
  return ramW / ramVoltage(r);
}

/** Amps the CPU asks for: its power over its core voltage (grows about with r^2 as the clock rises). */
export function currentDemand(cpuW: number, r: number): number {
  return cpuW / coreVoltage(r);
}

/** Demand over the phases' total rating. 1 = every phase at its rated current. */
export function loadRatio(spec: VrmSpec, demandA: number): number {
  return demandA / (spec.phases * spec.ampsPerPhase);
}

/** Efficiency 0.4..peak: lower at very light load (switching waste) and past 60% of rating (conduction losses). */
export function efficiency(spec: VrmSpec, ratio: number): number {
  const light = 0.12 * Math.max(0, 1 - ratio / 0.15);
  const heavy = 0.35 * Math.max(0, ratio - 0.6) ** 2;
  return Math.min(spec.peakEfficiency, Math.max(0.4, spec.peakEfficiency - light - heavy));
}

/** Heat made in the VRM for `cpuW` delivered at the given efficiency. */
export function lossW(cpuW: number, eff: number): number {
  return cpuW * (1 / eff - 1);
}

/** Chance per busy tick of a voltage-droop crash while unstable: more overload, more heat and sloppier parts raise it. */
export function errorProb(spec: VrmSpec, ratio: number, tempC: number): number {
  const base = 0.01 + 0.2 * Math.max(0, ratio - VRM_OVERLOAD) + 0.02 * Math.max(0, tempC - spec.unstableC);
  return Math.min(0.5, base * (0.5 + 1.5 * spec.ripple));
}
