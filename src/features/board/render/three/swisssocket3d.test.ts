// The Swiss triple socket (swisssocket3d.ts): the pinwheel's plan (where each recess and its holes stand, how a plug is turned in it) and the socket built from it.
import { describe, expect, it } from 'vitest';
import { Box3, Group, Mesh, MeshStandardMaterial } from 'three';
import { mat } from '@/core/render/three/materials';
import { lozenge, SWISS, T13 } from './plugs3d';
import { inPinwheel, pinHoles, pinwheel, TRIPLE, tripleSocket } from './swisssocket3d';
import { quietCanvas } from './testutil';

quietCanvas();

const MM = 23;
/** A closed outline of a socket (its recess drawn in by `inset` mm; a negative inset grows it: a plug's shoulder) in mm from the screw. */
const outline = (s: ReturnType<typeof pinwheel>[number], inset: number): [number, number][] => lozenge(inset).map((p) => inPinwheel(s, p));
const segDist = (p: readonly number[], a: readonly number[], b: readonly number[]): number => {
  const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, t = Math.max(0, Math.min(1, ((p[0]! - a[0]!) * dx + (p[1]! - a[1]!) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0]! - a[0]! - t * dx, p[1]! - a[1]! - t * dy);
};
/** The least distance between two closed outlines (neither inside the other). */
const gap = (a: [number, number][], b: [number, number][]): number => {
  let m = Infinity;
  for (const [p, q] of [[a, b], [b, a]] as const) for (const v of p) for (let i = 0; i < q.length; i++) m = Math.min(m, segDist(v, q[i]!, q[(i + 1) % q.length]!));
  return m;
};

describe('the pinwheel', () => {
  const [top, left, right] = pinwheel();

  it('turns the three sockets 120 degrees from each other round the screw, each 17.35 mm out', () => {
    for (const s of [top, left, right]) expect(Math.hypot(s.x, s.y)).toBeCloseTo(TRIPLE.reach, 5);
    // (a plug turned by `roll` has its live and neutral side on the socket's outer side, its earth pin toward the screw)
    expect(top.roll).toBeCloseTo(0, 5);
    expect(left.roll).toBeCloseTo((120 * Math.PI) / 180, 5);
    expect(right.roll).toBeCloseTo((240 * Math.PI) / 180, 5);
    expect(top.y).toBeGreaterThan(0);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    expect(left.y).toBeLessThan(0);
    expect(left.y).toBeCloseTo(right.y, 5);
  });

  it('puts each socket\'s earth hole 11.8 mm from the screw and its live and neutral holes 19.3 mm, as a real one measures', () => {
    for (const s of [top, left, right]) {
      const [l, n, e] = pinHoles(s);
      expect(Math.hypot(e![0], e![1])).toBeCloseTo(11.8, 1);
      expect(Math.hypot(l![0], l![1])).toBeCloseTo(19.3, 1);
      expect(Math.hypot(n![0], n![1])).toBeCloseTo(19.3, 1);
      // (the pair 19 apart, the earth hole 5 from their line and on its screw side)
      expect(Math.hypot(l![0] - n![0], l![1] - n![1])).toBeCloseTo(19, 5);
      const mid = [(l![0] + n![0]) / 2, (l![1] + n![1]) / 2];
      expect(Math.hypot(e![0] - mid[0]!, e![1] - mid[1]!)).toBeCloseTo(5, 5);
      expect(Math.hypot(...(mid as [number, number]))).toBeGreaterThan(Math.hypot(e![0], e![1]));
    }
  });

  it('leaves 3 mm of the insert between two recesses, and the recesses clear of the insert\'s edge', () => {
    const o = [top, left, right].map((s) => outline(s, 0));
    for (const [a, b] of [[0, 1], [1, 2], [0, 2]] as const) expect(gap(o[a]!, o[b]!)).toBeGreaterThan(2.8);
    for (const r of o) for (const [x, y] of r) {
      expect(Math.abs(x)).toBeLessThan(TRIPLE.insert / 2 - 1.5);
      expect(Math.abs(y)).toBeLessThan(TRIPLE.insert / 2 - 1.5);
    }
  });

  it('lets a plug in each of the three sockets at once: the shoulders stand clear of each other', () => {
    // (a shoulder is the recess's outline a hair out: 0.6 mm each, of the 3 between two recesses)
    const sh = [top, left, right].map((s) => outline(s, -SWISS.shoulder.out));
    for (const [a, b] of [[0, 1], [1, 2], [0, 2]] as const) expect(gap(sh[a]!, sh[b]!)).toBeGreaterThan(1.5);
  });
});

describe('tripleSocket', () => {
  const look = { plate: mat(0xcfd2d8), black: mat(0x050608), steel: mat(0xb9babf) };
  const build = (): { g: Group; root: Group } => {
    const root = new Group();
    const g = tripleSocket(root, { x: 1000, y: 2000, z: 700, face: 700 + 18 * MM, look });
    return { g, root };
  };

  it('builds a 91 mm square frame round the screw, from the wall to the face and not past it', () => {
    const { g, root } = build(), b = new Box3().setFromObject(g);
    expect(root.children).toContain(g);
    expect(g.name).toBe('wall.mains');
    expect((b.max.x - b.min.x) / MM).toBeCloseTo(91, 0);
    expect((b.max.y - b.min.y) / MM).toBeCloseTo(91, 0);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(1000, 0);
    expect((b.min.y + b.max.y) / 2).toBeCloseTo(2000, 0);
    expect(b.min.z).toBeGreaterThanOrEqual(700 - 2);
    expect(b.max.z).toBeLessThanOrEqual(700 + 18 * MM + 1);
  });

  it('cuts each recess down to its floor, 13 mm under the face, with three black holes in it', () => {
    const { g } = build(), floor = 700 + (18 - T13.deep) * MM;
    const holes = g.children.filter((o) => (o as Mesh).isMesh && ((o as Mesh).material as MeshStandardMaterial) === look.black && new Box3().setFromObject(o).min.z < floor);
    // (nine contact holes, the three in each floor; the screw's slot is black too, but it stands at the face)
    expect(holes).toHaveLength(9);
    for (const h of holes) {
      const b = new Box3().setFromObject(h);
      expect(b.max.z).toBeCloseTo(floor + 0.3 * MM, 0);
      expect((b.max.x - b.min.x) / MM).toBeCloseTo(T13.hole, 1);
    }
  });
});
