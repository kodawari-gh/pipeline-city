import { describe, expect, it } from 'vitest';
import { assemble, AsmError } from './index';
import { decode, disassemble, OPS } from '../isa';
import type * as isaTypes from '../isa';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** One line of assembly per instruction format, with operands that fit the instruction. */
const SAMPLE_LINE: Record<isaTypes.OpSpec['fmt'], (o: isaTypes.OpSpec) => string> = {
  N: (o) => o.name,
  R: (o) => (o.amo === true ? `${o.name} a0, a2, (a1)` : `${o.name} a0, a1, a2`),
  I: (o) => (o.mem === true ? `${o.name} t0, -8(sp)` : `${o.name} s0, s1, 3`),
  S: (o) => `${o.name} a3, 12(t4)`,
  B: (o) => `${o.name} a0, a1, -8`,
  U: (o) => `${o.name} t1, 0x1abcd`,
  J: (o) => `${o.name} ra, 64`,
};

function err(src: string): AsmError {
  try {
    assemble(src);
  } catch (error) {
    if (error instanceof AsmError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected AsmError');
}

describe('assembler', () => {
  it('assembles labels, comments and pseudo-instructions', () => {
    const { program, symbols } = assemble(`
      start: li a0, 5      # comment
             mv a1, a0     ; other comment
             nop
      loop:  bne a0, zero, loop
             j start
             call start
             ret
    `);
    expect(program).toHaveLength(7);
    expect(symbols.get('start')).toBe(0);
    expect(symbols.get('loop')).toBe(12);
    expect(disassemble(must(program[0]))).toBe('addi a0, zero, 5');
    expect(disassemble(must(program[3]))).toBe('bne a0, zero, 0');
    expect(disassemble(must(program[4]))).toBe('jal zero, -16');
    expect(disassemble(must(program[5]))).toBe('jal ra, -20');
    expect(disassemble(must(program[6]))).toBe('jalr zero, ra, 0');
  });

  it('expands li to lui+addi only when needed', () => {
    expect(assemble('li a0, 65535').program).toHaveLength(1);
    expect(assemble('li a0, 65537').program).toHaveLength(2);
    expect(assemble('li a0, 0x40000000').program).toHaveLength(1); // lui only
    expect(assemble('li a0, -1').program).toHaveLength(1);
    expect(assemble('li a0, 0xdeadbeef').program).toHaveLength(2);
  });

  it('emits data directives', () => {
    const { program, symbols } = assemble(`
      msg: .string "Hi\\n"
      .align
      v: .word 0x11223344, msg
      b: .byte 1, 2, 255
    `);
    const bytes = new Uint8Array(program.buffer);
    expect(bytes.slice(0, 4)).toStrictEqual(new Uint8Array([72, 105, 10, 0]));
    expect(symbols.get('v')).toBe(4);
    expect(program[1]).toBe(0x11_22_33_44);
    expect(program[2]).toBe(0);
    expect(symbols.get('b')).toBe(12);
    expect(bytes.slice(12, 15)).toStrictEqual(new Uint8Array([1, 2, 255]));
    expect(program).toHaveLength(4); // padded to a word
  });

  it('honours origin for symbols', () => {
    expect(assemble('a: nop', { origin: 0x1_00 }).symbols.get('a')).toBe(0x1_00);
  });

  it('round-trips assemble -> disassemble -> assemble', () => {
    const src = OPS.map((o) => SAMPLE_LINE[o.fmt](o)).join('\n');
    const first = assemble(src).program;
    const text = [...first].map((w) => disassemble(w)).join('\n');
    const second = assemble(text).program;
    expect([...second]).toStrictEqual([...first]);
    expect(first).toHaveLength(OPS.length);
    expect([...first].every((w) => decode(w) !== null)).toBe(true);
  });

  it('reports errors with line numbers', () => {
    expect(err('nop\nfoo a0').message).toBe("line 2: unknown instruction 'foo'");
    expect(err('add a0, a1').line).toBe(1);
    expect(err('\n\nadd a0, a1, q9').message).toMatch(/^line 3: .*not a register/u);
    expect(err('x:\nx:').message).toBe("line 2: duplicate label 'x'");
    expect(err('j nowhere').message).toBe("line 1: undefined label 'nowhere'");
    expect(err('addi a0, a0, 70000').message).toMatch(/^line 1: .*out of 17-bit/u);
    expect(err('nop\nli a0, foo').line).toBe(2);
    expect(err('.string abc').message).toMatch(/quoted string/u);
    expect(err('.bogus 1').message).toMatch(/unknown directive/u);
    expect(err('.byte 1\nnop').message).toMatch(/line 2: misaligned/u);
    expect(err('lw a0, 4').message).toMatch(/imm\(reg\)/u);
    expect(err('.byte 300').message).toMatch(/out of range/u);
  });
});
