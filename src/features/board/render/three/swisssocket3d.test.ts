// The Swiss sockets (swisssocket3d.ts): the triple socket's pinwheel (where each recess and its holes stand, how a plug is turned in it) and the socket built from it,
// a recess at any scale, and the room's two-gang wall plate.
import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { mat } from '@/core/render/three/materials';
import { roomGeo } from '@/features/room/render/shell/room';
import { lozenge, SWISS, T13 } from './plugs3d';
import {
  inPinwheel,
  pinHoles,
  pinwheel,
  recessHoles,
  recessOutline,
  ROOM_SOCKET,
  TRIPLE,
  tripleSocket,
  wallPlate,
} from './swisssocket3d';
import { quietCanvas } from './testutil';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;
function asMesh(o: unknown): three.Mesh {
  if (!isMesh(o)) {
    throw new Error('expected a three.Mesh');
  }
  return o;
}

const isMeshStandardMaterial = (o: unknown): o is three.MeshStandardMaterial =>
  typeof o === 'object' && o !== null && 'isMeshStandardMaterial' in o && o.isMeshStandardMaterial === true;
function asMeshStandardMaterial(o: unknown): three.MeshStandardMaterial {
  if (!isMeshStandardMaterial(o)) {
    throw new Error('expected a three.MeshStandardMaterial');
  }
  return o;
}

quietCanvas();

const MM = 23;
/** A closed outline of a socket (its recess drawn in by `inset` mm; a negative inset grows it: a plug's shoulder) in mm from the screw. */
const outline = (s: ReturnType<typeof pinwheel>[number], inset: number): [number, number][] =>
  lozenge(inset).map((p) => inPinwheel(s, p));
const segDist = (p: readonly number[], a: readonly number[], b: readonly number[]): number => {
  const dx = must(b[0]) - must(a[0]),
    dy = must(b[1]) - must(a[1]),
    t = Math.max(
      0,
      Math.min(1, ((must(p[0]) - must(a[0])) * dx + (must(p[1]) - must(a[1])) * dy) / (dx * dx + dy * dy)),
    );
  return Math.hypot(must(p[0]) - must(a[0]) - t * dx, must(p[1]) - must(a[1]) - t * dy);
};
/** The least distance between two closed outlines (neither inside the other). */
const gap = (a: [number, number][], b: [number, number][]): number => {
  let m = Infinity;
  for (const [p, q] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const v of p) {
      for (let i = 0; i < q.length; i++) {
        m = Math.min(m, segDist(v, must(q[i]), must(q[(i + 1) % q.length])));
      }
    }
  }
  return m;
};

const box = (p: { x: number; y: number }[]): { x0: number; x1: number; y0: number; y1: number } => ({
  x0: Math.min(...p.map((q) => q.x)),
  x1: Math.max(...p.map((q) => q.x)),
  y0: Math.min(...p.map((q) => q.y)),
  y1: Math.max(...p.map((q) => q.y)),
});

describe('the pinwheel', () => {
  const [top, left, right] = pinwheel();

  function assert_turns_the_three_sockets_120_degrees_from_each_ot(): void {
    for (const s of [top, left, right]) {
      expect(Math.hypot(s.x, s.y)).toBeCloseTo(TRIPLE.reach, 5);
    }
    // (a plug turned by `roll` has its live and neutral side on the socket's outer side, its earth pin toward the screw)
    expect(top.roll).toBeCloseTo(0, 5);
    expect(left.roll).toBeCloseTo((120 * Math.PI) / 180, 5);
    expect(right.roll).toBeCloseTo((240 * Math.PI) / 180, 5);
    expect(top.y).toBeGreaterThan(0);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    expect(left.y).toBeLessThan(0);
    expect(left.y).toBeCloseTo(right.y, 5);
  }

  it('turns the three sockets 120 degrees from each other round the screw, each 17.35 mm out', () => {
    expect.hasAssertions();
    assert_turns_the_three_sockets_120_degrees_from_each_ot();
  });

  function assert_puts_each_socket_s_earth_hole_11_8_mm_from_the_s(): void {
    for (const s of [top, left, right]) {
      const [l, n, e] = pinHoles(s);
      expect(Math.hypot(must(e)[0], must(e)[1])).toBeCloseTo(11.8, 1);
      expect(Math.hypot(must(l)[0], must(l)[1])).toBeCloseTo(19.3, 1);
      expect(Math.hypot(must(n)[0], must(n)[1])).toBeCloseTo(19.3, 1);
      // (the pair 19 apart, the earth hole 5 from their line and on its screw side)
      expect(Math.hypot(must(l)[0] - must(n)[0], must(l)[1] - must(n)[1])).toBeCloseTo(19, 5);
      const mid = [(must(l)[0] + must(n)[0]) / 2, (must(l)[1] + must(n)[1]) / 2];
      expect(Math.hypot(must(e)[0] - must(mid[0]), must(e)[1] - must(mid[1]))).toBeCloseTo(5, 5);
      expect(Math.hypot(...(mid as [number, number]))).toBeGreaterThan(Math.hypot(must(e)[0], must(e)[1]));
    }
  }

  it("puts each socket's earth hole 11.8 mm from the screw and its live and neutral holes 19.3 mm, as a real one measures", () => {
    expect.hasAssertions();
    assert_puts_each_socket_s_earth_hole_11_8_mm_from_the_s();
  });

  function assert_leaves_3_mm_of_the_insert_between_two_recesses_a(): void {
    const o = [top, left, right].map((s) => outline(s, 0));
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [0, 2],
    ] as const) {
      expect(gap(must(o[a]), must(o[b]))).toBeGreaterThan(2.8);
    }
    for (const r of o) {
      for (const [x, y] of r) {
        expect(Math.abs(x)).toBeLessThan(TRIPLE.insert / 2 - 1.5);
        expect(Math.abs(y)).toBeLessThan(TRIPLE.insert / 2 - 1.5);
      }
    }
  }

  it("leaves 3 mm of the insert between two recesses, and the recesses clear of the insert's edge", () => {
    expect.hasAssertions();
    assert_leaves_3_mm_of_the_insert_between_two_recesses_a();
  });

  function assert_lets_a_plug_in_each_of_the_three_sockets_at_once(): void {
    // (a shoulder is the recess's outline a hair out: 0.6 mm each, of the 3 between two recesses)
    const sh = [top, left, right].map((s) => outline(s, -SWISS.shoulder.out));
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [0, 2],
    ] as const) {
      expect(gap(must(sh[a]), must(sh[b]))).toBeGreaterThan(1.5);
    }
  }

  it('lets a plug in each of the three sockets at once: the shoulders stand clear of each other', () => {
    expect.hasAssertions();
    assert_lets_a_plug_in_each_of_the_three_sockets_at_once();
  });
});

describe('tripleSocket', () => {
  const look = { plate: mat(0xcf_d2_d8), black: mat(0x05_06_08), steel: mat(0xb9_ba_bf) };
  const build = (): { g: three.Group; root: three.Group } => {
    const root = new three.Group();
    const g = tripleSocket(root, { x: 1000, y: 2000, z: 700, face: 700 + 18 * MM, look });
    return { g, root };
  };

  it('builds a 91 mm square frame round the screw, from the wall to the face and not past it', () => {
    const { g, root } = build(),
      b = new three.Box3().setFromObject(g);
    expect(root.children).toContain(g);
    expect(g.name).toBe('wall.mains');
    expect((b.max.x - b.min.x) / MM).toBeCloseTo(91, 0);
    expect((b.max.y - b.min.y) / MM).toBeCloseTo(91, 0);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(1000, 0);
    expect((b.min.y + b.max.y) / 2).toBeCloseTo(2000, 0);
    expect(b.min.z).toBeGreaterThanOrEqual(700 - 2);
    expect(b.max.z).toBeLessThanOrEqual(700 + 18 * MM + 1);
  });

  function assert_cuts_each_recess_down_to_its_floor_13_mm_under_t(): void {
    const { g } = build(),
      floor = 700 + (18 - T13.deep) * MM;
    const holes = g.children.filter(
      (o) =>
        isMesh(o) &&
        asMeshStandardMaterial(asMesh(o).material) === look.black &&
        new three.Box3().setFromObject(o).min.z < floor,
    );
    // (nine contact holes, the three in each floor; the screw's slot is black too, but it stands at the face)
    expect(holes).toHaveLength(9);
    for (const h of holes) {
      const b = new three.Box3().setFromObject(h);
      expect(b.max.z).toBeCloseTo(floor + 0.3 * MM, 0);
      expect((b.max.x - b.min.x) / MM).toBeCloseTo(T13.hole, 1);
    }
  }

  it('cuts each recess down to its floor, 13 mm under the face, with three black holes in it', () => {
    expect.hasAssertions();
    assert_cuts_each_recess_down_to_its_floor_13_mm_under_t();
  });
});

describe('a recess of a plate', () => {
  function assert_is_the_traced_hexagon_at_the_scale_it_is_drawn_a(): void {
    for (const k of [14, 23]) {
      const b = box(recessOutline({ x: 100, y: 200, roll: 0 }, k));
      expect((b.x1 - b.x0) / k).toBeGreaterThan(38.5);
      expect((b.x1 - b.x0) / k).toBeLessThan(39.5);
      expect((b.y1 - b.y0) / k).toBeCloseTo(22.1, 1);
      expect((b.x0 + b.x1) / 2).toBeCloseTo(100, 0);
      expect((b.y0 + b.y1) / 2).toBeCloseTo(200, 0);
    }
  }

  it('is the traced hexagon at the scale it is drawn at, 39 x 22.1 mm, round its middle', () => {
    expect.hasAssertions();
    assert_is_the_traced_hexagon_at_the_scale_it_is_drawn_a();
  });

  it('turns with a plug: a quarter turn stands the hexagon on its end', () => {
    const b = box(recessOutline({ x: 0, y: 0, roll: Math.PI / 2 }, 10));
    expect((b.y1 - b.y0) / 10).toBeGreaterThan(38.5);
    expect((b.x1 - b.x0) / 10).toBeCloseTo(22.1, 1);
  });

  it("puts the three holes where the plug's pins go: the live and the neutral one 19 apart, the earth one 5 under them, all turned with it", () => {
    const [l, n, e] = recessHoles({ x: 50, y: 70, roll: 0 }, 14);
    expect(must(l)[0]).toBeCloseTo(50 - (T13.pitch / 2) * 14, 5);
    expect(must(n)[0]).toBeCloseTo(50 + (T13.pitch / 2) * 14, 5);
    expect(must(l)[1]).toBeCloseTo(70 + T13.ln * 14, 5);
    expect(must(e)[0]).toBeCloseTo(50, 5);
    expect(must(e)[1]).toBeCloseTo(70 + (T13.ln - T13.earth) * 14, 5);
    // (the earth hole stays on the same side of the pair, turned with the recess)
    const [l2, n2, e2] = recessHoles({ x: 0, y: 0, roll: Math.PI }, 14);
    expect(must(l2)[0]).toBeCloseTo((T13.pitch / 2) * 14, 5);
    expect(must(n2)[0]).toBeCloseTo(-(T13.pitch / 2) * 14, 5);
    expect(must(e2)[1]).toBeCloseTo(-(T13.ln - T13.earth) * 14, 5);
  });
});

describe('wallPlate', () => {
  const look = { plate: mat(0x2a_2d_32), black: mat(0x05_06_08) };
  const g = roomGeo(),
    p = g.socket.plate,
    { k, face } = ROOM_SOCKET,
    floor = face - T13.deep * k;
  const build = (): { plate: three.Group; root: three.Group } => {
    const root = new three.Group();
    return { plate: wallPlate(root, { rect: p, outlets: [g.socket.mon, g.socket.pc], face, k, look }), root };
  };

  it("builds the room's plate over its layout rect, from the wall to the face and not past it", () => {
    const { plate, root } = build(),
      b = new three.Box3().setFromObject(plate);
    expect(root.children).toContain(plate);
    expect(b.min.x).toBeCloseTo(p.x, 0);
    expect(b.max.x).toBeCloseTo(p.x + p.w, 0);
    expect(b.min.y).toBeCloseTo(-(p.y + p.h), 0);
    expect(b.max.y).toBeCloseTo(-p.y, 0);
    expect(b.min.z).toBeGreaterThanOrEqual(-2);
    expect(b.max.z).toBeLessThanOrEqual(face + 1);
    expect(b.max.z).toBeGreaterThan(face - 2);
  });

  function assert_cuts_a_recess_for_each_outlet_down_to_its_floor_(): void {
    const { plate } = build();
    const holes = plate.children.filter((o) => isMesh(o) && asMeshStandardMaterial(asMesh(o).material) === look.black);
    expect(holes).toHaveLength(6);
    for (const h of holes) {
      const b = new three.Box3().setFromObject(h);
      expect(b.max.z).toBeCloseTo(floor + 0.3 * k, 0);
      expect((b.max.x - b.min.x) / k).toBeCloseTo(T13.hole, 1);
    }
  }

  it('cuts a recess for each outlet down to its floor, 13 mm under the face, with three black holes in it', () => {
    expect.hasAssertions();
    assert_cuts_a_recess_for_each_outlet_down_to_its_floor_();
  });

  function assert_fits_the_room_s_layout_both_recesses_upright_on_(): void {
    const rs = [g.socket.mon, g.socket.pc].map((o) => recessOutline({ x: o.x, y: -o.y, roll: 0 }, k));
    const [a, c] = rs.map((r) => ({
      x0: Math.min(...r.map((q) => q.x)),
      x1: Math.max(...r.map((q) => q.x)),
      y0: Math.min(...r.map((q) => q.y)),
      y1: Math.max(...r.map((q) => q.y)),
    }));
    // (the monitor's is the west one: its outlet stands at 0.28 of the plate, the PC's at 0.72)
    expect(must(a).x1).toBeLessThan(must(c).x0 - 5 * k);
    // (the frame's rim, 5.5 mm, and a little more of the insert)
    for (const r of [must(a), must(c)]) {
      expect(r.x0).toBeGreaterThan(p.x + 7 * k);
      expect(r.x1).toBeLessThan(p.x + p.w - 7 * k);
      expect(r.y0).toBeGreaterThan(-(p.y + p.h) + 7 * k);
      expect(r.y1).toBeLessThan(-p.y - 7 * k);
    }
  }

  it("fits the room's layout: both recesses upright on the plate at the outlets, a web between them, the frame clear of them", () => {
    expect.hasAssertions();
    assert_fits_the_room_s_layout_both_recesses_upright_on_();
  });

  it('is deep enough for a plug: the head and the pins go in at most as far as the wall', () => {
    expect(floor).toBeGreaterThan(0);
    // (the head fills the recess, the pins go through the floor into the wall's depth)
    expect(SWISS.head.l).toBeLessThanOrEqual(T13.deep);
  });
});
