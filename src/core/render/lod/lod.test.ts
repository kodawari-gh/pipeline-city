import { describe, expect, it } from 'vitest';
import {
  DEVICE_LOD,
  DIE_SHOW,
  FAR_ZOOM,
  TierBudget,
  bandAlpha,
  deviceLod,
  dieShow,
  dieZoom,
  onBand,
  seenZoom,
  smooth,
  zoomSlow,
} from './lod';

describe('the lid rule', () => {
  it('opens a die over the same on-screen width, whatever its size', () => {
    for (const side of [10, 300, 2500]) {
      expect(dieShow(DIE_SHOW[0] / side, side)).toBe(0);
      expect(dieShow(DIE_SHOW[1] / side, side)).toBe(1);
      expect(dieShow(dieZoom(side), side)).toBe(1);
      const mid = dieShow((DIE_SHOW[0] + DIE_SHOW[1]) / 2 / side, side);
      expect(mid).toBeGreaterThan(0.4);
      expect(mid).toBeLessThan(0.6);
    }
  });
});

describe('smooth', () => {
  it('runs 0..1 over the band and clamps', () => {
    expect(smooth(0.2, 0.4, 0.1)).toBe(0);
    expect(smooth(0.2, 0.4, 0.3)).toBeCloseTo(0.5);
    expect(smooth(0.2, 0.4, 0.9)).toBe(1);
  });
  it('runs backwards when a > b', () => {
    expect(smooth(1.9, 1.5, 2)).toBe(0);
    expect(smooth(1.9, 1.5, 1)).toBe(1);
  });
});

/** Each device's fade band, for the devices that have one. */
const FADES = Object.entries(DEVICE_LOD).flatMap(([name, d]) => ('fade' in d ? [[name, d.fade] as const] : []));

describe('DEVICE_LOD', () => {
  it('has ordered fade bands', () => {
    for (const [name, fade] of FADES) {
      expect(fade[0], `${name}: fade band`).toBeLessThan(fade[1]);
    }
  });
  it('lets the insides take hits only once the lid has started to fade', () => {
    for (const d of [DEVICE_LOD.gpu, DEVICE_LOD.npu, DEVICE_LOD.tpm, DEVICE_LOD.disk, DEVICE_LOD.die]) {
      expect(d.hover).toBeGreaterThanOrEqual(d.fade[0]);
    }
  });
  it('shows names before counters on every card', () => {
    for (const d of [DEVICE_LOD.gpu, DEVICE_LOD.npu, DEVICE_LOD.tpm, DEVICE_LOD.disk]) {
      expect(d.text).toBeGreaterThan(d.fade[0]);
      expect(d.detail).toBeGreaterThan(d.text);
    }
  });
  it('puts the disk architecture between its names and its counters', () => {
    const d = DEVICE_LOD.disk;
    expect(d.arch).toBeGreaterThan(d.text);
    expect(d.arch).toBeLessThan(d.detail);
    expect(d.arch).toBeGreaterThan(d.fade[1]);
  });
  it('fades a layer in over its band', () => {
    const b = onBand(0.8);
    expect(bandAlpha(0.79, b)).toBe(0);
    expect(bandAlpha(0.8 * 1.15, b)).toBe(1);
    expect(bandAlpha(0.86, b)).toBeGreaterThan(0);
    expect(bandAlpha(0.86, b)).toBeLessThan(1);
  });
});

describe('the shared ladder', () => {
  it('reads every device at the camera zoom while it is at the centre, whatever its size', () => {
    expect(seenZoom(0.8)).toBeCloseTo(0.8);
    expect(seenZoom(0.8, 1)).toBeCloseTo(0.8);
  });
  it('reads a device further from the centre at a lower zoom', () => {
    expect(seenZoom(1, 0)).toBeCloseTo(FAR_ZOOM);
    expect(seenZoom(1, 0.5)).toBeGreaterThan(FAR_ZOOM);
    expect(seenZoom(1, 0.5)).toBeLessThan(1);
  });
  it('gives a big and a small device the same focus at the same distance from the centre', () => {
    const view = { x: 0, y: 0, w: 1000, h: 600 };
    const small = deviceLod({ x: 780, y: 280, w: 40, h: 40 }, view).focus,
      big = deviceLod({ x: 500, y: 100, w: 600, h: 400 }, view).focus;
    expect(small).toBeCloseTo(big, 5);
  });
});

describe('zoomSlow', () => {
  it('runs at the game pace when zoomed out', () => {
    expect(zoomSlow(0.25, 4.5, 1)).toBe(1);
    expect(zoomSlow(0.25, 4.5, 2)).toBe(2);
  });
  it('crawls to one second per cycle from zoom 1 up, at any game speed', () => {
    for (const scale of [1, 2, 3]) {
      expect(zoomSlow(1, 4.5, scale)).toBeCloseTo(1 / 4.5);
      expect(zoomSlow(6, 4.5, scale)).toBeCloseTo(1 / 4.5);
    }
  });
  it('slows steadily as the camera comes in', () => {
    const a = zoomSlow(0.4, 4.5, 2),
      b = zoomSlow(0.6, 4.5, 2),
      c = zoomSlow(0.9, 4.5, 2);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });
  it('keeps a paused game paused', () => {
    expect(zoomSlow(6, 4.5, 0)).toBe(0);
  });
  it('leaves a replay that is already slower than the floor alone', () => {
    expect(zoomSlow(6, 0.5, 1)).toBe(1);
  });
});

describe('deviceLod', () => {
  const view = { x: 0, y: 0, w: 1000, h: 600 };
  it('is on screen when it overlaps the view, with a margin', () => {
    expect(deviceLod({ x: 100, y: 100, w: 50, h: 50 }, view).onScreen).toBe(true);
    expect(deviceLod({ x: 1050, y: 100, w: 20, h: 50 }, view).onScreen).toBe(true); // inside the 10 % margin
    expect(deviceLod({ x: 1500, y: 100, w: 50, h: 50 }, view).onScreen).toBe(false);
    expect(deviceLod({ x: 100, y: -400, w: 50, h: 50 }, view).onScreen).toBe(false);
  });
  it('has full focus at the centre, falling toward the edge, none off screen', () => {
    const mid = deviceLod({ x: 480, y: 280, w: 40, h: 40 }, view).focus;
    const edge = deviceLod({ x: 900, y: 500, w: 40, h: 40 }, view).focus;
    expect(mid).toBeCloseTo(1, 1);
    expect(edge).toBeLessThan(mid);
    expect(edge).toBeGreaterThanOrEqual(0);
    expect(deviceLod({ x: 3000, y: 0, w: 10, h: 10 }, view).focus).toBe(0);
  });
  it('reads a long device where the view is on it when asked (`near`)', () => {
    const card = { x: -200, y: 250, w: 3800, h: 100 };
    expect(deviceLod(card, view).focus).toBe(0); // its middle is far off to the right
    expect(deviceLod(card, view, 0.1, true).focus).toBe(1);
  });
});

describe('TierBudget', () => {
  it('lets the devices nearest the focus take the slots', () => {
    const b = new TierBudget(2);
    const top = b.assign([
      { id: 'a', focus: 0.2 },
      { id: 'b', focus: 0.9 },
      { id: 'c', focus: 0.6 },
    ]);
    expect([...top].toSorted()).toStrictEqual(['b', 'c']);
  });
  it('keeps a holder until a challenger leads by the margin', () => {
    const b = new TierBudget(1, 0.15);
    b.assign([
      { id: 'a', focus: 0.5 },
      { id: 'b', focus: 0.4 },
    ]);
    expect([
      ...b.assign([
        { id: 'a', focus: 0.5 },
        { id: 'b', focus: 0.6 },
      ]),
    ]).toStrictEqual(['a']); // 0.1 ahead: not enough
    expect([
      ...b.assign([
        { id: 'a', focus: 0.5 },
        { id: 'b', focus: 0.8 },
      ]),
    ]).toStrictEqual(['b']);
  });
  it('drops a tier that is no longer wanted at once', () => {
    const b = new TierBudget(2);
    b.assign([
      { id: 'a', focus: 1 },
      { id: 'b', focus: 1 },
    ]);
    expect([...b.assign([{ id: 'b', focus: 1 }])]).toStrictEqual(['b']);
  });
});
