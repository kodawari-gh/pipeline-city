// Thermal constants: the ambient temperature, the burn-out delay and the thermal presets the part lists share.
// BALANCE IS A PLACEHOLDER: every number here is a round, plausible guess to be tuned by playing.

import type { ThermalSpec } from './specTypes';

export const AMBIENT_C = 25;
/** Ticks above damageC (accumulated, cooling slowly forgives) before a device is burnt. */
export const DAMAGE_TICKS = 10;

export const cpuThermal: ThermalSpec = { passive: 0.15, mass: 20, throttleC: 70, unstableC: 85, damageC: 95 };
export const ramThermal: ThermalSpec = { passive: 0.3, mass: 20, throttleC: 75, unstableC: 90, damageC: 100 };
export const dispThermal: ThermalSpec = { passive: 0.3, mass: 30, throttleC: 80, unstableC: 95, damageC: 110 };
export const storageThermal: ThermalSpec = { passive: 0.4, mass: 25, throttleC: 55, unstableC: 70, damageC: 85 };
export const inertThermal: ThermalSpec = { passive: 1, mass: 50, throttleC: 999, unstableC: 999, damageC: 999 };
