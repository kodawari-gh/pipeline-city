import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';

vi.mock('../ink', async (orig) => ({ ...(await orig<typeof import('../ink')>()), label: () => new Container() }));

import { CASE, MONITOR, OUTBOX, ROUTER_SPOT, setLayoutTier, type Rect } from '../board/layout';
import { roomBakeRect, roomGeo } from './room';
import { SLAT, SLAT_DEPTH, drawSlats, drawWallShade, slatCount, slatTone, slatWall } from './wall';
import type { Theme } from '../theme';

const THEME: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const inside = (r: Rect, o: Rect) => r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h;

describe('the slat wall', () => {
  it.each([0, 1, 2, 3])('tier %i: covers everything that hangs on the wall, from the ceiling to the floor, and the whole width a view can show', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo(), w = slatWall({ ceil: g.ceil, floor: g.floor });
    for (const r of [g.keyRack, g.clock, g.window, OUTBOX, ROUTER_SPOT, MONITOR, CASE]) expect(inside(r, w)).toBe(true);
    const b = roomBakeRect(g);
    expect(w.x).toBeLessThanOrEqual(b.x);
    expect(w.x + w.w).toBeGreaterThanOrEqual(b.x + b.w);
    expect(w.y).toBe(g.ceil);
    expect(w.y + w.h).toBe(g.floor);
  });
  it('is drawn from a fixed pattern: the same tones every time, all three used', () => {
    const a = Array.from({ length: 120 }, (_, i) => slatTone(i)), b = Array.from({ length: 120 }, (_, i) => slatTone(i));
    expect(a).toEqual(b);
    expect(new Set(a)).toEqual(new Set([0, 1, 2]));
  });
  it('fits whole slats across the wall, in both themes', () => {
    setLayoutTier(0, 0);
    const g0 = roomGeo(), box = { ceil: g0.ceil, floor: g0.floor }, w = slatWall(box);
    expect(slatCount(w) * (SLAT.w + SLAT.gap) + SLAT.gap).toBeLessThanOrEqual(w.w);
    for (const dark of [true, false]) {
      const g = new Graphics();
      expect(() => drawSlats(g, { ...THEME, dark }, box)).not.toThrow();
      expect(g.getLocalBounds().width).toBeGreaterThan(w.w * 0.99);
      expect(g.getLocalBounds().height).toBeGreaterThan(w.h * 0.99);
    }
  });
  it('shows the side of a slat that faces the vanishing point, wider the farther from it, and never more than the gap; the wall shade is built in both themes', () => {
    setLayoutTier(0, 0);
    const g0 = roomGeo(), box = { ceil: g0.ceil, floor: g0.floor }, vx = g0.persp.vx;
    expect(SLAT_DEPTH * 60000).toBeGreaterThan(SLAT.gap); // far enough out, the gaps are closed
    expect(SLAT_DEPTH * 3000).toBeLessThan(SLAT.gap / 4); // near the middle, they are open
    for (const dark of [true, false]) {
      const a = new Graphics(), b = new Graphics();
      expect(() => { drawSlats(a, { ...THEME, dark }, box, vx); drawWallShade(b, { ...THEME, dark }, box, vx); }).not.toThrow();
      expect(b.getLocalBounds().width).toBeGreaterThan(100000);
      expect(b.getLocalBounds().minY).toBeGreaterThanOrEqual(box.ceil - 1);
      expect(b.getLocalBounds().maxY).toBeLessThanOrEqual(box.floor + 1);
    }
  });
});
