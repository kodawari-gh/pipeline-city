// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
import { describe, expect, it } from 'vitest';
import { catenary, hangCable, pathLen, startFall, stepFall, tiePoints, type Pt } from './cable';

const fs = fsMod as any;
const SRC: string = urlMod.fileURLToPath(new URL('../../', import.meta.url));

describe('cable physics', () => {
  it('a rope longer than the chord sags below it and has the length it was given', () => {
    const a: Pt = [0, 0], b: Pt = [1000, 0], pts = catenary(a, b, 1150, 60);
    expect(pts[0]).toEqual(a);
    expect(pts[60]![0]).toBeCloseTo(1000, 3);
    expect(Math.max(...pts.map((p) => p[1]))).toBeGreaterThan(100); // screen down is positive: it hangs
    expect(pathLen(pts)).toBeGreaterThan(1130);
    expect(pathLen(pts)).toBeLessThan(1170);
  });

  it('a rope as short as the chord is straight; it is symmetrical level and sags less the tighter it is', () => {
    const straight = catenary([0, 0], [500, 300], 400);
    expect(straight.every((p) => Math.abs(p[1] - (p[0] * 300) / 500) < 1e-6)).toBe(true);
    const loose = catenary([0, 0], [1000, 0], 1200, 40), tight = catenary([0, 0], [1000, 0], 1020, 40);
    const sag = (l: Pt[]) => Math.max(...l.map((p) => p[1]));
    expect(sag(loose)).toBeGreaterThan(sag(tight));
    expect(loose[10]![1]).toBeCloseTo(loose[30]![1], 1);
  });

  it('it runs to the left as well and reaches a higher end', () => {
    const l = catenary([1000, 0], [0, -400], 1300, 40);
    expect(l[40]![0]).toBeCloseTo(0, 3);
    expect(l[40]![1]).toBeCloseTo(-400, 3);
    expect(Math.max(...l.map((p) => p[1]))).toBeGreaterThanOrEqual(0);
  });

  it('a cable hangs from its fixed end along the way it leaves, and ends at the plug', () => {
    const anchor: Pt = [200, 0], tip: Pt = [900, 700], pts = hangCable(anchor, [0, -1], tip);
    expect(pts[0]).toEqual(anchor);
    expect(pts[pts.length - 1]![0]).toBeCloseTo(900, 3);
    expect(pts[pts.length - 1]![1]).toBeCloseTo(700, 3);
    expect(pts[3]![1]).toBeLessThan(anchor[1] + 1); // it starts by going up
    for (const p of pts) expect(Number.isFinite(p[0] + p[1])).toBe(true);
  });

  it('a cable shorter than the distance is pulled straight and a plug right under the fixed end makes a loop to the side', () => {
    const t = hangCable([0, 0], [0, 1], [800, 0], { len: 500 });
    expect(Math.max(...t.map((p) => Math.abs(p[1])))).toBeLessThan(100); // only the stub leaves its line
    const u = hangCable([0, 0], [0, 1], [0, 600], { len: 900 });
    expect(Math.max(...u.map((p) => Math.abs(p[0])))).toBeGreaterThan(100);
  });

  it('a plug that is let go falls, bounces, slides to its rest place and stops there', () => {
    const anchor: Pt = [0, 0], rest: Pt = [300, 900];
    const f = startFall([400, 100], [200, 0]);
    let t = 0;
    while (!f.done && t < 10) { stepFall(f, 1 / 60, anchor, 1400, rest); t += 1 / 60; }
    expect(f.done).toBe(true);
    expect(t).toBeLessThan(4);
    expect(f.p).toEqual(rest);
  });

  it('a falling plug never gets farther from the fixed end than the cable is long', () => {
    const anchor: Pt = [0, 0], rest: Pt = [100, 2000], f = startFall([900, 0], [1500, 0]);
    for (let i = 0; i < 300; i++) { stepFall(f, 1 / 60, anchor, 1000, rest); expect(Math.hypot(f.p[0] - anchor[0], f.p[1] - anchor[1])).toBeLessThan(1001); }
  });

  it('ties go along a long run and stay clear of its ends', () => {
    const pts: Pt[] = Array.from({ length: 101 }, (_, i) => [i * 50, 0] as Pt);
    const ties = tiePoints(pts, 1500, 260);
    expect(ties.length).toBeGreaterThan(2);
    for (const t of ties) { expect(t.at[0]).toBeGreaterThan(259); expect(t.at[0]).toBeLessThan(5000 - 259); }
  });

  it('every cable takes its sleeve from one place: no other file spells the sleeve colours', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}${e.name}`; if (e.isDirectory()) walk(`${p}/`); else if (/\.ts$/.test(e.name) && !/^cable\.(test\.)?ts$/.test(e.name)) files.push(p); } };
    walk(SRC);
    const bad = files.filter((f) => /#171d29|#2a313d|#36457a|#8fa3d6/i.test(fs.readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
