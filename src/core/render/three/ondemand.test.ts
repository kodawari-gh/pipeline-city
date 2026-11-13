import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { BATCH_MS, DrawGate, ViewWatch, frameDt, sceneChanged } from './ondemand';

describe('DrawGate', () => {
  it('draws the first tick, then waits', () => {
    const g = new DrawGate();
    expect(g.want(0)).toBe(true);
    expect(g.want(16)).toBe(false);
    expect(g.want(33)).toBe(false);
  });

  it('an ask draws the next tick once', () => {
    const g = new DrawGate();
    g.want(0);
    g.ask();
    g.ask();
    expect(g.want(16)).toBe(true);
    expect(g.want(33)).toBe(false);
  });

  it('draws while busy, and one tick more for the end pose', () => {
    const g = new DrawGate();
    g.want(0);
    expect(g.want(16, true)).toBe(true);
    expect(g.want(33, true)).toBe(true);
    expect(g.want(50, false)).toBe(true);
    expect(g.want(66, false)).toBe(false);
  });

  it('a scene change from outside draws the next tick of every gate', () => {
    const a = new DrawGate(), b = new DrawGate();
    a.want(0); b.want(0);
    sceneChanged();
    expect(a.want(16)).toBe(true);
    expect(b.want(16)).toBe(true);
    expect(a.want(33)).toBe(false);
  });

  it('keeps drawing until the time it was told', () => {
    const g = new DrawGate();
    g.want(0);
    g.keep(0, 100);
    g.keep(0, 40);
    expect(g.want(50)).toBe(true);
    expect(g.want(99)).toBe(true);
    expect(g.want(100)).toBe(false);
  });

  it('scene changes with more on their way draw in batches, and the last one at once', () => {
    const g = new DrawGate();
    g.want(0);
    let drawn = 0;
    // a tile bakes each 16 ms tick for a second
    for (let t = 16; t < 1000; t += 16) { sceneChanged(); if (g.want(t, false, true)) drawn++; }
    expect(drawn).toBeGreaterThanOrEqual(4);
    expect(drawn).toBeLessThanOrEqual(Math.ceil(1000 / BATCH_MS));
    // the queue is empty: the tiles not yet shown draw now, then nothing
    sceneChanged();
    expect(g.want(1000, false, false)).toBe(true);
    expect(g.want(1016, false, false)).toBe(false);
  });

  it('a held change is not lost when the queue empties with no new one', () => {
    const g = new DrawGate();
    g.want(0);
    sceneChanged();
    expect(g.want(16, false, true)).toBe(false);
    expect(g.want(33, false, false)).toBe(true);
  });

  it('an ask or a busy source draws at once while changes are held', () => {
    const g = new DrawGate();
    g.want(0);
    sceneChanged();
    expect(g.want(16, false, true)).toBe(false);
    g.ask();
    expect(g.want(33, false, true)).toBe(true);
    sceneChanged();
    expect(g.want(50, true, true)).toBe(true);
  });

  it('tells a frame with a change from one that only moves', () => {
    const g = new DrawGate();
    g.want(0);
    expect(g.forced).toBe(true);
    g.want(16, true);
    expect(g.forced).toBe(false);
    sceneChanged();
    g.want(33, true);
    expect(g.forced).toBe(true);
    g.want(50, true);
    g.ask();
    g.want(66);
    expect(g.forced).toBe(true);
  });
});

describe('ViewWatch', () => {
  const W = 1000, H = 800;
  const cam = (): PerspectiveCamera => {
    const c = new PerspectiveCamera(28, W / H, 4, 100000);
    c.position.set(0, 0, 0);
    c.lookAt(0, 0, -1);
    c.updateProjectionMatrix();
    return c;
  };

  it('has no shift to give before a mark, or after a new size', () => {
    const w = new ViewWatch(), c = cam();
    expect(w.shift(c, W, H, 100, 300)).toBe(Infinity);
    w.mark(c, W, H);
    expect(w.shift(c, W + 2, H, 100, 300)).toBe(Infinity);
  });

  it('a camera that stands gives no shift', () => {
    const w = new ViewWatch(), c = cam();
    w.mark(c, W, H);
    expect(w.shift(c, W, H, 100, 300)).toBeLessThan(1e-6);
  });

  it('a side step moves the near points the most, by the step over the depth', () => {
    const w = new ViewWatch(), c = cam();
    w.mark(c, W, H);
    c.position.x = 0.5;
    const p00 = c.projectionMatrix.elements[0];
    expect(w.shift(c, W, H, 100, 300)).toBeCloseTo((0.5 / 100) * p00 * W / 2, 6);
    expect(w.shift(c, W, H, 200, 300)).toBeCloseTo((0.5 / 200) * p00 * W / 2, 6);
  });

  it('a small turn moves the picture a little, a turn behind the eye is a full redraw', () => {
    const w = new ViewWatch(), c = cam();
    w.mark(c, W, H);
    c.rotation.y = 1e-4;
    const s = w.shift(c, W, H, 100, 300);
    expect(s).toBeGreaterThan(0.1);
    expect(s).toBeLessThan(1);
    c.rotation.y = Math.PI;
    expect(w.shift(c, W, H, 100, 300)).toBe(Infinity);
  });
});

describe('frameDt', () => {
  it('is the seconds from last to now', () => {
    expect(frameDt(1016, 1000)).toBeCloseTo(0.016, 9);
  });
  it('is never negative when the timestamp is earlier than the stored last', () => {
    expect(frameDt(1000, 1016)).toBe(0);
    expect(frameDt(0, 5000)).toBe(0);
  });
  it('is capped', () => {
    expect(frameDt(60000, 0)).toBe(0.1);
    expect(frameDt(60000, 0, 0.25)).toBe(0.25);
  });
});
