// Power and thermal model types and constants (stepped by thermalStep.ts). Numbers are placeholders.
// See thermal.ts for the model notes.

import { AMBIENT_C } from './specs';
import type * as specsTypes from './specs';

export type VrmSpecOf = (typeof specsTypes.BOARD_TIERS)[number]['vrm'];

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
  /** 0 to 1: how fast the card's own fans turn (graphics and neural cards; 0 for every other part). */
  fan: number;
}

/** A card's fans stay still below this temperature (zero-RPM mode), C, and reach full speed at the card's throttle limit. */
export const CARD_FAN_START_C = 40;
/** How fast a card's own fans turn, 0 to 1, from its temperature: still when cool, full at its throttle limit. */
export function cardFan(tempC: number, throttleC: number): number {
  return Math.max(0, Math.min(1, (tempC - CARD_FAN_START_C) / (throttleC - CARD_FAN_START_C)));
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

export const freshVrm = (): VrmThermal => ({
  tempC: AMBIENT_C,
  heatW: 0,
  loadRatio: 0,
  efficiency: 1,
  throttle: 1,
  unstable: false,
  stress: 0,
  errProb: 0,
});

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
/** The share of its fans' cooling a card keeps in a case with no air moving in its area (they only stir the trapped air). */
export const CARD_FAN_AIR_MIN = 0.4;
export const isCard = (kind: specsTypes.DeviceKind): boolean => kind === 'gpu' || kind === 'npu';

export type Loads = Partial<Record<specsTypes.DeviceKind, number>>;

/**
 * Which fan headers are plugged in (docs/VRM.md "Fans"): the Game reads it off the cables. `cpu`, `vrm`, `ram`: the fans on that heatsink turn (the
 * board says which fans are on it). `caseFans` counts the case fans that turn (their own cable and the hub's).
 */
export interface FanPower {
  cpu: boolean;
  vrm: boolean;
  ram: boolean;
  caseFans: number;
  /** The ids of the case fans that turn (`front0`, `top1`, `rear`: their own cable and the hub's). With it the case's air is worked out per area (airflow.ts); without it every area gets `caseFans`. */
  mounts?: string[];
  /** The airflow of the fan on each turning mount (absent: a basic fan of the case's size). */
  mountFlow?: Record<string, number>;
  /** What the fitted radiator adds to a liquid loop, W/C (0 with none). The Game works it out: full with its fan plugged, `UNFANNED_SHARE` of it without. */
  loopK?: number;
  /** The side of the case the radiator is on (`front` takes in room air and warms the case with its heat, `top` blows out of the case). Unset: looked up from the board. */
  radSide?: 'front' | 'top';
}
/** The default for a model with no cables to look at: every part's fan turns, no case fans counted, and a liquid loop runs the fitted radiator (if any) at full fan. */
export const FANS_ON: FanPower = { cpu: true, vrm: true, ram: true, caseFans: 0 };
/** What a clocked part draws, W: its idle draw scaled by the clock ratio `r` (clock over base), plus the load share that grows with r cubed. Used by the model and by compat.ts. */
export function clockPowerW(spec: { idleW: number; loadW: number }, r: number, load: number): number {
  return spec.idleW * r + (spec.loadW - spec.idleW) * load * r * r * r;
}
/** W per degree C the cooling block moves from the CPU into the coolant (the pump must run). */
export const LOOP_BLOCK_K = 60;
/** The block's exchange is worked out in this many steps per tick: it is stiff (a light CPU, a strong block), one step would overshoot. */
export const LOOP_SUBSTEPS = 12;
/** Joules per degree C of the coolant in the loop (one base tick = 1 s): it warms up and cools down slowly. */
export const LOOP_MASS = 120;
/** W per degree C the water carries at full flow (flow x specific heat): the heat the block hands over divided by this is how much the water warms crossing it. */
export const LOOP_FLOW_CP = 15;
/** How fast the flow follows the pump (share of the gap per tick) and the most the water warms crossing the block, C. */
export const LOOP_FLOW_EASE = 0.4;
export const LOOP_MAX_RISE_C = 30;
/** W per degree C each turning case fan adds to every part's own cooling (airflow through the case). */
export const CASE_FAN_K = 0.01;
/** A heatsink with a fan whose fan is not plugged in still works as fins: this share of its cooling is left. */
export const UNFANNED_SHARE = 0.5;

/** Optional arguments to `ThermalModel.step`. */
export interface ThermalStepOpts {
  /** Utilisation (0..1) per device kind; default 1 for most kinds, 0 for accelerators. */
  loads?: Loads;
  /** With false the machine is switched off (nothing draws, parts cool down); the trip latch is left alone. */
  powered?: boolean;
  /** Which fans turn; default `FANS_ON`. */
  fans?: FanPower;
}

function isStepOpts(opts: Loads | ThermalStepOpts): opts is ThermalStepOpts {
  return 'loads' in opts || 'powered' in opts || 'fans' in opts;
}

export function parseStepOpts(opts: Loads | ThermalStepOpts = {}): { loads: Loads; powered: boolean; fans: FanPower } {
  if (isStepOpts(opts)) {
    return { loads: opts.loads ?? {}, powered: opts.powered !== false, fans: opts.fans ?? FANS_ON };
  }
  return { loads: opts, powered: true, fans: FANS_ON };
}
