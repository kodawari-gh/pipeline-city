import type { Graphics } from 'pixi.js';
import { mix } from './ink';
import type { Theme } from './theme';

// The room's shell: the ceiling with its crown moulding, the baseboard and the floor. A tall screen (a phone in portrait shows four times the height of the
// room) must show a room, not a void, and no edge of the picture: the ceiling and the floor run on past any view as a flat dark that the gradient has
// already reached, so there is nothing to see the end of. The wall between them is the slat wall (`wall.ts`).

export interface ShellBox {
  /** Where the wall meets the ceiling and the floor (world y). */
  ceil: number; floor: number;
}

/** The crown moulding under the ceiling and the baseboard over the floor: their heights. */
export const TRIM = { crown: 520, base: 440 };
/** How far the ceiling and the floor take to reach their flat far colour. */
export const FADE = { ceil: 3600, floor: 5400 };
/** The first floorboard's depth, and how much each is deeper than the one before (they are seen from a little above, so they widen toward the viewer). */
export const BOARD = { first: 430, grow: 1.13, count: 16 };

export interface ShellLook {
  /** The ceiling next to the wall and far from it. */
  ceilNear: string; ceilFar: string;
  /** The floor next to the wall and far from it, the two tones of the boards and the seams. */
  floorNear: string; floorFar: string; boardA: string; boardB: string; seam: string;
  /** The crown moulding and the baseboard. */
  trim: string; trimLo: string; trimHi: string;
}

export const shellLook = (T: Theme): ShellLook => T.dark
  ? { ceilNear: '#0c1122', ceilFar: '#04060e', floorNear: '#2a1f22', floorFar: '#07080f', boardA: '#2d2125', boardB: '#251b1f', seam: '#07090f', trim: '#3d3036', trimLo: '#241b20', trimHi: '#5a4a50' }
  : { ceilNear: '#e9eff4', ceilFar: '#b9c6d3', floorNear: '#c9a47f', floorFar: '#7f8396', boardA: '#c9a47f', boardB: '#bf9a76', seam: '#8e6f55', trim: '#f2f5f8', trimLo: '#c4ceda', trimHi: '#ffffff' };

/** The depth below the floor line (world units) of the top of floorboard `k` (0 is the first seam, where the first board begins). */
export function boardTop(k: number): number {
  let y = 0, d = BOARD.first;
  for (let i = 0; i < k; i++) { y += d; d *= BOARD.grow; }
  return y;
}

const BIG = 90000, BANDS = 16;

/** A vertical gradient as flat bands (no canvas: it is also built in tests): from `y0` to `y1`, the colour going from `a` to `b`. */
function bands(g: Graphics, x: number, w: number, y0: number, y1: number, a: string, b: string) {
  const h = (y1 - y0) / BANDS;
  for (let k = 0; k < BANDS; k++) g.rect(x, y0 + k * h, w, h + 2).fill({ color: mix(a, b, (k + 0.5) / BANDS) });
}

/** The ceiling: above `ceil`, the colour next to the wall fading to the far colour, then flat. */
export function drawCeiling(g: Graphics, T: Theme, B: ShellBox) {
  const L = shellLook(T);
  g.rect(-BIG, B.ceil - BIG, 2 * BIG, BIG - FADE.ceil).fill({ color: L.ceilFar });
  bands(g, -BIG, 2 * BIG, B.ceil - FADE.ceil, B.ceil, L.ceilFar, L.ceilNear);
}

/** The crown moulding: a lit strip under the ceiling with a shadow line under it, over the top of the slats. */
export function drawCrown(g: Graphics, T: Theme, B: ShellBox) {
  const L = shellLook(T), y = B.ceil, h = TRIM.crown;
  g.rect(-BIG, y, 2 * BIG, h).fill({ color: L.trim });
  g.rect(-BIG, y, 2 * BIG, h * 0.22).fill({ color: L.trimHi, alpha: 0.5 });
  g.rect(-BIG, y + h * 0.72, 2 * BIG, h * 0.28).fill({ color: L.trimLo, alpha: 0.75 });
  g.rect(-BIG, y + h, 2 * BIG, 150).fill({ color: '#000000', alpha: T.dark ? 0.35 : 0.14 }); // the shadow it throws on the wall
}

/** The baseboard over the foot of the wall, and the floor: boards that widen away from the wall, each with its seam and some butt joints, darkening to the far colour. */
export function drawFloor(g: Graphics, T: Theme, B: ShellBox) {
  const L = shellLook(T), y0 = B.floor, depth = FADE.floor;
  // the floor's colour, from the wall out
  g.rect(-BIG, y0 + depth, 2 * BIG, BIG).fill({ color: L.floorFar });
  bands(g, -BIG, 2 * BIG, y0, y0 + depth, L.floorNear, L.floorFar);
  // the boards: two tones, a seam between them, and a butt joint here and there
  let y = y0, d = BOARD.first;
  for (let k = 0; k < BOARD.count && y < y0 + depth; k++) {
    g.rect(-BIG, y, 2 * BIG, d).fill({ color: k % 2 ? L.boardB : L.boardA, alpha: Math.max(0, 0.9 * (1 - (y - y0) / depth)) });
    g.rect(-BIG, y, 2 * BIG, Math.max(5, d * 0.03)).fill({ color: L.seam, alpha: 0.7 });
    const step = 4200 * (d / BOARD.first), off = ((Math.sin(k * 12.9898 + 1.3) * 43758.5453) % 1 + 1) % 1;
    for (let x = -60000 + off * step; x < 60000; x += step * (0.8 + 0.5 * (((Math.sin(x * 0.001 + k) * 9999) % 1 + 1) % 1))) g.rect(x, y, Math.max(5, d * 0.025), d).fill({ color: L.seam, alpha: 0.5 });
    y += d; d *= BOARD.grow;
  }
  // where the wall meets the floor: the baseboard, and the dark the corner holds
  g.rect(-BIG, y0 - TRIM.base, 2 * BIG, TRIM.base).fill({ color: L.trim });
  g.rect(-BIG, y0 - TRIM.base, 2 * BIG, TRIM.base * 0.2).fill({ color: L.trimHi, alpha: 0.4 });
  g.rect(-BIG, y0 - TRIM.base * 0.28, 2 * BIG, TRIM.base * 0.28).fill({ color: L.trimLo, alpha: 0.7 });
  g.rect(-BIG, y0, 2 * BIG, 260).fill({ color: '#000000', alpha: T.dark ? 0.5 : 0.22 });
}
