// The room's one perspective. The wall is a plane facing the viewer (drawn at scale 1, like the machine on it), and everything that comes out of it toward the viewer
// (the desk, the floor, the rug, the legs, the window's recess) is drawn in the same one-point perspective, so their edges meet at one vanishing point. A point
// of the wall plane `(x, y)` that is brought forward to a scale `s` (1 on the wall, larger toward the viewer) lands at the vanishing point plus `s` times its offset
// from it. The picture is seen from a little above the desk's height, a little over half way up the wall.

export interface Persp {
  /** The vanishing point (world). */
  vx: number; yH: number;
}

/** How far up the wall the eye is, as a part of the wall's height (floor to ceiling). */
export const EYE = 0.58;
/** The scale of the depth the things on the desk stand at (the middle of the desk top), and of the desk's front edge. */
export const S_FEET = 1.08, S_FRONT = 1.16;

export const roomPersp = (B: { ceil: number; floor: number; x0: number; x1: number }): Persp => ({ vx: (B.x0 + B.x1) / 2, yH: B.floor - EYE * (B.floor - B.ceil) });
export const spreadX = (P: Persp, x: number, s: number) => P.vx + (x - P.vx) * s;
export const spreadY = (P: Persp, y: number, s: number) => P.yH + (y - P.yH) * s;
/** The scale of the floor plane at world y (1 at the wall's foot, growing toward the viewer). */
export const floorScale = (P: Persp, floor: number, y: number) => (y - P.yH) / (floor - P.yH);

export interface DeskGeo {
  P: Persp;
  /** The line the things on the desk stand on, and the floor line (where the wall meets the floor). */
  ys: number; floor: number;
  /** The top's far edge (against the wall) and its near edge (the front). */
  yBack: number; yFront: number;
  /** The front face of the slab, and its bottom edge. */
  slab: number; yBottom: number;
  /** Where the legs meet the floor, at the front. */
  floorFront: number;
  /** The x of a coordinate given at the depth the things stand at, brought to the scale `s` (1: the wall, `S_FRONT`: the front). */
  xAt(x: number, s: number): number;
  /** The x of a point of the front plane, taken back to the wall. */
  toWall(x: number): number;
}

/** The thickness of the slab at the front, world units. */
export const SLAB_FRONT = 440;

export function deskGeo(P: Persp, ys: number, floor: number): DeskGeo {
  const yBack = spreadY(P, ys, 1 / S_FEET), yFront = spreadY(P, yBack, S_FRONT);
  return {
    P, ys, floor, yBack, yFront, slab: SLAB_FRONT, yBottom: yFront + SLAB_FRONT, floorFront: spreadY(P, floor, S_FRONT),
    xAt: (x, s) => spreadX(P, x, s / S_FEET),
    toWall: (x) => spreadX(P, x, 1 / S_FRONT),
  };
}
