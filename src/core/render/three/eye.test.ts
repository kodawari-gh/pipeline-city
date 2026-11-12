import { describe, expect, it } from 'vitest';
import { Eye } from './eye';

const KEY = 0.04 / 1.2, RANGE = [0.3, 14] as const, DT = 1 / 30;

/** A scene of luminance `lum` seen at the eye's exposure: the reading depends a little on it, and jitters by +-1 %. */
function reading(lum: number, e: Eye, n: number): number {
  const jitter = 1 + 0.01 * (n % 2 ? 1 : -1);
  return lum * (0.9 + 0.1 * e.seen) * jitter;
}

/** Runs ticks as the stage does; returns the tick where it rested for good, or -1. */
function run(e: Eye, lum: number, ticks: number): number {
  let rest = -1;
  for (let n = 0; n < ticks; n++) {
    e.step(DT);
    if (e.moving) rest = -1;
    else if (rest < 0) rest = n;
    e.read(reading(lum, e, n));
  }
  return rest;
}

describe('Eye', () => {
  it('rests under jitter and stays at rest', () => {
    const e = new Eye(KEY, RANGE);
    const rest = run(e, 0.05, 300);
    expect(rest).toBeGreaterThanOrEqual(0);
    expect(rest).toBeLessThan(200);
  });

  it('moves again for a 2x change and settles at the right factor', () => {
    const e = new Eye(KEY, RANGE);
    run(e, 0.05, 300);
    const before = e.seen;
    e.read(reading(0.1, e, 0));
    expect(e.moving).toBe(true);
    expect(run(e, 0.1, 400)).toBeGreaterThanOrEqual(0);
    expect(e.seen / before).toBeGreaterThan(0.4);
    expect(e.seen / before).toBeLessThan(0.6);
  });

  it('clamps to the range', () => {
    const e = new Eye(KEY, RANGE);
    e.read(1e-9);
    expect(e.goal).toBe(14);
    e.read(1e9);
    expect(e.goal).toBe(0.3);
  });

  it('a null reading changes nothing', () => {
    const e = new Eye(KEY, RANGE);
    e.read(null);
    expect(e.goal).toBe(1);
    expect(e.moving).toBe(false);
  });
});
