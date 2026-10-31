import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';

// Text needs a canvas, which the tests do not have: labels are empty containers here (as in accelart.test.ts).
vi.mock('@/core/render/ink', async (orig) => ({ ...(await orig<typeof import('@/core/render/ink')>()), label: () => new Container() }));

import { specsOfKind } from '../../board/sim/specs';
import type { Theme } from '@/core/render/theme';
import { gpuAccent, gpuFar, gpuLaneLines, gpuNear, gpuTitle, GPU_KIND_COLOR, GPU_LEGEND, GPU_LINK_COLOR } from './gpuart';
import { gpuPlanInput } from './gpuplan';
import { gpuPlan } from './gpuplans';

const T: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const instr = (g: unknown) => (g as { context: { instructions: unknown[] } }).context.instructions.length;

describe('gpu die art', () => {
  it('draws the far view and the near layers of every tier, the bigger die with more to draw', () => {
    const sizes = specsOfKind('gpu').map((s) => {
      const plan = gpuPlan(gpuPlanInput(s.gpu!)), g = new Graphics();
      gpuFar(g, T, plan);
      const art = gpuNear(T, plan);
      expect(art.root.children).toHaveLength(4);
      expect(instr(art.wires.children[0]), s.id).toBeGreaterThan(0);
      expect(instr(art.cells.children[0]), s.id).toBeGreaterThan(0);
      return instr(g);
    });
    expect(sizes[0]).toBeLessThan(sizes[2]!);
  });

  it('has a colour for every block and link kind, and one trace per lane of a link', () => {
    for (const s of specsOfKind('gpu')) {
      const plan = gpuPlan(gpuPlanInput(s.gpu!));
      for (const b of plan.blocks) expect(GPU_KIND_COLOR[b.kind], b.id).toBeDefined();
      for (const l of plan.links) {
        expect(GPU_LINK_COLOR[l.kind], l.id).toBeDefined();
        expect(gpuLaneLines(l)).toHaveLength(l.lanes);
      }
    }
  });

  it('each tier has its own rim colour and title, and every legend colour is a theme colour', () => {
    const plans = specsOfKind('gpu').map((sp) => gpuPlan(gpuPlanInput(sp.gpu!)));
    expect(new Set(plans.map((p) => gpuAccent(T, p))).size).toBe(plans.length);
    expect(new Set(plans.map((p) => gpuTitle(p))).size).toBe(plans.length);
    for (const e of GPU_LEGEND) expect(T[e.key], e.text).toMatch(/^#/);
  });
});
