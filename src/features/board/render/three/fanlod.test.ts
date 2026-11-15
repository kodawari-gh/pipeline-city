// A fan at its three detail levels (LOD-01, docs/render/lod.md): fewer triangles and draws at each, and an outline that stays within one
// screen pixel of the full part's at the size where the level takes over. No WebGL: the outline is read from the vertices.
import { describe, expect, it } from 'vitest';
import { Group, Vector3, type BufferGeometry, type Mesh, type Object3D } from 'three';
import { lowOf, standIns } from '@/core/render/three/merge';
import { FAN_LOD_PX, fanDepth, fanLodSides, fanPart, type FanLevel } from './fans3d';
import { quietCanvas } from './testutil';

quietCanvas();

const D = 120 * 23, DEPTH = fanDepth(120);
const meshes = (root: Object3D): Mesh[] => { const out: Mesh[] = []; root.updateWorldMatrix(true, true); root.traverse((o) => { if ((o as Mesh).isMesh) out.push(o as Mesh); }); return out; };
const tris = (g: BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const census = (level: FanLevel, tier = 0) => {
  const { root, spin } = fanPart({ size: 120, tier }, D, DEPTH, 1, level), all = meshes(root);
  const inRotor = (m: Object3D): boolean => { for (let p: Object3D | null = m; p; p = p.parent) if (p === spin.rotor) return true; return false; };
  return { root, all, still: all.filter((m) => !inRotor(m)), triangles: all.reduce((n, m) => n + tris(m.geometry), 0) };
};
/** The outline seen along z, as its reach in 180 directions (the support function of the vertices), in units. */
function reach(geos: readonly { g: BufferGeometry; m: Mesh }[]): number[] {
  const out = new Array<number>(180).fill(-Infinity), v = new Vector3();
  for (const { g, m } of geos) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      for (let k = 0; k < 180; k++) { const a = (k / 180) * Math.PI * 2, r = v.x * Math.cos(a) + v.y * Math.sin(a); if (r > out[k]!) out[k] = r; }
    }
  }
  return out;
}
const outline = (level: FanLevel): number[] => reach(census(level).all.map((m) => ({ g: m.geometry, m })));
/** Screen pixels per unit when the fan's bbox diagonal (face on) is `px` pixels. */
const scaleAt = (px: number): number => px / (D * Math.SQRT2);

describe('a fan at three detail levels', () => {
  it('takes its sides from the level: 32, 24, 16 for a 120 mm fan, never under 8', () => {
    expect([0, 1, 2].map((l) => fanLodSides(32, l as FanLevel))).toEqual([32, 24, 16]);
    expect(fanLodSides(16, 2)).toBe(8);
    expect(fanLodSides(8, 2)).toBe(8);
  });

  it('has fewer triangles at each level, and its still parts in one or a few draws', () => {
    const [a, b, c] = [census(0), census(1), census(2)];
    console.log(`fan 120 mm: ${a.triangles} / ${b.triangles} / ${c.triangles} triangles; still meshes ${a.still.length} / ${b.still.length} / ${c.still.length}`);
    expect(b.triangles).toBeLessThan(a.triangles * 0.6);
    expect(c.triangles).toBeLessThan(b.triangles * 0.75);
    // the housing with the motor, and the light's ring (its own material: it carries the state)
    expect(b.still.length).toBeLessThanOrEqual(2);
    expect(c.still.length).toBeLessThanOrEqual(2);
    expect(census(1, 1).still.length).toBeLessThanOrEqual(3); // (and the high-airflow fan's pads)
  });

  it('keeps its outline within 1 px of the full part at each switch size', () => {
    const full = outline(0);
    ([1, 2] as const).forEach((level) => {
      const low = outline(level), k = scaleAt(FAN_LOD_PX[level - 1]!);
      const err = Math.max(...full.map((r, i) => Math.abs(r - low[i]!))) * k;
      console.log(`level ${level} at ${FAN_LOD_PX[level - 1]} px: outline error ${err.toFixed(2)} px`);
      expect(err).toBeLessThanOrEqual(1);
    });
  });

  it('keeps its round wall within 1 px of a true circle at each switch size', () => {
    // (the wall is under the flange in the outline above: a polygon of n sides falls short of its circle by r (1 - cos(pi / n)))
    const sides = [32, 24, 16], wall = D * 0.49;
    ([1, 2] as const).forEach((level) => expect(wall * (1 - Math.cos(Math.PI / sides[level]!)) * scaleAt(FAN_LOD_PX[level - 1]!)).toBeLessThanOrEqual(1));
  });

  it('gives the overview stand-in its level 1 housing', () => {
    const one = census(0), two = census(0);
    two.root.position.x = D * 2;
    const frame = new Group();
    frame.add(one.root, two.root);
    frame.updateMatrixWorld(true);
    const body = (c: typeof one): Mesh => c.still.find((m) => lowOf(m.geometry))!;
    const low = lowOf(body(one).geometry)!;
    expect(tris(low)).toBeLessThan(tris(body(one).geometry) * 0.6);
    const [s] = standIns(frame, [body(one), body(two)]);
    expect(tris(s!.mesh.geometry)).toBe(2 * tris(low));
  });
});
