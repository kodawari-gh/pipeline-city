import { describe, expect, it } from 'vitest';
import { fingerCentres, ramRoutes, type Foot, type Pt } from './ramface3d';

// a stick as `ramStick` lays it (units): 8 data chips in two groups, an ECC chip, the power chip and the SPD in the gap
const L = 2384, H = 720, notchU = 1500;
const chip = (y: number, h: number, kind: Foot['kind'], v0 = 480, v1 = 660): Foot => ({ u0: L + 8 - y - h, u1: L + 8 - y, v0, v1, kind });
const foot = (ecc: boolean): Foot[] => {
  const d = Array.from({ length: 8 }, (_, j) => chip((j < 4 ? 80 : 2400 - 80 - 4 * 262 + 32) + (j % 4) * 262, 230, 'dram'));
  const gy = (80 + 3 * 262 + 230 + 2400 - 80 - 4 * 262 + 32) / 2;
  if (ecc) d.push(chip(gy - 70, 140, 'reg'));
  d.push(chip(gy + (ecc ? 72 : -23), 46, 'pmic', 360, 410), chip(gy + (ecc ? -97 : 59), 22, 'spd', 310, 340));
  return d;
};

const cross = (a: Pt, b: Pt, c: Pt, d: Pt): boolean => {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

describe('the memory stick\'s copper', () => {
  it('puts the fingers in an even row with a gap at the key', () => {
    const f = fingerCentres(L, notchU, 144);
    expect(f).toHaveLength(144);
    const steps = f.slice(1).map((u, i) => u - f[i]!);
    expect(Math.max(...steps)).toBeGreaterThan(Math.min(...steps) * 2);
    expect(f.every((u) => u > 0 && u < L)).toBe(true);
  });

  it.each([false, true])('runs every line inside the PCB, up from its finger to under its part, crossing no other (ecc %s)', (ecc) => {
    const r = ramRoutes({ L, H, notchU, pins: 144, sink: 70, foot: foot(ecc) });
    expect(r.lines.length).toBe(144);
    for (const l of r.lines) for (const p of l) { expect(p[0]).toBeGreaterThan(0); expect(p[0]).toBeLessThan(L); expect(p[1]).toBeGreaterThan(60); expect(p[1]).toBeLessThan(H); }
    for (let i = 0; i < r.lines.length; i++) for (let j = i + 1; j < r.lines.length; j++)
      for (let a = 1; a < r.lines[i]!.length; a++) for (let b = 1; b < r.lines[j]!.length; b++)
        expect(cross(r.lines[i]![a - 1]!, r.lines[i]![a]!, r.lines[j]![b - 1]!, r.lines[j]![b]!), `${i} x ${j}`).toBe(false);
    // the data chips are fed: a pad under each
    expect(r.pads.length).toBeGreaterThan(100);
  });
});
