import type { Snapshot } from '@/worker/protocol';

// Every fan of the machine (case, cooler, radiator, VRM and memory sinks, PSU, graphics cards) turns by one rule and moves by one motor. The rule
// says WHEN a fan may turn (`machineLive`, plus the part's own conditions: not burnt, its cable in); the motor says HOW: it eases up from still
// and coasts down to still, it never jumps. The speeds are published in `fanBank` so that other views (the airflow lens) show the same fan.

/** Fan speed in the units of `live.ts`: radians per second of a rotor; an edge-on fan slides 0.8 blade lengths per unit and second. */
export const FAN_MAX = 12;

/** The speed that counts as "full" for the air a fan blows (a case fan idles near 2, a hot cooler reaches 10+). */
const FAN_FULL_LEVEL = 7;

/** Whether the machine is running: on, not tripped, board not dead. No fan turns while it is not (the motors coast down). */
export const machineLive = (s: Snapshot | null | undefined): boolean => !!s && s.powered && !s.power.off && !s.power.tripped && !s.board?.burnt;

/** Seconds a fan takes to settle toward a faster speed (spin-up) or a slower one (coasting down). Critically damped: no jump, no overshoot. */
const UP_S = 1.1, DOWN_S = 2.4;
/** Below this speed a fan that is told to stop is still. */
const STILL = 0.04;

export class FanMotor {
  speed: number;
  private vel = 0;

  /** `start`: the speed the fan already has (a rebuilt scene hands the old speed from `fanBank`, so a fan never restarts from still). */
  constructor(start = 0) { this.speed = start; }

  /** Advance `dt` seconds (game time) toward `target`; returns the speed. A paused game (dt 0) holds the fan. */
  step(dt: number, target: number): number {
    if (dt <= 0) return this.speed;
    dt = Math.min(dt, 0.1);
    const goal = Math.max(0, target), time = goal > this.speed ? UP_S : DOWN_S, omega = 2 / time, x = omega * dt;
    const k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x), change = this.speed - goal, temp = (this.vel + omega * change) * dt;
    this.vel = (this.vel - omega * temp) * k;
    let out = goal + (change + temp) * k;
    if (goal - this.speed > 0 === out > goal) { out = goal; this.vel = 0; } // never past the target
    this.speed = Math.max(0, out);
    if (goal === 0 && this.speed < STILL) { this.speed = 0; this.vel = 0; }
    return this.speed;
  }
}

/** The liquid loop's water now (`board.loop` of the snapshot, written by live.ts): the board's coolant overlay reads it. Null with no loop. */
export interface LoopWater { coolantC: number; hotC: number; coldC: number; flow: number }
let water: LoopWater | null = null;
export const loopBank = {
  set(w: LoopWater | null) { water = w; },
  get(): LoopWater | null { return water; },
};

const speeds = new Map<string, number>();
/** The speed each fan has right now, by id (`case:front0`, `cooler`, `radiator:top1`, `vrm`, `ramvrm`, `psu`, `gpu:pcie0`). Written by the views that own the fans. */
export const fanBank = {
  set(id: string, speed: number) { speeds.set(id, speed); },
  /** 0 for a fan nobody has published. */
  get(id: string): number { return speeds.get(id) ?? 0; },
  /** 0 (still) to 1 (full speed). */
  level(id: string): number { return Math.min(1, (speeds.get(id) ?? 0) / FAN_FULL_LEVEL); },
  clear() { speeds.clear(); },
};
