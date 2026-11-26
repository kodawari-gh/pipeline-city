import { CatmullRomCurve3, Vector3 } from 'three';

/** The four coefficients of one axis of a piece (x, y or z), written to `c` from `o`: three's `CubicPoly.initNonuniformCatmullRom`, step for step. */
function axis(
  c: Float64Array,
  o: number,
  x0: number,
  x1: number,
  x2: number,
  x3: number,
  dt0: number,
  dt1: number,
  dt2: number,
): void {
  let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
  let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
  t1 *= dt1;
  t2 *= dt1;
  c[o] = x1;
  c[o + 1] = t1;
  c[o + 2] = -3 * x1 + 3 * x2 - 2 * t1 - t2;
  c[o + 3] = 2 * x1 - 2 * x2 + t1 + t2;
}

/** The coefficients of the piece between points `at` and `at + 1` of an open centripetal curve: x in 0..3, y in 4..7, z in 8..11. */
function piece(pts: readonly Vector3[], at: number): Float64Array {
  const l = pts.length,
    p1 = pts[at]!,
    p2 = pts[at + 1]!;
  const p0 = at > 0 ? pts[at - 1]! : new Vector3().subVectors(pts[0]!, pts[1]!).add(pts[0]!);
  const p3 = at + 2 < l ? pts[at + 2]! : new Vector3().subVectors(pts[l - 1]!, pts[l - 2]!).add(pts[l - 1]!);
  let dt0 = p0.distanceToSquared(p1) ** 0.25,
    dt1 = p1.distanceToSquared(p2) ** 0.25,
    dt2 = p2.distanceToSquared(p3) ** 0.25;
  if (dt1 < 1e-4) {
    dt1 = 1; // (repeated points, as three does)
  }
  if (dt0 < 1e-4) {
    dt0 = dt1;
  }
  if (dt2 < 1e-4) {
    dt2 = dt1;
  }
  const c = new Float64Array(12);
  axis(c, 0, p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2);
  axis(c, 4, p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2);
  axis(c, 8, p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2);
  return c;
}

/**
 * An open centripetal Catmull-Rom curve through `points` that gives the same numbers as three's `CatmullRomCurve3` for less. Three works the
 * four coefficients of a piece out again at every `getPoint` (three `Math.pow`, three divisions' worth of set-up), and a tube asks for 200
 * points of it for the length table of each limb alone (`getLengths`). This one works each piece out once. The points must not move after the
 * first `getPoint`. A `t` outside 0..1, or a curve of one point, goes to three.
 */
export class Spline extends CatmullRomCurve3 {
  private readonly coef: (Float64Array | undefined)[] = [];

  constructor(points: Vector3[]) {
    super(points, false, 'centripetal');
  }

  override getPoint(t: number, target: Vector3 = new Vector3()): Vector3 {
    const pts = this.points,
      l = pts.length,
      p = (l - 1) * t;
    let at = Math.floor(p),
      w = p - at;
    if (w === 0 && at === l - 1) {
      at = l - 2;
      w = 1;
    }
    if (!(at >= 0 && at < l - 1)) {
      return super.getPoint(t, target);
    }
    const c = (this.coef[at] ??= piece(pts, at)),
      w2 = w * w,
      w3 = w2 * w;
    return target.set(
      c[0]! + c[1]! * w + c[2]! * w2 + c[3]! * w3,
      c[4]! + c[5]! * w + c[6]! * w2 + c[7]! * w3,
      c[8]! + c[9]! * w + c[10]! * w2 + c[11]! * w3,
    );
  }
}
