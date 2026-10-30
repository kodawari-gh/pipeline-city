import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// Text needs a canvas, which the tests do not have: labels are empty containers here (as in gpuview.test.ts).
vi.mock('../ink', async (orig) => ({ ...(await orig<typeof import('../ink')>()), label: () => Object.assign(new Container(), { text: '' }) }));

import type { Theme } from '../theme';
import { cpuPlan } from './cpuplans';
import { DieView } from './diemulti';

const T: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};

describe('multicore die LoD', () => {
  const make = () => {
    const d = new DieView();
    d.setPlan(T, cpuPlan({ arch: 'inorder', cores: 4, cacheLines: 8, l2Lines: 32 }));
    return d;
  };
  const tiles = (d: DieView) => (d as unknown as { cores: { view: { root: Container }; tile: { rect: { x: number; y: number; w: number; h: number } } }[] }).cores;

  it('shows a tile\'s insides only once its wash is gone, never both', () => {
    const d = make();
    const view = { x: -710, y: -565, w: 1420, h: 1130 };
    for (const z of [0.05, 0.2, 0.5, 1, 3]) {
      d.setZoom(z, z, view);
      for (const c of tiles(d)) {
        const a = c.view.root.alpha;
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
    d.setZoom(0.05, 0.05, view);
    expect(tiles(d).every((c) => !c.view.root.visible)).toBe(true);
    d.setZoom(1.9, 1.9, null); // no view: every tile reads the die's zoom, and the core view has not started
    expect(tiles(d).every((c) => c.view.root.visible && c.view.root.alpha === 1)).toBe(true);
  });

  it('opens the tile at the centre of the view before one far from it', () => {
    const d = make();
    const [first] = tiles(d);
    const r = first!.tile.rect;
    // a small view centred on the first tile: it is in focus, the others are not
    const view = { x: r.x + r.w / 2 - 200, y: r.y + r.h / 2 - 150, w: 400, h: 300 };
    d.setZoom(1.2, 1.2, view);
    const alphas = tiles(d).map((c) => c.view.root.alpha);
    expect(alphas[0]).toBeGreaterThan(alphas[alphas.length - 1]!);
  });

  it('shows only the core under the view centre in the deep core view', () => {
    const d = make();
    const r = tiles(d)[0]!.tile.rect;
    const view = { x: r.x + r.w / 2 - 100, y: r.y + r.h / 2 - 75, w: 200, h: 150 };
    d.setZoom(6, 6, view);
    const t = tiles(d);
    expect(t[0]!.view.root.visible).toBe(true);
    expect(t.slice(1).every((c) => !c.view.root.visible)).toBe(true);
    expect((d as unknown as { shared: { root: Container } }).shared.root.visible).toBe(false);
    d.setZoom(1, 1, view);
    expect((d as unknown as { shared: { root: Container } }).shared.root.visible).toBe(true);
  });
});
