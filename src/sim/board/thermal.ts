// Power and thermal model, stepped once per base tick. Deterministic; the only randomness is errorRoll,
// which draws from the machine's seeded PRNG. Simple first-order model, not a physics sim. Numbers are placeholders.
//
// Per device each tick:
//   r      = effective clock / base clock
//   power  = idleW * r + (loadW - idleW) * load * r^3         (dynamic power grows steeply: voltage rises with clock)
//   heat   = power * heatFactor
//   T     += (heat - (passive + coolerCoeff[CPU only]) * (T - ambient)) / mass
// Effective clock = requested clock * thermal factor * PSU factor.
//   Thermal factor: 1 up to throttleC, then falls linearly to 0.8 at unstableC (throttling only trims 20%,
//   so a seriously overclocked or under-cooled part still runs away into errors and damage).
//   Above unstableC: errorRoll() can return true (probability 1% + 2% per degree, max 50%).
//   Above damageC for DAMAGE_TICKS accumulated ticks (cooler ticks forgive 1 each): the device is burnt
//   (InstalledDevice.burnt = true, persists in the save, clock 0 and no draw until replaced).
// Brownout rule: total draw > PSU watts -> every clock is scaled by watts/draw (forced throttle).
//   Total draw > 1.5x PSU watts (or a burnt PSU) -> hard trip: everything off (clock 0) until powerCycle().
//   No PSU installed -> machine is off (not latched).

import type { Prng } from "../machine/prng";
import { deviceSpec, findDevices, installedPsu, type Board, type InstalledDevice } from "./board";
import { AMBIENT_C, DAMAGE_TICKS, type DeviceKind } from "./specs";

export const THROTTLE_MIN = 0.8;
export const TRIP_RATIO = 1.5;

export interface DeviceThermal {
  tempC: number;
  powerW: number;
  heatW: number;
  /** Clock actually used this tick, in ticks per base tick (0 if off or burnt). */
  effClock: number;
  /** Thermal factor in [THROTTLE_MIN, 1] (does not include the PSU factor). */
  throttle: number;
  unstable: boolean;
  /** Accumulated ticks above damageC. */
  stress: number;
  /** Chance errorRoll() returns true this tick (0 when stable). */
  errProb: number;
}

export interface PowerReport {
  totalW: number;
  budgetW: number;
  /** 1 normally; budget/draw when over budget. */
  psuFactor: number;
  /** No working PSU, or tripped. */
  off: boolean;
  tripped: boolean;
}

export type Loads = Partial<Record<DeviceKind, number>>;

export class ThermalModel {
  readonly devices = new Map<string, DeviceThermal>();
  power: PowerReport = { totalW: 0, budgetW: 0, psuFactor: 1, off: true, tripped: false };

  constructor(private readonly prng: Prng) {}

  /** Clear a hard trip (the player flips the power switch). */
  powerCycle(): void {
    this.power = { ...this.power, tripped: false };
  }

  state(id: string): DeviceThermal | undefined {
    return this.devices.get(id);
  }

  /** Effective clock of a device (0 for unknown, burnt, or powered-off). */
  effectiveClock(id: string): number {
    return this.devices.get(id)?.effClock ?? 0;
  }

  /**
   * True if an error should hit this device now. Consumes PRNG state only while the device is unstable,
   * so a healthy machine's PRNG stream is untouched. The sim decides what an error means.
   */
  errorRoll(id: string): boolean {
    const s = this.devices.get(id);
    if (!s || !s.unstable) return false;
    return this.prng.next() < s.errProb;
  }

  /** Advance one base tick. `loads` is the utilisation (0..1) per device kind; default 1. */
  step(board: Board, loads: Loads = {}): void {
    const psu = installedPsu(board);
    const tripped = this.power.tripped;
    const live = !!psu && !psu.dev.burnt && !tripped;
    const load = (d: InstalledDevice): number => loads[deviceSpec(d).kind] ?? 1;
    const cpuLoad = Math.max(0, ...findDevices(board, "cpu").map(load));

    // Thermal factor from last tick's temperatures.
    const therm = new Map<string, number>();
    for (const d of board.devices) {
      const st = this.ensure(d);
      const t = deviceSpec(d).thermal;
      therm.set(d.id, st.tempC <= t.throttleC ? 1 : Math.max(THROTTLE_MIN, 1 - (1 - THROTTLE_MIN) * (st.tempC - t.throttleC) / (t.unstableC - t.throttleC)));
    }
    // Forget removed devices.
    for (const id of [...this.devices.keys()]) if (!board.devices.some((d) => d.id === id)) this.devices.delete(id);

    const powerOf = (d: InstalledDevice, psuFactor: number): { w: number; clk: number } => {
      const spec = deviceSpec(d);
      if (!live || d.burnt) return { w: 0, clk: 0 };
      if (!spec.clock) {
        // Cooler fan follows CPU load; PSU draws nothing of its own in this model.
        return { w: spec.kind === "cooler" ? spec.idleW + (spec.loadW - spec.idleW) * cpuLoad : 0, clk: 0 };
      }
      const clk = (d.clock ?? spec.clock.base) * therm.get(d.id)! * psuFactor;
      const r = clk / spec.clock.base;
      return { w: spec.idleW * r + (spec.loadW - spec.idleW) * load(d) * r * r * r, clk };
    };

    let total = 0;
    for (const d of board.devices) total += powerOf(d, 1).w;
    const budget = psu && !psu.dev.burnt ? psu.spec.watts : 0;
    let psuFactor = 1;
    let nowTripped = tripped;
    if (live && total > budget) {
      psuFactor = budget / total;
      if (total > budget * TRIP_RATIO) nowTripped = true;
    }
    const effLive = live && !nowTripped;
    let drawn = 0;

    const cooler = findDevices(board, "cooler").find((d) => !d.burnt);
    const coolerK = effLive && cooler ? (deviceSpec(cooler) as { coolingPerC: number }).coolingPerC : 0;

    for (const d of board.devices) {
      const spec = deviceSpec(d);
      const st = this.ensure(d);
      const p = effLive ? powerOf(d, psuFactor) : { w: 0, clk: 0 };
      drawn += p.w;
      const heat = p.w * spec.heatFactor;
      const k = spec.thermal.passive + (spec.kind === "cpu" ? coolerK : 0);
      st.powerW = p.w;
      st.heatW = heat;
      st.tempC += (heat - k * (st.tempC - AMBIENT_C)) / spec.thermal.mass;
      st.effClock = p.clk;
      st.throttle = therm.get(d.id)!;
      st.unstable = !d.burnt && st.tempC > spec.thermal.unstableC;
      st.errProb = st.unstable ? Math.min(0.5, 0.01 + 0.02 * (st.tempC - spec.thermal.unstableC)) : 0;
      if (st.tempC > spec.thermal.damageC) st.stress++;
      else st.stress = Math.max(0, st.stress - 1);
      if (st.stress >= DAMAGE_TICKS && !d.burnt) d.burnt = true;
    }
    this.power = { totalW: drawn, budgetW: budget, psuFactor, off: !effLive, tripped: nowTripped };
  }

  private ensure(d: InstalledDevice): DeviceThermal {
    let s = this.devices.get(d.id);
    if (!s) {
      s = { tempC: AMBIENT_C, powerW: 0, heatW: 0, effClock: 0, throttle: 1, unstable: false, stress: 0, errProb: 0 };
      this.devices.set(d.id, s);
    }
    return s;
  }
}
