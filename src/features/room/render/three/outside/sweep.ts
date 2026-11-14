// The city's big meshes, cut to what the window's camera sees. A mesh holds its pieces (a building, a tree) in the order of their bearing from
// the window, so the pieces a camera sees through it lie in one run, from the first it sees to the last: the mesh draws only that run. A ring
// of the city (its pieces at about the same distance) is one mesh, so a run holds few pieces it does not see, and each ring is one draw call.
// The streets' many small things (their paint, their lamps, the tree pits) are one mesh a material, in bearing order too (`sweptMerge`).
import { Float32BufferAttribute, Matrix4, Mesh, Sphere, Vector3, type BufferGeometry, type Frustum, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRID } from './plan';

/** The bearing of (x, z) from the window (rad): 0 straight out (north, -z), negative to the west. */
export const bearing = (x: number, z: number): number => Math.atan2(x - GRID.av0, -z);

/** The ball round the vertices `from` to `to` (not included) of a position array. */
export function ballOf(pos: ArrayLike<number>, from: number, to: number): Sphere {
  const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity), p = new Vector3();
  for (let i = from; i < to; i++) { p.set(pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!); lo.min(p); hi.max(p); }
  return to > from ? new Sphere(lo.clone().add(hi).multiplyScalar(0.5), lo.distanceTo(hi) / 2) : new Sphere(new Vector3(), -1);
}

/** Where a geometry's draw counts: its index, or its vertices when it has none. */
export const drawn = (g: BufferGeometry): number => (g.index ? g.index.count : g.attributes.position!.count);

/** The pieces of one or more meshes in bearing order: each piece's ball, and for each mesh where each piece starts in it (then its end). */
export class Sweep {
  constructor(private balls: readonly Sphere[], private runs: readonly { mesh: Mesh; at: readonly number[] }[]) {}

  /** Each mesh draws the run of pieces from the first that `seen` (the camera's frustum) holds to the last; with no `seen`, every piece. */
  cut(seen?: Frustum): void {
    let a = 0, b = this.balls.length;
    if (seen) {
      a = b = -1;
      for (let k = 0; k < this.balls.length; k++) if (seen.intersectsSphere(this.balls[k]!)) { if (a < 0) a = k; b = k + 1; }
      if (a < 0) a = b = 0;
    }
    for (const { mesh, at } of this.runs) {
      const s = at[a]!, n = at[b]! - s;
      mesh.geometry.setDrawRange(s, n);
      mesh.visible = n > 0;
    }
  }
}

const KEEP = new Set(['position', 'normal', 'uv']);
/** `sweptMerge` cuts by cells of the ground this size (m), not mesh by mesh: far fewer balls to test a draw. */
const CELL = 24;

/**
 * Merge the meshes under `root` on each of `mats` into one mesh a material on `root` (in its frame, unindexed, with only a position, a normal
 * and a uv), each cell of the ground (`CELL`) a piece, in bearing order; returns the sweeps that cut them. The originals leave the tree. Call
 * it before `mergeStatic`.
 */
export function sweptMerge(root: Object3D, mats: readonly Material[], cell = CELL, keep: readonly string[] = []): Sweep[] {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert(), out: Sweep[] = [];
  for (const mat of mats) {
    // each mesh in the root's frame, by its cell
    const cells = new Map<string, { ms: Mesh[]; gs: BufferGeometry[]; x: number; z: number; b: number }>();
    root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || m.material !== mat) return;
      let g = m.geometry.clone().applyMatrix4(new Matrix4().multiplyMatrices(toRoot, m.matrixWorld));
      if (g.index) g = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (!KEEP.has(k) && !keep.includes(k)) g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
      g.clearGroups();
      g.computeBoundingSphere();
      const c = g.boundingSphere!.center, key = `${Math.floor(c.x / cell)},${Math.floor(c.z / cell)}`;
      const s = cells.get(key) ?? { ms: [], gs: [], x: 0, z: 0, b: 0 };
      cells.set(key, s);
      s.ms.push(m); s.gs.push(g); s.x += c.x; s.z += c.z;
    });
    // the cells in bearing order, each a piece of the one mesh
    const pieces = [...cells.values()];
    for (const p of pieces) p.b = bearing(p.x / p.ms.length, p.z / p.ms.length);
    pieces.sort((p, q) => p.b - q.b);
    const gs = pieces.flatMap((p) => p.gs), g = gs.length > 1 ? mergeGeometries(gs, false) : null;
    if (!g) continue;
    const at = [0], pos = g.attributes.position!.array, mesh = new Mesh(g, mat), first = pieces[0]!.ms[0]!;
    for (const p of pieces) at.push(at[at.length - 1]! + p.gs.reduce((n, pg) => n + pg.attributes.position!.count, 0));
    for (const p of pieces) for (const m of p.ms) m.parent?.remove(m);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    root.add(mesh);
    out.push(new Sweep(pieces.map((_, k) => ballOf(pos, at[k]!, at[k + 1]!)), [{ mesh, at }]));
  }
  return out;
}
