// The hoodie the desk chair wears, as a cloth bake (docs/render/cloth.md; `npm run bake:cloth -- src/features/room/render/three/hoodiecloth.ts`
// writes `public/models/hoodie.glb`). A pullover cut as a tailor cuts one: front, back, two sleeves, a hood in two halves, a rib hem and rib
// cuffs. It is sewn over the chair's back; then it is let down: the hood falls down the back, the sleeves fall to the sides and the body
// hangs over the frame. The chair's stand-in solids follow `chair3d.ts`. Millimetres in the chair's frame (y up from the floor, the sitter
// facing -z).
import type { ClothBake } from '@/core/render/three/cloth/bake';
import { curve, curve3, pointAt, polyLength, type Garment, type P2, type P3, type Piece } from '@/core/render/three/cloth/pattern';
import { capsule, floor, slab, slabAt, union, type Sdf } from '@/core/render/three/cloth/solid';

// ---- the chair (chair3d.ts): the back group at (0, 540, 255), leaning back 0.16 rad (its top away from the sitter) ----
const LEAN = 0.16, CL = Math.cos(LEAN), SL = Math.sin(LEAN), BY = 540, BZ = 255;
/** A point in the back's frame (y up along the back, z out behind it) in the chair's frame. */
const fromBack = (x: number, y: number, z: number): P3 => [x, BY + y * CL - z * SL, BZ + y * SL + z * CL];

/** The backrest in its own frame: the frame ring (a squircle on a 13 mm tube, wider at the top, bowed back at its sides), the mesh in it, the lumbar pad. */
function backrest(x: number, y: number, z: number): number {
  const yy = Math.min(1, Math.max(0, (y - 60) / 380)), hx = 198 + 22 * yy, e = Math.min(1, Math.abs(x) / hx);
  return Math.min(
    slabAt(x, y - 250, z - 30 * e * e, hx + 13, 203, 13, 90, 13),
    slabAt(x, y - 250, z - 8, 205, 175, 9, 70, 6),
    slabAt(x, y - 150, z + 6, 150, 30, 11, 10, 10),
  );
}

/** The chair's stand-ins: the backrest, the seat's cushion and shell, the spine, the armrests, the floor. */
export const CHAIR: Sdf = union(
  (x, y, z) => { const dy = y - BY, dz = z - BZ; return backrest(x, dy * CL + dz * SL, -dy * SL + dz * CL); },
  (x, y, z) => slabAt(x, z + 5, y - 505, 245, 235, 40, 60, 32),
  slab(0, 458, 0, 235, 11, 225, 8),
  slab(0, 470, 200, 35, 20, 60, 10),
  capsule([0, 470, 255], [0, 600, 300], 22),
  ...[-1, 1].flatMap((s) => [
    slab(s * 268, 662, 0, 36, 14, 125, 12),
    capsule([s * 262, 440, 40], [s * 268, 650, 20], 18),
    capsule([s * 120, 440, 40], [s * 262, 440, 40], 14),
  ]),
  floor(0),
);

// ---- the pattern (a men's M): body 560 wide and 700 long, the armpit 440 up; sleeves 615 long; the hood 365 high ----
const HW = 280, PIT = 440, TOP = 700, SHO: P2 = [235, 676], NK = 92, BAND = 62;
const CUFF = 100, BIC = 205, UA = 520, CAP = 615, CUFF_H = 70;
/**
 * The pieces start near their seams, so sewing is a short pull: the body a stadium round the back (its faces `R` off its middle `ZC`) closed
 * along the shoulders, the sleeves hanging with their caps laid on the armholes, the hood's halves rising off the neckline and leaning
 * together. The shoulders' high point `NECK` is 300 mm over the back's top (453), so the hem clears the seat; the sewn hoodie is let down.
 */
const R = 58, F = HW - (Math.PI * R) / 2, ZC = 15, NECK = 792;
const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const edgeOf = (p: Piece, name: string) => p.edges.find((e) => e.name === name)!.pts;

/**
 * A rib band up to `h` from the edge: its own material. It is not cut narrower: a band shorter than the cloth sewn to it cannot lie flat
 * nor fold still under hard stretch, so the solver shivers it.
 */
const rib = (h: number) => ({ material: (_x: number, y: number) => (y < h ? 1 : 0) });

/** The body's top at `ax` off its middle: the shoulder line, and over the neck a line rising off it, so the neck stays open. */
const topAt = (ax: number) => (ax >= NK ? TOP + ((SHO[1] - TOP) * Math.min(1, (ax - NK) / (SHO[0] - NK))) : TOP + 0.8 * (NK - ax));

/** Front (side -1, toward the sitter) or back (+1): its neckline `drop` deep; the rib band along its hem. */
function body(name: string, side: -1 | 1, drop: number): Piece {
  return {
    name,
    edges: [
      { name: 'hem', pts: [[-HW, 0], [HW, 0]] },
      { name: 'sideR', pts: [[HW, 0], [HW, PIT]] },
      { name: 'armR', pts: curve([HW, PIT], [HW - 6, 590], SHO) },
      { name: 'shR', pts: [SHO, [NK, TOP]] },
      { name: 'neckR', pts: curve([NK, TOP], [NK * 0.9, TOP - drop], [0, TOP - drop]) },
      { name: 'neckL', pts: curve([0, TOP - drop], [-NK * 0.9, TOP - drop], [-NK, TOP]) },
      { name: 'shL', pts: [[-NK, TOP], [-SHO[0], SHO[1]]] },
      { name: 'armL', pts: curve([-SHO[0], SHO[1]], [-(HW - 6), 590], [-HW, PIT]) },
      { name: 'sideL', pts: [[-HW, PIT], [-HW, 0]] },
    ],
    ...rib(BAND),
    // shallower toward the top, so front and back meet along the shoulders
    place: (x, y) => {
      const ax = Math.abs(x), a = Math.max(0, (ax - F) / R), k = smooth((topAt(ax) - y) / 130);
      const px = ax > F ? Math.sign(x) * (F + R * Math.sin(a)) : x, pz = side * R * k * (ax > F ? Math.cos(a) : 1);
      return fromBack(px, y - TOP + NECK, ZC + pz);
    },
  };
}

/** The sleeve cap's front half, underarm to top (its back half is its mirror); as long as the armhole, so the seam sews flat. */
const CAP_F = curve3([BIC, UA], [BIC * 0.8, UA + 80], [BIC * 0.53, CAP], [0, CAP]), CAP_LEN = polyLength(CAP_F);
/** On the cap at `ax` off the sleeve's middle: its height, and how far along it from the underarm (0) to the top (1). */
function capAt(ax: number): { y: number; u: number } {
  let run = 0;
  for (let i = 1; i < CAP_F.length; i++) {
    const a = CAP_F[i - 1]!, b = CAP_F[i]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (ax >= b[0] || i === CAP_F.length - 1) {
      const t = a[0] > b[0] ? Math.min(1, Math.max(0, (a[0] - ax) / (a[0] - b[0]))) : 0;
      return { y: a[1] + (b[1] - a[1]) * t, u: (run + l * t) / CAP_LEN };
    }
    run += l;
  }
  return { y: CAP, u: 1 };
}
/** The armhole of `p` on side `sx`, `u` of the way from the armpit to the shoulder. */
const armhole = (p: Piece, sx: number, u: number): P3 => { const [x, y] = pointAt(edgeOf(p, sx > 0 ? 'armR' : 'armL'), sx > 0 ? u : 1 - u); return p.place(x, y); };

/**
 * A sleeve (`sx` its side): a tube round an arm hanging down beside the back, its top bent over the last 260 mm onto the armhole of the
 * front (the cap's front half `capF`, x > 0) and the back.
 */
function sleeve(name: string, sx: -1 | 1, front: Piece, back: Piece): Piece {
  const top = fromBack(sx * 312, NECK - 22, ZC), foot = fromBack(sx * 330, NECK - 22 - CAP, ZC + 15);
  const u = norm([top[0] - foot[0], top[1] - foot[1], top[2] - foot[2]]);
  const out = norm(less([sx, 0, 0], u)), fwd = norm(less(less([0, 0, -1], u), out));
  const tube = (x: number, y: number): P3 => {
    const hw = y < UA ? CUFF + ((BIC - CUFF) * y) / UA : BIC, r = hw / Math.PI, f = Math.PI * Math.max(-1, Math.min(1, x / hw)), t = Math.min(y, CAP) / CAP;
    const c = Math.cos(f) * r, s = Math.sin(f) * r;
    return [0, 1, 2].map((k) => foot[k]! + (top[k]! - foot[k]!) * t + out[k]! * c + fwd[k]! * s) as P3;
  };
  return {
    name,
    edges: [
      { name: 'cuff', pts: [[-CUFF, 0], [CUFF, 0]] },
      { name: 'seamR', pts: [[CUFF, 0], [BIC, UA]] },
      { name: 'capF', pts: CAP_F },
      { name: 'capB', pts: CAP_F.map(([x, y]): P2 => [-x, y]).reverse() },
      { name: 'seamL', pts: [[-BIC, UA], [-CUFF, 0]] },
    ],
    ...rib(CUFF_H),
    place: (x, y) => {
      const cap = capAt(Math.abs(x)), w = smooth((y - cap.y + 260) / 260), at = tube(x, y);
      if (w === 0) return at;
      const seam = tube(x, cap.y), to = armhole(x >= 0 ? front : back, sx, cap.u);
      return [0, 1, 2].map((k) => at[k]! + w * (to[k]! - seam[k]!)) as P3;
    },
  };
}

/** Where the hoodR half's neck is sewn at `x` from the face's edge: along the front's neckline to its side, the back's to its middle, then on back. */
function neckAt(x: number, front: Piece, back: Piece): P3 {
  const fl = polyLength(edgeOf(front, 'neckR')), bl = polyLength(edgeOf(back, 'neckR'));
  if (x <= fl) { const [a, b] = pointAt(edgeOf(front, 'neckR'), 1 - x / fl); return front.place(a, b); }
  const [a, b] = pointAt(edgeOf(back, 'neckR'), (x - fl) / bl), p = back.place(a, b), past = Math.max(0, x - fl - bl);
  return [p[0], p[1] - past * SL, p[2] + past * CL];
}

/**
 * A hood half (`sx` its side): x from the face's edge back, y up from the neck; it rises off the neckline, leaning in to meet the other.
 * Its neck is as long as the front's and the back's necklines.
 */
function hood(name: string, sx: -1 | 1, front: Piece, back: Piece): Piece {
  const fl = polyLength(edgeOf(front, 'neckR')), nb = fl + polyLength(edgeOf(back, 'neckR'));
  return {
    name,
    edges: [
      { name: 'neckF', pts: [[0, 0], [fl, 4]] },
      { name: 'neckB', pts: [[fl, 4], [nb, 12]] },
      { name: 'crown', pts: curve3([nb, 12], [278, 175], [255, 362], [70, 368]) },
      { name: 'face', pts: curve([70, 368], [24, 190], [0, 0]) },
    ],
    place: (x, y) => {
      const n = neckAt(x, front, back);
      return [sx * Math.max(Math.abs(n[0]) * (1 - y / 400), 6), n[1] + 0.97 * y * CL, n[2] + 0.97 * y * SL];
    },
  };
}

type V = [number, number, number];
const less = (a: V, u: V): V => { const d = a[0] * u[0] + a[1] * u[1] + a[2] * u[2]; return [a[0] - d * u[0], a[1] - d * u[1], a[2] - d * u[2]]; };
const norm = (a: V): V => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const front = body('front', -1, 85), back = body('back', 1, 22);
const pieces = [
  front, back, sleeve('sleeveR', 1, front, back), sleeve('sleeveL', -1, front, back), hood('hoodR', 1, front, back), hood('hoodL', -1, front, back),
];
/** Sew `a.ea` to `b.eb`; `flip` where the two edges run opposite ways round their pieces. */
const sew = (a: string, ea: string, b: string, eb: string, flip = false) => ({ a: [a, ea] as const, b: [b, eb] as const, flip });

export const HOODIE: Garment = {
  pieces,
  materials: ['knit', 'rib'],
  seams: [
    sew('front', 'sideR', 'back', 'sideR'), sew('front', 'sideL', 'back', 'sideL'),
    sew('front', 'shR', 'back', 'shR'), sew('front', 'shL', 'back', 'shL'),
    // armpit to shoulder on the body; underarm to cap top (capF) or back (capB) on the sleeve
    sew('front', 'armR', 'sleeveR', 'capF'), sew('back', 'armR', 'sleeveR', 'capB', true),
    sew('front', 'armL', 'sleeveL', 'capF', true), sew('back', 'armL', 'sleeveL', 'capB'),
    sew('sleeveR', 'seamR', 'sleeveR', 'seamL', true), sew('sleeveL', 'seamR', 'sleeveL', 'seamL', true),
    // the hood's neck: centre front to the neck's side (neckF), on to centre back (neckB)
    sew('hoodR', 'neckF', 'front', 'neckR', true), sew('hoodR', 'neckB', 'back', 'neckR'),
    sew('hoodL', 'neckF', 'front', 'neckL'), sew('hoodL', 'neckB', 'back', 'neckL', true),
    sew('hoodL', 'crown', 'hoodR', 'crown'),
  ],
};

const G = 9810;

export const bake: ClothBake = {
  name: 'hoodie',
  garment: HOODIE,
  h: 15,
  params: { rate: 1500, thickness: 3, self: 11, stretch: 1e-7, bend: 2e-4, friction: [0.6, 0.4] },
  tile: 100,
  rim: 3.5,
  smooth: 3,
  phases: [
    // a short pull: the pieces start near their seams
    { label: 'sew', time: 1.5, gravity: 0, solid: CHAIR, sew: Infinity, keep: 0 },
    // let down onto the frame, slowly (the hood leans back with the back, so it falls behind)
    { label: 'drop', time: 1.2, gravity: G, solid: CHAIR, sew: Infinity, keep: 0.05 },
    { label: 'hang', time: 2, gravity: G, solid: CHAIR, sew: Infinity, keep: 0.2 },
    { label: 'settle', time: 1, gravity: G, solid: CHAIR, sew: Infinity, keep: 0.01 },
  ],
};
