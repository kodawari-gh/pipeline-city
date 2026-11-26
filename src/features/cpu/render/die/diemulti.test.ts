import { describe, expect, it, vi } from 'vitest';
import { Text } from 'pixi.js';

import type { Theme } from '@/core/render/theme';
import { cpuPlan } from '../core/cpuplans';
import { splitPlan } from '../core/coreplan';
import { DieView } from './diemulti';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

// Text needs a canvas, which the tests do not have: labels are empty texts here, so nothing is measured.
vi.mock(import('@/core/render/ink'), async (orig) => ({
  ...(await orig()),
  label: () => new Text({ text: '' }),
}));

const T: Theme = {
  bg: '#04060f',
  board: '#081628',
  trace: '#1e4270',
  sub: '#0d1636',
  die: '#111b46',
  pin: '#d4af5f',
  tile: '#18245c',
  ink: '#e2eaff',
  mute: '#8a97c2',
  line: '#2a366a',
  dot: '#18214a',
  on: '#08102a',
  alu: '#3be3ff',
  mul: '#a68bff',
  ld: '#ffc247',
  st: '#6dffa6',
  br: '#ff55dc',
  bad: '#ff5a78',
};

const PLAN = cpuPlan({ arch: 'inorder', cores: 4, cacheLines: 8, l2Lines: 32 });

/** Where each core tile sits on the die, in core order. */
const TILE_RECTS = must(splitPlan(PLAN)).tiles.map((t) => t.rect);

/** A die view showing the 4-core plan. */
function make(): DieView {
  const d = new DieView();
  d.setPlan(T, PLAN);
  return d;
}

/** The root of the die's shared part: the bottom layer of the die's root. */
const sharedRoot = (d: DieView) => must(d.root.children[0]);

/** The root of each core tile's view, in core order: the children of the die's second layer. */
const tileRoots = (d: DieView) => must(d.root.children[1]).children;

/** Whether `root` is shown at full strength. */
const fullyShown = (root: { visible: boolean; alpha: number }) => root.visible && root.alpha === 1;

describe('multicore die LoD', () => {
  it("shows a tile's insides only once its wash is gone, never both", () => {
    const d = make();
    expect(tileRoots(d)).toHaveLength(TILE_RECTS.length);
    const view = { x: -710, y: -565, w: 1420, h: 1130 };
    for (const z of [0.05, 0.5, 1, 2, 3]) {
      d.setZoom(z, z, view);
      for (const root of tileRoots(d)) {
        const a = root.alpha;
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
    d.setZoom(0.05, 0.05, view);
    expect(tileRoots(d).every((root) => !root.visible)).toBe(true);
    d.setZoom(3.3, 3.3, null); // no view: every tile reads the die's zoom, and the core view has not started
    expect(tileRoots(d).every((root) => fullyShown(root))).toBe(true);
  });

  it('opens the tile at the centre of the view before one far from it', () => {
    const d = make();
    const r = must(TILE_RECTS[0]);
    // a small view centred on the first tile: it is in focus, the others are not
    const view = { x: r.x + r.w / 2 - 200, y: r.y + r.h / 2 - 150, w: 400, h: 300 };
    d.setZoom(2.8, 2.8, view);
    const alphas = tileRoots(d).map((root) => root.alpha);
    expect(alphas[0]).toBeGreaterThan(must(alphas.at(-1)));
  });

  it('shows only the core under the view centre in the deep core view', () => {
    const d = make();
    const r = must(TILE_RECTS[0]);
    const view = { x: r.x + r.w / 2 - 100, y: r.y + r.h / 2 - 75, w: 200, h: 150 };
    d.setZoom(8, 8, view);
    const t = tileRoots(d);
    expect(must(t[0]).visible).toBe(true);
    expect(t.slice(1).every((root) => !root.visible)).toBe(true);
    expect(sharedRoot(d).visible).toBe(false);
    d.setZoom(1, 1, view);
    expect(sharedRoot(d).visible).toBe(true);
  });
});
