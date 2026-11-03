import { describe, expect, it } from 'vitest';
import { FLOOR_Y, WALL_T, WINDOW } from '../roomplan';
import { CURB, FLOOR_UP, M, SIDE, SIDE_TURN, Z, cars, cutWall, eavesOf, houses, lamps, openings, sideOf, sidePoint, toOutside, trees } from './plan';

describe('outside plan', () => {
  it('puts the room on the third floor, its outer wall face on the street side at z = 0', () => {
    expect(toOutside(0, -FLOOR_Y, 0)[1]).toBeCloseTo(FLOOR_UP);
    expect(toOutside(0, 0, -WALL_T)[2]).toBeCloseTo(0);
    expect(toOutside(M, 0, 0)[0]).toBeCloseTo(1);
    // the window's sill stands nearly 9 m over the road
    expect(toOutside(0, -(WINDOW.y + WINDOW.h), 0)[1]).toBeGreaterThan(8.5);
  });

  it('walks the side street both ways', () => {
    const [x, z] = sidePoint(40, -3);
    const back = sideOf(x, z);
    expect(back.s).toBeCloseTo(40);
    expect(back.t).toBeCloseTo(-3);
    // it runs away from us, a little west
    expect(sidePoint(100, 0)[1]).toBeLessThan(Z.kerbFar - 90);
    expect(sidePoint(100, 0)[0]).toBeLessThan(SIDE.x0);
    // a thing turned by SIDE_TURN has its -z along the street
    expect(-Math.sin(SIDE_TURN)).toBeCloseTo(SIDE.dir[0]);
    expect(-Math.cos(SIDE_TURN)).toBeCloseTo(SIDE.dir[1]);
  });

  it('cuts a wall round its openings: the pieces and the holes make the whole wall', () => {
    const holes = [{ x0: -2, x1: -1, y0: 1, y1: 2.5 }, { x0: 1, x1: 2, y0: 0, y1: 2 }, { x0: -2, x1: -1, y0: 3, y1: 4 }];
    const pieces = cutWall(-3, 3, 0, 5, holes);
    const area = (b: { x0: number; x1: number; y0: number; y1: number }) => (b.x1 - b.x0) * (b.y1 - b.y0);
    expect(pieces.reduce((s, b) => s + area(b), 0) + holes.reduce((s, b) => s + area(b), 0)).toBeCloseTo(30);
    for (const p of pieces) for (const h of holes) {
      const overlap = Math.min(p.x1, h.x1) - Math.max(p.x0, h.x0) > 1e-6 && Math.min(p.y1, h.y1) - Math.max(p.y0, h.y0) > 1e-6;
      expect(overlap).toBe(false);
    }
  });

  it('opens each house within its facade, under its eaves', () => {
    for (const h of houses()) {
      const e = eavesOf(h);
      for (const o of openings(h)) {
        expect(o.x0).toBeGreaterThan(-h.w / 2);
        expect(o.x1).toBeLessThan(h.w / 2);
        if (o.kind !== 'attic') expect(o.y1).toBeLessThan(e);
      }
      expect(openings(h).filter((o) => o.kind === 'door')).toHaveLength(1);
    }
  });

  it('keeps every house off the streets and off its neighbours', () => {
    const hs = houses();
    expect(hs.length).toBeGreaterThan(40);
    for (const h of hs) {
      // the four corners of its footprint
      const c = Math.cos(h.rot), s = Math.sin(h.rot);
      for (const [lx, lz] of [[-h.w / 2, 0], [h.w / 2, 0], [-h.w / 2, -h.d], [h.w / 2, -h.d]] as const) {
        const x = h.x + lx * c + lz * s, z = h.z - lx * s + lz * c;
        expect(z).toBeLessThan(Z.walkFar);
        const p = sideOf(x, z);
        if (p.s > -5 && p.s < SIDE.len + 5) expect(Math.abs(p.t)).toBeGreaterThan(SIDE.walk);
      }
    }
    const across = hs.filter((h) => h.rot === 0).sort((a, b) => a.x - b.x);
    for (let i = 1; i < across.length; i++) expect(across[i]!.x - across[i]!.w / 2).toBeGreaterThanOrEqual(across[i - 1]!.x + across[i - 1]!.w / 2);
  });

  it('stands trees and lamps off the roads', () => {
    for (const p of [...trees(), ...lamps()]) {
      expect(p.z > Z.kerb || p.z < Z.kerbFar).toBe(true);
      const q = sideOf(p.x, p.z);
      if (q.s > 0 && q.s < SIDE.len) expect(Math.abs(q.t)).toBeGreaterThan(SIDE.kerb);
    }
  });

  it('parks the cars in their lanes, clear of each other and of the side street', () => {
    const cs = cars();
    for (const lane of [Z.kerb - 1, Z.kerbFar + 1]) {
      const row = cs.filter((c) => c.z === lane).sort((a, b) => a.x - b.x);
      expect(row.length).toBeGreaterThan(4);
      for (let i = 1; i < row.length; i++) expect(row[i]!.x - row[i - 1]!.x).toBeGreaterThan((row[i]!.len + row[i - 1]!.len) / 2 + 0.5);
    }
    // the mouth of the side street is kept clear on the far side
    for (const c of cs.filter((k) => k.z === Z.kerbFar + 1)) expect(Math.abs(sideOf(c.x, Z.kerbFar).t)).toBeGreaterThan(SIDE.walk + 2.5);
    // the side street's cars stand on its road, by the kerb
    for (const c of cs.filter((k) => k.z !== Z.kerb - 1 && k.z !== Z.kerbFar + 1)) expect(Math.abs(sideOf(c.x, c.z).t)).toBeLessThan(SIDE.kerb);
    expect(CURB).toBeGreaterThan(0.1);
  });
});
