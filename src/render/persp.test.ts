import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';

vi.mock('./ink', async (orig) => ({ ...(await orig<typeof import('./ink')>()), label: () => new Container() }));

import { setLayoutTier } from './layout';
import { roomGeo } from './room';
import { drawDesk, drawDeskShadow, drawUnderDesk } from './desk';
import { EYE, S_FEET, S_FRONT, SLAB_FRONT, deskGeo, floorScale, roomPersp, spreadX, spreadY } from './persp';
import type { Theme } from './theme';

const THEME: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const LOOK = { wood: '#c39b72', woodHi: '#d8b68f', woodLo: '#a37c58', edge: '#8a6a4c', metal: '#8d99b4', metalLo: '#6b7794' };

describe('the room perspective', () => {
  it('a point brought forward lands on the line from the vanishing point through it, and scale 1 is the wall', () => {
    const P = { vx: 100, yH: -500 };
    expect(spreadX(P, 700, 1)).toBe(700);
    expect(spreadY(P, 300, 1)).toBe(300);
    const [x, y] = [spreadX(P, 700, 1.5), spreadY(P, 300, 1.5)];
    expect((x - P.vx) / (700 - P.vx)).toBeCloseTo(1.5, 9);
    expect((y - P.yH) / (300 - P.yH)).toBeCloseTo(1.5, 9);
    expect(floorScale(P, 300, spreadY(P, 300, 1.37))).toBeCloseTo(1.37, 9);
  });
  it.each([0, 1, 2, 3])('tier %i: the eye is above the desk top and under the ceiling, and the desk top has depth with the feet standing on it', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo(), P = g.persp, D = deskGeo(P, g.ys, g.floor);
    expect(P.yH).toBeGreaterThan(g.ceil);
    expect(P.yH).toBeLessThan(g.ys - 2000); // well above the desk top, so the top shows
    expect(P.yH).toBeCloseTo(g.floor - EYE * (g.floor - g.ceil), 6);
    expect(D.yBack).toBeLessThan(g.ys);
    expect(D.yFront).toBeGreaterThan(g.ys);
    expect(D.yFront - D.yBack).toBeGreaterThan(500);
    expect(D.yFront - D.yBack).toBeLessThan(1600); // a desk top, not a floor
    expect(D.yBottom - D.yFront).toBe(SLAB_FRONT);
    expect(D.floorFront).toBeGreaterThan(g.floor);
    expect(D.floorFront - g.floor).toBeLessThan(2000);
    // the feet's depth is in between the wall and the front
    expect(S_FEET).toBeGreaterThan(1);
    expect(S_FEET).toBeLessThan(S_FRONT);
    // the desk's side edges converge on the vanishing point: the west edge leans toward it going back
    const west = g.desk.x0;
    expect(D.xAt(west, S_FRONT)).toBeLessThan(D.xAt(west, 1));
    expect(D.xAt(g.desk.x1, S_FRONT)).toBeGreaterThan(D.xAt(g.desk.x1, 1));
    expect(D.toWall(D.xAt(west, S_FRONT))).toBeCloseTo(D.xAt(west, 1), 6);
  });
  it('the vanishing point is the middle of the desk', () => {
    const P = roomPersp({ ceil: -9000, floor: 7000, x0: -20000, x1: 14000 });
    expect(P.vx).toBe(-3000);
  });
  it.each([true, false])('the desk draws its parts on the floor and the wall without error (dark %s)', (dark) => {
    setLayoutTier(0, 0);
    const g = roomGeo(), D = deskGeo(g.persp, g.ys, g.floor), T = { ...THEME, dark };
    const a = new Graphics(), b = new Graphics(), c = new Graphics();
    drawUnderDesk(a, T, D, g.desk.x0, g.desk.x1);
    drawDeskShadow(b, T, D, g.desk.x0, g.desk.x1);
    drawDesk(c, T, LOOK, D, g.desk.x0, g.desk.x1);
    const body = c.getLocalBounds();
    expect(body.maxY).toBeGreaterThanOrEqual(D.floorFront); // the legs reach the floor in front of the baseboard
    expect(body.minY).toBeLessThanOrEqual(D.yBack + 1);
    expect(b.getLocalBounds().maxY).toBeGreaterThan(D.floorFront - 1);
    expect(a.getLocalBounds().minY).toBeCloseTo(D.yBack, 0);
  });
});
