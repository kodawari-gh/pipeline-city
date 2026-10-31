import { describe, expect, it } from "vitest";
import { decode, disassemble, encode, instr, OPS, parseReg, REG_NAMES, type Instr } from "./index";

/** Sample operands per format, including extremes. */
function samples(fmt: string, name: string): Instr[] {
  const regs = [[0, 0, 0], [1, 2, 3], [15, 14, 13], [5, 15, 0]];
  const out: Instr[] = [];
  for (const [rd, rs1, rs2] of regs) {
    switch (fmt) {
      case "N": out.push(instr(name)); break;
      case "R": out.push(instr(name, { rd, rs1, rs2 })); break;
      case "I": {
        const imms = name.startsWith("s") && name.endsWith("i") && name !== "slti" && name !== "sltiu" ? [0, 1, 31] : [0, 1, -1, 65535, -65536];
        for (const imm of imms) out.push(instr(name, { rd, rs1, imm }));
        break;
      }
      case "S": for (const imm of [0, 4, -1, 65535, -65536]) out.push(instr(name, { rs1, rs2, imm })); break;
      case "B": for (const imm of [0, 4, -4, 65532, -65536]) out.push(instr(name, { rs1, rs2, imm })); break;
      case "U": for (const imm of [0, 1, 0x1fffff, 0x100000]) out.push(instr(name, { rd, imm })); break;
      case "J": for (const imm of [0, 4, -4, 0xffffc, -0x100000]) out.push(instr(name, { rd, imm })); break;
    }
  }
  return out;
}

describe("encode/decode", () => {
  it("has unique opcodes and names", () => {
    expect(new Set(OPS.map((o) => o.op)).size).toBe(OPS.length);
    expect(new Set(OPS.map((o) => o.name)).size).toBe(OPS.length);
  });

  for (const spec of OPS) {
    it(`round-trips ${spec.name}`, () => {
      for (const i of samples(spec.fmt, spec.name)) {
        const w = encode(i);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThan(2 ** 32);
        expect(decode(w)).toEqual(i);
      }
    });
  }

  it("rejects out-of-range fields", () => {
    expect(() => encode(instr("addi", { imm: 65536 }))).toThrow(RangeError);
    expect(() => encode(instr("addi", { rd: 16 }))).toThrow(RangeError);
    expect(() => encode(instr("slli", { imm: 32 }))).toThrow(RangeError);
    expect(() => encode(instr("beq", { imm: 2 }))).toThrow(RangeError);
    expect(() => encode(instr("jal", { imm: 0x100000 }))).toThrow(RangeError);
    expect(() => encode(instr("nope"))).toThrow(RangeError);
  });

  it("decodes illegal opcodes to null", () => {
    expect(decode(0)).toBeNull();
    expect(disassemble(0xffffffff)).toBe(".word 0xffffffff");
  });

  it("names registers", () => {
    expect(REG_NAMES.length).toBe(16);
    expect(parseReg("sp")).toBe(2);
    expect(parseReg("x15")).toBe(15);
    expect(parseReg("x16")).toBe(-1);
    expect(parseReg("foo")).toBe(-1);
  });
});
