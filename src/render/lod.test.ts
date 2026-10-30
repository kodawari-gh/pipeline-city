import { describe, expect, it } from 'vitest';
import { BASE_LOD, DEVICE_LOD, FAR_ZOOM, LodClock, TierBudget, ZoomSwitch, bandAlpha, deviceLod, onBand, seenZoom, smooth, zoomSlow } from './lod';

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

describe('DEVICE_LOD', () => {
  it('has ordered fade bands', () => {
    for (const [name, d] of Object.entries(DEVICE_LOD)) {
      const fade = (d as { fade?: readonly [number, number] }).fade;
      if (fade) expect(fade[0], name).toBeLessThan(fade[1]);
    }
  });
  it('lets the insides take hits only once the lid has started to fade', () => {
    for (const d of [DEVICE_LOD.gpu, DEVICE_LOD.npu, DEVICE_LOD.tpm, DEVICE_LOD.die]) expect(d.hover).toBeGreaterThanOrEqual(d.fade[0]);
  });
  it('shows names before counters on every card', () => {
    for (const d of [DEVICE_LOD.gpu, DEVICE_LOD.npu, DEVICE_LOD.tpm]) {
      expect(d.text).toBeGreaterThan(d.fade[0]);
      expect(d.detail).toBeGreaterThan(d.text);
    }
  });
  it('fades a layer in over its band', () => {
    const b = onBand(0.8);
    expect(bandAlpha(0.79, b)).toBe(0);
    expect(bandAlpha(0.8 * 1.15, b)).toBe(1);
    expect(bandAlpha(0.86, b)).toBeGreaterThan(0);
    expect(bandAlpha(0.86, b)).toBeLessThan(1);
  });
});

describe('LodClock', () => {
  it('follows the camera and never overshoots', () => {
    const c = new LodClock(1);
    let prev = 1;
    for (let i = 0; i < 120; i++) {
      c.update(1 / 60, 4);
      expect(c.zs).toBeGreaterThanOrEqual(prev);
      expect(c.zs).toBeLessThanOrEqual(4);
      prev = c.zs;
    }
    expect(c.zs).toBeCloseTo(4, 2);
  });
  it('takes the same time for a doubling at any zoom (log space)', () => {
    const a = new LodClock(0.1), b = new LodClock(2);
    a.update(1 / 60, 0.2); b.update(1 / 60, 4);
    expect(a.zs / 0.1).toBeCloseTo(b.zs / 2, 6);
  });
  it('crosses a threshold over several frames, not in one', () => {
    const c = new LodClock(0.18); // a wheel flick of x1.45 across 0.2
    let frames = 0;
    while (c.zs < 0.2) { c.update(1 / 60, 0.26); frames++; }
    expect(frames).toBeGreaterThanOrEqual(2);
  });
  it('settles exactly and reports it', () => {
    const c = new LodClock(1);
    for (let i = 0; i < 600; i++) c.update(1 / 60, 2);
    expect(c.zs).toBe(2);
    expect(c.settled).toBe(true);
    expect(c.update(1 / 60, 2)).toBe(false);
  });
  it('clamps a long frame so a stall does not jump', () => {
    const c = new LodClock(1);
    c.update(5, 8);
    expect(c.zs).toBeLessThan(8);
  });
  it('snaps', () => {
    const c = new LodClock(1);
    c.snap(3);
    expect(c.zs).toBe(3);
    expect(c.settled).toBe(true);
    expect(c.update(1 / 60, 3)).toBe(false);
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
    const small = deviceLod({ x: 780, y: 280, w: 40, h: 40 }, view).focus, big = deviceLod({ x: 500, y: 100, w: 600, h: 400 }, view).focus;
    expect(small).toBeCloseTo(big, 5);
  });
});

describe('zoomSlow', () => {
  it('runs at full pace when zoomed out and crawls to 0.5 s per cycle at the closest zoom', () => {
    expect(zoomSlow(0.25, 4.5)).toBe(1);
    expect(zoomSlow(6, 4.5)).toBeCloseTo(2 / 4.5);
  });
  it('slows steadily as the camera comes in', () => {
    const a = zoomSlow(1, 4.5), b = zoomSlow(2, 4.5), c = zoomSlow(4, 4.5);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });
  it('leaves a replay that is already slower than the floor alone', () => {
    expect(zoomSlow(6, 1)).toBe(1);
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
});

describe('TierBudget', () => {
  it('lets the devices nearest the focus take the slots', () => {
    const b = new TierBudget(2);
    const top = b.assign([{ id: 'a', focus: 0.2 }, { id: 'b', focus: 0.9 }, { id: 'c', focus: 0.6 }]);
    expect([...top].sort()).toEqual(['b', 'c']);
  });
  it('keeps a holder until a challenger leads by the margin', () => {
    const b = new TierBudget(1, 0.15);
    b.assign([{ id: 'a', focus: 0.5 }, { id: 'b', focus: 0.4 }]);
    expect([...b.assign([{ id: 'a', focus: 0.5 }, { id: 'b', focus: 0.6 }])]).toEqual(['a']); // 0.1 ahead: not enough
    expect([...b.assign([{ id: 'a', focus: 0.5 }, { id: 'b', focus: 0.8 }])]).toEqual(['b']);
  });
  it('drops a tier that is no longer wanted at once', () => {
    const b = new TierBudget(2);
    b.assign([{ id: 'a', focus: 1 }, { id: 'b', focus: 1 }]);
    expect([...b.assign([{ id: 'b', focus: 1 }])]).toEqual(['b']);
  });
});

describe('ZoomSwitch', () => {
  it('bakes below the threshold and unbakes only past the dead band', () => {
    const s = new ZoomSwitch(0.2);
    expect(s.update(0.3)).toBe(false);
    expect(s.update(0.19)).toBe(true);
    expect(s.update(0.21)).toBe(true); // wobble across the line: still baked
    expect(s.update(0.2 * 1.08 + 0.001)).toBe(false);
  });
  it('does not flip on a wobble', () => {
    const s = new ZoomSwitch(0.2);
    let flips = 0, last = s.update(0.25);
    for (let i = 0; i < 100; i++) {
      const on = s.update(0.2 + 0.015 * Math.sin(i));
      if (on !== last) flips++;
      last = on;
    }
    expect(flips).toBeLessThanOrEqual(1);
  });
  it('warms up before the threshold when zooming out', () => {
    const s = new ZoomSwitch(0.2);
    s.update(0.3);
    expect(s.warm).toBe(false);
    s.update(0.22);
    expect(s.warm).toBe(true);
    expect(s.on).toBe(false);
  });
  it('keeps the warm ring through a wobble and always holds it while on', () => {
    const s = new ZoomSwitch(0.2);
    s.update(0.22);
    expect(s.warm).toBe(true);
    s.update(0.235); // just over the warm line, inside its dead band
    expect(s.warm).toBe(true);
    s.update(0.26);
    expect(s.warm).toBe(false);
    for (const z of [0.15, 0.19, 0.21, 0.24, 0.25]) { s.update(z); if (s.on) expect(s.warm).toBe(true); }
  });
});
