import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// The labels go through Pixi's Text (a canvas): the room only needs its shapes here.
vi.mock('./ink', async (orig) => ({ ...(await orig<typeof import('./ink')>()), label: () => new Container() }));

import { BEAM, LIGHT_RES, ambientOf, emittersOf, focusAt, lightKey, shiftEmitter, type LightGeo, type LightIn } from './light';
import { DAY_S, RoomView, beamsAt, roomBakeRect, roomGeo } from './room';
import type { Theme } from './theme';

const THEME: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const CASE = { x: 0, y: 0, w: 8000, h: 6000 };
const day: LightIn = { dark: true, night: 0, dusk: 0, lamp: 1, screen: 1, beams: [] };

describe('the focus dark', () => {
  it('is off for the whole room and for a view of the monitor, full once the case fills the view', () => {
    expect(focusAt({ x: -8000, y: -4000, w: 24000, h: 14000 }, CASE)).toBe(0); // the whole room: the case is a sixth of the view
    expect(focusAt({ x: -20000, y: 0, w: 12000, h: 6750 }, CASE)).toBe(0); // the monitor, west of the case
    expect(focusAt({ x: 500, y: 400, w: 7000, h: 5000 }, CASE)).toBe(1); // inside the case
    expect(focusAt({ x: -200, y: -150, w: 8400, h: 6300 }, CASE)).toBe(1); // the case fills the view
  });
  it('rises smoothly between the two as the case fills more of the view', () => {
    const f = (w: number) => focusAt({ x: 4000 - w / 2, y: 3000 - (w * 9) / 32, w, h: (w * 9) / 16 }, CASE);
    const seq = [24000, 18000, 14000, 11000, 9000].map(f);
    for (let i = 1; i < seq.length; i++) expect(seq[i]!).toBeGreaterThanOrEqual(seq[i - 1]!);
    expect(seq[0]).toBe(0);
    expect(seq.some((v) => v > 0 && v < 1)).toBe(true);
  });
  it('responds to a tall or a very wide view that the case fills along its short side: a phone zoomed on the case, but not its overview', () => {
    // a tall phone: the view is 2.2 times as tall as wide; zoomed on the case it spans the width
    expect(focusAt({ x: -200, y: -6000, w: 8400, h: 18500 }, CASE)).toBeGreaterThan(0.95);
    // the same phone at the overview of the whole machine (the case spans about 45 percent of the width)
    expect(focusAt({ x: -9000, y: -16000, w: 17800, h: 39000 }, CASE)).toBe(0);
    // an ultra-wide screen at the overview: the case spans three quarters of the height
    expect(focusAt({ x: -22000, y: -700, w: 36000, h: 8400 }, CASE)).toBe(0);
    // and zoomed on the case
    expect(focusAt({ x: -2500, y: -250, w: 13000, h: 6500 }, CASE)).toBeGreaterThan(0.8);
  });
  it('is 0 for a view that misses the case or has no size', () => {
    expect(focusAt({ x: 20000, y: 0, w: 5000, h: 3000 }, CASE)).toBe(0);
    expect(focusAt({ x: 0, y: 0, w: 0, h: 0 }, CASE)).toBe(0);
  });
});

describe('the quantised light state', () => {
  it('gives equal keys for states that look the same and different keys across a visible step', () => {
    expect(lightKey(day)).toBe(lightKey({ ...day, night: 0.01, lamp: 0.999 }));
    expect(lightKey(day)).not.toBe(lightKey({ ...day, night: 0.5 }));
    expect(lightKey(day)).not.toBe(lightKey({ ...day, lamp: 0 }));
    expect(lightKey(day)).not.toBe(lightKey({ ...day, screen: 0 }));
    expect(lightKey(day)).not.toBe(lightKey({ ...day, dark: false }));
  });
});

describe('the window light', () => {
  const geo = roomGeo();
  it('is a shaft of 13 slices with a patch on the desk top for the sun by day, and the moon by night', () => {
    const sun = beamsAt(geo, 10, 0);
    expect(sun.length).toBe(1);
    expect(sun[0]!.quads.length).toBe(13);
    expect(sun[0]!.quads[0]!.fade).toBe(1);
    expect(sun[0]!.quads.at(-1)!.fade).toBeLessThan(0.1);
    const moon = beamsAt(geo, 1, 0);
    expect(moon.length).toBe(1);
    expect(moon[0]!.a).toBeLessThan(sun[0]!.a);
  });
  it('is gone with the blind down and below the horizon', () => {
    expect(beamsAt(geo, 10, 1)).toEqual([]);
    expect(beamsAt(geo, 5.6, 0).every((b) => b.a < 0.05)).toBe(true);
  });
  it('moves the light key as the sun crosses the sky', () => {
    const k = (h: number) => lightKey({ ...day, beams: beamsAt(geo, h, 0) });
    expect(k(8)).not.toBe(k(14));
    expect(k(12)).toBe(k(12));
  });
});

describe('the dark of the room', () => {
  it('is none by day, deeper at night (more in the light theme than its wall alone would suggest) and takes the lamp by night more than by day', () => {
    expect(ambientOf({ ...day, night: 0 }).alpha).toBe(0);
    expect(ambientOf({ ...day, night: 1 }).alpha).toBeGreaterThan(0.3);
    expect(ambientOf({ ...day, dark: false, night: 1 }).alpha).toBeGreaterThan(0.3);
    expect(ambientOf({ ...day, night: 1 }).lamp).toBeGreaterThan(ambientOf({ ...day, night: 0 }).lamp);
    expect(ambientOf({ ...day, lamp: 0, night: 1 }).lamp).toBe(0);
  });
});

describe('the light layer of the room', () => {
  const geo = roomGeo();
  it('covers the baked region at a few hundred pixels (it is soft)', () => {
    const r = roomBakeRect(geo);
    expect(r.w * LIGHT_RES).toBeLessThan(1400);
    expect(r.h * LIGHT_RES).toBeLessThan(800);
  });
  it('has a cone that is a fan of under a half turn', () => {
    expect(BEAM.half).toBeGreaterThan(0.3);
    expect(BEAM.half * 2).toBeLessThan(Math.PI);
  });
  it('is only the lit edges without a renderer (tests): the focus and the screen are accepted and change nothing', () => {
    const v = new RoomView(THEME, geo);
    expect(v.light.children.length).toBe(1);
    v.setScreen(true); v.setFocus(1);
    expect(() => v.frame(DAY_S * 400, 16)).not.toThrow();
    v.dispose();
  });
  it('is hidden with the room while the view lies inside the case', () => {
    const v = new RoomView(THEME, geo);
    const c = { x: 0, y: 0, w: 20000, h: 12000 };
    v.setView({ x: 4000, y: 3000, w: 8000, h: 4500 }, 0.3, 1, c);
    expect(v.light.visible).toBe(false);
    v.setView({ x: -20000, y: -9000, w: 40000, h: 20000 }, 0.04, 1, c);
    expect(v.light.visible).toBe(true);
  });
});

describe('the lights as data', () => {
  const geo = roomGeo();
  const G: LightGeo = {
    window: geo.window, region: roomBakeRect(geo), case: CASE, inner: { x: 100, y: 100, w: 5000, h: 4000 }, monitor: { x: -20000, y: 1000, w: 9000, h: 5000 }, screen: { x: -19500, y: 1400, w: 8000, h: 4000 },
    router: { x: 0, y: 0, w: 10, h: 10 }, clock: geo.clock, mouth: geo.lamp.mouth, dir: { x: 0.8, y: 0.6 }, ys: geo.ys, keyboard: { x: -18000, y: 7500, w: 5000, h: 330 }, deskTop: 8500, deskBack: 6500,
  };
  const night: LightIn = { ...day, night: 1 };
  const byId = (i: LightIn, g = G) => Object.fromEntries(emittersOf(i, g).map((e) => [e.id, e]));
  it('has the window, the lamp, the screen and the clock', () => {
    expect(emittersOf(night, G).map((e) => e.id)).toEqual(['window', 'lamp', 'screen', 'clock']);
  });
  it('gives a light nothing to draw while its source is off', () => {
    const e = byId({ ...night, lamp: 0, screen: 0 });
    expect(e.lamp!.lit.length + e.lamp!.tint.length).toBe(0);
    expect(e.screen!.lit.length + e.screen!.tint.length).toBe(0);
    expect(byId(night).screen!.lit.length).toBeGreaterThan(0);
  });
  it('keeps the screen light soft: the glass is the only rectangle, and it is feathered', () => {
    const rects = byId(night).screen!.lit.filter((l) => l.shape.k === 'rect');
    expect(rects.length).toBe(1);
    expect((rects[0]!.shape as { soft?: number }).soft).toBeGreaterThan(0);
    expect(byId(night).screen!.tint.some((l) => l.shape.k === 'poly')).toBe(false);
  });
  it('throws less light by day than by night', () => {
    const tintOf = (i: LightIn) => byId(i).screen!.tint.reduce((a, l) => a + (l.erase ? 0 : l.alpha), 0);
    expect(tintOf({ ...day, night: 0 })).toBeLessThan(tintOf(night));
  });
  it('follows the items: the screen light moves with the screen and the keyboard lift with the keyboard', () => {
    const at = (g: LightGeo) => byId(night, g).screen!.lit.map((l) => (l.shape.k === 'blob' ? l.shape.x : l.shape.k === 'rect' ? l.shape.r.x : 0));
    const a = at(G), b = at({ ...G, screen: { ...G.screen, x: G.screen.x + 700 }, monitor: { ...G.monitor, x: G.monitor.x + 700 }, keyboard: { ...G.keyboard, x: G.keyboard.x + 700 } });
    expect(b.every((x, j) => Math.abs(x - a[j]! - 700) < 1e-6)).toBe(true);
  });
  it('moves every piece of a light by an offset, and by nothing as the same light', () => {
    const e = byId(night).lamp!, m = shiftEmitter(e, 300, -200);
    expect(shiftEmitter(e, 0, 0)).toBe(e);
    expect(m.clip!.x).toBe(e.clip!.x + 300);
    const c0 = e.lit[0]!.shape, c1 = m.lit[0]!.shape;
    expect(c0.k).toBe('cone');
    if (c0.k === 'cone' && c1.k === 'cone') expect([c1.x - c0.x, c1.y - c0.y]).toEqual([300, -200]);
  });
});
