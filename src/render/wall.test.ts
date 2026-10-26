import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';

vi.mock('./ink', async (orig) => ({ ...(await orig<typeof import('./ink')>()), label: () => new Container() }));

import { CASE, MONITOR, OUTBOX, ROUTER_SPOT, setLayoutTier, type Rect } from './layout';
import { roomGeo } from './room';
import { SLAT, drawSlats, slatCount, slatPanel, slatTone } from './wall';
import type { Theme } from './theme';

const THEME: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const inside = (r: Rect, o: Rect) => r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h;
const boxOf = () => { const g = roomGeo(); return { ys: g.ys, window: g.window, deskX1: g.desk.x1, top: g.top }; };

describe('the slat wall', () => {
  it.each([0, 1, 2, 3])('tier %i: the panel holds everything that hangs on the wall and stands before it, and stops east of the window', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo(), p = slatPanel(boxOf());
    for (const r of [g.keyRack, g.clock, OUTBOX, ROUTER_SPOT, { x: MONITOR.x, y: MONITOR.y, w: MONITOR.w, h: MONITOR.h }]) expect(inside(r, p)).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(g.window.x + g.window.w + SLAT.windowGap);
    expect(p.x + p.w).toBeGreaterThan(CASE.x + CASE.w); // the case stands before it
    expect(p.y + p.h).toBeLessThan(g.ys); // it ends above the desk top
  });
  it('is drawn from a fixed pattern: the same tones every time, all three used', () => {
    const a = Array.from({ length: 120 }, (_, i) => slatTone(i)), b = Array.from({ length: 120 }, (_, i) => slatTone(i));
    expect(a).toEqual(b);
    expect(new Set(a)).toEqual(new Set([0, 1, 2]));
  });
  it('fits whole slats across the panel, in both themes', () => {
    setLayoutTier(0, 0);
    const p = slatPanel(boxOf());
    expect(slatCount(p) * (SLAT.w + SLAT.gap) + SLAT.gap).toBeLessThanOrEqual(p.w);
    for (const dark of [true, false]) {
      const g = new Graphics();
      expect(() => drawSlats(g, { ...THEME, dark }, boxOf())).not.toThrow();
      expect(g.getLocalBounds().width).toBeGreaterThan(p.w * 0.9);
    }
  });
});
