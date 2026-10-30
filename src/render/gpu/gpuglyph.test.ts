import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { specsOfKind } from '../../sim/board/specs';
import type { Theme } from '../theme';
import { gpuGlyph, gpuGlyphArea, GPU_GLYPH_KINDS, hasGpuSymbol } from './gpuglyph';
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
});
