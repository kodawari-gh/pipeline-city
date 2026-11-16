// Low's contact shade (MACH-03, src/features/room/light.md "Contact shade at Low"). The Low tier draws no occlusion pass, so a part that
// stands on the board or on the shroud met the surface with no dark band, where High's GTAO draws one. A skirt is one unlit, see-through mesh
// on the surface round the part's footprint: as dark as `peak` under the footprint and at its edge, fading to nothing `reach` out, its corners
// round (each ring is the footprint grown by its distance). Its alpha lies in its vertices, so a skirt is one draw and needs no texture.
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial } from 'three';
import type { RectLike } from '@/core/render/three/geometry';

/** The rings: each one's distance out, in parts of `reach`, and its darkness, in parts of `peak` (about (1 - t)², a soft fall with no edge). */
export const RINGS: readonly (readonly [number, number])[] = [[0, 1], [0.12, 0.76], [0.3, 0.48], [0.55, 0.2], [0.8, 0.04], [1, 0]];
/** The segments on each quarter round of a ring. */
const ARC = 6;
const NO_HIT = () => {};

/**
 * A skirt round `r` (layout units: x right, y down) in the plane z 0, facing +z, `round` the footprint's own corner radius. The caller puts it
 * on its surface: on the board just over `BOARD_Z`, on a floor turned to face up (`rotation.x = -π/2` takes the rect's y to world z).
 */
export function footShade(r: RectLike, reach: number, peak: number, round = 0): Mesh {
  const rc = Math.max(0, Math.min(round, r.w / 2, r.h / 2)), cx = r.x + r.w / 2, cy = -(r.y + r.h / 2), hx = r.w / 2 - rc, hy = r.h / 2 - rc;
  const pos: number[] = [cx, cy, 0], col: number[] = [0, 0, 0, peak], idx: number[] = [], per = 4 * (ARC + 1);
  for (const [t, k] of RINGS) {
    const rad = rc + t * reach;
    // the four corners counter-clockwise from the north-east, each a quarter round about its centre
    for (const [sx, sy, a0] of [[1, 1, 0], [-1, 1, 0.5], [-1, -1, 1], [1, -1, 1.5]] as const) {
      for (let j = 0; j <= ARC; j++) {
        const a = (a0 + (0.5 * j) / ARC) * Math.PI;
        pos.push(cx + sx * hx + Math.cos(a) * rad, cy + sy * hy + Math.sin(a) * rad, 0);
        col.push(0, 0, 0, peak * k);
      }
    }
  }
  // the middle's fan, then each band between two rings
  for (let j = 0; j < per; j++) idx.push(0, 1 + j, 1 + ((j + 1) % per));
  for (let i = 0; i + 1 < RINGS.length; i++) {
    const a = 1 + i * per, b = a + per;
    for (let j = 0; j < per; j++) {
      const n = (j + 1) % per;
      idx.push(a + j, b + j, b + n, a + j, b + n, a + n);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  const m = new Mesh(geo, new MeshBasicMaterial({ color: 0x000000, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
  m.name = 'footShade';
  m.raycast = NO_HIT; // (a shade, not a part: a click goes through it)
  return m;
}
