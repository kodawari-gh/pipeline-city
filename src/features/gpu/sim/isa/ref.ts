// Reference interpreter for the GPU ISA (src/sim/isa/gpu.ts): N lanes in lockstep, an execution mask with a mask stack,
// banked word memory on the card. Ground truth for the GPU engine, like ref.ts is for the CPU's.
//
// Timing is the one rule the engine copies (`gpuCost`): every instruction takes one cycle, and a vld / vst takes as many cycles as the
// busiest memory bank has distinct addresses to serve (lanes reading the same address share one access, so a broadcast is free). Lanes
// that are masked off do not touch memory.

import { gpuDecode, GPU_MASK_DEPTH, GPU_REG_COUNT, GPU_SPEC_BY_NAME, type GpuInstr } from "./isa";

export class GpuFault extends Error {
  constructor(public pc: number, msg: string) {
    super(`gpu pc=0x${pc.toString(16)}: ${msg}`);
    this.name = "GpuFault";
  }
}

export interface GpuRefConfig {
  /** Lanes that run in lockstep, 1..32. */
  lanes: number;
  /** Card memory in bytes (a multiple of 4). Kernel code and data share it. */
  memBytes: number;
  /** Memory banks; word `w` lives in bank `w % banks`. */
  banks: number;
  /** Card memory to run on instead of a private one (the warps of an SM share it); `memBytes` is then ignored. */
  mem?: Uint32Array;
  /** What `lane` gives lane 0 (a warp's first lane number on the card), default 0. */
  laneBase?: number;
}

/** Distinct addresses each bank has to serve for one access, `banks` entries (bank = word % banks). */
export function bankLoad(addrs: readonly number[], banks: number): number[] {
  const perBank = Array.from({ length: banks }, () => new Set<number>());
  for (const a of addrs) perBank[(a >>> 2) % banks]!.add(a);
  return perBank.map((s) => s.size);
}

/** Cycles a memory access takes: the most distinct addresses any one bank has to serve (at least 1). */
export function bankCycles(addrs: readonly number[], banks: number): number {
  return Math.max(1, ...bankLoad(addrs, banks));
}

/** What an instruction does, for the card's view: ALU work, a load, a store, a mask change, a branch, or the rest. */
export type GpuStepKind = "alu" | "ld" | "st" | "mask" | "br" | "sys";

/** The instruction `step()` ran last: where it was, the mask it ran under, what it cost, and the bank loads of a vld / vst. */
export interface GpuStep {
  pc: number;
  name: string;
  kind: GpuStepKind;
  /** The execution mask the instruction ran under (before it changed it). */
  mask: number;
  cost: number;
  /** Distinct addresses per bank for a vld / vst, else null. */
  banks: number[] | null;
  /** The vector register the instruction writes (ALU work and loads), else null. */
  dest: number | null;
  /** The fields below are set by the engines; fixtures may leave them out. The raw instruction word. */
  word?: number;
  /** The execution mask after the instruction, and the mask stack depth after it. */
  maskAfter?: number;
  stackDepth?: number;
  /** The card cycle the instruction issued in (cycles elapsed since the launch started running). */
  startCycle?: number;
  /** Which SM and warp ran it (0, 0 on the unpipelined unit). */
  sm?: number;
  warp?: number;
  /** Why it took more than one cycle: a memory bank conflict, else null. */
  stall?: GpuStall | null;
  /** What a vld / vst touched in card memory, for the card's memory view. */
  mem?: GpuMemTouch;
  /** The vector register values the instruction read and wrote, one word per lane of its unit (lane `lane0 + n`): `a` and `b` the source registers as they were, `d` the destination after. */
  vals?: { a?: number[]; b?: number[]; d?: number[] };
  lane0?: number;
}

/** The words a vld / vst moved, as the card memory held them when it ran. */
export interface GpuMemTouch {
  /** Byte address and word moved for each active lane (same order). */
  addrs: number[];
  data: number[];
  /** The words of memory around the first address (`GPU_AROUND` of them from byte address `at`), after the instruction. */
  at: number;
  around: number[];
}

/** Words of card memory a popup shows around the address an instruction touched. */
export const GPU_AROUND = 9;

/** Why an instruction (or a warp) lost cycles: memory bank conflicts, a pending load, a barrier. */
export type GpuStall = "bank" | "mem" | "barrier";

const MASK_OPS = new Set(["mseteq", "msetne", "msetlt", "msetge", "mpush", "melse", "mpop"]);
const stepKind = (name: string): GpuStepKind =>
  name === "vld" ? "ld" : name === "vst" ? "st" : MASK_OPS.has(name) ? "mask" : name === "bany" || name === "jmp" ? "br" : name === "bar" || name === "halt" ? "sys" : "alu";

export class GpuRef {
  readonly lanes: number;
  readonly banks: number;
  /** Card memory as words. */
  readonly mem: Uint32Array;
  /** Vector registers: `regs[r][lane]`. */
  readonly regs: Int32Array[];
  /** Execution mask, bit n = lane n active. */
  mask = 0;
  readonly stack: number[] = [];
  pc = 0;
  halted = false;
  cycles = 0;
  instructions = 0;
  /** Cycles lost to bank conflicts (already inside `cycles`). */
  conflictCycles = 0;
  /** Lanes that were idle on the instructions run so far (divergence), summed over instructions. */
  idleLaneSlots = 0;
  /** The instruction the last `step()` ran (null before the first). */
  lastStep: GpuStep | null = null;
  /** Byte addresses the active lanes of the last vld / vst touched (empty for other instructions). */
  lastAddrs: number[] = [];
  private readonly laneBase: number;

  private readonly all: number;

  constructor(cfg: GpuRefConfig) {
    if (!Number.isInteger(cfg.lanes) || cfg.lanes < 1 || cfg.lanes > 32) throw new RangeError(`bad lane count ${cfg.lanes}`);
    if (!cfg.mem && (cfg.memBytes % 4 !== 0 || cfg.memBytes < 4)) throw new RangeError(`bad card memory size ${cfg.memBytes}`);
    this.lanes = cfg.lanes;
    this.banks = Math.max(1, cfg.banks);
    this.mem = cfg.mem ?? new Uint32Array(cfg.memBytes / 4);
    this.laneBase = cfg.laneBase ?? 0;
    this.regs = Array.from({ length: GPU_REG_COUNT }, () => new Int32Array(cfg.lanes));
    this.all = cfg.lanes === 32 ? 0xffffffff : (1 << cfg.lanes) - 1;
    this.reset();
  }

  /** Registers zero, every lane active, pc and the counters back at the start. Memory is left as it is. */
  reset(pc = 0, activeLanes = this.lanes): void {
    for (const r of this.regs) r.fill(0);
    this.mask = (activeLanes >= 32 ? 0xffffffff : (1 << activeLanes) - 1) >>> 0;
    this.stack.length = 0;
    this.pc = pc;
    this.halted = false;
    this.cycles = this.instructions = this.conflictCycles = this.idleLaneSlots = 0;
    this.lastStep = null;
    this.lastAddrs = [];
  }

  /** Copy words into card memory at a byte address. */
  load(words: ArrayLike<number>, at = 0): void {
    if (at % 4 !== 0 || at < 0 || at / 4 + words.length > this.mem.length) throw new RangeError(`load of ${words.length} words at ${at} does not fit`);
    for (let k = 0; k < words.length; k++) this.mem[at / 4 + k] = words[k]! >>> 0;
  }

  private popcount(m: number): number {
    let n = 0;
    for (let x = m >>> 0; x; x &= x - 1) n++;
    return n;
  }

  private fetch(): GpuInstr {
    if (this.pc % 4 !== 0 || this.pc < 0 || this.pc / 4 >= this.mem.length) throw new GpuFault(this.pc, "instruction fetch outside card memory");
    const i = gpuDecode(this.mem[this.pc / 4]!);
    if (!i) throw new GpuFault(this.pc, `illegal instruction 0x${this.mem[this.pc / 4]!.toString(16)}`);
    return i;
  }

  /** Run one instruction. No-op once halted. */
  step(): void {
    if (this.halted) return;
    const i = this.fetch();
    const word = this.mem[this.pc / 4]!;
    this.lastAddrs = [];
    const startCycle = this.cycles;
    const R = this.regs;
    const L = this.lanes;
    const mask = this.mask;
    const active = (l: number): boolean => ((mask >>> l) & 1) === 1;
    let cost = 1;
    let banks: number[] | null = null;
    let touch: GpuMemTouch | undefined;
    const fmt = GPU_SPEC_BY_NAME.get(i.name)?.fmt;
    const usesA = fmt === "R" || fmt === "M" || fmt === "S" || (fmt === "I" && i.name !== "vli"), usesB = fmt === "R" || fmt === "M" || fmt === "S";
    const srcA = usesA ? Array.from(this.regs[i.rs1]!) : undefined, srcB = usesB ? Array.from(this.regs[i.rs2]!) : undefined;
    let next = this.pc + 4;

    const alu = (f: (a: number, b: number) => number, bFrom: "reg" | "imm"): void => {
      for (let l = 0; l < L; l++) if (active(l)) R[i.rd]![l] = f(R[i.rs1]![l]!, bFrom === "reg" ? R[i.rs2]![l]! : i.imm) | 0;
    };
    const setMask = (cmp: (a: number, b: number) => boolean): void => {
      let m = 0;
      for (let l = 0; l < L; l++) if (active(l) && cmp(R[i.rs1]![l]!, R[i.rs2]![l]!)) m |= 1 << l;
      this.mask = m >>> 0;
    };
    const addrOf = (l: number): number => {
      const a = (R[i.rs1]![l]! + i.imm) | 0;
      if (a % 4 !== 0 || a < 0 || a / 4 >= this.mem.length) throw new GpuFault(this.pc, `lane ${l}: ${i.name} at 0x${(a >>> 0).toString(16)} is outside card memory or misaligned`);
      return a;
    };
    const top = (): number => {
      const t = this.stack[this.stack.length - 1];
      if (t === undefined) throw new GpuFault(this.pc, `${i.name} with an empty mask stack`);
      return t;
    };

    switch (i.name) {
      case "vadd": alu((a, b) => a + b, "reg"); break;
      case "vsub": alu((a, b) => a - b, "reg"); break;
      case "vand": alu((a, b) => a & b, "reg"); break;
      case "vor": alu((a, b) => a | b, "reg"); break;
      case "vxor": alu((a, b) => a ^ b, "reg"); break;
      case "vsll": alu((a, b) => a << (b & 31), "reg"); break;
      case "vsrl": alu((a, b) => a >>> (b & 31), "reg"); break;
      case "vsra": alu((a, b) => a >> (b & 31), "reg"); break;
      case "vslt": alu((a, b) => (a < b ? 1 : 0), "reg"); break;
      case "vmul": alu((a, b) => Math.imul(a, b), "reg"); break;
      case "vmin": alu((a, b) => Math.min(a, b), "reg"); break;
      case "vmax": alu((a, b) => Math.max(a, b), "reg"); break;
      case "vaddi": alu((a, b) => a + b, "imm"); break;
      case "vandi": alu((a, b) => a & b, "imm"); break;
      case "vslli": alu((a, b) => a << b, "imm"); break;
      case "vsrli": alu((a, b) => a >>> b, "imm"); break;
      case "vsrai": alu((a, b) => a >> b, "imm"); break;
      case "vli": for (let l = 0; l < L; l++) if (active(l)) R[i.rd]![l] = i.imm; break;
      case "lane": for (let l = 0; l < L; l++) if (active(l)) R[i.rd]![l] = l + this.laneBase; break;
      case "vld":
      case "vst": {
        const addrs: number[] = [];
        for (let l = 0; l < L; l++) {
          if (!active(l)) continue;
          const a = addrOf(l);
          addrs.push(a);
          if (i.name === "vld") R[i.rd]![l] = this.mem[a >>> 2]! | 0;
          else this.mem[a >>> 2] = R[i.rs2]![l]! >>> 0;
        }
        this.lastAddrs = addrs;
        if (addrs.length > 0) {
          const first = Math.max(0, Math.min(((addrs[0]! >>> 2) - (GPU_AROUND >> 1)), this.mem.length - GPU_AROUND));
          const data = addrs.map((a) => this.mem[a >>> 2]! | 0);
          touch = { addrs: [...addrs], data, at: first * 4, around: Array.from(this.mem.subarray(first, first + GPU_AROUND)) };
        }
        banks = bankLoad(addrs, this.banks);
        cost = Math.max(1, ...banks);
        this.conflictCycles += cost - 1;
        break;
      }
      case "mseteq": setMask((a, b) => a === b); break;
      case "msetne": setMask((a, b) => a !== b); break;
      case "msetlt": setMask((a, b) => a < b); break;
      case "msetge": setMask((a, b) => a >= b); break;
      case "mpush":
        if (this.stack.length >= GPU_MASK_DEPTH) throw new GpuFault(this.pc, "mask stack overflow");
        this.stack.push(mask);
        break;
      case "mpop": top(); this.mask = this.stack.pop()!; break;
      case "melse": this.mask = (top() & ~mask & this.all) >>> 0; break;
      case "bar": break;
      case "bany": if (mask !== 0) next = this.pc + i.imm; break;
      case "jmp": next = this.pc + i.imm; break;
      case "halt": this.halted = true; next = this.pc; break;
    }
    this.idleLaneSlots += L - this.popcount(mask);
    const kind = stepKind(i.name);
    this.lastStep = { pc: this.pc, name: i.name, kind, mask, cost, banks, dest: kind === "alu" || kind === "ld" ? i.rd : null,
      word, maskAfter: this.mask, stackDepth: this.stack.length, startCycle, sm: 0, warp: 0, stall: cost > 1 ? "bank" : null, ...(touch ? { mem: touch } : {}),
      vals: { ...(srcA ? { a: srcA } : {}), ...(srcB ? { b: srcB } : {}), ...(kind === "alu" || kind === "ld" ? { d: Array.from(this.regs[i.rd]!) } : {}) }, lane0: this.laneBase };
    this.cycles += cost;
    this.instructions++;
    this.pc = next;
  }

  /** Run until `halt`. Throws if it takes more than `maxInstructions` (a kernel stuck in a loop). */
  run(maxInstructions = 5_000_000): void {
    while (!this.halted) {
      if (this.instructions >= maxInstructions) throw new GpuFault(this.pc, `no halt after ${maxInstructions} instructions`);
      this.step();
    }
  }

  /** Words of card memory from a byte address, as signed numbers. */
  read(at: number, n: number): number[] {
    return Array.from(this.mem.subarray(at / 4, at / 4 + n), (w) => w | 0);
  }
}
