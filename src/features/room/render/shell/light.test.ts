import { assert, describe, expect, it, vi } from 'vitest';
import { BEAM, LIGHT_RES, ambientOf, emittersOf, focusAt, lightKey, shiftEmitter } from './light';
import type * as lightTypes from './light';
import { beamsAt, roomBakeRect, roomGeo } from './room';

// The labels go through Pixi's Text (a canvas): the room only needs its shapes here.
// Labels are texts that never measure themselves here, with empty bounds like the empty containers they stood in for before.
vi.mock(import('@/core/render/ink'), async (orig) => {
  const pixi = await import('pixi.js');
  class BareText extends pixi.Text {
    protected override updateBounds(): void {
      this._bounds.clear();
    }
  }
  return { ...(await orig()), label: (str: string) => new BareText({ text: str }) };
});

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const CASE = { x: 0, y: 0, w: 8000, h: 6000 };
const day: lightTypes.LightIn = { night: 0, dusk: 0, lamp: 1, screen: 1, beams: [] };

type Shape = lightTypes.Emitter['lit'][number]['shape'];

/** The focus for a 16:9 view `w` wide, centred on the case. */
const focusOfWidth = (w: number) => focusAt({ x: 4000 - w / 2, y: 3000 - (w * 9) / 32, w, h: (w * 9) / 16 }, CASE);

/** Whether a focus is part way, neither off nor full. */
const partWay = (v: number): boolean => v > 0 && v < 1;

/** A rectangle's feather (none for another shape). */
const softOf = (shape: Shape): number | undefined => (shape.k === 'rect' ? shape.soft : undefined);

/** Where a shape stands across: a blob's x, a rectangle's left edge, 0 for the rest. */
function shapeX(shape: Shape): number {
  if (shape.k === 'blob') {
    return shape.x;
  }
  return shape.k === 'rect' ? shape.r.x : 0;
}

/** A cone's tip. */
function coneTip(shape: Shape): [number, number] {
  assert(shape.k === 'cone', `a ${shape.k}, not a cone`);
  return [shape.x, shape.y];
}

describe('the focus dark', () => {
  it('is off for the whole room and for a view of the monitor, full once the case fills the view', () => {
    expect(focusAt({ x: -8000, y: -4000, w: 24_000, h: 14_000 }, CASE)).toBe(0); // the whole room: the case is a sixth of the view
    expect(focusAt({ x: -20_000, y: 0, w: 12_000, h: 6750 }, CASE)).toBe(0); // the monitor, west of the case
    expect(focusAt({ x: 500, y: 400, w: 7000, h: 5000 }, CASE)).toBe(1); // inside the case
    expect(focusAt({ x: -200, y: -150, w: 8400, h: 6300 }, CASE)).toBe(1); // the case fills the view
  });
  it('rises smoothly between the two as the case fills more of the view', () => {
    const seq = [24_000, 18_000, 14_000, 11_000, 9000].map((w) => focusOfWidth(w));
    for (let i = 1; i < seq.length; i++) {
      const seqItem = seq[i];
      assert.exists(seqItem);
      expect(seqItem).toBeGreaterThanOrEqual(must(seq[i - 1]));
    }
    expect(seq[0]).toBe(0);
    expect(seq.some((v) => partWay(v))).toBe(true);
  });
  it('responds to a tall or a very wide view that the case fills along its short side: a phone zoomed on the case, but not its overview', () => {
    // a tall phone: the view is 2.2 times as tall as wide; zoomed on the case it spans the width
    expect(focusAt({ x: -200, y: -6000, w: 8400, h: 18_500 }, CASE)).toBeGreaterThan(0.95);
    // the same phone at the overview of the whole machine (the case spans about 45 percent of the width)
    expect(focusAt({ x: -9000, y: -16_000, w: 17_800, h: 39_000 }, CASE)).toBe(0);
    // an ultra-wide screen at the overview: the case spans three quarters of the height
    expect(focusAt({ x: -22_000, y: -700, w: 36_000, h: 8400 }, CASE)).toBe(0);
    // and zoomed on the case
    expect(focusAt({ x: -2500, y: -250, w: 13_000, h: 6500 }, CASE)).toBeGreaterThan(0.8);
  });
  it('is 0 for a view that misses the case or has no size', () => {
    expect(focusAt({ x: 20_000, y: 0, w: 5000, h: 3000 }, CASE)).toBe(0);
    expect(focusAt({ x: 0, y: 0, w: 0, h: 0 }, CASE)).toBe(0);
  });
});

describe('the quantised light state', () => {
  it('gives equal keys for states that look the same and different keys across a visible step', () => {
    expect(lightKey(day)).toBe(lightKey({ ...day, night: 0.01, lamp: 0.999 }));
    expect(lightKey(day)).not.toBe(lightKey({ ...day, night: 0.5 }));
    expect(lightKey(day)).not.toBe(lightKey({ ...day, lamp: 0 }));
    expect(lightKey(day)).not.toBe(lightKey({ ...day, screen: 0 }));
  });
});

describe('the window light', () => {
  const geo = roomGeo();
  it('is a shaft of 13 slices with a patch on the desk top for the sun by day, and the moon by night', () => {
    const sun = beamsAt(geo, 10, 0);
    expect(sun).toHaveLength(1);
    assert.exists(sun[0]);
    expect(sun[0].quads).toHaveLength(13);
    assert.exists(sun[0].quads[0]);
    expect(sun[0].quads[0].fade).toBe(1);
    const lastQuad = sun[0].quads.at(-1);
    assert.exists(lastQuad);
    expect(lastQuad.fade).toBeLessThan(0.1);
    const moon = beamsAt(geo, 1, 0);
    expect(moon).toHaveLength(1);
    assert.exists(moon[0]);
    expect(moon[0].a).toBeLessThan(sun[0].a);
  });
  it('is gone with the blind down and below the horizon', () => {
    expect(beamsAt(geo, 10, 1)).toStrictEqual([]);
    expect(beamsAt(geo, 5.6, 0).every((b) => b.a < 0.05)).toBe(true);
  });
  const k = (h: number) => lightKey({ ...day, beams: beamsAt(geo, h, 0) });
  it('moves the light key as the sun crosses the sky', () => {
    expect(k(8)).not.toBe(k(14));
    expect(k(12)).toBe(k(12));
  });
});

describe('the dark of the room', () => {
  it('is none by day, deeper at night and takes the lamp by night more than by day', () => {
    expect(ambientOf({ ...day, night: 0 }).alpha).toBe(0);
    expect(ambientOf({ ...day, night: 1 }).alpha).toBeGreaterThan(0.3);
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
});

describe('the lights as data', () => {
  const geo = roomGeo();
  const G: lightTypes.LightGeo = {
    window: geo.window,
    region: roomBakeRect(geo),
    case: CASE,
    inner: { x: 100, y: 100, w: 5000, h: 4000 },
    monitor: { x: -20_000, y: 1000, w: 9000, h: 5000 },
    screen: { x: -19_500, y: 1400, w: 8000, h: 4000 },
    router: { x: 0, y: 0, w: 10, h: 10 },
    clock: geo.clock,
    mouth: geo.lamp.mouth,
    dir: { x: 0.8, y: 0.6 },
    ys: geo.ys,
    keyboard: { x: -18_000, y: 7500, w: 5000, h: 330 },
    deskTop: 8500,
    deskBack: 6500,
  };
  const night: lightTypes.LightIn = { ...day, night: 1 };
  const byId = (i: lightTypes.LightIn, g = G) => Object.fromEntries(emittersOf(i, g).map((e) => [e.id, e]));
  it('has the window, the lamp, the screen and the clock', () => {
    expect(emittersOf(night, G).map((e) => e.id)).toStrictEqual(['window', 'lamp', 'screen', 'clock']);
  });
  it('gives a light nothing to draw while its source is off', () => {
    const e = byId({ ...night, lamp: 0, screen: 0 });
    assert.exists(e['lamp']);
    expect(e['lamp'].lit.length + e['lamp'].tint.length).toBe(0);
    assert.exists(e['screen']);
    expect(e['screen'].lit.length + e['screen'].tint.length).toBe(0);
    const byIdItem = byId(night)['screen'];
    assert.exists(byIdItem);
    expect(byIdItem.lit.length).toBeGreaterThan(0);
  });
  it('keeps the screen light soft: the glass is the only rectangle, and it is feathered', () => {
    const byIdItem2 = byId(night)['screen'];
    assert.exists(byIdItem2);
    const rects = byIdItem2.lit.filter((l) => l.shape.k === 'rect');
    expect(rects).toHaveLength(1);
    assert.exists(rects[0]);
    expect(softOf(rects[0].shape)).toBeGreaterThan(0);
    const byIdItem3 = byId(night)['screen'];
    assert.exists(byIdItem3);
    expect(byIdItem3.tint.some((l) => l.shape.k === 'poly')).toBe(false);
  });
  const tintOf = (i: lightTypes.LightIn) => {
    const byIdItem4 = byId(i)['screen'];
    assert.exists(byIdItem4);
    return byIdItem4.tint.reduce((a, l) => a + (l.erase === true ? 0 : l.alpha), 0);
  };
  it('throws less light by day than by night', () => {
    expect(tintOf({ ...day, night: 0 })).toBeLessThan(tintOf(night));
  });
  const at = (g: lightTypes.LightGeo) => {
    const byIdItem5 = byId(night, g)['screen'];
    assert.exists(byIdItem5);
    return byIdItem5.lit.map((l) => shapeX(l.shape));
  };
  it('follows the items: the screen light moves with the screen and the keyboard lift with the keyboard', () => {
    const a = at(G),
      b = at({
        ...G,
        screen: { ...G.screen, x: G.screen.x + 700 },
        monitor: { ...G.monitor, x: G.monitor.x + 700 },
        keyboard: { ...G.keyboard, x: G.keyboard.x + 700 },
      });
    expect(
      b.every((x, j) => {
        const aItem = a[j];
        assert.exists(aItem);
        return Math.abs(x - aItem - 700) < 1e-6;
      }),
    ).toBe(true);
  });
  it('moves every piece of a light by an offset, and by nothing as the same light', () => {
    const e = must(byId(night)['lamp']),
      m = shiftEmitter(e, 300, -200);
    expect(shiftEmitter(e, 0, 0)).toBe(e);
    assert.exists(m.clip);
    assert.exists(e.clip);
    expect(m.clip.x).toBe(e.clip.x + 300);
    const c0 = must(e.lit[0]).shape,
      c1 = must(m.lit[0]).shape;
    expect(c0.k).toBe('cone');
    const [x0, y0] = coneTip(c0),
      [x1, y1] = coneTip(c1);
    expect([x1 - x0, y1 - y0]).toStrictEqual([300, -200]);
  });
});
