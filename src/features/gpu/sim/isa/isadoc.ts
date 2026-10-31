// The GPU's instruction set in words, for the almanac and the Trace panel (docs/GPU.md "The kernel"): what each instruction does, in the order the
// reference card (src/sim/ref/gpuref.ts) does it. Every instruction acts on the lanes the execution mask has on; the others keep their registers.

import { GPU_OPS } from "./isa";

export type GpuOpGroup = "arith" | "logic" | "shift" | "compare" | "memory" | "mask" | "control";

export const GPU_GROUP_NAME: Record<GpuOpGroup, string> = {
  arith: "Arithmetic", logic: "Logic", shift: "Shifts", compare: "Compare", memory: "Card memory", mask: "Execution mask", control: "Control",
};

export interface GpuOpDoc { group: GpuOpGroup; /** The form as it is written. */ form: string; /** What it does, in a line. */ text: string }

export const GPU_OP_DOC: Record<string, GpuOpDoc> = {
  vadd: { group: "arith", form: "vadd vd, va, vb", text: "vd = va + vb in every active lane." },
  vsub: { group: "arith", form: "vsub vd, va, vb", text: "vd = va - vb." },
  vmul: { group: "arith", form: "vmul vd, va, vb", text: "vd = va * vb, the low 32 bits." },
  vmin: { group: "arith", form: "vmin vd, va, vb", text: "vd = the smaller of va and vb (signed)." },
  vmax: { group: "arith", form: "vmax vd, va, vb", text: "vd = the larger of va and vb (signed)." },
  vaddi: { group: "arith", form: "vaddi vd, va, imm", text: "vd = va + a constant." },
  vli: { group: "arith", form: "vli vd, imm", text: "Load a constant into vd in every active lane." },
  lane: { group: "arith", form: "lane vd", text: "vd = the lane's own number (0, 1, 2...): what makes lanes do different work." },
  vand: { group: "logic", form: "vand vd, va, vb", text: "vd = va AND vb, bit by bit." },
  vor: { group: "logic", form: "vor vd, va, vb", text: "vd = va OR vb." },
  vxor: { group: "logic", form: "vxor vd, va, vb", text: "vd = va XOR vb." },
  vandi: { group: "logic", form: "vandi vd, va, imm", text: "vd = va AND a constant (a mask of bits)." },
  vsll: { group: "shift", form: "vsll vd, va, vb", text: "vd = va shifted left by vb (0..31) bits." },
  vsrl: { group: "shift", form: "vsrl vd, va, vb", text: "vd = va shifted right by vb bits, filling with zeros." },
  vsra: { group: "shift", form: "vsra vd, va, vb", text: "vd = va shifted right by vb bits, keeping the sign." },
  vslli: { group: "shift", form: "vslli vd, va, n", text: "vd = va shifted left by a constant n (0..31)." },
  vsrli: { group: "shift", form: "vsrli vd, va, n", text: "vd = va shifted right by n, filling with zeros." },
  vsrai: { group: "shift", form: "vsrai vd, va, n", text: "vd = va shifted right by n, keeping the sign." },
  vslt: { group: "compare", form: "vslt vd, va, vb", text: "vd = 1 where va < vb (signed), else 0." },
  vld: { group: "memory", form: "vld vd, off(va)", text: "Each active lane reads the word at va + off from card memory. Lanes that hit the same bank wait for each other." },
  vst: { group: "memory", form: "vst vs, off(va)", text: "Each active lane writes vs to card memory at va + off. Bank conflicts cost cycles, as for a load." },
  mseteq: { group: "mask", form: "mseteq va, vb", text: "Keep only the active lanes where va = vb: the mask for an if." },
  msetne: { group: "mask", form: "msetne va, vb", text: "Keep only the active lanes where va != vb." },
  msetlt: { group: "mask", form: "msetlt va, vb", text: "Keep only the active lanes where va < vb." },
  msetge: { group: "mask", form: "msetge va, vb", text: "Keep only the active lanes where va >= vb." },
  mpush: { group: "mask", form: "mpush", text: "Save the current mask on the mask stack (8 deep) before a branch narrows it." },
  melse: { group: "mask", form: "melse", text: "Turn on the lanes the saved mask had on and the if did not: the else side." },
  mpop: { group: "mask", form: "mpop", text: "Restore the saved mask: the lanes come back together." },
  bar: { group: "control", form: "bar", text: "Barrier: every warp of the SM waits here until all have arrived." },
  bany: { group: "control", form: "bany label", text: "Jump to the label if any lane is still active: how a loop ends once every lane is done." },
  jmp: { group: "control", form: "jmp label", text: "Jump to the label." },
  halt: { group: "control", form: "halt", text: "End the kernel; the card reports done." },
};

/** The groups in the order a reference lists them. */
export const GPU_GROUP_ORDER: readonly GpuOpGroup[] = ["arith", "logic", "shift", "compare", "memory", "mask", "control"];

/** Every instruction of the ISA, in the order of its opcode table, for the reference. */
export const gpuOpNames = (): string[] => GPU_OPS.map((o) => o.name);
