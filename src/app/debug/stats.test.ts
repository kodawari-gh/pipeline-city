import { describe, expect, it } from 'vitest';
import { DrawnFrames, FrameWindow, statsText, viewportOf } from './stats';

describe('viewportOf', () => {
  it('reads the window and screen sizes and the orientation the screen reports', () => {
    const v = viewportOf({ innerWidth: 485, innerHeight: 997 }, { width: 485, height: 997, orientation: { type: 'portrait-primary' } });
    expect(v).toEqual({ vw: 485, vh: 997, sw: 485, sh: 997, orient: 'portrait-primary' });
  });

  it('without screen.orientation, the orientation comes from the window size', () => {
    expect(viewportOf({ innerWidth: 997, innerHeight: 485 }, { width: 997, height: 485 }).orient).toBe('landscape (by size)');
    expect(viewportOf({ innerWidth: 485, innerHeight: 997 }, { width: 485, height: 997 }).orient).toBe('portrait (by size)');
  });
});

describe('DrawnFrames', () => {
  const RAF = 1000 / 120;

  it('counts only drawn frames: a draw every 4th rAF at 120 Hz is 30 fps', () => {
    const d = new DrawnFrames();
    for (let i = 0; i <= 240; i++) d.tick(i * RAF, i % 4 === 0 ? 5 : 0);
    expect(d.fps()).toBeCloseTo(30, 0);
    expect(d.avg()).toBeCloseTo(33.3, 0);
  });

  it('a draw every 2nd rAF at 120 Hz is 60 fps', () => {
    const d = new DrawnFrames();
    for (let i = 0; i <= 240; i++) d.tick(i * RAF, i % 2 === 0 ? 5 : 0);
    expect(d.fps()).toBeCloseTo(60, 0);
    expect(d.avg()).toBeCloseTo(16.7, 0);
  });

  it('a 3 s still gap is not pushed: the readout reads still and 0, then resumes without the gap', () => {
    const d = new DrawnFrames();
    for (let i = 0; i <= 120; i++) d.tick(i * RAF, i % 4 === 0 ? 5 : 0);
    const before = d.avg();
    const t0 = 120 * RAF;
    // nothing draws for 3 s while the rAFs go on
    for (let i = 1; i <= 360; i++) d.tick(t0 + i * RAF, 0);
    expect(d.still()).toBe(true);
    expect([d.fps(), d.avg(), d.p95()]).toEqual([0, 0, 0]);
    // the first draw after the gap restarts the anchor: the 3 s is not a frame interval
    d.tick(t0 + 3000 + RAF, 5);
    expect(d.still()).toBe(false);
    expect(d.avg()).toBeCloseTo(before, 5);
    expect(d.p95()).toBeLessThan(100);
  });

  it('reads still before anything has drawn', () => {
    const d = new DrawnFrames();
    d.tick(0, 0);
    expect(d.still()).toBe(true);
    expect(d.fps()).toBe(0);
  });
});

describe('FrameWindow', () => {
  it('is empty: avg, p95 and fps are 0', () => {
    const w = new FrameWindow();
    expect(w.avg()).toBe(0);
    expect(w.p95()).toBe(0);
    expect(w.fps()).toBe(0);
  });

  it('averages the frame intervals', () => {
    const w = new FrameWindow();
    for (const ms of [10, 20, 30, 40]) w.push(ms);
    expect(w.avg()).toBe(25);
    expect(w.fps()).toBe(40);
  });

  it('takes the nearest-rank p95: sorted[ceil(0.95 n) - 1]', () => {
    const w = new FrameWindow();
    // 20 frames of 1..20 ms: ceil(0.95 * 20) - 1 = 18, so the 19th smallest (19 ms)
    for (let i = 1; i <= 20; i++) w.push(i);
    expect(w.p95()).toBe(19);
    // 100 frames of 1..100: ceil(95) - 1 = 94, so 95 ms
    const v = new FrameWindow();
    for (let i = 1; i <= 100; i++) v.push(i);
    expect(v.p95()).toBe(95);
  });

  it('takes the nearest rank where floor would be one lower', () => {
    // n = 10: ceil(9.5) - 1 = 9 -> 10 (floor would give 9); n = 30: ceil(28.5) - 1 = 28 -> 29 (floor: 28)
    const ten = new FrameWindow();
    for (const v of [7, 1, 10, 4, 2, 9, 5, 3, 8, 6]) ten.push(v);
    expect(ten.p95()).toBe(10);
    const thirty = new FrameWindow();
    for (let i = 30; i >= 1; i--) thirty.push(i);
    expect(thirty.p95()).toBe(29);
  });

  it('a single frame is its own p95', () => {
    const w = new FrameWindow();
    w.push(16);
    expect(w.p95()).toBe(16);
  });

  it('keeps only the last 120 frames', () => {
    const w = new FrameWindow();
    for (let i = 0; i < 120; i++) w.push(100); // old, slow frames
    for (let i = 0; i < 120; i++) w.push(10); // the newest 120 are fast
    expect(w.avg()).toBe(10);
    expect(w.p95()).toBe(10);
    expect(w.fps()).toBe(100);
  });
});

describe('statsText', () => {
  it('rounds dpr and ratio to 3 decimals without trailing zeros', () => {
    const text = statsText({
      fps: 60, avgMs: 16.7, p95Ms: 20, tier: 'high', reason: 'x', mode: 'auto', dpr: 2.200000047683716, ratio: 2.625,
      w: 1, h: 1, calls: 0, scale: 1, post: false, shadows: 3, lights: 0, vw: 1, vh: 1, sw: 1, sh: 1, orient: 'x',
    });
    expect(text).toContain('dpr 2.2 ratio 2.625');
    expect(text).not.toContain('0000');
    const half = statsText({
      fps: 60, avgMs: 16.7, p95Ms: 20, tier: 'high', reason: 'x', mode: 'auto', dpr: 1.5, ratio: 1.5,
      w: 1, h: 1, calls: 0, scale: 1, post: false, shadows: 3, lights: 0, vw: 1, vh: 1, sw: 1, sh: 1, orient: 'x',
    });
    expect(half).toContain('dpr 1.5 ratio 1.5');
  });

  it('holds the numbers of the snapshot', () => {
    const text = statsText({
      fps: 58.4, avgMs: 17.1, p95Ms: 24.6, tier: 'medium', reason: 'integrated GPU', mode: 'auto', dpr: 3, ratio: 1.5,
      w: 1170, h: 2532, calls: 312, scale: 0.75, post: true, shadows: 2, lights: 4,
      vw: 390, vh: 844, sw: 390, sh: 844, orient: 'portrait-primary',
    });
    expect(text.split('\n').length).toBeGreaterThan(3);
    for (const want of ['58.4', '17.1', '24.6', 'medium', 'integrated GPU', 'auto', '3', '1.5', '1170', '2532', '312', '0.75']) {
      expect(text).toContain(want);
    }
  });

  it('shows the shadows and lights values and the viewport line', () => {
    const text = statsText({
      fps: 60, avgMs: 16.7, p95Ms: 20, tier: 'high', reason: 'x', mode: 'auto', dpr: 2.225, ratio: 1.5,
      w: 727, h: 1495, calls: 0, scale: 1, post: false, shadows: 0, lights: 4,
      vw: 485, vh: 997, sw: 485, sh: 997, orient: 'portrait-primary',
    });
    expect(text).toContain('shadows 0');
    expect(text).toContain('lights 4');
    expect(text).toContain('view 485x997, screen 485x997, portrait-primary');
  });
});
