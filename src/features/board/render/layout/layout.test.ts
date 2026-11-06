import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Container } from 'pixi.js';
import { Camera } from '@/core/render/camera';
import { roomBox } from '@/features/room/render/shell/room';
import { CASE, DESK_Y, MONITOR, PORTRAIT_ASPECT, TRAY, WORLD, overviewFrame, setLayoutTier, type Rect } from './layout';

// The camera only needs an element and a container (as in camera.test.ts); no DOM.
const fakeEl = () => ({ style: {}, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 823 }) }) as unknown as HTMLElement;
const fakeWorld = () => ({ scale: { set() {} }, position: { set() {} } }) as unknown as Container;
const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** A 9:19 phone held upright (390 x 823 CSS px), the HUD's bars over its top and bottom, the room as the bounds. */
function phone(): Camera {
  const c = new Camera(fakeWorld(), fakeEl());
  c.resize(390, 823);
  c.snapInset({ top: 48, right: 0, bottom: 64, left: 0 });
  c.bounds = roomBox();
  return c;
}

beforeAll(() => { (globalThis as unknown as { window: unknown }).window = { addEventListener() {} }; });
afterAll(() => setLayoutTier(2));

describe('the overview on a phone held upright (9:19)', () => {
  it('frames the case, from its top to the desk, and leaves the monitor for a pan', () => {
    const c = phone(), a = c.fitArea, f = overviewFrame(a.w / a.h);
    expect(a.w / a.h).toBeLessThan(PORTRAIT_ASPECT);
    expect(inside(CASE, f)).toBe(true);
    expect(f.y + f.h).toBeGreaterThanOrEqual(DESK_Y);
    expect(f.x).toBeGreaterThan(MONITOR.x + MONITOR.w);
  });

  it('draws the case across the screen, much bigger than the whole scene would be', () => {
    const c = phone(), a = c.fitArea, z = c.fit(overviewFrame(a.w / a.h), 0.95).z;
    expect(z).toBeGreaterThan(c.fit(overviewFrame(16 / 9), 0.95).z * 1.3);
    expect(CASE.w * z).toBeGreaterThan(a.w * 0.85);
    expect(CASE.h * z).toBeLessThan(a.h);
  });

  it('the player can pan to the monitor and the key tray: the room bounds let either sit whole on the screen', () => {
    const c = phone(), a = c.fitArea, z = c.fit(overviewFrame(a.w / a.h), 0.95).z;
    for (const r of [MONITOR, TRAY]) {
      const v = c.clampView({ x: r.x + r.w / 2, y: r.y + r.h / 2, z }), hw = a.w / 2 / z, hh = a.h / 2 / z;
      expect(inside(r, { x: v.x - hw, y: v.y - hh, w: 2 * hw, h: 2 * hh })).toBe(true);
    }
  });

  it('holds in every case size', () => {
    for (const t of [0, 1, 2, 3]) {
      setLayoutTier(t);
      const f = overviewFrame(9 / 19);
      expect(inside(CASE, f)).toBe(true);
      expect(f.x).toBeGreaterThan(MONITOR.x + MONITOR.w);
    }
  });
});

describe('the overview on a wide or square screen', () => {
  it('frames the whole scene: the machine, the monitor and the wall plate', () => {
    for (const k of [16 / 9, 4 / 3, 1, PORTRAIT_ASPECT]) {
      const f = overviewFrame(k);
      expect(inside(WORLD, f)).toBe(true);
      expect(inside(MONITOR, f)).toBe(true);
    }
  });
});
