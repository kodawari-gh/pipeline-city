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
  /** The next instruction to fetch. When `drained` this is the next instruction of the program, in program order. */
  readonly pc: number;
  readonly cycle: number;
  // Interrupt support (docs/CPU.md). An engine without it never takes interrupts.
  /** No instruction in flight (everything fetched has retired or been squashed), so a handler may start. */
  readonly drained?: boolean;
  /** Stop (or resume) fetching new instructions, so the pipeline empties. */
  holdFetch?(on: boolean): void;
  /** Fetch from `pc` next. Only valid while `drained`. */
  redirect?(pc: number): void;
}
