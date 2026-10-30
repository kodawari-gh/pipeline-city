import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { specsOfKind } from '../../sim/board/specs';
import type { Theme } from '../theme';
import { gpuEncode, gpuInstr } from '../../sim/isa/gpu';
import { gpuControlIndices, gpuControlLines, gpuGlyph, gpuGlyphArea, gpuGlyphLive, gpuSlotValues, GPU_GLYPH_KINDS, hasGpuSymbol } from './gpuglyph';
import { gpuPlanInput, type GpuBlock, type GpuBlockKind } from './gpuplan';
import { gpuPlan } from './gpuplans';

const T: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const instr = (g: unknown) => (g as { context: { instructions: unknown[] } }).context.instructions.length;

// The symbols inside the card's blocks (docs/DIE.md "Inside the blocks"): every kind of a plan has one, it fits its block and draws something.
describe('gpu block symbols', () => {
  const plans = specsOfKind('gpu').map((s) => ({ id: s.id, plan: gpuPlan(gpuPlanInput(s.gpu!)) }));

  it('every block kind of every tier has a symbol but the SM frame, drawn into its block', () => {
    const seen = new Set<GpuBlockKind>();
    for (const { id, plan } of plans) {
      for (const b of plan.blocks) {
        seen.add(b.kind);
        expect(hasGpuSymbol(b), `${id} ${b.id}`).toBe(b.kind !== 'sm');
        if (b.kind === 'sm') { expect(gpuGlyphArea(b)).toBeNull(); continue; }
        const a = gpuGlyphArea(b);
        expect(a, `${id} ${b.id}`).not.toBeNull();
        expect(a!.x).toBeGreaterThanOrEqual(b.rect.x);
        expect(a!.y + a!.h).toBeLessThanOrEqual(b.rect.y + b.rect.h);
        const g = new Graphics(), texts: string[] = [];
        expect(() => gpuGlyph(g, T, b, '#0af', (t) => texts.push(t))).not.toThrow();
        expect(instr(g), `${id} ${b.id}`).toBeGreaterThan(0);
      }
    }
    for (const k of Object.keys(GPU_GLYPH_KINDS) as GpuBlockKind[]) expect(seen.has(k), k).toBe(true);
  });

  it('a block too small for a symbol draws nothing', () => {
    const b: GpuBlock = { id: 'x', kind: 'lanes', label: 'L', rect: { x: 0, y: 0, w: 12, h: 20 } };
    expect(gpuGlyphArea(b)).toBeNull();
    const g = new Graphics();
    gpuGlyph(g, T, b, '#0af', () => undefined);
    expect(instr(g)).toBe(0);
  });

  it('an instruction raises the control lines it needs', () => {
    expect([...gpuControlLines({ name: 'vaddi', kind: 'alu', dest: 2 })].sort()).toEqual(['alu', 'imm', 'wr']);
    expect([...gpuControlLines({ name: 'vld', kind: 'ld', dest: 3 })].sort()).toEqual(['imm', 'mem', 'wr']);
    expect([...gpuControlLines({ name: 'halt', kind: 'sys', dest: null })]).toEqual(['sys']);
    expect(gpuControlIndices({ name: 'vld', kind: 'ld', dest: 3 })).toEqual([1, 2, 4]);
  });

  it('the decoder splits a GPU word into its slots, and the shared symbols light for the instruction on show', () => {
    const word = gpuEncode(gpuInstr('vaddi', { rd: 2, rs1: 1, imm: 7 }));
    expect(gpuSlotValues(word)).toEqual(['vaddi', 'v2', 'v1', '', '7']);
    expect(gpuSlotValues(gpuEncode(gpuInstr('vadd', { rd: 3, rs1: 1, rs2: 2 })))).toEqual(['vadd', 'v3', 'v1', 'v2', '']);
    const step = { pc: 0x2c, name: 'vaddi', kind: 'alu' as const, mask: 0xff, cost: 1, banks: null, dest: 2, word };
    const dec: GpuBlock = { id: 'decode', kind: 'decode', label: 'DECODE', rect: { x: 100, y: 50, w: 400, h: 150 } };
    const live = gpuGlyphLive(dec, gpuGlyphArea(dec)!, step);
    expect(live.lit.length).toBeGreaterThan(1 + 2); // the word and the lines raised
    expect(live.texts.map((t) => t.top)).toEqual(['vaddi', 'v2', 'v1', '7']);
    // the word wipes in: at the start no text yet, only the bar
    expect(gpuGlyphLive(dec, gpuGlyphArea(dec)!, step, 0.2).texts).toEqual([]);
    const pc: GpuBlock = { id: 'pc', kind: 'pc', label: 'PC', rect: { x: 0, y: 0, w: 300, h: 80 } };
    expect(gpuGlyphLive(pc, gpuGlyphArea(pc)!, step).texts.map((t) => t.top).join('')).toBe('0000002c');
    const fetch: GpuBlock = { id: 'fetch', kind: 'fetch', label: 'FETCH', rect: { x: 0, y: 0, w: 300, h: 80 } };
    expect(gpuGlyphLive(fetch, gpuGlyphArea(fetch)!, step).texts[0]!.top).toBe('vaddi v2, v1, 7');
    expect(gpuGlyphLive(dec, gpuGlyphArea(dec)!, null)).toEqual({ texts: [], lit: [] });
  });
});
