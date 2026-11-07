import { describe, expect, it } from 'vitest';
import { Mesh, Vector3, type BufferGeometry } from 'three';
import { mat } from '@/core/render/three/materials';
import { outlinePts, ring, slab, shapeOf, wallCircle, wallX } from './casekit3d';

/** The faces of a mesh that lie on the walls of a hole round the axis point `c` (within `r` of it, off the caps): each must face the hole's middle. */
function holeWallsFaceIn(m: Mesh, c: Vector3, axis: 'x' | 'z', r: number): number {
  m.updateMatrixWorld(true);
  const g = m.geometry as BufferGeometry, p = g.getAttribute('position'), idx = g.getIndex();
  const n = idx ? idx.count : p.count, at = (k: number) => new Vector3().fromBufferAttribute(p, idx ? idx.getX(k) : k).applyMatrix4(m.matrixWorld);
  let walls = 0;
  for (let k = 0; k < n; k += 3) {
    const a = at(k), b = at(k + 1), d = at(k + 2), nrm = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a)).normalize();
    if (Math.abs(nrm[axis]) > 0.5) continue; // a cap
    const mid = a.clone().add(b).add(d).divideScalar(3), off = mid.clone().sub(c).setComponent(axis === 'x' ? 0 : 2, 0);
    if (off.length() > r) continue; // the outline's walls
    walls++;
    expect(nrm.dot(off), 'a hole wall faces into the material').toBeLessThan(0);
  }
  return walls;
}

describe('the case kit', () => {
  const m = mat(0xffffff);
  it('turns the walls of a wall’s openings toward the opening', () => {
    const w = new Mesh(wallX(0, 40, { y0: 0, y1: 1000, z0: 0, z1: 1000 }, [{ y0: 200, y1: 400, z0: 200, z1: 400, r: 20 }, wallCircle(700, 600, 150)], m).geometry);
    expect(holeWallsFaceIn(w, new Vector3(0, -300, 300), 'x', 160)).toBeGreaterThan(0);
    expect(holeWallsFaceIn(w, new Vector3(0, -700, 600), 'x', 160)).toBeGreaterThan(0);
  });
  it('turns the walls of a slab’s and a ring’s openings toward the opening', () => {
    const s = slab(shapeOf(outlinePts({ x: 0, y: 0, w: 1000, h: 1000 }, 40), [outlinePts({ x: 400, y: 400, w: 200, h: 200 }, 10)]), 0, 30, m, 4);
    expect(holeWallsFaceIn(s, new Vector3(500, -500, 0), 'z', 150)).toBeGreaterThan(0);
    const r = ring({ x: 400, y: 400, w: 200, h: 200 }, 10, [0, 0, 0, 0], 60, 0, 30, m);
    expect(holeWallsFaceIn(r, new Vector3(500, -500, 0), 'z', 145)).toBeGreaterThan(0);
  });
});
