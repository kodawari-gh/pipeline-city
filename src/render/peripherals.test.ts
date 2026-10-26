import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';

vi.mock('./ink', async (orig) => ({ ...(await orig<typeof import('./ink')>()), label: () => new Container() }));

import { MONITOR, setLayoutTier } from './layout';
import { KEYBOARD, MOUSE, drawKeyboard, drawMat, drawMouse, keyboardPlacer, mousePlacer, placer } from './peripherals';
import { deskGeo } from './persp';
import { roomGeo } from './room';
import type { Theme } from './theme';

const THEME: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const LOOK = { plastic: '#2a3252', plasticLo: '#1b2140', line: '#2a3768', paper: '#aeb8d4' };

describe('what lies on the desk', () => {
  it.each([0, 1, 2, 3])('tier %i: the mat, the keyboard and the mouse lie on the desk top, between its far and near edges, and a height lifts a point straight up', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo(), D = deskGeo(g.persp, g.ys, g.floor), mcx = MONITOR.x + MONITOR.w / 2;
    for (const dark of [true, false]) {
      for (const draw of [drawMat, (o: Graphics, T: Theme, d: typeof D, c: number) => drawKeyboard(o, T, LOOK, d, c), (o: Graphics, T: Theme, d: typeof D, c: number) => drawMouse(o, T, LOOK, d, c)]) {
        const o = new Graphics();
        draw(o, { ...THEME, dark }, D, mcx);
        const b = o.getLocalBounds();
        expect(b.maxY).toBeLessThan(D.yFront); // nothing hangs over the desk's edge
        expect(b.minX).toBeGreaterThan(g.desk.x0);
        expect(b.maxX).toBeLessThan(g.desk.x1);
      }
    }
    const k = keyboardPlacer(D, mcx), c0 = k(0, 0, 0), c1 = k(0, 0, 100);
    expect(c0[1]).toBeGreaterThan(D.yBack);
    expect(c0[1]).toBeLessThan(D.yFront);
    expect(c1[0]).toBe(c0[0]);
    expect(c1[1]).toBe(c0[1] - 100);
    // the mouse is east of the keyboard and clear of it
    const m = mousePlacer(D, mcx);
    expect(m(-MOUSE.w / 2, 0)[0]).toBeGreaterThan(k(KEYBOARD.w / 2, 0)[0]);
  });
  it('a yaw turns a plan point: the right end of the keyboard is nearer or farther than the left; zero yaw keeps the row level', () => {
    setLayoutTier(0, 0);
    const g = roomGeo(), D = deskGeo(g.persp, g.ys, g.floor);
    const level = placer(D, 0, g.ys, 0), turned = placer(D, 0, g.ys, 5);
    expect(level(-2000, 0)[1]).toBe(level(2000, 0)[1]);
    expect(turned(2000, 0)[1]).toBeGreaterThan(turned(-2000, 0)[1]); // a positive yaw brings the right end toward the viewer
  });
});
