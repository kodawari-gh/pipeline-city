import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';

vi.mock('./ink', async (orig) => ({ ...(await orig<typeof import('./ink')>()), label: () => new Container() }));

import { CASE, MONITOR, OUTBOX, ROUTER_SPOT, setLayoutTier, type Rect } from './layout';
import { roomBakeRect, roomGeo } from './room';
import { SLAT, drawSlats, slatCount, slatTone, slatWall } from './wall';
import type { Theme } from './theme';

const THEME: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const inside = (r: Rect, o: Rect) => r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h;

describe('the slat wall', () => {
  it.each([0, 1, 2, 3])('tier %i: covers all of the wall (everything on it, the baked region and a very tall view), under the floor too', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo(), w = slatWall({ floor: g.floor });
    for (const r of [g.keyRack, g.clock, g.window, OUTBOX, ROUTER_SPOT, MONITOR, CASE, roomBakeRect(g)]) expect(inside(r, w)).toBe(true);
    expect(w.y + w.h).toBeGreaterThan(g.floor + 40000);
    expect(w.h).toBeGreaterThan(40000 + g.floor); // a phone in portrait shows about 40,000 units above the desk
  });
  it('is drawn from a fixed pattern: the same tones every time, all three used', () => {
    const a = Array.from({ length: 120 }, (_, i) => slatTone(i)), b = Array.from({ length: 120 }, (_, i) => slatTone(i));
    expect(a).toEqual(b);
    expect(new Set(a)).toEqual(new Set([0, 1, 2]));
  });
  it('fits whole slats across the wall, in both themes', () => {
    setLayoutTier(0, 0);
    const box = { floor: roomGeo().floor }, w = slatWall(box);
    expect(slatCount(w) * (SLAT.w + SLAT.gap) + SLAT.gap).toBeLessThanOrEqual(w.w);
    for (const dark of [true, false]) {
      const g = new Graphics();
      expect(() => drawSlats(g, { ...THEME, dark }, box)).not.toThrow();
      expect(g.getLocalBounds().width).toBeGreaterThan(w.w * 0.99);
    }
  });
});
