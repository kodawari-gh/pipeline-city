import type { BufferGeometry } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { LOW_NEAR_RINGS, type CityDetail } from './detail';
import { buildings, GRID, topOf, type Building } from './plan';
import { bearing, drawn } from './sweep';
import { massGeometries, type MassRing } from './towers';

/** `massGeometries` as the Low cut will call it (the third parameter does not exist yet). */
const withDetail = massGeometries as (bs: readonly Building[], washes: [], detail?: CityDetail) => MassRing[];

const sum = (g: BufferGeometry): number => Array.from(g.attributes.position!.array).reduce((s, v) => s + v, 0);
const total = (rs: MassRing[]): number => rs.reduce((n, r) => n + drawn(r.geometry), 0);
const away = (b: Building): number => Math.hypot((b.tiers[0]!.x0 + b.tiers[0]!.x1) / 2 - GRID.av0, b.tiers[0]!.z1);

describe('massGeometries detail', () => {
  let bs: Building[], high: MassRing[];
  beforeAll(() => { bs = buildings(); high = massGeometries(bs); }, 60000);

  it('lock: High is the same with the detail omitted or "high": rings, draws, positions', () => {
    const again = withDetail(bs, [], 'high');
    expect(again.length).toBe(high.length);
    expect(again.map((r) => drawn(r.geometry))).toEqual(high.map((r) => drawn(r.geometry)));
    expect(again.map((r) => sum(r.geometry))).toEqual(high.map((r) => sum(r.geometry)));
    expect(again.map((r) => r.balls.length)).toEqual(high.map((r) => r.balls.length));
  }, 60000);

  it('Low: the near rings stay and every ring past them is one mesh', () => {
    expect(withDetail(bs, [], 'low').length).toBe(LOW_NEAR_RINGS + 1);
  }, 60000);

  it('Low: the near rings are High\'s, building for building: fine clutter (door, step, lamp), and solar panels (kind 7)', () => {
    const low = withDetail(bs, [], 'low');
    // buildings under FINE (420 m) from the window: the near rings hold some, so the fine clutter is there to keep
    expect(bs.filter((b) => away(b) < 300).length, 'near buildings').toBeGreaterThan(0);
    const near = low.slice(0, LOW_NEAR_RINGS), hi = high.slice(0, LOW_NEAR_RINGS);
    expect(near.map((r) => r.at)).toEqual(hi.map((r) => r.at));
    expect(near.map((r) => sum(r.geometry))).toEqual(hi.map((r) => sum(r.geometry)));
    let solar = 0;
    for (const r of near) {
      const aux = r.geometry.attributes.aux!;
      for (let v = 0; v < aux.count; v++) if (Math.round(aux.getY(v)) === 7) solar++;
    }
    expect(solar, 'solar panel vertices in the near rings').toBeGreaterThan(0);
  }, 60000);

  it('Low: draws under 22% of the High triangles', () => {
    // (15% was the plain-block cut; far night lights — flood, LED, signs, crowns — add a little)
    // (17%: the far masts and spires keep their own silhouette pieces)
    // (22%: the near rings keep their fine clutter, the door, step and lamp, as High has it)
    expect(total(withDetail(bs, [], 'low'))).toBeLessThan(total(high) * 0.22);
  }, 60000);

  it('Low: the far mesh holds every far building as a plain block, of more than one height', () => {
    const low = withDetail(bs, [], 'low'), far = low[low.length - 1]!;
    // (the ring edge: ring 1 ends at 300 m)
    expect(far.balls.length).toBe(bs.filter((b) => away(b) >= 300).length);
    // each far building is a block, plus optional night pieces (flood, LED, signs, crowns, beacons)
    for (let i = 0; i < far.balls.length; i++) expect(far.at[i + 1]! - far.at[i]!).toBeGreaterThan(0);
    const aux = far.geometry.attributes.aux!;
    const lights = new Set<number>();
    for (let i = 0; i < aux.count; i++) lights.add(Math.round(aux.getY(i)));
    expect([3, 4, 5, 8, 9].some((k) => lights.has(k)), 'far blocks keep live night-light kinds').toBe(true);
    const pos = far.geometry.attributes.position!, tops = new Set<number>();
    for (let i = 0; i < far.balls.length; i++) {
      let top = -Infinity;
      for (let v = far.at[i]!; v < far.at[i + 1]!; v++) top = Math.max(top, pos.getY(v));
      tops.add(Math.round(top));
    }
    expect(tops.size).toBeGreaterThan(1);
  }, 60000);

  it('Low: a far mast or spire keeps its own pieces under its tip beacon (no floating beacon), and no roof clutter round a mast', () => {
    const far = withDetail(bs, [], 'low').at(-1)!;
    const pos = far.geometry.attributes.position!, aux = far.geometry.attributes.aux!;
    const kind = (v: number): number => Math.round(aux.getY(v));
    // the far balls are in the order `massGeometries` sorts them: by bearing of the first tier's middle
    const mid = (b: Building): number => bearing((b.tiers[0]!.x0 + b.tiers[0]!.x1) / 2, (b.tiers[0]!.z0 + b.tiers[0]!.z1) / 2);
    const farBs = bs.filter((b) => away(b) >= 300).sort((p, q) => mid(p) - mid(q));
    expect(farBs.length).toBe(far.balls.length);
    let checked = 0;
    for (let i = 0; i < farBs.length; i++) {
      const b = farBs[i]!, h = topOf(b);
      if ((b.crown !== 'mast' && b.crown !== 'spire') || h < 110) continue;
      checked++;
      const v0 = far.at[i]!, v1 = far.at[i + 1]!;
      // the tip: the lowest beacon vertex; the silhouette must reach up to it on a kept piece, not stop short
      let tip = Infinity;
      for (let v = v0; v < v1; v++) if (kind(v) === 3) tip = Math.min(tip, pos.getY(v));
      expect(tip, `${b.crown} tip beacon`).toBeLessThan(Infinity);
      // a mast's shaft is Plain, 1.1 m wide, from its 6 m base up (a box: its vertices sit on its bottom and top rings);
      // a spire's stages and needle are Plain (unlit) or Crown/Led/Flood (lit), with rings between its roof and its tip
      const cx = (b.tiers[b.tiers.length - 1]!.x0 + b.tiers[b.tiers.length - 1]!.x1) / 2, cz = (b.tiers[b.tiers.length - 1]!.z0 + b.tiers[b.tiers.length - 1]!.z1) / 2;
      let under = 0, reachesTip = false;
      for (let v = v0; v < v1; v++) {
        const y = pos.getY(v), k = kind(v);
        if (k !== 3 && Math.abs(y - tip) < 0.01) reachesTip = true;
        if (b.crown === 'mast') {
          if (k === 2 && y >= h + 6 - 0.01 && y < tip - 0.01 && Math.abs(pos.getX(v) - cx) <= 0.56 && Math.abs(pos.getZ(v) - cz) <= 0.56) under++;
        } else if ([2, 4, 5, 9].includes(k) && y > h + 1 && y < tip - 0.01) under++;
      }
      expect(reachesTip, `${b.crown} silhouette reaches its tip beacon`).toBe(true);
      expect(under, `${b.crown} keeps its silhouette between its roof and tip`).toBeGreaterThan(0);
      if (b.crown === 'mast') {
        // a mast's own footprint is all it keeps of the roof: no plain vertex outside its 3 m base in the first 6 m
        const t = b.tiers[b.tiers.length - 1]!, cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
        let stray = 0;
        for (let v = v0; v < v1; v++) {
          const y = pos.getY(v);
          if (kind(v) === 2 && y >= h - 0.01 && y < h + 6 - 0.01 && (Math.abs(pos.getX(v) - cx) > 1.5 + 1e-3 || Math.abs(pos.getZ(v) - cz) > 1.5 + 1e-3)) stray++;
        }
        expect(stray, 'mast: no roof clutter restored').toBe(0);
      }
    }
    expect(checked, 'far masts or spires, lit or not, with a beacon').toBeGreaterThan(0);
  }, 60000);

  it('Low: far blocks keep live Led corner strips (vertical, not only the top band)', () => {
    const far = withDetail(bs, [], 'low').at(-1)!;
    const pos = far.geometry.attributes.position!, aux = far.geometry.attributes.aux!, look = far.geometry.attributes.look!;
    // a corner strip is Led, grows across (look.w = Wide.Across = 1) and runs up a tier; the band is Led, Wide.Up, and flat
    let strips = 0, tallest = 0;
    for (let i = 0; i < far.balls.length; i++) {
      let lo = Infinity, hi = -Infinity, n = 0;
      for (let v = far.at[i]!; v < far.at[i + 1]!; v++) {
        if (Math.round(aux.getY(v)) !== 5 || Math.round(look.getW(v)) !== 1) continue;
        lo = Math.min(lo, pos.getY(v)); hi = Math.max(hi, pos.getY(v)); n++;
      }
      if (n > 0) strips++;
      tallest = Math.max(tallest, hi - lo);
    }
    expect(strips, 'far blocks with Led corner strips').toBeGreaterThan(0);
    expect(tallest, 'a corner strip runs up a tier, not a band').toBeGreaterThan(2);
  }, 60000);
});
