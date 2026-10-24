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
// The board's VRM (docs/VRM.md) is stepped here too: its loss (CPU power x (1/efficiency - 1)) is drawn from the PSU,
//   its temperature lives in `vrm`, a hot VRM trims the CPU clock (same 0.8 floor), overload or heat makes
//   vrmErrorRoll() fire, and sustained overload or heat burns the board (Board.burnt).
// Brownout rule: total draw > PSU watts -> every clock is scaled by watts/draw (forced throttle).
//   Total draw > 1.5x PSU watts (or a burnt PSU) -> hard trip: everything off (clock 0) until powerCycle().
//   No PSU installed -> machine is off (not latched).

import type { Prng } from "../machine/prng";
import { deviceSpec, findDevices, installedPsu, type Board, type InstalledDevice } from "./board";
import { AMBIENT_C, BOARD_TIERS, DAMAGE_TICKS, type DeviceKind } from "./specs";
import { currentDemand, efficiency, errorProb, lossW, loadRatio, VRM_BURN_RATIO, VRM_HOT_STRESS, VRM_OVERLOAD } from "./vrm";

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

/** The board VRM's live state (temperature restarts at ambient on load; the burnt flag is Board.burnt). */
export interface VrmThermal {
  tempC: number;
  /** Heat made this tick (the conversion loss), W. */
  heatW: number;
  /** CPU current demand over the phases' rating. */
  loadRatio: number;
  efficiency: number;
  /** The VRM's own thermal factor in [THROTTLE_MIN, 1] (multiplied into the CPU clock). */
  throttle: number;
  unstable: boolean;
  /** Accumulated ticks of overload or heat past the damage limits. */
  stress: number;
  /** Chance vrmErrorRoll() returns true this tick (0 when stable). */
  errProb: number;
}

const freshVrm = (): VrmThermal => ({ tempC: AMBIENT_C, heatW: 0, loadRatio: 0, efficiency: 1, throttle: 1, unstable: false, stress: 0, errProb: 0 });

export interface PowerReport {
  totalW: number;
  /** Of totalW, the VRM's conversion loss. */
  vrmLossW: number;
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
  vrm: VrmThermal = freshVrm();
  power: PowerReport = { totalW: 0, vrmLossW: 0, budgetW: 0, psuFactor: 1, off: true, tripped: false };

  constructor(private readonly prng: Prng) {}

  /** Clear a hard trip (the player flips the power switch). */
  powerCycle(): void {
    this.power = { ...this.power, tripped: false };
  }

  /** Sandbox tool: every part and the VRM back to ambient with no accumulated damage, and the PSU trip cleared. */
  coolAll(): void {
    for (const st of this.devices.values()) {
      st.tempC = AMBIENT_C;
      st.stress = 0;
      st.unstable = false;
      st.errProb = 0;
      st.throttle = 1;
    }
    this.vrm = freshVrm();
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

  /** True if a voltage-droop crash should hit now. Consumes PRNG state only while the VRM is unstable. */
  vrmErrorRoll(): boolean {
    if (!this.vrm.unstable) return false;
    return this.prng.next() < this.vrm.errProb;
  }

  /**
   * Advance one base tick. `loads` is the utilisation (0..1) per device kind; default 1. With `powered` false the
   * machine is switched off (nothing draws, parts cool down); the trip latch is left alone.
   */
  step(board: Board, loads: Loads = {}, powered = true): void {
    const psu = installedPsu(board);
    const tripped = this.power.tripped;
    const live = powered && !!psu && !psu.dev.burnt && !tripped && !board.burnt;
    const vspec = BOARD_TIERS[board.tier]!.vrm;
    const load = (d: InstalledDevice): number => loads[deviceSpec(d).kind] ?? 1;
    const cpuLoad = Math.max(0, ...findDevices(board, "cpu").map(load));

    // Thermal factor from last tick's temperatures.
    const therm = new Map<string, number>();
    for (const d of board.devices) {
      const st = this.ensure(d);
      const t = deviceSpec(d).thermal;
      therm.set(d.id, st.tempC <= t.throttleC ? 1 : Math.max(THROTTLE_MIN, 1 - (1 - THROTTLE_MIN) * (st.tempC - t.throttleC) / (t.unstableC - t.throttleC)));
    }
    // The VRM's thermal factor (last tick's temperature) trims the CPU on top of its own.
    const vrmThrottle = this.vrm.tempC <= vspec.throttleC ? 1 : Math.max(THROTTLE_MIN, 1 - (1 - THROTTLE_MIN) * (this.vrm.tempC - vspec.throttleC) / (vspec.unstableC - vspec.throttleC));
    // Forget removed devices.
    for (const id of [...this.devices.keys()]) if (!board.devices.some((d) => d.id === id)) this.devices.delete(id);

    const powerOf = (d: InstalledDevice, psuFactor: number): { w: number; clk: number } => {
      const spec = deviceSpec(d);
      if (!live || d.burnt) return { w: 0, clk: 0 };
      if (!spec.clock) {
        // Cooler fan follows CPU load; PSU draws nothing of its own in this model.
        return { w: spec.kind === "cooler" || spec.kind === "vrm-sink" ? spec.idleW + (spec.loadW - spec.idleW) * cpuLoad : 0, clk: 0 };
      }
      const clk = (d.clock ?? spec.clock.base) * therm.get(d.id)! * (spec.kind === "cpu" ? vrmThrottle : 1) * psuFactor;
      const r = clk / spec.clock.base;
      return { w: spec.idleW * r + (spec.loadW - spec.idleW) * load(d) * r * r * r, clk };
    };

    // The VRM between PSU and CPU: the CPU's power at this PSU factor, the current it needs, and what the VRM wastes.
    const cpuDev = findDevices(board, "cpu").find((d) => !d.burnt);
    const vrmAt = (psuFactor: number): { ratio: number; eff: number; loss: number } => {
      if (!cpuDev || !live) return { ratio: 0, eff: vspec.peakEfficiency, loss: 0 };
      const cs = deviceSpec(cpuDev);
      const p = powerOf(cpuDev, psuFactor);
      const ratio = loadRatio(vspec, currentDemand(p.w, p.clk / cs.clock!.base));
      const eff = efficiency(vspec, ratio);
      return { ratio, eff, loss: lossW(p.w, eff) };
    };
    let total = vrmAt(1).loss;
    for (const d of board.devices) total += powerOf(d, 1).w;
    const budget = psu && !psu.dev.burnt ? psu.spec.watts : 0;
    let psuFactor = 1;
    let nowTripped = tripped;
    if (live && total > budget) {
      psuFactor = budget / total;
      if (total > budget * TRIP_RATIO) nowTripped = true;
    }
    const effLive = live && !nowTripped;
    const vrmNow = vrmAt(effLive ? psuFactor : 1);
    let drawn = effLive ? vrmNow.loss : 0;

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
    this.stepVrm(board, vspec, vrmNow, vrmThrottle, effLive);
    this.power = { totalW: drawn, vrmLossW: effLive ? vrmNow.loss : 0, budgetW: budget, psuFactor, off: !effLive, tripped: nowTripped };
  }

  private stepVrm(board: Board, vspec: (typeof BOARD_TIERS)[number]["vrm"], now: { ratio: number; eff: number; loss: number }, throttle: number, live: boolean): void {
    const v = this.vrm;
    const sink = live ? findDevices(board, "vrm-sink").find((d) => !d.burnt) : undefined;
    const cooler = live ? findDevices(board, "cooler").find((d) => !d.burnt) : undefined;
    const sinkK = sink ? (deviceSpec(sink) as { coolingPerC: number }).coolingPerC : 0;
    const airK = cooler ? (deviceSpec(cooler) as { vrmAirPerC: number }).vrmAirPerC : 0;
    v.heatW = now.loss;
    v.tempC += (now.loss - (vspec.passive + sinkK + airK) * (v.tempC - AMBIENT_C)) / vspec.mass;
    v.loadRatio = now.ratio;
    v.efficiency = now.eff;
    v.throttle = throttle;
    v.unstable = !board.burnt && live && (now.ratio > VRM_OVERLOAD || v.tempC > vspec.unstableC);
    v.errProb = v.unstable ? errorProb(vspec, now.ratio, v.tempC) : 0;
    // Burn-out stress: fast when far over the limits, slow when overloaded AND hot (so cooling the VRM saves it), else it recovers.
    if (v.tempC > vspec.damageC || now.ratio > VRM_BURN_RATIO) v.stress++;
    else if (v.unstable && v.tempC > vspec.throttleC) v.stress += VRM_HOT_STRESS;
    else v.stress = Math.max(0, v.stress - 1);
    if (v.stress >= DAMAGE_TICKS && !board.burnt) board.burnt = true;
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
