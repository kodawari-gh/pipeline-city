import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';

vi.mock('@/core/render/ink', async (orig) => ({ ...(await orig<typeof import('@/core/render/ink')>()), label: () => new Container() }));

import { setLayoutTier } from '@/features/board/render/layout/layout';
import { roomBakeRect, roomBox, roomGeo } from './room';
import { BOARD, FADE, TRIM, boardTop, drawCeiling, drawCrown, drawFloor, shellLook } from './shell';
import { floorScale } from './persp';
import type { Theme } from '@/core/render/theme';

const THEME: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};

describe('the room shell', () => {
  it.each([0, 1, 2, 3])('tier %i: the ceiling is above everything on the wall, the floor under it, and the camera box and the baked region hold both fades', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo(), box = roomBox(g), region = roomBakeRect(g);
    expect(g.ceil).toBeLessThan(Math.min(g.window.y, g.clock.y, g.keyRack.y) - TRIM.crown);
    expect(g.floor).toBeGreaterThan(g.ys);
    expect(box.y).toBeGreaterThan(g.ceil);
    expect(box.y + box.h).toBeGreaterThan(g.floor); // a little floor is part of the picture
    expect(region.y).toBeLessThanOrEqual(g.ceil - FADE.ceil);
    expect(region.y + region.h).toBeGreaterThanOrEqual(g.floor + FADE.floor);
  });
  it('floorboards widen away from the wall, and equal depths of the room are the steps of the perspective', () => {
    const h = 9000;
    let prev = 0;
    for (let k = 1; k <= BOARD.count; k++) {
      const d = boardTop(k, h) - boardTop(k - 1, h);
      expect(d).toBeGreaterThan(prev);
      prev = d;
      expect(floorScale({ vx: 0, yH: -h }, 0, boardTop(k, h))).toBeCloseTo(1 / (1 - k * BOARD.step), 9);
    }
    expect(boardTop(0, h)).toBe(0);
    expect(boardTop(1, h)).toBeGreaterThan(300);
    expect(boardTop(1, h)).toBeLessThan(600);
  });
  it.each([true, false])('is built (dark theme %s) and reaches far past any view with its flat far colour', (dark) => {
    const T = { ...THEME, dark }, B = { ceil: -9000, floor: 7000, vx: 2000, yH: -2000 }, L = shellLook(T);
    for (const draw of [drawCeiling, drawCrown, drawFloor]) {
      const g = new Graphics();
      expect(() => draw(g, T, B)).not.toThrow();
      const b = g.getLocalBounds();
      expect(b.width).toBeGreaterThan(100000);
    }
    const up = new Graphics(), down = new Graphics();
    drawCeiling(up, T, B); drawFloor(down, T, B);
    expect(up.getLocalBounds().minY).toBeLessThan(B.ceil - 60000);
    expect(down.getLocalBounds().maxY).toBeGreaterThan(B.floor + 60000);
    expect(L.ceilFar).not.toBe(L.ceilNear);
    expect(L.floorFar).not.toBe(L.floorNear);
  });
});
