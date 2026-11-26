import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute } from 'three';
import { assert, beforeAll, describe, expect, it } from 'vitest';
import { LOW_NEAR_RINGS } from './detail';
import { buildings, GRID, topOf } from './plan';
import type * as planTypes from './plan';
import { bearing, drawn } from './sweep';
import { LOW_WHOLE, massGeometries, massSteps } from './towers/rings';
import type * as ringsTypes from './towers/rings';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const sum = (g: BufferGeometry): number => {
  assert.exists(g.attributes['position']);
  return [...g.attributes['position'].array].reduce((s, v) => s + v, 0);
};
const total = (rs: ringsTypes.MassRing[]): number => rs.reduce((n, r) => n + drawn(r.geometry), 0);
const away = (b: planTypes.Building): number => {
  assert.exists(b.tiers[0]);
  return Math.hypot((b.tiers[0].x0 + b.tiers[0].x1) / 2 - GRID.av0, b.tiers[0].z1);
};

/** A building's bearing from the window: its first tier's middle (the order `massGeometries` sorts the far balls in). */
const mid = (b: planTypes.Building): number => {
  assert.exists(b.tiers[0]);
  return bearing((b.tiers[0].x0 + b.tiers[0].x1) / 2, (b.tiers[0].z0 + b.tiers[0].z1) / 2);
};

/** The buildings of the far mesh (past 300 m), in its order. */
const farOf = (bs: planTypes.Building[]): planTypes.Building[] =>
  bs.filter((b) => away(b) >= 300).toSorted((p, q) => mid(p) - mid(q));

/** The places of the buildings that `keep` keeps. */
const where = (bs: planTypes.Building[], keep: (b: planTypes.Building) => boolean): number[] =>
  bs.flatMap((b, i) => (keep(b) ? [i] : []));

type Attr = BufferAttribute | InterleavedBufferAttribute;

/** How many vertices are of the kind (`aux.y`). */
function kindCount(aux: Attr, kind: number): number {
  let n = 0;
  for (let v = 0; v < aux.count; v++) {
    if (Math.round(aux.getY(v)) === kind) {
      n++;
    }
  }
  return n;
}

/** A building's vertices of one kind: their places, and their seeds. */
const of = (r: ringsTypes.MassRing, i: number, kind: number): { at: number[]; seeds: number[] } => {
  const pos = must(r.geometry.attributes['position']),
    aux = must(r.geometry.attributes['aux']),
    at: number[] = [],
    seeds: number[] = [];
  for (let v = must(r.at[i]); v < must(r.at[i + 1]); v++) {
    if (Math.round(aux.getY(v)) === kind) {
      at.push(pos.getX(v), pos.getY(v), pos.getZ(v));
      seeds.push(aux.getX(v));
    }
  }
  return { at, seeds };
};

/** Whether a building stands from `LOW_WHOLE` to 900 m (High's ring after the whole ones ends at 900 m: within it a roof has its plant, whose draws come before the crown's). */
const inBand = (b: planTypes.Building): boolean => away(b) >= LOW_WHOLE && away(b) < 900;

/** Whether a building is a mast or a spire of 110 m and up, past `LOW_WHOLE` (a building within it is High's whole one, roof plant and corner beacons too). */
const tallTip = (b: planTypes.Building): boolean =>
  (b.crown === 'mast' || b.crown === 'spire') && topOf(b) >= 110 && away(b) >= LOW_WHOLE;

/** What a far mast or spire keeps: its tip (the lowest beacon vertex), whether a kept piece reaches up to it, the vertices of its silhouette between its roof and the tip, and (a mast) the roof clutter round its base. */
function silhouette(
  far: ringsTypes.MassRing,
  i: number,
  b: planTypes.Building,
): { tip: number; reachesTip: boolean; under: number; stray: number } {
  const pos = must(far.geometry.attributes['position']),
    aux = must(far.geometry.attributes['aux']),
    kind = (v: number): number => Math.round(aux.getY(v)),
    h = topOf(b),
    v0 = must(far.at[i]),
    v1 = must(far.at[i + 1]);
  let tip = Infinity;
  for (let v = v0; v < v1; v++) {
    if (kind(v) === 3) {
      tip = Math.min(tip, pos.getY(v));
    }
  }
  // a mast's shaft is Plain, 1.1 m wide, from its 6 m base up (a box: its vertices sit on its bottom and top rings);
  // a spire's stages and needle are Plain (unlit) or Crown/Led/Flood (lit), with rings between its roof and its tip
  const t = must(b.tiers.at(-1)),
    cx = (t.x0 + t.x1) / 2,
    cz = (t.z0 + t.z1) / 2,
    mast = b.crown === 'mast';
  let under = 0,
    stray = 0,
    reachesTip = false;
  for (let v = v0; v < v1; v++) {
    const y = pos.getY(v),
      k = kind(v),
      dx = Math.abs(pos.getX(v) - cx),
      dz = Math.abs(pos.getZ(v) - cz);
    if (k !== 3 && Math.abs(y - tip) < 0.01) {
      reachesTip = true;
    }
    if (mast) {
      if (k === 2 && y >= h + 6 - 0.01 && y < tip - 0.01 && dx <= 0.56 && dz <= 0.56) {
        under++;
      }
      // a mast's own footprint is all it keeps of the roof: no plain vertex outside its 3 m base in the first 6 m
      if (k === 2 && y >= h - 0.01 && y < h + 6 - 0.01 && (dx > 1.5 + 1e-3 || dz > 1.5 + 1e-3)) {
        stray++;
      }
    } else if ([2, 4, 5, 9].includes(k) && y > h + 1 && y < tip - 0.01) {
      under++;
    }
  }
  return { tip, reachesTip, under, stray };
}

/** A far block's Led corner strip (Led, grows across: look.w = Wide.Across = 1): how many vertices, and how far up they run. */
function ledStrip(far: ringsTypes.MassRing, i: number): { n: number; span: number } {
  const pos = must(far.geometry.attributes['position']),
    aux = must(far.geometry.attributes['aux']),
    look = must(far.geometry.attributes['look']);
  let lo = Infinity,
    hi = -Infinity,
    n = 0;
  for (let v = must(far.at[i]); v < must(far.at[i + 1]); v++) {
    if (Math.round(aux.getY(v)) !== 5 || Math.round(look.getW(v)) !== 1) {
      continue;
    }
    lo = Math.min(lo, pos.getY(v));
    hi = Math.max(hi, pos.getY(v));
    n++;
  }
  return { n, span: hi - lo };
}

describe('massGeometries detail', () => {
  let bs: planTypes.Building[], high: ringsTypes.MassRing[];
  beforeAll(() => {
    bs = buildings();
    high = massGeometries(bs);
  }, 60_000);

  it('lock: High is the same with the detail omitted or "high": rings, draws, positions', () => {
    const again = massGeometries(bs, [], 'high');
    expect(again).toHaveLength(high.length);
    expect(again.map((r) => drawn(r.geometry))).toStrictEqual(high.map((r) => drawn(r.geometry)));
    expect(again.map((r) => sum(r.geometry))).toStrictEqual(high.map((r) => sum(r.geometry)));
    expect(again.map((r) => r.balls.length)).toStrictEqual(high.map((r) => r.balls.length));
  }, 60_000);

  it('Low: the near rings stay and every ring past them is one mesh', () => {
    expect(massGeometries(bs, [], 'low')).toHaveLength(LOW_NEAR_RINGS + 1);
  }, 60_000);

  it("Low: the near rings are High's, building for building: fine clutter (door, step, lamp), and solar panels (kind 7)", () => {
    const low = massGeometries(bs, [], 'low');
    // buildings under FINE (420 m) from the window: the near rings hold some, so the fine clutter is there to keep
    expect(bs.filter((b) => away(b) < 300).length, 'near buildings').toBeGreaterThan(0);
    const near = low.slice(0, LOW_NEAR_RINGS),
      hi = high.slice(0, LOW_NEAR_RINGS);
    expect(near.map((r) => r.at)).toStrictEqual(hi.map((r) => r.at));
    expect(near.map((r) => sum(r.geometry))).toStrictEqual(hi.map((r) => sum(r.geometry)));
    let solar = 0;
    for (const r of near) {
      const { aux } = r.geometry.attributes;
      assert.exists(aux);
      solar += kindCount(aux, 7);
    }
    expect(solar, 'solar panel vertices in the near rings').toBeGreaterThan(0);
  }, 60_000);

  it('Low: draws under 37% of the High triangles', () => {
    // (15% was the plain-block cut; far night lights — flood, LED, signs, crowns — add a little)
    // (17%: the far masts and spires keep their own silhouette pieces)
    // (22%: the near rings keep their fine clutter, the door, step and lamp, as High has it)
    // (37%: the buildings from 300 m to `LOW_WHOLE` are whole, the window looks down on their roofs; 295k of High's 823k)
    expect(total(massGeometries(bs, [], 'low'))).toBeLessThan(total(high) * 0.37);
  }, 60_000);

  it("Low: a far-mesh building within LOW_WHOLE is High's whole building, vertex for vertex", () => {
    const far = must(massGeometries(bs, [], 'low').at(-1)),
      ring = must(high[LOW_NEAR_RINGS]);
    const farBs = farOf(bs);
    // (`LOW_WHOLE` is the edge of High's ring after the near ones, so that ring is the whole buildings, in the same order)
    expect(farBs.filter((b) => away(b) < LOW_WHOLE)).toHaveLength(ring.balls.length);
    const lp = must(far.geometry.attributes['position']).array,
      hp = must(ring.geometry.attributes['position']).array,
      whole = where(farBs, (b) => away(b) < LOW_WHOLE);
    for (const [j, i] of whole.entries()) {
      const atItem = far.at[i + 1];
      assert.exists(atItem);
      const atItem4 = far.at[i];
      assert.exists(atItem4);
      expect(atItem - atItem4, `building ${j} vertices`).toBe(must(ring.at[j + 1]) - must(ring.at[j]));
      expect([...lp.subarray(3 * atItem4, 3 * atItem)]).toStrictEqual([
        ...hp.subarray(3 * must(ring.at[j]), 3 * must(ring.at[j + 1])),
      ]);
    }
    const j = whole.length;
    expect(j).toBeGreaterThan(100);
  }, 60_000);

  it("Low: a block past LOW_WHOLE keeps High's own crown lights, tip beacon and sign boards (the roof plant's draws still run)", () => {
    const far = must(massGeometries(bs, [], 'low').at(-1)),
      ring = must(high[LOW_NEAR_RINGS + 1]);
    const band = where(farOf(bs), inBand);
    let crowns = 0,
      boards = 0;
    for (const [j, i] of band.entries()) {
      const lc = of(far, i, 4),
        hc = of(ring, j, 4),
        ls = of(far, i, 8),
        hs = of(ring, j, 8),
        lb = of(far, i, 3),
        hb = of(ring, j, 3);
      expect(lc.at, `crown lights ${j}`).toStrictEqual(hc.at);
      expect(ls.at, `sign boards ${j}`).toStrictEqual(hs.at);
      expect(ls.seeds).toStrictEqual(hs.seeds);
      // a tip's beacon is High's first one (its seed comes from the building's stream, after the roof plant's draws; no tower that tall
      // stands in this band today)
      expect(lb.seeds.slice(0, 1)).toStrictEqual(hb.seeds.slice(0, Math.min(1, lb.seeds.length)));
      crowns += Number(lc.at.length > 0);
      boards += Number(ls.at.length > 0);
    }
    const j = band.length;
    expect(j).toBe(ring.balls.length);
    expect(crowns, 'blocks with crown lights').toBeGreaterThan(0);
    expect(boards, 'blocks with sign boards').toBeGreaterThan(0);
  }, 60_000);

  it('Low: the far mesh holds every far building (a plain block past LOW_WHOLE), of more than one height', () => {
    const low = massGeometries(bs, [], 'low'),
      far = must(low.at(-1));
    // (the ring edge: ring 1 ends at 300 m)
    expect(far.balls).toHaveLength(bs.filter((b) => away(b) >= 300).length);
    // each far building is a block, plus optional night pieces (flood, LED, signs, crowns, beacons)
    for (let i = 0; i < far.balls.length; i++) {
      const atItem3 = far.at[i + 1];
      assert.exists(atItem3);
      const atItem6 = far.at[i];
      assert.exists(atItem6);
      expect(atItem3 - atItem6).toBeGreaterThan(0);
    }
    const { aux } = far.geometry.attributes;
    assert.exists(aux);
    const lights = new Set<number>();
    for (let i = 0; i < aux.count; i++) {
      lights.add(Math.round(aux.getY(i)));
    }
    expect(
      [3, 4, 5, 8, 9].some((k) => lights.has(k)),
      'far blocks keep live night-light kinds',
    ).toBe(true);
    const pos = must(far.geometry.attributes['position']),
      tops = new Set<number>();
    for (let i = 0; i < far.balls.length; i++) {
      let top = -Infinity;
      for (let v = must(far.at[i]); v < must(far.at[i + 1]); v++) {
        top = Math.max(top, pos.getY(v));
      }
      tops.add(Math.round(top));
    }
    expect(tops.size).toBeGreaterThan(1);
  }, 60_000);

  it('Low: a far mast or spire keeps its own pieces under its tip beacon (no floating beacon), and no roof clutter round a mast', () => {
    const far = massGeometries(bs, [], 'low').at(-1);
    assert.exists(far);
    // the far balls are in the order `massGeometries` sorts them: by bearing of the first tier's middle
    const farBs = farOf(bs);
    expect(farBs).toHaveLength(far.balls.length);
    const tall = where(farBs, tallTip);
    for (const i of tall) {
      const b = must(farBs[i]);
      // the tip: the lowest beacon vertex; the silhouette must reach up to it on a kept piece, not stop short
      const { tip, reachesTip, under, stray } = silhouette(far, i, b);
      expect(tip, `${b.crown} tip beacon`).toBeLessThan(Infinity);
      expect(reachesTip, `${b.crown} silhouette reaches its tip beacon`).toBe(true);
      expect(under, `${b.crown} keeps its silhouette between its roof and tip`).toBeGreaterThan(0);
      // (a spire has no roof clutter to count: 0)
      expect(stray, 'mast: no roof clutter restored').toBe(0);
    }
    const checked = tall.length;
    expect(checked, 'far masts or spires, lit or not, with a beacon').toBeGreaterThan(0);
  }, 60_000);

  it('Low: far blocks keep live Led corner strips (vertical, not only the top band)', () => {
    const far = massGeometries(bs, [], 'low').at(-1);
    assert.exists(far);
    // a corner strip is Led, grows across (look.w = Wide.Across = 1) and runs up a tier; the band is Led, Wide.Up, and flat
    let strips = 0,
      tallest = 0;
    for (let i = 0; i < far.balls.length; i++) {
      const { n, span } = ledStrip(far, i);
      strips += Number(n > 0);
      tallest = Math.max(tallest, span);
    }
    expect(strips, 'far blocks with Led corner strips').toBeGreaterThan(0);
    expect(tallest, 'a corner strip runs up a tier, not a band').toBeGreaterThan(2);
  }, 60_000);
});

// BOOT-05: the boot builds the buildings while the baked textures load, a turn for the page every 20 ms (`OutsideView.make`)
describe('massSteps', () => {
  it.each(['high', 'low'] as const)(
    '%s: with no budget it yields after each building, and ends with the rings massGeometries makes',
    (detail) => {
      const bs = buildings(),
        run = massSteps(bs, [], { detail, budget: 0 });
      let yields = 0,
        step = run.next();
      while (step.done !== true) {
        yields++;
        step = run.next();
      }
      const whole = massGeometries(bs, [], detail);
      expect(yields).toBe(bs.length);
      expect(step.value.map((r) => r.at)).toStrictEqual(whole.map((r) => r.at));
      expect(step.value.map((r) => sum(r.geometry))).toStrictEqual(whole.map((r) => sum(r.geometry)));
      expect(step.value.map((r) => r.balls.map((b) => b.radius))).toStrictEqual(
        whole.map((r) => r.balls.map((b) => b.radius)),
      );
    },
    60_000,
  );

  it('never yields with an endless budget (`massGeometries`)', () => {
    const run = massSteps(buildings(), [], { detail: 'high', budget: Infinity });
    expect(run.next().done).toBe(true);
  }, 60_000);
});
