import { describe, expect, it } from 'vitest';
import { assemble } from '../sim/asm';
import { bodyOf, fieldsOf, idColor, pcText, readsOf, seqText, writesOf } from './tokentext';

// What an instruction's token shows at each stage (docs/DIE.md "The token").
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

  it('shows the raw word when fetched, the fields when decoded, the values when it executes', () => {
    expect(bodyOf('F', { word: add, regs }).text).toBe('0x' + add.toString(16).padStart(8, '0'));
    expect(fieldsOf(add).map((f) => f.name)).toEqual(['op', 'rd', 'rs1', 'rs2']);
    expect(fieldsOf(add)[0]!.value).toBe('add');
    expect(fieldsOf(lw).map((f) => f.name)).toEqual(['op', 'rd', 'rs1', 'imm']);
    expect(fieldsOf(bne).map((f) => f.name)).toEqual(['op', 'rs1', 'rs2', 'imm']);
    expect(bodyOf('X', { word: add, regs }).text).toBe('t1=80  t2=90');
    expect(bodyOf('X', { word: lw, regs }).text).toBe('t2=90  8');
  });

  it('shows the address a load reached for and the value written back', () => {
    expect(bodyOf('M', { word: lw, regs, addr: 0x4a10 }).text).toBe('[0x4a10]');
    expect(bodyOf('W', { word: add, regs }).text).toBe('t4 ← 0x6e');
    expect(bodyOf('C', { word: sw, regs }).text).toBe('stored');
    expect(bodyOf('x', { word: add, regs }).text).toBe('flushed');
  });

  it('gives every instruction its address and number, and a colour of its own', () => {
    expect(pcText(0xc5a0)).toBe('@c5a0');
    expect(seqText(412)).toBe('#412');
    expect(idColor(1, true)).not.toBe(idColor(2, true));
    expect(idColor(7, true)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
