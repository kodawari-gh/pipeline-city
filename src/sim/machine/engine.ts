import type { Machine } from "./machine";

/**
 * A CPU engine (unpipelined, 5-stage, ...). It owns its pipeline state; the Machine owns RAM, registers and devices.
 * The CPU clock domain calls step() once per CPU tick.
 */
export interface Engine {
  /** Load the program into machine RAM and restart: cold caches/pipeline, pc = 0, cycle = 0. */
  reset(machine: Machine, program: Uint32Array): void;
  /** Advance one CPU cycle. No-op once halted. */
  step(): void;
  readonly halted: boolean;
  readonly pc: number;
  readonly cycle: number;
}
