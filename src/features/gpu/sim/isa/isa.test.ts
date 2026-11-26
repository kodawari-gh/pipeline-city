import { describe, expect, it } from 'vitest';
import { assembleGpu } from './asm';
import { AsmError } from '@/features/cpu/sim/asm/assemble';
import * as isa from './isa';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

type Regs = readonly [rd: number, rs1: number, rs2: number];

/** Register triples the samples use, including extremes. */
const SAMPLE_REGS: readonly Regs[] = [
  [0, 0, 0],
  [1, 2, 3],
  [7, 6, 5],
  [5, 7, 0],
];

/** The sample instructions of one format for one register triple. */
const BY_FORMAT: Record<string, (name: string, regs: Regs, shift: boolean) => isa.GpuInstr[]> = {
  N: (name) => [isa.gpuInstr(name)],
  R: (name, [rd, rs1, rs2]) => [isa.gpuInstr(name, { rd, rs1, rs2 })],
  // vli has no source register
  I: (name, [rd, rs1], shift) =>
    (shift ? [0, 1, 31] : [0, 1, -1, 65_535, -65_536]).map((imm) =>
      isa.gpuInstr(name, { rd, rs1: name === 'vli' ? 0 : rs1, imm }),
    ),
  D: (name, [rd]) => [isa.gpuInstr(name, { rd })],
  S: (name, [, rs1, rs2]) => [0, 4, -1, 65_535, -65_536].map((imm) => isa.gpuInstr(name, { rs1, rs2, imm })),
  M: (name, [, rs1, rs2]) => [isa.gpuInstr(name, { rs1, rs2 })],
  O: (name) => [0, 4, -4, 0xf_ff_fc, -0x10_00_00].map((imm) => isa.gpuInstr(name, { imm })),
};

/** Sample operands per format, including extremes. */
function samples(fmt: string, name: string, shift?: boolean): isa.GpuInstr[] {
  const make = BY_FORMAT[fmt];
  if (!make) {
    return [];
  }
  return SAMPLE_REGS.flatMap((regs) => make(name, regs, shift === true));
}

describe('GPU ISA encode/decode', () => {
  it('has unique opcodes and names', () => {
    expect(new Set(isa.GPU_OPS.map((o) => o.op)).size).toBe(isa.GPU_OPS.length);
    expect(new Set(isa.GPU_OPS.map((o) => o.name)).size).toBe(isa.GPU_OPS.length);
  });

  it.each(isa.GPU_OPS)('round-trips $name through the encoding, the disassembler and the assembler', (spec) => {
    for (const i of samples(spec.fmt, spec.name, spec.shift)) {
      const w = isa.gpuEncode(i);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThan(2 ** 32);
      expect(isa.gpuDecode(w)).toStrictEqual(i);
      // text round trip: disassemble, assemble, same word
      expect(assembleGpu(isa.gpuDisassemble(w)).program[0]).toBe(w);
    }
  });

  it('rejects out-of-range fields', () => {
    expect(() => isa.gpuEncode(isa.gpuInstr('vaddi', { imm: 65_536 }))).toThrow(RangeError);
    expect(() => isa.gpuEncode(isa.gpuInstr('vadd', { rd: 8 }))).toThrow(RangeError);
    expect(() => isa.gpuEncode(isa.gpuInstr('vslli', { imm: 32 }))).toThrow(RangeError);
    expect(() => isa.gpuEncode(isa.gpuInstr('bany', { imm: 2 }))).toThrow(RangeError);
    expect(() => isa.gpuEncode(isa.gpuInstr('jmp', { imm: 0x10_00_00 }))).toThrow(RangeError);
    expect(() => isa.gpuEncode(isa.gpuInstr('add'))).toThrow(RangeError); // a CPU opcode
  });

  it('decodes illegal opcodes and out-of-range registers to null', () => {
    expect(isa.gpuDecode(0)).toBeNull();
    const vadd = isa.gpuEncode(isa.gpuInstr('vadd'));
    expect(isa.gpuDecode(vadd | (9 << 7))).toBeNull(); // rd = v9
    expect(isa.gpuDisassemble(0xff_ff_ff_fe)).toBe('.word 0xfffffffe');
  });

  it('names the vector registers', () => {
    expect(isa.parseVReg('v0')).toBe(0);
    expect(isa.parseVReg('v7')).toBe(7);
    expect(isa.parseVReg('v8')).toBe(-1);
    expect(isa.parseVReg('a0')).toBe(-1);
  });
});

describe('GPU assembler', () => {
  it('assembles labels, forward and backward branches, comments and the vmv pseudo-op', () => {
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
    expect(program).toHaveLength(9);
    expect(symbols.get('loop')).toBe(12);
    expect(isa.gpuDecode(must(program[5]))).toMatchObject({ name: 'bany', imm: -8 });
    expect(isa.gpuDecode(must(program[6]))).toMatchObject({ name: 'jmp', imm: 8 });
    expect(isa.gpuDecode(must(program[2]))).toMatchObject({ name: 'vaddi', rd: 3, rs1: 2, imm: 0 });
  });

  it('reports the line of an error', () => {
    expect(() => assembleGpu('vli v1, 1\nvadd v1, v2')).toThrow(AsmError);
    expect(() => assembleGpu('vli v1, 1\nvadd v1, v2')).toThrow(/line 2/u);
    expect(() => assembleGpu('nope v1')).toThrow(/unknown GPU instruction/u);
    expect(() => assembleGpu('vli v9, 1')).toThrow(/vector register/u);
    expect(() => assembleGpu('bany nowhere')).toThrow(/bad target/u);
    expect(() => assembleGpu('a: halt\na: halt')).toThrow(/duplicate label/u);
    expect(() => assembleGpu('vld v1, 4(v2)\nvst v1, (v2)')).not.toThrow();
  });
});
