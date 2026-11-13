import { describe, expect, it } from 'vitest';
import { FrameWindow, statsText } from './stats';

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
      w: 1, h: 1, calls: 0, scale: 1, post: false,
    });
    expect(text).toContain('dpr 2.2 ratio 2.625');
    expect(text).not.toContain('0000');
    const half = statsText({
      fps: 60, avgMs: 16.7, p95Ms: 20, tier: 'high', reason: 'x', mode: 'auto', dpr: 1.5, ratio: 1.5,
      w: 1, h: 1, calls: 0, scale: 1, post: false,
    });
    expect(half).toContain('dpr 1.5 ratio 1.5');
  });

  it('holds the numbers of the snapshot', () => {
    const text = statsText({
      fps: 58.4, avgMs: 17.1, p95Ms: 24.6, tier: 'medium', reason: 'integrated GPU', mode: 'auto', dpr: 3, ratio: 1.5,
      w: 1170, h: 2532, calls: 312, scale: 0.75, post: true,
    });
    expect(text.split('\n').length).toBeGreaterThan(3);
    for (const want of ['58.4', '17.1', '24.6', 'medium', 'integrated GPU', 'auto', '3', '1.5', '1170', '2532', '312', '0.75']) {
      expect(text).toContain(want);
    }
  });
});
