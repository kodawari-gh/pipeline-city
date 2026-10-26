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
// The memory has a second regulator of its own (BoardTierSpec.ramVrm, `ramVrm` here): same maths, fed by the DIMMs total power
//   at 1.2 V (ramDemand), its throttle trims every DIMM clock, its instability crashes the machine (ramVrmErrorRoll) and sustained
//   overload or heat burns the board too. Its heatsink sits in slot `ram-sink`.
// Brownout rule: total draw > PSU watts -> every clock is scaled by watts/draw (forced throttle).
//   Total draw > 1.5x PSU watts (or a burnt PSU) -> hard trip: everything off (clock 0) until powerCycle().
//   No PSU installed -> machine is off (not latched).

import type { Prng } from "../machine/prng";
import { deviceSpec, findDevices, installedPsu, type Board, type InstalledDevice } from "./board";
import { AMBIENT_C, BOARD_TIERS, DAMAGE_TICKS, type DeviceKind } from "./specs";
import { currentDemand, efficiency, errorProb, lossW, loadRatio, ramDemand, VRM_BURN_RATIO, VRM_HOT_STRESS, VRM_OVERLOAD } from "./vrm";

type VrmSpecOf = (typeof BOARD_TIERS)[number]["vrm"];

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

/** Degrees C the case air warms for every watt a GPU or NPU card draws (docs/ACCEL.md "Case heat"): a 180 W card warms the other parts by 9. */
export const CASE_HEAT_C_PER_W = 0.05;
const isCard = (kind: DeviceKind): boolean => kind === "gpu" || kind === "npu";

export type Loads = Partial<Record<DeviceKind, number>>;

export class ThermalModel {
  readonly devices = new Map<string, DeviceThermal>();
  vrm: VrmThermal = freshVrm();
  /** The memory regulator live state. */
  ramVrm: VrmThermal = freshVrm();
  power: PowerReport = { totalW: 0, vrmLossW: 0, budgetW: 0, psuFactor: 1, off: true, tripped: false };
  /** How much warmer the case air is than the room because of the cards (last tick), C. */
  caseRiseC = 0;

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
    this.ramVrm = freshVrm();
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

  /** True if a memory-regulator droop crash should hit now. Consumes PRNG state only while that regulator is unstable. */
  ramVrmErrorRoll(): boolean {
    if (!this.ramVrm.unstable) return false;
    return this.prng.next() < this.ramVrm.errProb;
  }

  /**
   * Advance one base tick. `loads` is the utilisation (0..1) per device kind; default 1. With `powered` false the
   * machine is switched off (nothing draws, parts cool down); the trip latch is left alone.
   */
  step(board: Board, loads: Loads = {}, powered = true): void {
    const psu = installedPsu(board);
    const tripped = this.power.tripped;
    const live = powered && !!psu && !psu.dev.burnt && !tripped && !board.burnt;
    const vspec = BOARD_TIERS[board.tier]!.vrm, rspec = BOARD_TIERS[board.tier]!.ramVrm;
    // Accelerators idle until something drives them (docs/ACCEL.md); every other kind defaults to full load.
    const load = (d: InstalledDevice): number => { const k = deviceSpec(d).kind; return loads[k] ?? (k === "gpu" || k === "npu" || k === "tpm" ? 0 : 1); };
    const cpuLoad = Math.max(0, ...findDevices(board, "cpu").map(load));

    // Thermal factor from last tick's temperatures.
    const therm = new Map<string, number>();
    for (const d of board.devices) {
      const st = this.ensure(d);
      const t = deviceSpec(d).thermal;
      therm.set(d.id, st.tempC <= t.throttleC ? 1 : Math.max(THROTTLE_MIN, 1 - (1 - THROTTLE_MIN) * (st.tempC - t.throttleC) / (t.unstableC - t.throttleC)));
    }
    // The VRM's thermal factor (last tick's temperature) trims the CPU on top of its own.
    const throttleOf = (v: VrmThermal, s: VrmSpecOf) => (v.tempC <= s.throttleC ? 1 : Math.max(THROTTLE_MIN, 1 - (1 - THROTTLE_MIN) * (v.tempC - s.throttleC) / (s.unstableC - s.throttleC)));
    const vrmThrottle = throttleOf(this.vrm, vspec), ramThrottle = throttleOf(this.ramVrm, rspec);
    // Forget removed devices.
    for (const id of [...this.devices.keys()]) if (!board.devices.some((d) => d.id === id)) this.devices.delete(id);

    const powerOf = (d: InstalledDevice, psuFactor: number): { w: number; clk: number } => {
      const spec = deviceSpec(d);
      if (!live || d.burnt) return { w: 0, clk: 0 };
      if (spec.kind === "nic" || spec.kind === "tpm") return { w: spec.idleW + (spec.loadW - spec.idleW) * load(d), clk: 0 };
      if (!spec.clock) {
        // Cooler fan follows CPU load; PSU draws nothing of its own in this model.
        return { w: spec.kind === "cooler" || spec.kind === "vrm-sink" || spec.kind === "ram-sink" ? spec.idleW + (spec.loadW - spec.idleW) * cpuLoad : 0, clk: 0 };
      }
      const clk = (d.clock ?? spec.clock.base) * therm.get(d.id)! * (spec.kind === "cpu" ? vrmThrottle : spec.kind === "ram" ? ramThrottle : 1) * psuFactor;
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
    // The memory regulator: every DIMM power at the mean clock ratio, over 1.2 V.
    const ramDevs = findDevices(board, "ram").filter((d) => !d.burnt);
    const ramAt = (psuFactor: number): { ratio: number; eff: number; loss: number } => {
      if (!ramDevs.length || !live) return { ratio: 0, eff: rspec.peakEfficiency, loss: 0 };
      let w = 0, r = 0;
      for (const d of ramDevs) { const p = powerOf(d, psuFactor); w += p.w; r += p.clk / deviceSpec(d).clock!.base; }
      const ratio = loadRatio(rspec, ramDemand(w, r / ramDevs.length));
      const eff = efficiency(rspec, ratio);
      return { ratio, eff, loss: lossW(w, eff) };
    };
    let total = vrmAt(1).loss + ramAt(1).loss;
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
    const ramNow = ramAt(effLive ? psuFactor : 1);
    let drawn = effLive ? vrmNow.loss + ramNow.loss : 0;

    // Case heat (docs/ACCEL.md): a working card warms the air every other part breathes, CASE_HEAT_C_PER_W degrees per watt it draws.
    let cardW = 0;
    if (effLive) for (const d of board.devices) if (isCard(deviceSpec(d).kind) && !d.burnt) cardW += powerOf(d, psuFactor).w;
    const caseRiseC = CASE_HEAT_C_PER_W * cardW;
    this.caseRiseC = caseRiseC;

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
      st.tempC += (heat - k * (st.tempC - (AMBIENT_C + (isCard(spec.kind) ? 0 : caseRiseC)))) / spec.thermal.mass;
      st.effClock = p.clk;
      st.throttle = therm.get(d.id)!;
      st.unstable = !d.burnt && st.tempC > spec.thermal.unstableC;
      st.errProb = st.unstable ? Math.min(0.5, 0.01 + 0.02 * (st.tempC - spec.thermal.unstableC)) : 0;
      if (st.tempC > spec.thermal.damageC) st.stress++;
      else st.stress = Math.max(0, st.stress - 1);
      if (st.stress >= DAMAGE_TICKS && !d.burnt) d.burnt = true;
    }
    this.stepVrm(board, this.vrm, vspec, vrmNow, vrmThrottle, effLive, "vrm-sink", caseRiseC);
    this.stepVrm(board, this.ramVrm, rspec, ramNow, ramThrottle, effLive, "ram-sink", caseRiseC);
    this.power = { totalW: drawn, vrmLossW: effLive ? vrmNow.loss + ramNow.loss : 0, budgetW: budget, psuFactor, off: !effLive, tripped: nowTripped };
  }

  private stepVrm(board: Board, v: VrmThermal, vspec: VrmSpecOf, now: { ratio: number; eff: number; loss: number }, throttle: number, live: boolean, sinkKind: "vrm-sink" | "ram-sink", caseRiseC: number): void {
    const sink = live ? findDevices(board, sinkKind).find((d) => !d.burnt) : undefined;
    const cooler = live ? findDevices(board, "cooler").find((d) => !d.burnt) : undefined;
    const sinkK = sink ? (deviceSpec(sink) as { coolingPerC: number }).coolingPerC : 0;
    const airK = cooler ? (deviceSpec(cooler) as { vrmAirPerC: number }).vrmAirPerC : 0;
    v.heatW = now.loss;
    v.tempC += (now.loss - (vspec.passive + sinkK + airK) * (v.tempC - AMBIENT_C - caseRiseC)) / vspec.mass;
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
