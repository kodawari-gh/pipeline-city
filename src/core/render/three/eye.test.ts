import { describe, expect, it } from 'vitest';
import { Eye } from './eye';

const KEY = 0.04 / 1.2,
  RANGE = [0.3, 14] as const,
  DT = 1 / 30;

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

  it('a held eye stays where it stands: a lens that darkens the picture on purpose must not be lifted back', () => {
    const e = new Eye(KEY, RANGE);
    run(e, 0.05, 300);
    const goal = e.goal,
      seen = e.seen;
    e.hold(true);
    expect(e.holding).toBe(true);
    // (a picture 25 times darker would lift the exposure to its limit)
    run(e, 0.002, 300);
    expect(e.goal).toBe(goal);
    expect(e.seen).toBeCloseTo(seen, 6);
    expect(e.moving).toBe(false);
  });

  it('drops the first readings after the hold, which are of the darkened picture, then reads again', () => {
    const e = new Eye(KEY, RANGE);
    e.read(0.05);
    const goal = e.goal;
    e.hold(true);
    e.hold(false);
    // (the readings in flight when the lens went off: the dark picture's)
    e.read(0.002);
    e.read(0.002);
    expect(e.goal).toBe(goal);
    // the next one is the picture now on the screen
    e.read(0.2);
    expect(e.goal).not.toBe(goal);
    expect(e.goal).toBeLessThan(goal);
    // (a hold that was never on drops nothing)
    const f = new Eye(KEY, RANGE);
    f.hold(false);
    f.read(0.05);
    expect(f.goal).toBeCloseTo(Math.min(14, KEY / 0.05), 6);
  });
});
