// Wiring: apply a Board (and its thermal state) to a Machine.

import { createEngine, type EngineConfig } from "../../cpu/sim/engines";
import { GPU_PORTS, KERNEL_SECONDARY, NPU_PORTS, STORAGE_PORTS } from "@/core/sim/memmap";
import type { Machine, MachineConfig } from "@/core/sim/machine";
import type { Rate } from "@/core/sim/clock";
import { deviceSpec, findDevices, type Board, type InstalledDevice } from "./board";
import type { CpuSpec, DisplaySpec, RamSpec } from "./specs";
import type { ThermalModel } from "./thermal";

const CLOCK_SCALE = 100;

/** Clock in ticks per base tick -> integer Rate (resolution 0.01). */
export function clockToRate(clock: number): Rate {
  return { mul: Math.max(0, Math.round(clock * CLOCK_SCALE)), div: CLOCK_SCALE };
}

function working(board: Board, kind: "cpu" | "ram" | "display" | "storage" | "gpu" | "npu" | "tpm"): InstalledDevice[] {
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
  // Storage ports: one clock domain per storage slot, driven by the drive installed there (0 when empty or burnt).
  for (const slot of STORAGE_PORTS) {
    if (!machine.clock.hasDomain(slot)) continue;
    const d = working(board, "storage").find((x) => x.slot === slot);
    machine.clock.setRate(slot, clockToRate(d ? clockOf(d, thermal) : 0));
  }
  // NPU cards: the port npuK follows the card in slot pcieK.
  NPU_PORTS.forEach((port, k) => {
    if (!machine.clock.hasDomain(port)) return;
    const d = working(board, "npu").find((x) => x.slot === `pcie${k}`);
    machine.clock.setRate(port, clockToRate(d ? clockOf(d, thermal) : 0));
  });
  // The TPM runs on one fixed slow clock while a module is installed (no overclock).
  if (machine.clock.hasDomain("tpm")) machine.clock.setRate("tpm", clockToRate(working(board, "tpm").length > 0 ? 1 : 0));
  // GPU cards: one clock domain per PCIe slot, driven by the card installed there.
  for (const slot of GPU_PORTS) {
    if (!machine.clock.hasDomain(slot)) continue;
    const d = working(board, "gpu").find((x) => x.slot === slot);
    machine.clock.setRate(slot, clockToRate(d ? clockOf(d, thermal) : 0));
  }
}

/**
 * Engine config for the installed CPU, with the cache miss penalty taken from the RAM: the RAM's access
 * latency (RAM ticks) converted to CPU cycles by the requested clock ratio (the slowest stick counts). Null if there is no working CPU.
 */
export function engineConfigFor(board: Board): EngineConfig | null {
  const cpuDev = working(board, "cpu")[0];
  if (!cpuDev) return null;
  const cpu = deviceSpec(cpuDev) as CpuSpec;
  const cfg: EngineConfig = { ...cpu.engine };
  if (cfg.kind === "ooo" && (cpu.threads ?? 1) > 1) cfg.threads = cpu.threads; // the out-of-order core holds its threads in the pipeline together
  // Several sticks run at the speed of the slowest one: the miss penalty comes from the stick that costs most cycles.
  const cpuClock = cpuDev.clock ?? cpu.clock.base;
  const sticks = working(board, "ram").map((d) => {
    const ram = deviceSpec(d) as RamSpec;
    return { ram, penalty: Math.ceil(ram.latency * (cpuClock / (d.clock ?? ram.clock.base))) };
  });
  if (sticks.length > 0 && cfg.kind !== "ref") {
    cfg.missPenalty = Math.max(1, ...sticks.map((s) => s.penalty));
    if (cfg.kind !== "unpipelined") {
      // the DRAM the CPU reaches: as many banks as the weakest stick has, the slowest stick's timing (docs/RAM.md): an activate costs the stick's latency,
      // the open row a share of it, a conflict half as much again
      const slow = sticks.reduce((a, b) => (b.penalty > a.penalty ? b : a));
      const r = slow.ram, k = Math.max(0.01, slow.penalty / Math.max(1, r.latency)); // RAM ticks -> CPU cycles for this clock ratio
      const cy = (t: number) => Math.max(1, Math.ceil(t * k));
      const mc = cpu.memory ?? { channels: 1, policy: "open" as const };
      let channels = 1;
      const lanes = sticks.reduce((n, s) => n + (s.ram.subChannels ?? 1), 0); // a DDR5 stick brings two sub-channels
      while (channels * 2 <= Math.min(mc.channels, lanes)) channels *= 2;
      cfg.dram = {
        channels, banks: Math.min(...sticks.map((s) => s.ram.banks)), bankGroups: Math.min(...sticks.map((s) => s.ram.bankGroups)), rowBytes: r.rowBytes,
        tCL: cy(r.tCL), tRCD: cy(r.tRCD), tRP: cy(r.tRP), burst: cy(r.burst), ccdS: cy(r.burst), ccdL: cy(r.burst * 2),
        refreshEvery: 6000, tRFC: cy(r.tRCD + r.tRP), policy: mc.policy,
      };
    }
  }
  return cfg;
}

/**
 * Build the board's engine and attach it with the program. Only call between requests (caches go cold). A multicore CPU gets one engine per core, all on
 * the first engine's L2 and DRAM: core 0 runs the program, the others start parked with their interrupt vector at the kernel's secondary entry (what a
 * multicore OS wakes with an IPI; under the key loader or the first OS they stay asleep).
 */
export function applyEngine(board: Board, machine: Machine, program: Uint32Array): boolean {
  const cfg = engineConfigFor(board);
  if (!cfg) return false;
  const spec = deviceSpec(working(board, "cpu")[0]!) as CpuSpec;
  // the MMU the CPU has (none: the unit cannot be switched on and the paged OS will not boot)
  machine.mmu.configure(spec.mmu?.tlb ?? 0);
  const first = createEngine(cfg);
  const cores = first.memSystem ? spec.cores ?? 1 : 1; // an engine without a memory system (the reference, the unpipelined one) cannot share one
  const threads = cfg.kind === "inorder" || cfg.kind === "ooo" ? spec.threads ?? 1 : 1; // the in-order engine switches threads on a miss, the out-of-order one runs them together
  machine.mem = cores > 1 ? first.memSystem! : null;
  machine.setCores(cores * threads); // after the memory system is set: it switches the shared L2 on
  machine.attach(first, program);
  for (let k = 1; k < cores; k++) {
    machine.attachCore(k, createEngine(cfg), new Uint32Array(0));
    machine.parkCore(k, KERNEL_SECONDARY);
  }
  // The logical cores come in turn: the first thread of every hardware core, then the second of each, so a kernel that uses the first few runs them on different cores.
  for (let t = 1; t < threads; t++) {
    for (let h = 0; h < cores; h++) {
      machine.attachThread(h + t * cores, h);
      machine.parkCore(h + t * cores, KERNEL_SECONDARY);
    }
  }
  return true;
}
