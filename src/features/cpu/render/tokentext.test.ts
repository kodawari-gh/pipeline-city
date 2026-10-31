import { describe, expect, it } from 'vitest';
import { assemble } from '../sim/asm';
import { fieldsOf, idColor, pcText, readsOf, seqText, slotValues, writesOf } from './tokentext';

// What the die shows of one instruction (docs/DIE.md "Instructions on the die").
const word = (src: string) => { const p = assemble(src).program; return new DataView(p.buffer, p.byteOffset).getUint32(0, true) >>> 0; };
const regs = Array.from({ length: 16 }, (_, k) => k * 10);

describe('token text', () => {
  const add = word('add t4, t1, t2'), lw = word('lw a0, 8(t2)'), sw = word('sw t1, 4(sp)'), bne = word('loop:\nbne t0, t1, loop');

  it('knows what an instruction reads and writes', () => {
    expect(readsOf(add)).toEqual([8, 9]);
    expect(writesOf(add)).toBe(11);
    expect(readsOf(lw)).toEqual([9]);
    expect(writesOf(sw)).toBe(-1);
    expect(writesOf(bne)).toBe(-1);
  });

  it('splits a word into the decoder slots', () => {
    expect(fieldsOf(add).map((f) => f.name)).toEqual(['op', 'rd', 'rs1', 'rs2']);
    expect(fieldsOf(lw).map((f) => f.name)).toEqual(['op', 'rd', 'rs1', 'imm']);
    expect(fieldsOf(bne).map((f) => f.name)).toEqual(['op', 'rs1', 'rs2', 'imm']);
    expect(slotValues(add)).toEqual(['add', 't4', 't1', 't2', '']);
    expect(slotValues(lw)).toEqual(['lw', 'a0', 't2', '', '8']);
    expect(slotValues(bne).slice(0, 4)).toEqual(['bne', '', 't0', 't1']);
  });

  it('gives every instruction its address and number, and a colour of its own', () => {
    expect(pcText(0xc5a0)).toBe('@c5a0');
    expect(seqText(412)).toBe('#412');
    expect(idColor(1, true)).not.toBe(idColor(2, true));
    expect(idColor(7, true)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
