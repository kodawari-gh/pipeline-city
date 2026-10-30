import { describe, expect, it } from 'vitest';
import { HIGH_LEVEL } from '../../sim/game/jobcode';
import { profileOf } from '../../sim/game/jobcode';
import { highlight, highlightLines } from './highlight';
import { gpuKernelProfile } from '../../sim/game/gpucode';

const kinds = (lang: 'asm' | 'cpp' | 'python', text: string) => highlight(lang, text).filter((t) => t.k !== 'plain' && t.k !== 'punct').map((t) => `${t.k}:${t.t}${t.cls ? '/' + t.cls : ''}`);

describe('syntax colouring', () => {
  it('assembly: labels, instructions by what they do, registers, numbers, comments', () => {
    expect(kinds('asm', 'loop:  lw t1, 0(a0)   # load')).toEqual(['label:loop:', 'op:lw/ld', 'reg:t1', 'number:0', 'reg:a0', 'comment:# load']);
    expect(kinds('asm', '  mul t2, t1, a3')).toEqual(['op:mul/mul', 'reg:t2', 'reg:t1', 'reg:a3']);
    expect(kinds('asm', '  bne a1, zero, loop')).toEqual(['op:bne/br', 'reg:a1', 'reg:zero', 'label:loop']);
    expect(kinds('asm', '  li t0, 0x4000')).toEqual(['op:li/alu', 'reg:t0', 'number:0x4000']);
    expect(kinds('asm', '  .word 12')).toEqual(['directive:.word', 'number:12']);
    expect(kinds('asm', '  sw a2, 0(a0)')[0]).toBe('op:sw/st');
  });

  it('C++ and Python: keywords, types, numbers, comments and strings', () => {
    expect(kinds('cpp', 'for (int i = 0; i < 8; i++) // go')).toEqual(['keyword:for', 'type:int', 'number:0', 'number:8', 'comment:// go']);
    expect(kinds('cpp', '#include <cstdint>')).toEqual(['pre:#include <cstdint>']);
    expect(kinds('python', 'def scan(mem): # note')).toEqual(['keyword:def', 'func:scan', 'comment:# note']);
    expect(kinds('python', "x = sum(a) & 0xFF")).toEqual(['type:sum', 'number:0xFF']);
  });

  it('the pieces always join back to the text, for every job in all three languages', () => {
    const p = profileOf('db.index', 1);
    expect(highlight('asm', p.asm).map((t) => t.t).join('')).toBe(p.asm);
    for (const h of Object.values(HIGH_LEVEL)) {
      expect(highlight('cpp', h.cpp).map((t) => t.t).join('')).toBe(h.cpp);
      expect(highlight('python', h.python).map((t) => t.t).join('')).toBe(h.python);
      expect(highlightLines('python', h.python)).toHaveLength(h.python.split('\n').length);
    }
  });

  it('GPU assembly: mnemonics coloured by what they do, vector registers, labels, and the pieces join back', () => {
    const text = ['  loop:', '  vld v3, 4(v2)', '  vmul v3, v3, v1', '  vst v3, 8(v2)', '  mseteq v1, v2 # keep', '  bany loop', '  halt'].join('\n');
    const toks = highlightLines('gpu', text).flat(); // a line at a time, as the listing draws them: the first word of a line is the instruction
    expect(toks.map((t) => t.t).join('')).toBe(text.replace(/\n/g, ''));
    const op = (n: string) => toks.find((t) => t.k === 'op' && t.t === n)?.cls;
    expect([op('vld'), op('vst'), op('vmul'), op('mseteq'), op('bany'), op('halt')]).toEqual(['ld', 'st', 'mul', 'br', 'br', 'sys']);
    expect(toks.filter((t) => t.k === 'reg').map((t) => t.t)).toContain('v3');
    expect(toks.some((t) => t.k === 'comment' && t.t === '# keep')).toBe(true);
    expect(toks.filter((t) => t.k === 'label').map((t) => t.t)).toEqual(['loop:', 'loop']);
    const k = gpuKernelProfile('gpu.blur3', 8)!;
    expect(highlight('gpu', k.asm).map((t) => t.t).join('')).toBe(k.asm);
  });
});
