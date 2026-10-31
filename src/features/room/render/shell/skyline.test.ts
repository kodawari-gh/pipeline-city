import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { drawAircraft, drawCityLive, drawClouds, drawSkyline, drawStars, flickers, skylineK, starField, towers } from './skyline';

const W = { x: 0, y: 0, w: 5600, h: 9100 };

describe('the stars', () => {
  const stars = starField();
  it('are many, deterministic, inside the glass, and never two close together', () => {
    expect(stars.length).toBeGreaterThan(130);
    expect(starField()).toEqual(stars);
    for (const s of stars) { expect(s.u).toBeGreaterThan(0); expect(s.u).toBeLessThan(1); expect(s.v).toBeGreaterThan(0); expect(s.v).toBeLessThan(0.86); }
    for (let i = 0; i < stars.length; i++) for (let j = i + 1; j < stars.length; j++) expect(Math.hypot((stars[i]!.u - stars[j]!.u) * 0.78, stars[i]!.v - stars[j]!.v)).toBeGreaterThan(0.025);
  });
  it('are not on a grid: their columns and rows do not repeat, their sizes vary a lot (mostly small), their tones and twinkles differ', () => {
    const cols = new Set(stars.map((s) => Math.round(s.u * 200))), rows = new Set(stars.map((s) => Math.round(s.v * 200)));
    expect(cols.size).toBeGreaterThan(stars.length * 0.5); expect(rows.size).toBeGreaterThan(stars.length * 0.5);
    const small = stars.filter((s) => s.r < 25).length;
    expect(small).toBeGreaterThan(stars.length * 0.6); expect(stars.some((s) => s.r > 40)).toBe(true);
    expect(new Set(stars.map((s) => s.tone)).size).toBe(3);
    expect(new Set(stars.map((s) => s.rate.toFixed(2))).size).toBeGreaterThan(40);
    expect(stars.some((s) => s.sparkle)).toBe(true);
  });
  it('come out with the night and draw nothing by day', () => {
    const day = new Graphics(), night = new Graphics();
    drawStars(day, W, 0, 0); drawStars(night, W, 1, 0);
    expect(day.context.instructions.length).toBe(0); expect(night.context.instructions.length).toBeGreaterThan(100);
  });
});

describe('the city', () => {
  const k = skylineK(W.h);
  it('has three rows of towers across the whole glass, with varied heights, roofs and a landmark, none taller than the glass allows', () => {
    const ts = towers(W.w, W.h);
    expect(ts.length).toBeGreaterThan(20);
    for (const layer of [0, 1, 2] as const) { const row = ts.filter((t) => t.layer === layer); expect(row.length).toBeGreaterThanOrEqual(5); expect(Math.min(...row.map((t) => t.x))).toBeLessThan(0); expect(Math.max(...row.map((t) => t.x + t.w))).toBeGreaterThan(W.w); }
    expect(new Set(ts.map((t) => t.roof)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(ts.map((t) => Math.round(t.h / 100))).size).toBeGreaterThan(15);
    const land = ts.find((t) => t.roof === 'spire')!;
    expect(land.h).toBe(3700 * k); expect(land.beacon).toBe(true);
    for (const t of ts) expect(t.h).toBeLessThan(W.h * 0.55);
    expect(towers(W.w, W.h)).toEqual(ts);
  });
  it('does not stretch its towers with a tall window', () => {
    expect(skylineK(6400)).toBe(1); expect(skylineK(20000)).toBe(1.25); expect(skylineK(3200)).toBe(0.5);
  });
  it('draws a lot at night (windows, flickers, beacons, clouds by day, the aircraft) without failing, and little windows by day', () => {
    const d = new Graphics(), n = new Graphics(), live = new Graphics(), cl = new Graphics(), ac = new Graphics();
    drawSkyline(d, W, 0, '#aabbdd'); drawSkyline(n, W, 1, '#223366');
    drawCityLive(live, W, 1, 1600); drawClouds(cl, W, 0, '#aabbdd', 5000); drawAircraft(ac, W, 1, 10000);
    expect(n.context.instructions.length).toBeGreaterThan(d.context.instructions.length * 0.6);
    expect(live.context.instructions.length).toBeGreaterThan(5);
    expect(cl.context.instructions.length).toBeGreaterThan(10);
    expect(ac.context.instructions.length).toBeGreaterThan(0);
    expect(flickers(W).length).toBeGreaterThan(10);
    const none = new Graphics(); drawCityLive(none, W, 0, 1600); expect(none.context.instructions.length).toBe(0);
  });
});
