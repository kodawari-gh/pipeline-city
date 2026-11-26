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

import type { Prng } from '@/core/sim/prng';
import { AMBIENT_C } from './specs';
import { zoneAir } from './airflow';
import type * as airflowTypes from './airflow';
import type * as boardTypes from './board';
import { freshVrm } from './thermalCore';
import type * as thermalCoreTypes from './thermalCore';
import { runThermalStep } from './thermalStep';

export {
  CARD_FAN_START_C,
  CASE_FAN_K,
  CASE_HEAT_C_PER_W,
  FANS_ON,
  TRIP_RATIO,
  UNFANNED_SHARE,
  cardFan,
  clockPowerW,
} from './thermalCore';
export type { DeviceThermal, FanPower, Loads } from './thermalCore';

export class ThermalModel {
  readonly devices = new Map<string, thermalCoreTypes.DeviceThermal>();
  vrm: thermalCoreTypes.VrmThermal = freshVrm();
  /** The memory regulator live state. */
  ramVrm: thermalCoreTypes.VrmThermal = freshVrm();
  power: thermalCoreTypes.PowerReport = { totalW: 0, vrmLossW: 0, budgetW: 0, psuFactor: 1, off: true, tripped: false };
  /** How much warmer the case air is than the room because of the cards (last tick), C. */
  caseRiseC = 0;
  /** The coolant of a liquid loop (C): the CPU's heat goes into it, the radiator takes it out (it sits at the room temperature with no loop). */
  loopC = AMBIENT_C;
  /** Heat the radiator gives to the air now, W (last tick). */
  loopRejectW = 0;
  /** The pump's flow, 0 (still) to 1 (full): it eases toward the pump's state (the cable in, the machine on). */
  loopFlow = 0;
  /** The water going from the block to the radiator and the water coming back from it (C); both sit at the room temperature with no loop. */
  loopHotC = AMBIENT_C;
  loopColdC = AMBIENT_C;
  /** Which side of the case the radiator that does it is on (null: no loop or no radiator). */
  loopSide: 'front' | 'top' | null = null;
  /** The case's air by area, last tick (airflow.ts). */
  air: Record<airflowTypes.AirZoneId, airflowTypes.ZoneAir> = zoneAir({ tier: 0, caseFans: 0, cardW: 0, heatPerW: 0 });

  constructor(private readonly prng: Prng) {}

  /** Clear a hard trip (the player flips the power switch). */
  powerCycle(): void {
    this.power = { ...this.power, tripped: false };
  }

  /** Sandbox tool: every part and the VRM back to ambient with no accumulated damage, and the PSU trip cleared. */
  coolAll(): void {
    for (const st of this.devices.values()) {
      st.tempC = AMBIENT_C;
      st.fan = 0;
      st.stress = 0;
      st.unstable = false;
      st.errProb = 0;
      st.throttle = 1;
    }
    this.vrm = freshVrm();
    this.ramVrm = freshVrm();
    this.loopC = AMBIENT_C;
    this.loopRejectW = 0;
    this.loopFlow = 0;
    this.loopHotC = AMBIENT_C;
    this.loopColdC = AMBIENT_C;
    this.power = { ...this.power, tripped: false };
  }

  state(id: string): thermalCoreTypes.DeviceThermal | undefined {
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
    if (!s || !s.unstable) {
      return false;
    }
    return this.prng.next() < s.errProb;
  }

  /** True if a voltage-droop crash should hit now. Consumes PRNG state only while the VRM is unstable. */
  vrmErrorRoll(): boolean {
    if (!this.vrm.unstable) {
      return false;
    }
    return this.prng.next() < this.vrm.errProb;
  }

  /** True if a memory-regulator droop crash should hit now. Consumes PRNG state only while that regulator is unstable. */
  ramVrmErrorRoll(): boolean {
    if (!this.ramVrm.unstable) {
      return false;
    }
    return this.prng.next() < this.ramVrm.errProb;
  }

  /**
   * Advance one base tick. `loads` is the utilisation (0..1) per device kind; default 1. With `powered` false the
   * machine is switched off (nothing draws, parts cool down); the trip latch is left alone.
   * The second argument may be a `Loads` map or a `ThermalStepOpts` object (`loads`, `powered`, `fans`).
   */
  step(board: boardTypes.Board, opts: thermalCoreTypes.Loads | thermalCoreTypes.ThermalStepOpts = {}): void {
    runThermalStep(this, board, opts);
  }
}
