// Lofted shapes for joinery and cloth: a moulded frame round a rect (a door's panel moulding, a raised field, a picture frame, an architrave),
// a tube that tapers (a trunk, a stem), a ribbon along a curve (a tie-back's band, a strap). Pure geometry: no materials, no scene.
import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, TubeGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type V3 = readonly [number, number, number];

/** A profile point: how far in from the rect's edge, how high off its back (z). The same point twice makes a sharp edge there. */
export type ProfilePt = readonly [inset: number, z: number];

/**
 * A moulded frame round a w x h rect centred on the origin, facing +z: each profile point is the rect inset by its first value at the height
 * of its second, and the loft joins them, mitred at the corners as a joiner cuts them. Each side is its own strip, so the light breaks at the
 * mitres while a curved profile shades smooth. `cap` closes the innermost rect (a raised panel's field). u runs along a side, v along the profile.
 */
export function frameLoft(w: number, h: number, profile: readonly ProfilePt[], o: { cap?: boolean } = {}): BufferGeometry {
  // each ring's corners, counter-clockwise seen from +z, from the bottom left
  const rings = profile.map(([d, z]): V3[] => [[-w / 2 + d, -h / 2 + d, z], [w / 2 - d, -h / 2 + d, z], [w / 2 - d, h / 2 - d, z], [-w / 2 + d, h / 2 - d, z]]);
  const parts: BufferGeometry[] = [];
  for (let s = 0; s < 4; s++) {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let v = 0;
    rings.forEach((r, i) => {
      const a = r[s]!, b = r[(s + 1) % 4]!;
      if (i) { const p = rings[i - 1]![s]!; v += Math.hypot(a[0] - p[0], a[1] - p[1], a[2] - p[2]); }
      pos.push(...a, ...b);
      uv.push(0, v, Math.hypot(b[0] - a[0], b[1] - a[1]), v);
    });
    for (let i = 0; i + 1 < rings.length; i++) { const k = i * 2; idx.push(k, k + 1, k + 3, k, k + 3, k + 2); }
    parts.push(strip(pos, uv, idx));
  }
  const last = rings[rings.length - 1]!;
  if (o.cap && last[1]![0] > last[0]![0] && last[2]![1] > last[1]![1]) {
    const [a, b, c, d] = last as [V3, V3, V3, V3];
    parts.push(strip([...a, ...b, ...c, ...d], [0, 0, b[0] - a[0], 0, b[0] - a[0], c[1] - b[1], 0, c[1] - b[1]], [0, 1, 2, 0, 2, 3]));
  }
  return mergeGeometries(parts, false)!;
}

function strip(pos: number[], uv: number[], idx: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A tube through 3D points that tapers from radius `r0` at the first point to `r1` at the last (a trunk, a branch, a stem). */
export function taperTube(points: readonly V3[], r0: number, r1: number, sides = 8, segs = Math.max(8, points.length * 4)): BufferGeometry {
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)), false, 'centripetal');
  const g = new TubeGeometry(curve, segs, 1, sides, false), p = g.attributes.position!, c = new Vector3(), q = new Vector3();
  // the tube's rings in order: ring i (sides + 1 points) sits round the curve's point at i / segs; each moves out to its own radius
  for (let i = 0; i <= segs; i++) {
    curve.getPointAt(i / segs, c);
    const r = r0 + (r1 - r0) * (i / segs);
    for (let j = 0; j <= sides; j++) {
      const k = i * (sides + 1) + j;
      q.set(p.getX(k), p.getY(k), p.getZ(k)).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(k, q.x, q.y, q.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** A flat band along a smooth curve through `pts`, `width` across along `up` (a tie-back's cloth, a strap). One surface: draw it double-sided. */
export function ribbon(pts: readonly V3[], width: number, o: { up?: V3; closed?: boolean; segs?: number } = {}): BufferGeometry {
  const curve = new CatmullRomCurve3(pts.map((p) => new Vector3(...p)), o.closed ?? false, 'centripetal');
  const n = o.segs ?? 48, up = new Vector3(...(o.up ?? [0, 1, 0])).multiplyScalar(width / 2), len = curve.getLength(), p = new Vector3();
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    curve.getPointAt(i / n, p);
    pos.push(p.x - up.x, p.y - up.y, p.z - up.z, p.x + up.x, p.y + up.y, p.z + up.z);
    uv.push((i / n) * len, 0, (i / n) * len, 1);
    if (i) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  return strip(pos, uv, idx);
}
