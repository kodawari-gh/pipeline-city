import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import type { PlanInput, Rect } from './cpuplan';
import { cpuPlan } from './cpuplans';
import { isTall } from './dieart';
import { controlsOf, glyph, glyphArea, glyphLive, GLYPH_KINDS, slotsOf, CONTROL_LINES } from './blockart';
import type { Theme } from './theme';

const DARK: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};

// The symbols inside the die's blocks (docs/DIE.md "Inside the blocks"): they fit their blocks, and the live text goes where the symbol has room for it.

const INPUTS: PlanInput[] = [
  { arch: 'unpipelined', cacheLines: 8 },
  { arch: 'inorder', forwarding: true, cacheLines: 16, icacheLines: 8, l2Lines: 32 },
  { arch: 'inorder2', forwarding: true, cacheLines: 16 },
  { arch: 'ooo', width: 4, robSize: 32, schedSize: 16, fetchQueue: 8, cacheLines: 64, ways: 4, icacheLines: 32, l2Lines: 128 },
];
const inside = (r: Rect, o: Rect) => r.x >= o.x - 4 && r.y >= o.y - 1 && r.x + r.w <= o.x + o.w + 4 && r.y + r.h <= o.y + o.h + 1;

describe('block symbols', () => {
  it('every symbol block of every architecture has room for its symbol, which is drawn without error', () => {
    for (const i of INPUTS) {
      for (const b of cpuPlan(i).blocks.filter((x) => GLYPH_KINDS.has(x.kind) && !isTall(x))) {
        const a = glyphArea(b);
        expect(a, `${i.arch} ${b.id}`).not.toBeNull();
        const texts: string[] = [];
        expect(() => glyph(new Graphics(), DARK, b, a!, '#0af', (t) => texts.push(t))).not.toThrow();
      }
    }
  });

  it('the live text of an instruction goes inside the block it is in', () => {
    const items = [{ op: 'addi', text: 'addi t0, t0, 4', pc: 0x1004 }];
    for (const i of INPUTS) {
      for (const b of cpuPlan(i).blocks.filter((x) => GLYPH_KINDS.has(x.kind) && !isTall(x))) {
        const a = glyphArea(b)!;
        const l = glyphLive(b, a, items, 0x1004);
        for (const t of l.texts) expect(inside(t.rect, b.rect), `${i.arch} ${b.id}`).toBe(true);
        for (const t of l.lit) expect(inside(t.rect, b.rect), `${i.arch} ${b.id} lit`).toBe(true);
      }
    }
  });

  it('the PC shows eight hex digits and a fetch block one word per lane it reads', () => {
    const plan = cpuPlan(INPUTS[3]!);
    const pc = plan.blocks.find((b) => b.kind === 'pc')!, fetch = plan.blocks.find((b) => b.kind === 'fetch')!;
    expect(glyphLive(pc, glyphArea(pc)!, [], 0x1abc).texts.map((t) => t.top).join('')).toBe('00001abc');
    expect(slotsOf(fetch, glyphArea(fetch)!).words).toHaveLength(4);
  });

  it('the decoder raises the lines an instruction needs', () => {
    const on = (op: string) => controlsOf(op).map((k) => CONTROL_LINES[k]);
    expect(on('add')).toEqual(['alu', 'wr']);
    expect(on('addi')).toEqual(['alu', 'wr', 'imm']);
    expect(on('lw')).toEqual(['mem', 'wr', 'imm']);
    expect(on('sw')).toEqual(['mem', 'imm']);
    expect(on('bne')).toEqual(['br']);
    expect(on('ecall')).toEqual(['sys']);
  });
});
