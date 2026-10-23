// Wiring: apply a Board (and its thermal state) to a Machine.

import { createEngine, type EngineConfig } from "../engines";
import type { Machine, MachineConfig } from "../machine/machine";
import type { Rate } from "../machine/clock";
import { deviceSpec, findDevices, type Board, type InstalledDevice } from "./board";
import type { CpuSpec, DisplaySpec, RamSpec } from "./specs";
import type { ThermalModel } from "./thermal";

const CLOCK_SCALE = 100;

/** Clock in ticks per base tick -> integer Rate (resolution 0.01). */
export function clockToRate(clock: number): Rate {
  return { mul: Math.max(0, Math.round(clock * CLOCK_SCALE)), div: CLOCK_SCALE };
}

function working(board: Board, kind: "cpu" | "ram" | "display"): InstalledDevice[] {
  return findDevices(board, kind).filter((d) => !d.burnt);
}

/** Effective clock: the thermal model's value if given, else the requested clock. */
function clockOf(d: InstalledDevice, thermal?: ThermalModel): number {
  if (thermal) return thermal.effectiveClock(d.id);
  return d.clock ?? 0;
}

/** Construction-time machine settings from the board: total RAM, initial rates, display latency. */
export function machineConfigFor(board: Board, seed?: number): MachineConfig {
  const ram = working(board, "ram").reduce((n, d) => n + (deviceSpec(d) as RamSpec).sizeBytes, 0);
  const disp = working(board, "display")[0];
  const cfg: MachineConfig = {};
  if (seed !== undefined) cfg.seed = seed;
  if (ram > 0) cfg.ramSize = ram;
  const cpu = working(board, "cpu")[0];
  cfg.cpuRate = clockToRate(cpu?.clock ?? 0);
  cfg.displayRate = clockToRate(disp?.clock ?? 0);
  cfg.displayLatency = disp ? (deviceSpec(disp) as DisplaySpec).writeLatency : 0;
  return cfg;
}

/**
 * Set the "cpu", "display" (and "ram", if the machine has such a domain) clock rates. Call after each
 * ThermalModel.step so throttled/browned-out rates take effect. Without `thermal`, requested clocks are used.
 * A missing or burnt device gets rate 0.
 */
export function applyRates(board: Board, machine: Machine, thermal?: ThermalModel): void {
  const set = (name: string, kind: "cpu" | "ram" | "display"): void => {
    if (!machine.clock.hasDomain(name)) return;
    const d = working(board, kind)[0];
    machine.clock.setRate(name, clockToRate(d ? clockOf(d, thermal) : 0));
  };
  set("cpu", "cpu");
  set("display", "display");
  set("ram", "ram");
}

/**
 * Engine config for the installed CPU, with the cache miss penalty taken from the RAM: the RAM's access
 * latency (RAM ticks) converted to CPU cycles by the requested clock ratio. Null if there is no working CPU.
 */
export function engineConfigFor(board: Board): EngineConfig | null {
  const cpuDev = working(board, "cpu")[0];
  if (!cpuDev) return null;
  const cpu = deviceSpec(cpuDev) as CpuSpec;
  const cfg: EngineConfig = { ...cpu.engine };
  const ramDev = working(board, "ram")[0];
  if (ramDev && cfg.kind !== "ref") {
    const ram = deviceSpec(ramDev) as RamSpec;
    const ratio = (cpuDev.clock ?? cpu.clock.base) / (ramDev.clock ?? ram.clock.base);
    cfg.missPenalty = Math.max(1, Math.ceil(ram.latency * ratio));
  }
  return cfg;
}

/** Build the board's engine and attach it with the program. Only call between requests (caches go cold). */
export function applyEngine(board: Board, machine: Machine, program: Uint32Array): boolean {
  const cfg = engineConfigFor(board);
  if (!cfg) return false;
  machine.attach(createEngine(cfg), program);
  return true;
}
