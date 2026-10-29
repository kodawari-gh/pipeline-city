import type { MemSystem } from "../engines/memsys";
import type { Core } from "./core";
import type { Machine } from "./machine";

/**
 * A CPU engine (unpipelined, 5-stage, ...). It owns its pipeline state; the Machine owns RAM and the devices, and each Core its registers and
 * interrupt state. The CPU clock domain calls step() once per CPU tick (on a multicore machine for each core's engine in turn).
 */
export interface Engine {
  /** Load the program into machine RAM at the core's entry and restart: cold caches/pipeline, pc = the core's entry (0), cycle = 0. `core` defaults to core 0. */
  reset(machine: Machine, program: Uint32Array, core?: Core): void;
  /** Use an L2 and DRAM shared with the other cores instead of the engine's own (before `reset`; its owner resets it). Optional. */
  useMemSystem?(mem: MemSystem): void;
  /** The L2 and DRAM behind this engine's caches (what the other cores of a multicore CPU are given). Optional. */
  readonly memSystem?: MemSystem;
  /** Advance one CPU cycle. No-op once halted. */
  step(): void;
  readonly halted: boolean;
  /** The next instruction to fetch. When `drained` this is the next instruction of the program, in program order. */
  readonly pc: number;
  readonly cycle: number;
  /** An event for the engine's log (`Ev` in engines/common.ts): an interrupt taken, an address space switched. Optional. */
  note?(kind: number, a: number, b: number, c: number): void;
  // Interrupt support (docs/CPU.md). An engine without it never takes interrupts.
  /** No instruction in flight (everything fetched has retired or been squashed), so a handler may start. */
  readonly drained?: boolean;
  /** Stop (or resume) fetching new instructions, so the pipeline empties. */
  holdFetch?(on: boolean): void;
  /** Fetch from `pc` next. Only valid while `drained`. */
  redirect?(pc: number): void;
}
