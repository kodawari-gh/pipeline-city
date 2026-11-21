import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// Text needs a canvas, which the tests do not have: labels are empty containers here (as in diemulti.test.ts).
vi.mock('@/core/render/ink', async (orig) => ({ ...(await orig<typeof import('@/core/render/ink')>()), label: () => Object.assign(new Container(), { text: '' }) }));

import { builtinTheme } from '@/core/render/theme';
import type { RamMap } from '../../cpu/sim/pipesnap';
import { CHIPS_PER_STICK } from './ramlayout';
import { RamView } from './ramview';

// Which stick holds an address (`stickOf`): the board's `Live` lights the lanes of the stick that answers a reach. The 3D board has no chips to draw
// (its sticks show their own map), and the sticks still hold their windows of the address space.

const MB = 1 << 20;
const T = builtinTheme();
const map = (bytes: number): RamMap => ({ bytes, filled: [], code: [], regions: [], image: new Uint8Array(bytes) });
const chips = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i * 150, y: 0, w: 116, h: 112 }));

function view(sticks: { idx: number; bytes: number }[], rects: { x: number; y: number; w: number; h: number }[], bytes = sticks.reduce((n, s) => n + s.bytes, 0)): RamView {
  const v = new RamView();
  v.setScene(T, rects);
  v.setSticks(sticks);
  v.setMap(map(bytes));
  return v;
}

describe.each([
  ['with no chips to draw (the 3D board)', () => []],
  ['with the chips of the 2D board', () => chips(2 * CHIPS_PER_STICK)],
])('which stick answers an address, %s', (_name, rects) => {
  const two = [{ idx: 0, bytes: MB }, { idx: 1, bytes: MB }];

  it('the first stick holds the lowest addresses, the next one the next', () => {
    const v = view(two, rects());
    expect(v.stickOf(0)).toBe(0);
    expect(v.stickOf(MB - 1)).toBe(0);
    expect(v.stickOf(MB)).toBe(1);
    expect(v.stickOf(2 * MB - 1)).toBe(1);
  });

  it('an address past the memory (a device window) is no stick\'s', () => {
    const v = view(two, rects());
    expect(v.stickOf(2 * MB)).toBe(-1);
    expect(v.stickOf(0xf0000000)).toBe(-1);
  });

  it('answers with the stick\'s slot number, lowest slot first whatever the order the sticks are listed in', () => {
    const v = view([{ idx: 5, bytes: MB }, { idx: 2, bytes: MB }], rects());
    expect(v.stickOf(0)).toBe(2);
    expect(v.stickOf(MB)).toBe(5);
  });

  it('a stick that is taken out is no longer answering, and one put in is', () => {
    const v = view(two, rects());
    v.setSticks([{ idx: 0, bytes: MB }]);
    v.setMap(map(MB));
    expect(v.stickOf(MB - 1)).toBe(0);
    expect(v.stickOf(MB)).toBe(-1);
    v.setSticks([{ idx: 0, bytes: MB }, { idx: 3, bytes: MB }]);
    v.setMap(map(2 * MB));
    expect(v.stickOf(MB)).toBe(3);
  });

  it('with no sticks, no stick answers', () => {
    const v = new RamView();
    v.setScene(T, rects());
    v.setMap(map(MB));
    expect(v.stickOf(0)).toBe(-1);
  });
});

describe('the RAM map without chips', () => {
  it('draws nothing: it stays hidden at every zoom', () => {
    const v = view([{ idx: 0, bytes: MB }], []);
    for (const z of [0.05, 0.5, 1, 3, 8]) {
      v.setZoom(z);
      v.frame(true, 1000);
      expect(v.root.visible).toBe(false);
    }
  });

  it('does not compare the whole image on every snapshot (nothing shows it): it keeps no copy to compare with', () => {
    const own = (v: RamView) => (v as unknown as { prev: Uint8Array | null }).prev;
    const none = view([{ idx: 0, bytes: MB }], []);
    none.setMap(map(MB));
    expect(own(none)).toBeNull();
    // (with chips to draw, it does: a change of a byte redraws them)
    const drawn = view([{ idx: 0, bytes: MB }], chips(CHIPS_PER_STICK));
    drawn.setMap(map(MB));
    expect(own(drawn)).not.toBeNull();
  });

  it('a reach it is told of is kept without growing for ever', () => {
    const v = view([{ idx: 0, bytes: MB }], []);
    for (let i = 0; i < 10000; i++) v.touch('fetch', i * 4, '#fff');
    expect((v as unknown as { touches: unknown[] }).touches.length).toBeLessThanOrEqual(48);
  });
});
