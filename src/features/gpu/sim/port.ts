// A GPU card as a memory-mapped device (docs/ACCEL.md "GPU"). Like a storage port, one fixed bus window per PCIe slot (pcie0..pcie3)
// whose clock domain is named after the slot; the game attaches a card (lanes, card memory, banks) when a GPU is installed there.
//
// The CPU copies a kernel and its data into the card-memory window with plain stores (no DMA, so the copy cost is visible), writes
// KERNEL and LANES, writes CMD = 1 and polls STATUS. A launch crosses the PCIe link: it starts GPU_HOP_TICKS after CMD, the kernel then
// runs one instruction per tick (a vld / vst that hits a bank conflict takes one tick per extra access), and Done shows GPU_HOP_TICKS
// after the kernel halts. The instruction semantics and the cycle rule are the reference interpreter's (src/sim/ref/gpuref.ts): this
// device steps that core, so it matches it by construction and the tests check the cycle counts against known runs.

import { GPU_BASE, GPU_CODE, GPU_FRAME, GPU_HOP_TICKS, GPU_MEM, GPU_REG, GPU_STRIDE, GpuFaultCode, GpuStatus } from "@/core/sim/memmap";
import { createGpu, sameGpuConfig, type GpuCacheView, type GpuConfig, type GpuEngine, type GpuSmView } from ".";
import { GpuFault, type GpuStep } from "./isa/ref";
import type { Rate } from "@/core/sim/hw/clock";
import type { Device } from "@/core/sim/hw/device";

type Phase = "idle" | "in" | "run" | "out";

/** Instructions of the last launch a card remembers for its view (the die view replays them at its own pace). */
export const GPU_TRACE_STEPS = 64;

export type { GpuCacheView, GpuSmView, GpuWarpView } from ".";

/** What a card shows from the outside: its shape, where the launch is, and the last instructions it ran (docs/ACCEL.md "Art as built"). */
export interface GpuView {
  lanes: number;
  banks: number;
  memBytes: number;
  phase: Phase;
  /** Execution mask now (bit n = lane n). */
  mask: number;
  /** The mask stack, oldest first. */
  stack: number[];
  pc: number;
  /** Vector registers `regs[r][lane]` as of now; empty before the first launch of this power-on. */
  regs: number[][];
  /** The last instructions run, oldest first (at most GPU_TRACE_STEPS), kept after the launch ends. */
  trace: GpuStep[];
  launches: number;
  /** Counters of the current / last launch. */
  stats: { instructions: number; idleLaneSlots: number; conflictCycles: number; cycles: number };
  /** SMs and their warps (the unpipelined unit: one of each). */
  sms?: GpuSmView[];
  /** Set when the last launch ended in a fault. */
  error: boolean;
  /** What a display on this card's port shows: the output region of card memory (`GPU_FRAME`), as words; empty before the first launch of this power-on. */
  frame: number[];
  /** The kernel in card memory (words from address 0, up to the last one that is not zero), as a launch finds it; empty until the card has had one copied in. */
  code?: number[];
  /** The caches and the lines they hold (a card with an L1 / L2 only). */
  caches?: GpuCacheView[];
  /** A map of card memory: for every `GPU_FILL_WORDS` words, how many are not zero. */
  fill?: number[];
}

/** Words of card memory one entry of `GpuView.fill` covers. */
export const GPU_FILL_WORDS = 4;

/** How full card memory is, block by block: the words that are not zero in each `GPU_FILL_WORDS`. */
function fillMap(mem: Uint32Array): number[] {
  const out: number[] = new Array(Math.ceil(mem.length / GPU_FILL_WORDS)).fill(0);
  for (let k = 0; k < mem.length; k++) if (mem[k] !== 0) out[(k / GPU_FILL_WORDS) | 0]!++;
  return out;
}

/** The words of the kernel in card memory: the code area up to its last word that is not zero. */
function kernelWords(mem: Uint32Array): number[] {
  let n = Math.min(GPU_CODE.words, mem.length);
  while (n > 0 && mem[n - 1] === 0) n--;
  return Array.from(mem.subarray(0, n));
}

export class GpuPort implements Device {
  readonly size = GPU_STRIDE;
  readonly base: number;
  /** Starts stopped; the game sets the rate from the installed card's (throttled) clock. */
  readonly clock: Rate = { mul: 0, div: 1 };

  private cfg: GpuConfig | null = null;
  private core: GpuEngine | null = null;
  private phase: Phase = "idle";
  private wait = 0;
  private kernel = 0;
  private lanes = 0;
  private done = false;
  private error = false;
  private fault: number = GpuFaultCode.None;
  private lastCycles = 0;
  private trace: GpuStep[] = [];
  /** Set while a launch is in flight, cleared by `takeActivity` (the game reads it for the thermal load). */
  active = false;
  /** Totals since power-on, for the stats and the tests. */
  launches = 0;
  kernelCycles = 0;
  /** The core's counters for the last launch (instructions, lane slots idle through divergence, cycles lost to conflicts). */
  lastStats = { instructions: 0, idleLaneSlots: 0, conflictCycles: 0 };

  constructor(readonly name: string, index: number) {
    this.base = GPU_BASE + index * GPU_STRIDE;
  }

  /** Put a card in the slot (or take it out with null). A different card is a fresh one; the same config leaves the state alone. */
  configure(cfg: GpuConfig | null): void {
    if (sameGpuConfig(cfg, this.cfg)) return;
    this.cfg = cfg;
    this.core = cfg ? createGpu(cfg) : null;
    this.reset();
  }

  /** Power-on reset: card memory is volatile and no launch is in flight. */
  reset(): void {
    this.core?.mem.fill(0);
    this.phase = "idle";
    this.wait = 0;
    this.kernel = this.lanes = 0;
    this.done = this.error = false;
    this.fault = GpuFaultCode.None;
    this.lastCycles = 0;
    this.trace = [];
    this.active = false;
  }

  /** The card seen from outside, or null without one. Copies, so the snapshot never aliases the core's arrays. */
  view(): GpuView | null {
    const core = this.core;
    if (!core) return null;
    return {
      lanes: core.lanes, banks: core.banks, memBytes: core.mem.length * 4, phase: this.phase, mask: core.mask, stack: [...core.stack], pc: core.pc,
      regs: this.launches > 0 ? core.regs.map((r) => Array.from(r)) : [],
      trace: this.trace.map((s) => ({ ...s, banks: s.banks && [...s.banks] })),
      launches: this.launches,
      stats: { instructions: core.instructions, idleLaneSlots: core.idleLaneSlots, conflictCycles: core.conflictCycles, cycles: core.cycles },
      sms: core.smViews?.() ?? [{ warps: [{ pc: core.pc, mask: core.mask, stack: [...core.stack], state: core.halted ? "done" : "ready" }] }],
      error: this.error,
      code: kernelWords(core.mem),
      ...(core.cacheViews ? { caches: core.cacheViews() } : {}),
      fill: fillMap(core.mem),
      frame: this.launches > 0 ? Array.from(core.mem.subarray(GPU_FRAME.at >>> 2, (GPU_FRAME.at >>> 2) + GPU_FRAME.words)) : [],
    };
  }

  get present(): boolean {
    return this.core !== null;
  }

  get isBusy(): boolean {
    return this.phase !== "idle";
  }

  /** The card memory as words (the tests and the game's views read it; the CPU goes through the window). */
  get memory(): Uint32Array | null {
    return this.core?.mem ?? null;
  }

  takeActivity(): boolean {
    const a = this.active;
    this.active = this.phase !== "idle";
    return a;
  }

  read(off: number): number {
    const core = this.core;
    if (off >= GPU_MEM) {
      const o = off - GPU_MEM;
      return core && o < core.mem.length * 4 ? (core.mem[o >>> 2]! >>> (8 * (o & 3))) & 0xff : 0;
    }
    let w = 0;
    switch (off & ~3) {
      case GPU_REG.STATUS:
        w = (this.phase !== "idle" ? GpuStatus.Busy : 0) | (this.error ? GpuStatus.Error : 0) | (core ? GpuStatus.Present : 0) | (this.done ? GpuStatus.Done : 0);
        break;
      case GPU_REG.KERNEL: w = this.kernel; break;
      case GPU_REG.LANES: w = this.lanes; break;
      case GPU_REG.LANES_MAX: w = this.cfg?.lanes ?? 0; break;
      case GPU_REG.MEM_BYTES: w = this.cfg?.memBytes ?? 0; break;
      case GPU_REG.BANKS: w = this.cfg?.banks ?? 0; break;
      case GPU_REG.CYCLES: w = this.lastCycles; break;
      case GPU_REG.FAULT: w = this.fault; break;
    }
    return (w >>> (8 * (off & 3))) & 0xff;
  }

  write(off: number, val: number): void {
    const core = this.core;
    if (off >= GPU_MEM) {
      const o = off - GPU_MEM;
      if (core && o < core.mem.length * 4) {
        const sh = 8 * (o & 3);
        core.mem[o >>> 2] = ((core.mem[o >>> 2]! & ~(0xff << sh)) | ((val & 0xff) << sh)) >>> 0;
      }
      return;
    }
    const reg = off & ~3, sh = 8 * (off & 3);
    const put = (old: number): number => ((old & ~(0xff << sh)) | ((val & 0xff) << sh)) >>> 0;
    if (reg === GPU_REG.KERNEL) this.kernel = put(this.kernel);
    else if (reg === GPU_REG.LANES) this.lanes = put(this.lanes);
    else if (reg === GPU_REG.CMD && off === reg) this.launch(val & 0xff); // fires on the low byte, after the other registers have landed
  }

  private launch(cmd: number): void {
    const core = this.core;
    if (cmd !== 1 || !core || this.phase !== "idle" || this.kernel % 4 !== 0 || this.kernel >= core.mem.length * 4 || this.lanes > core.lanes) {
      this.error = true;
      this.fault = GpuFaultCode.BadLaunch;
      return;
    }
    this.error = this.done = false;
    this.fault = GpuFaultCode.None;
    this.phase = "in";
    this.wait = GPU_HOP_TICKS;
    this.trace = [];
    this.active = true;
    this.launches++;
  }

  tick(): void {
    const core = this.core;
    if (!core || this.phase === "idle") return;
    switch (this.phase) {
      case "in":
        if (--this.wait <= 0) {
          core.reset(this.kernel, this.lanes === 0 ? core.lanes : this.lanes);
          this.phase = "run";
        }
        break;
      case "run": {
        try {
          const issued = core.step();
          if (issued) {
            this.trace.push(issued);
            if (this.trace.length > GPU_TRACE_STEPS) this.trace.shift();
          }
        } catch (e) {
          if (!(e instanceof GpuFault)) throw e;
          this.error = true;
          this.fault = GpuFaultCode.Kernel;
          this.finish(core);
          break;
        }
        if (core.halted) this.finish(core);
        break;
      }
      case "out":
        if (--this.wait <= 0) {
          this.phase = "idle";
          this.done = true;
        }
        break;
    }
  }

  private finish(core: GpuEngine): void {
    this.lastCycles = core.cycles;
    this.kernelCycles += core.cycles;
    this.lastStats = { instructions: core.instructions, idleLaneSlots: core.idleLaneSlots, conflictCycles: core.conflictCycles };
    this.phase = "out";
    this.wait = GPU_HOP_TICKS;
  }
}
