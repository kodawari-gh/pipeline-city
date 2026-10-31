// Assembler for the GPU ISA (src/sim/isa/gpu.ts). Same syntax rules as the CPU's: `#` or `;` comments, `label:`, numbers
// in decimal / 0x / 0b / 'c'. Branch targets are labels (made relative to the instruction) or raw byte offsets.

import { gpuEncode, gpuInstr, GPU_SPEC_BY_NAME, parseVReg, type GpuInstr } from "./isa";
import { AsmError, LABEL_RE, parseNum, splitOps, stripComment } from "../../cpu/sim/asm/assemble";

export interface GpuAsmResult {
  /** The kernel as little-endian words, ready to copy into card memory. */
  program: Uint32Array;
  /** Label -> byte offset in the kernel. */
  symbols: Map<string, number>;
}

/** One real instruction per line, plus the pseudo-instruction `vmv vd, vs` (copy). */
export function assembleGpu(src: string): GpuAsmResult {
  const symbols = new Map<string, number>();
  const items: { line: number; mnem: string; ops: string[] }[] = [];
  src.split(/\r?\n/).forEach((raw, n) => {
    let text = stripComment(raw).trim();
    for (;;) {
      const m = /^([A-Za-z_.][\w.]*)\s*:\s*(.*)$/.exec(text);
      if (!m) break;
      if (symbols.has(m[1]!)) throw new AsmError(n + 1, `duplicate label '${m[1]}'`);
      symbols.set(m[1]!, items.length * 4);
      text = m[2]!;
    }
    if (text === "") return;
    const sp = text.search(/\s/);
    const mnem = (sp < 0 ? text : text.slice(0, sp)).toLowerCase();
    if (!GPU_SPEC_BY_NAME.has(mnem) && mnem !== "vmv") throw new AsmError(n + 1, `unknown GPU instruction '${mnem}'`);
    items.push({ line: n + 1, mnem, ops: sp < 0 ? [] : splitOps(text.slice(sp + 1).trim()) });
  });

  const program = new Uint32Array(items.length);
  items.forEach(({ line, mnem, ops }, k) => {
    const pc = k * 4;
    const reg = (s: string | undefined): number => {
      const r = s === undefined ? -1 : parseVReg(s);
      if (r < 0) throw new AsmError(line, `${mnem}: '${s ?? ""}' is not a vector register (v0..v7)`);
      return r;
    };
    const num = (s: string | undefined): number => {
      const v = s === undefined ? null : parseNum(s);
      if (v === null) throw new AsmError(line, `${mnem}: '${s ?? ""}' is not a number`);
      return v;
    };
    const arity = (n: number): void => { if (ops.length !== n) throw new AsmError(line, `${mnem} takes ${n} operand(s), got ${ops.length}`); };
    const target = (s: string | undefined): number => {
      const v = s === undefined ? null : parseNum(s);
      if (v !== null) return v;
      if (s !== undefined && LABEL_RE.test(s) && symbols.has(s)) return symbols.get(s)! - pc;
      throw new AsmError(line, `${mnem}: bad target '${s ?? ""}'`);
    };
    const memOp = (s: string | undefined): { imm: number; rs1: number } => {
      const m = s === undefined ? null : /^(.*)\(\s*(\w+)\s*\)$/.exec(s);
      if (!m) throw new AsmError(line, `${mnem}: expected imm(vreg), got '${s ?? ""}'`);
      const t = m[1]!.trim();
      return { imm: t === "" ? 0 : num(t), rs1: reg(m[2]) };
    };
    let i: GpuInstr;
    if (mnem === "vmv") {
      arity(2);
      i = gpuInstr("vaddi", { rd: reg(ops[0]), rs1: reg(ops[1]) });
    } else {
      const spec = GPU_SPEC_BY_NAME.get(mnem)!;
      switch (spec.fmt) {
        case "N": arity(0); i = gpuInstr(mnem); break;
        case "R": arity(3); i = gpuInstr(mnem, { rd: reg(ops[0]), rs1: reg(ops[1]), rs2: reg(ops[2]) }); break;
        case "I":
          if (spec.mem) { arity(2); const m = memOp(ops[1]); i = gpuInstr(mnem, { rd: reg(ops[0]), rs1: m.rs1, imm: m.imm }); }
          else if (mnem === "vli") { arity(2); i = gpuInstr(mnem, { rd: reg(ops[0]), imm: num(ops[1]) }); }
          else { arity(3); i = gpuInstr(mnem, { rd: reg(ops[0]), rs1: reg(ops[1]), imm: num(ops[2]) }); }
          break;
        case "D": arity(1); i = gpuInstr(mnem, { rd: reg(ops[0]) }); break;
        case "S": { arity(2); const m = memOp(ops[1]); i = gpuInstr(mnem, { rs2: reg(ops[0]), rs1: m.rs1, imm: m.imm }); break; }
        case "M": arity(2); i = gpuInstr(mnem, { rs1: reg(ops[0]), rs2: reg(ops[1]) }); break;
        case "O": arity(1); i = gpuInstr(mnem, { imm: target(ops[0]) }); break;
      }
    }
    try {
      program[k] = gpuEncode(i);
    } catch (e) {
      if (e instanceof RangeError) throw new AsmError(line, e.message);
      throw e;
    }
  });
  return { program, symbols };
}
