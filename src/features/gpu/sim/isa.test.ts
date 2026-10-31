import { describe, expect, it } from "vitest";
import { assembleGpu } from "./asm";
import { AsmError } from "../../cpu/sim/asm/assemble";
import { GPU_OPS, gpuDecode, gpuDisassemble, gpuEncode, gpuInstr, parseVReg, type GpuInstr } from "./isa";

/** Sample operands per format, including extremes. */
function samples(fmt: string, name: string, shift?: boolean): GpuInstr[] {
  const out: GpuInstr[] = [];
  for (const [rd, rs1, rs2] of [[0, 0, 0], [1, 2, 3], [7, 6, 5], [5, 7, 0]] as const) {
    switch (fmt) {
      case "N": out.push(gpuInstr(name)); break;
      case "R": out.push(gpuInstr(name, { rd, rs1, rs2 })); break;
      case "I": for (const imm of shift ? [0, 1, 31] : [0, 1, -1, 65535, -65536]) out.push(gpuInstr(name, { rd, rs1: name === "vli" ? 0 : rs1, imm })); // vli has no source register break;
      case "D": out.push(gpuInstr(name, { rd })); break;
      case "S": for (const imm of [0, 4, -1, 65535, -65536]) out.push(gpuInstr(name, { rs1, rs2, imm })); break;
      case "M": out.push(gpuInstr(name, { rs1, rs2 })); break;
      case "O": for (const imm of [0, 4, -4, 0xffffc, -0x100000]) out.push(gpuInstr(name, { imm })); break;
    }
  }
  return out;
}

describe("GPU ISA encode/decode", () => {
  it("has unique opcodes and names", () => {
    expect(new Set(GPU_OPS.map((o) => o.op)).size).toBe(GPU_OPS.length);
    expect(new Set(GPU_OPS.map((o) => o.name)).size).toBe(GPU_OPS.length);
  });

  for (const spec of GPU_OPS) {
    it(`round-trips ${spec.name} through the encoding, the disassembler and the assembler`, () => {
      for (const i of samples(spec.fmt, spec.name, spec.shift)) {
        const w = gpuEncode(i);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThan(2 ** 32);
        expect(gpuDecode(w)).toEqual(i);
        // text round trip: disassemble, assemble, same word
        expect(assembleGpu(gpuDisassemble(w)).program[0]).toBe(w);
      }
    });
  }

  it("rejects out-of-range fields", () => {
    expect(() => gpuEncode(gpuInstr("vaddi", { imm: 65536 }))).toThrow(RangeError);
    expect(() => gpuEncode(gpuInstr("vadd", { rd: 8 }))).toThrow(RangeError);
    expect(() => gpuEncode(gpuInstr("vslli", { imm: 32 }))).toThrow(RangeError);
    expect(() => gpuEncode(gpuInstr("bany", { imm: 2 }))).toThrow(RangeError);
    expect(() => gpuEncode(gpuInstr("jmp", { imm: 0x100000 }))).toThrow(RangeError);
    expect(() => gpuEncode(gpuInstr("add"))).toThrow(RangeError); // a CPU opcode
  });

  it("decodes illegal opcodes and out-of-range registers to null", () => {
    expect(gpuDecode(0)).toBeNull();
    expect(gpuDecode(gpuEncode(gpuInstr("vadd")) | (9 << 7))).toBeNull(); // rd = v9
    expect(gpuDisassemble(0xfffffffe)).toBe(".word 0xfffffffe");
  });

  it("names the vector registers", () => {
    expect(parseVReg("v0")).toBe(0);
    expect(parseVReg("v7")).toBe(7);
    expect(parseVReg("v8")).toBe(-1);
    expect(parseVReg("a0")).toBe(-1);
  });
});

describe("GPU assembler", () => {
  it("assembles labels, forward and backward branches, comments and the vmv pseudo-op", () => {
    const { program, symbols } = assembleGpu(`
      start: lane v1          # lane ids
             vli v2, 3
             vmv v3, v2       ; copy
      loop:  vaddi v2, v2, -1
             msetne v2, v0
             bany loop
             jmp end
             vadd v1, v1, v1
      end:   halt
    `);
    expect(program.length).toBe(9);
    expect(symbols.get("loop")).toBe(12);
    expect(gpuDecode(program[5]!)).toMatchObject({ name: "bany", imm: -8 });
    expect(gpuDecode(program[6]!)).toMatchObject({ name: "jmp", imm: 8 });
    expect(gpuDecode(program[2]!)).toMatchObject({ name: "vaddi", rd: 3, rs1: 2, imm: 0 });
  });

  it("reports the line of an error", () => {
    expect(() => assembleGpu("vli v1, 1\nvadd v1, v2")).toThrow(AsmError);
    expect(() => assembleGpu("vli v1, 1\nvadd v1, v2")).toThrow(/line 2/);
    expect(() => assembleGpu("nope v1")).toThrow(/unknown GPU instruction/);
    expect(() => assembleGpu("vli v9, 1")).toThrow(/vector register/);
    expect(() => assembleGpu("bany nowhere")).toThrow(/bad target/);
    expect(() => assembleGpu("a: halt\na: halt")).toThrow(/duplicate label/);
    expect(() => assembleGpu("vld v1, 4(v2)\nvst v1, (v2)")).not.toThrow();
  });
});
