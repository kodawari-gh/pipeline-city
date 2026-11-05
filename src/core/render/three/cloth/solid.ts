// The solids a cloth lies on (docs/render/cloth.md), as signed distance functions in millimetres: below 0 inside, above it the distance out.
// A garment's colliders are a few of these joined (`union`): stand-ins for the furniture, a little rounder than the meshes they stand for.
// Pure maths.

export type Sdf = (x: number, y: number, z: number) => number;

export const union = (...parts: Sdf[]): Sdf => (x, y, z) => {
  let d = Infinity;
  for (const p of parts) d = Math.min(d, p(x, y, z));
  return d;
};

export const sphere = (cx: number, cy: number, cz: number, r: number): Sdf => (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r;

/** A rod with round ends from `a` to `b`. */
export function capsule(a: readonly [number, number, number], b: readonly [number, number, number], r: number): Sdf {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l2 = dx * dx + dy * dy + dz * dz || 1;
  return (x, y, z) => {
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / l2));
    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy, z - a[2] - t * dz) - r;
  };
}

/**
 * A slab about its middle: `hx` by `hy` its half size, its corners round by `rc` in that plane, `hz` its half thickness, its rims round by `rz`
 * (a cushion, a backrest's frame). With `rc = rz` a plain rounded box.
 */
export function slabAt(x: number, y: number, z: number, hx: number, hy: number, hz: number, rc: number, rz: number): number {
  const qx = Math.abs(x) - hx + rc, qy = Math.abs(y) - hy + rc;
  const d2 = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rc;
  const wx = d2 + rz, wz = Math.abs(z) - hz + rz;
  return Math.hypot(Math.max(wx, 0), Math.max(wz, 0)) + Math.min(Math.max(wx, wz), 0) - rz;
}

export const slab = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, rc: number, rz = rc): Sdf =>
  (x, y, z) => slabAt(x - cx, y - cy, z - cz, hx, hy, hz, rc, rz);

export const floor = (y0: number): Sdf => (_x, y) => y - y0;

/** The outward direction at a point: the distance's gradient, by central differences. */
export function gradient(f: Sdf, x: number, y: number, z: number, out: [number, number, number], e = 0.25): [number, number, number] {
  const gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e), l = Math.hypot(gx, gy, gz);
  if (l < 1e-12) { out[0] = 0; out[1] = 1; out[2] = 0; } else { out[0] = gx / l; out[1] = gy / l; out[2] = gz / l; }
  return out;
}
