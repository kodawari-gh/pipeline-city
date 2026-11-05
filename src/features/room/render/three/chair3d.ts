// The desk chair in 3D: a modern task chair at real sizes (seat 490 mm up, back to about 1.05 m), pulled out from the desk and turned a little,
// as left after use. A five-star base on twin-wheel castors, a gas lift, a fabric seat and a mesh back in a black frame, two armrests, and a
// hoodie the chair wears (the room is lived in). Built in its own frame (millimetres, y up from the floor, the sitter facing -z), then set on the
// floor and turned. Pure scenery: nothing answers a click; the room merges its still parts by material (`mergeStatic`).
import { CatmullRomCurve3, CylinderGeometry, DoubleSide, Group, Mesh, Vector3, type BufferGeometry, type Material } from 'three';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import { healNormals, paint, rod, softBox, tube } from '@/core/render/three/geometry';
import { cloth, mat } from '@/core/render/three/materials';
import { cushion, floorShadow, weave } from './furniture3d';
import { FLOOR_Y } from './roomplan';

/** Room units per millimetre (the room's metre is 18 700 units). */
const MM = 18.7;

// ---- the hoodie, in millimetres in the back's frame (y up along the back, z out behind it, toward the room; the frame's ring runs y 60 to 440) ----
/** The cloth round the back: its middle `zc` (z) and half depth `B`; the rounded box it is pulled over (the ring less the cloth's round), its middle `yc`, its top half `hq` high, its corners `cr` round. */
const HD = { zc: 15, B: 48, yc: 250, hq: 160, cr: 55 };
/** The top of the cloth over the frame, where its faces meet. */
const TOP = HD.yc + HD.hq + HD.B;
/** The loop's length round the back (about), for the knit's scale. */
const PER = 1080;
/** The shares of the loop: each face (front, back) and each side's round. */
const FACE = 0.36, SIDE = 0.14;

/** The squircle's half width at a height: the ring's, less the round; below the frame the hanging cloth comes in a little. */
const coreW = (y: number): number => 198 + 22 * Math.min(1, Math.max(0, (y - 60) / 380)) - 25 - 0.06 * Math.max(0, 60 - y);
/** How far the faces stand off the middle: the half depth, less over the top, where the cloth rounds over the frame. */
const depthAt = (y: number): number => { const o = y - HD.yc - HD.hq; return o <= 0 ? HD.B : Math.sqrt(Math.max(0, HD.B * HD.B - o * o)); };
/** The cloth's half width at a height, `d` off the middle: the rounded box grown by what is left of the round there (over the top, the faces keep the box's flat). */
function halfW(y: number, d: number): number {
  const r = Math.sqrt(Math.max(0, HD.B * HD.B - d * d)), w = coreW(Math.min(y, HD.yc + HD.hq)), o = y - (HD.yc + HD.hq - HD.cr);
  return o <= 0 ? w + r : w - HD.cr + Math.sqrt(Math.max(0, (HD.cr + r) ** 2 - o * o));
}
/** Where `u` (0..1) is round the loop: -1 on the front face (to the sitter), 1 on the back face, between on the sides. */
const sideOf = (u: number): number =>
  u < FACE ? -1 : u < FACE + SIDE ? -Math.cos((Math.PI * (u - FACE)) / SIDE) : u < 2 * FACE + SIDE ? 1 : Math.cos((Math.PI * (u - 2 * FACE - SIDE)) / SIDE);
/** The hem's height there: over the seat in front, lower behind, where it hangs free below the frame. */
const hemY = (side: number): number => { const k = Math.min(1, Math.max(0, (side + 0.6) / 1.2)); return 28 - 138 * k * k * (3 - 2 * k); };

/** A point round the loop at a height: its x, its offset off the middle (z) and the outward normal there (x, z). */
function around(u: number, y: number): { x: number; d: number; nx: number; nz: number } {
  const D = depthAt(y);
  if (u < FACE) { const w = halfW(y, -D); return { x: -w + (2 * w * u) / FACE, d: -D, nx: 0, nz: -1 }; }
  if ((u -= FACE) < SIDE) { const a = (Math.PI * u) / SIDE, d = -D * Math.cos(a); return { x: halfW(y, d), d, nx: Math.sin(a), nz: -Math.cos(a) }; }
  if ((u -= SIDE) < FACE) { const w = halfW(y, D); return { x: w - (2 * w * u) / FACE, d: D, nx: 0, nz: 1 }; }
  const a = (Math.PI * (u - FACE)) / SIDE, d = D * Math.cos(a);
  return { x: -halfW(y, d), d, nx: -Math.sin(a), nz: Math.cos(a) };
}
/** The cloth's folds (mm out of its form) at `s` mm round the loop: a ripple where it is pulled over the frame, deep folds where it hangs below it. */
function folds(s: number, y: number): number {
  const free = Math.min(1, Math.max(0, (60 - y) / 170)), amp = 0.8 + 9 * Math.pow(free, 1.3);
  return amp * (0.6 * Math.sin(s / 13 + 0.7 + y / 160) + 0.4 * Math.sin(s / 7.5 + 2.1 - y / 90));
}
/** Below the frame the back hangs plumb, out from the back as it leans. */
const drift = (y: number, side: number): number => 0.16 * Math.max(0, 60 - y) * Math.max(0, side);
/** The cloth at `u` round the loop and height y, `push` out of its form, its folds `k` deep (none at the top, where its faces meet). */
function clothAt(u: number, y: number, push: number, k: number, out: Vector3): Vector3 {
  const p = around(u, y), off = push + k * folds(u * PER, y) * Math.min(1, (TOP - y) / 30);
  return out.set(p.x + p.nx * off, y, HD.zc + p.d + p.nz * off + drift(y, sideOf(u)));
}
/** The back face's z at (x, y): on the face where it is flat, else on the round where the cloth's width comes to |x|. */
function backZ(x: number, y: number): number {
  const D = depthAt(y), ax = Math.abs(x);
  let d = D;
  if (ax > halfW(y, D)) {
    let lo = 0, hi = D;
    for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (halfW(y, m) > ax) lo = m; else hi = m; }
    d = lo;
  }
  return HD.zc + d + drift(y, 1);
}

/** A 1x1 rib knit: raised columns and the valleys between, a tile 12 mm across. */
const ribs = (base: string) => paint(64, 64, (c, w, h) => {
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) {
    const x = (i * w) / 4, g = c.createLinearGradient(x, 0, x + w / 4, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.28)'); g.addColorStop(0.3, 'rgba(255,255,255,0.1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.12)'); g.addColorStop(0.85, 'rgba(0,0,0,0.2)'); g.addColorStop(1, 'rgba(0,0,0,0.28)');
    c.fillStyle = g; c.fillRect(x, 0, w / 4, h);
  }
}, [1, 1]);

/** A sleeve's line, from inside the shoulder down the side to the cuff: the east one, and the west a little forward with a bend at the elbow. */
const SLEEVES: readonly (readonly [number, number, number])[][] = [
  [[160, 402, 18], [236, 362, 20], [262, 250, 25], [256, 120, 31], [252, 0, 40], [247, -110, 52], [244, -165, 58]],
  [[-160, 402, 15], [-238, 358, 13], [-266, 238, 9], [-260, 112, 16], [-252, -6, 33], [-246, -120, 48], [-243, -172, 55]],
];

/** A soft tube along a curve, flattened across x (it lies against the side), `r(t, a)` its radius at `t` along it and `a` round it. */
function sleeveGeo(curve: CatmullRomCurve3, t0: number, t1: number, r: (t: number, a: number) => number, flat: number, slices: number, stacks: number): ParametricGeometry {
  const P = new Vector3(), T = new Vector3(), N = new Vector3(), B = new Vector3(), X = new Vector3(1, 0, 0);
  return new ParametricGeometry((u: number, v: number, out: Vector3) => {
    const t = t0 + (t1 - t0) * v, a = u * Math.PI * 2;
    curve.getPointAt(t, P); curve.getTangentAt(t, T);
    N.copy(X).addScaledVector(T, -X.dot(T)).normalize(); B.crossVectors(T, N);
    const R = r(t, a);
    out.copy(P).addScaledVector(N, R * flat * Math.cos(a)).addScaledVector(B, R * Math.sin(a));
  }, slices, stacks);
}

/** Multiply a geometry's UVs: its tiles then come out a fixed size on it. */
function scaleUv(g: BufferGeometry, su: number, sv: number): BufferGeometry {
  const uv = g.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

/**
 * A hoodie the chair wears: pulled down over its back, the hem over the seat in front and hanging free behind, where it folds; a rib band at
 * the hem and the cuffs; the hood hanging down the back from the neck, its seam down its middle; the sleeves down the sides. In millimetres,
 * in the back's frame (the group is scaled to room units).
 */
function hoodie(): Group {
  const g = new Group(), knit = cloth(0xffffff, { map: weave('#4b5443', { knit: true, repeat: [1, 1] }), side: DoubleSide });
  const rib = cloth(0xffffff, { map: ribs('#434b3a'), side: DoubleSide }), dark = mat(0x14160f, { roughness: 1 });
  const add = (geo: ParametricGeometry, m: Material, su: number, sv: number) => { const o = new Mesh(scaleUv(healNormals(geo, geo.parameters.slices + 1), su, sv), m); o.castShadow = o.receiveShadow = true; g.add(o); };
  // the body: from the hem band up over the frame (closer rows at the top, where it rounds over), blousing a little over the band
  add(new ParametricGeometry((u: number, v: number, out: Vector3) => {
    const y0 = hemY(sideOf(u)) + 45, y = y0 + (TOP - y0) * (1 - Math.pow(1 - v, 1.6)), b = y - y0 - 18;
    clothAt(u, y, 5 * Math.exp(-(b * b) / 300), 1, out);
  }, 120, 44), knit, PER / 100, 4.6);
  // the band: pulled in, its top hidden under the body
  add(new ParametricGeometry((u: number, v: number, out: Vector3) => clothAt(u, hemY(sideOf(u)) + 60 * v, -4, 0.2, out), 120, 3), rib, PER / 12, 5);
  // the hood: hanging down the back from the neck, wide at the neck and round to its crown, puffed (two layers of cloth and the air between)
  const hood = { top: 438, len: 300, w: 158, puff: 34 };
  const hoodW = (v: number) => hood.w * Math.pow(Math.max(0, 1 - Math.pow(v, 2.4)), 0.55) * (0.9 + 0.1 * Math.sin(Math.PI * Math.min(1, v * 1.6)));
  const hoodAt = (s: number, v: number, out: Vector3) => {
    const x = s * hoodW(v), y = hood.top - 34 * s * s - v * (hood.len - 34 * s * s);
    const body = hood.puff * Math.sqrt(Math.max(0, 1 - s * s)) * Math.sqrt(Math.max(0, 1 - Math.pow(v, 3))) * (0.6 + 0.4 * Math.min(1, v * 3.5));
    const seam = -4 * Math.exp(-((x / 8) ** 2)), crease = 2 * Math.sin(x / 18 + 4 * v) * (1 - v);
    return out.set(x, y, backZ(x, y) + 1.2 + body + seam + crease);
  };
  add(new ParametricGeometry((u: number, v: number, out: Vector3) => hoodAt(2 * u - 1, v, out), 28, 22), knit, 3.2, 3);
  // its edge at the neck, rolled
  const edge: [number, number, number][] = [];
  for (let k = 0; k <= 12; k++) { const s = -1 + k / 6, p = hoodAt(s * 0.97, 0, new Vector3()), z = backZ(p.x, p.y); edge.push([p.x, p.y + 3, (z + p.z) / 2]); }
  const roll = tube(edge, 8, knit, 10);
  scaleUv(roll.geometry, 3.4, 0.5);
  g.add(roll);
  // the sleeves: empty, so lying flat against the sides; wide at the shoulder, narrower down to the cuff, the cloth stacking in folds above
  // it; a rib cuff, its opening dark
  const flat = 0.46;
  SLEEVES.forEach((pts, i) => {
    const curve = new CatmullRomCurve3(pts.map((p) => new Vector3(...p)), false, 'centripetal'), len = curve.getLength(), end = 0.9;
    const r = (t: number, a: number) => (54 - 13 * Math.min(1, t / end)) * (1 + (0.03 + 0.1 * Math.max(0, (t - 0.3) / 0.6) ** 1.5) * Math.sin(t * 38 + i * 2 + 1.3 * Math.cos(a) + 0.8 * Math.sin(2 * a)));
    add(sleeveGeo(curve, 0, end + 0.02, r, flat, 16, 48), knit, (2 * Math.PI * 50) / 100, (len * (end + 0.02)) / 100);
    add(sleeveGeo(curve, end, 1, () => 39, flat, 16, 4), rib, (2 * Math.PI * 39) / 12, (len * (1 - end)) / 12);
    add(sleeveGeo(curve, 0.995, 1, (t) => 37 * (1 - (t - 0.995) / 0.005), flat, 16, 2), dark, 1, 1);
  });
  g.scale.setScalar(MM);
  return g;
}

/** A soft box centred on (x, y, z) in millimetres, y up. */
function slab(x: number, y: number, z: number, w: number, h: number, d: number, m: Material, radius = 8): Mesh {
  return softBox({ x: (x - w / 2) * MM, y: -(y + h / 2) * MM, w: w * MM, h: h * MM }, (z - d / 2) * MM, (z + d / 2) * MM, m, radius * MM);
}

/** A rod between two points in millimetres. */
const bar = (a: readonly [number, number, number], b: readonly [number, number, number], r: number, m: Material, sides = 10): Mesh =>
  rod([a[0] * MM, a[1] * MM, a[2] * MM], [b[0] * MM, b[1] * MM, b[2] * MM], r * MM, m, sides);

/** A cylinder standing on (x, y0, z), in millimetres, `axisX` laid along x (a wheel). */
function can(x: number, y: number, z: number, r: number, h: number, m: Material, axisX = false, sides = 16): Mesh {
  const o = new Mesh(new CylinderGeometry(r * MM, r * MM, h * MM, sides), m);
  if (axisX) o.rotation.z = Math.PI / 2;
  o.position.set(x * MM, (axisX ? y : y + h / 2) * MM, z * MM);
  o.castShadow = o.receiveShadow = true;
  return o;
}

/** The chair, its seat's middle over the floor point (x, z) in room units, turned `turn` radians from square to the desk. */
export function deskChair(x: number, z: number, turn: number): Group {
  const root = new Group(), c = new Group();
  const black = mat(0x1d1f22, { roughness: 0.45 }), steel = mat(0xb9bdc2, { metalness: 0.9, roughness: 0.28 });
  const seatCloth = cloth(0xffffff, { map: weave('#4a4d52', { repeat: [3, 3] }) }), mesh = cloth(0xffffff, { map: weave('#2c2f33', { repeat: [10, 12] }), sheenColor: 0x6a6e74 });

  // ---- the base: a hub, five legs falling to the castors, each castor two wheels on a swivel ----
  c.add(can(0, 95, 0, 42, 70, black, false, 20));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3, ca = Math.cos(a), sa = Math.sin(a), tip = 315;
    c.add(bar([ca * 30, 125, sa * 30], [ca * tip, 88, sa * tip], 19, black, 6));
    c.add(can(ca * tip, 62, sa * tip, 12, 30, steel, false, 8));
    const wheel = new Group();
    for (const s of [-1, 1]) wheel.add(can(s * 12, 26, -14, 26, 18, black, true, 18));
    wheel.add(slab(0, 46, -10, 34, 26, 44, black, 6));
    wheel.position.set(ca * tip * MM, 0, sa * tip * MM);
    wheel.rotation.y = a * 1.7 + 0.4;
    c.add(wheel);
  }
  // ---- the gas lift: a black sleeve, the chrome piston, the tilt box under the seat ----
  c.add(can(0, 130, 0, 30, 160, black, false, 20), can(0, 285, 0, 21, 125, steel, false, 20));
  c.add(slab(0, 425, 10, 230, 45, 260, black, 10));
  // (the height lever out from under the seat's west side)
  c.add(bar([-60, 420, -100], [-245, 405, -140], 7, steel, 8));

  // ---- the seat: a moulded shell, the cushion on it ----
  c.add(slab(0, 458, 0, 470, 22, 450, black, 10));
  const seat = new Mesh(cushion(490 * MM, 80 * MM, 470 * MM, 0.8), seatCloth);
  seat.position.set(0, 505 * MM, -5 * MM);
  seat.castShadow = seat.receiveShadow = true;
  c.add(seat);

  // ---- the back: a spine from the tilt box, a black frame round a mesh panel, laid back a little (its top away from the sitter), a lumbar pad ----
  const lean = 0.16, back = new Group();
  back.position.set(0, 540 * MM, 255 * MM);
  back.rotation.x = lean;
  const H = 380, W = 440;
  const ring: [number, number, number][] = [];
  for (let k = 0; k <= 32; k++) {
    // a rounded rectangle, wider at the top, its middle bowed back (the panel's curve round the sitter)
    const t = (k / 32) * Math.PI * 2, sx = Math.cos(t), sy = Math.sin(t), ex = Math.sign(sx) * Math.pow(Math.abs(sx), 0.35), ey = Math.sign(sy) * Math.pow(Math.abs(sy), 0.35);
    const yy = (ey + 1) / 2, ww = W / 2 * (0.9 + 0.1 * yy);
    ring.push([ex * ww * MM, (60 + yy * H) * MM, (30 * ex * ex) * MM]);
  }
  back.add(tube(ring, 13 * MM, black, 8));
  const panel = new Mesh(cushion((W - 30) * MM, 18 * MM, (H - 30) * MM, 0.5), mesh);
  panel.rotation.x = Math.PI / 2;
  panel.position.set(0, (60 + H / 2) * MM, 8 * MM);
  panel.castShadow = panel.receiveShadow = true;
  back.add(panel);
  back.add(slab(0, 150, -6, 300, 60, 22, black, 10));
  c.add(back);
  c.add(slab(0, 470, 200, 70, 40, 120, black, 10), bar([0, 470, 255], [0, 600, 300], 22, black, 10));

  // ---- the armrests: a post up from under each side of the seat, a soft pad on it ----
  for (const s of [-1, 1]) {
    c.add(bar([s * 120, 440, 40], [s * 262, 440, 40], 14, black, 8), bar([s * 262, 440, 40], [s * 268, 650, 20], 18, black, 10));
    c.add(slab(s * 268, 662, 0, 72, 28, 250, black, 12));
  }

  // ---- the hoodie: the chair wears it, pulled down over the back, the hood hanging behind, the sleeves down the sides ----
  const worn = hoodie();
  worn.position.copy(back.position);
  worn.rotation.x = lean;
  c.add(worn);

  c.rotation.y = turn;
  c.position.set(x, -FLOOR_Y, z);
  root.add(c, floorShadow(x, z, 760 * MM, 760 * MM, 0.7));
  return root;
}
