// The door in the west wall (`door`): its architrave, its leaf, the lever and the keyhole plate, the threshold, the stop and the light switch.
import { Group } from 'three';
import { SEG, post, rectBox, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { STEEL, TRIM } from '../palette';
import { DOOR, FLOOR_Y, WEST_X } from '../roomplan';
import type { Material, Mesh } from './types';

/** A box in the west wall's plane: from `y0` down to `y1`, from `za` to `zb` along the wall, from `x0` to `x1` out of it. */
type Span = readonly [y0: number, y1: number, za: number, zb: number, x0: number, x1: number];

/** A soft-edged box over a `Span`, its edges rounded `r`. */
function slab(s: Span, m: Material, r = 40): Mesh {
  const [y0, y1, za, zb, x0, x1] = s;
  return softBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, za, zb, m, r);
}

/**
 * A flush charcoal door in the west wall near the front: a slim square architrave in the trim's tone, the plain leaf in its frame with a dark
 * gap round it, hidden hinges, a black lever on a square rose and a small keyhole plate, a black threshold strip, a stop on the floor, and a
 * flat black light switch beside it.
 */
export function door(): Group {
  const g = new Group(),
    { z0, z1, top } = DOOR,
    fl = FLOOR_Y,
    trim = mat(TRIM, { roughness: 0.45 }),
    xs = WEST_X;
  // (in the wall's plane: y down, z along the wall; x out of the wall into the room)
  // the architrave: three square-edged boards round the opening
  const cw = 900;
  g.add(slab([top - cw, top, z0 - cw, z1 + cw, xs, xs + 160], trim, 20));
  for (const [a, b] of [
    [z0 - cw, z0],
    [z1, z1 + cw],
  ] as const) {
    g.add(slab([top, fl, a, b, xs, xs + 160], trim, 20));
  }
  // the frame's dark gap round the leaf, the leaf
  g.add(rectBox({ x: xs - 320, y: top, w: 100, h: fl - top }, z0, z1, mat(0x13_15_18, { roughness: 0.9 })));
  const face = xs + 110,
    leaf = mat(0x2a_2d_32, { roughness: 0.5 });
  g.add(slab([top + 70, fl - 150, z0 + 70, z1 - 70, xs - 220, face], leaf, 25));
  const black = mat(0x1d_1e_22, { metalness: 0.4, roughness: 0.4 }),
    dark = mat(0x05_06_08, { roughness: 0.7 });
  doorLever(g, face, { black, dark });
  doorFloor(g, black);
  doorSwitch(g);
  return g;
}

/** The lever: a square rose, a short neck, a straight square-section bar along the door; a keyhole plate under it. */
function doorLever(g: Group, face: number, { black, dark }: { black: Material; dark: Material }): void {
  const hy = FLOOR_Y - 19_000,
    hz = DOOR.z0 + 1350;
  g.add(slab([hy - 480, hy + 480, hz - 480, hz + 480, face, face + 90], black, 40));
  g.add(slab([hy - 110, hy + 110, hz - 110, hz + 110, face + 90, face + 620], black, 40));
  g.add(slab([hy - 120, hy + 120, hz - 110, hz + 2300, face + 520, face + 760], black, 60));
  g.add(
    slab([hy + 1400, hy + 2000, hz - 300, hz + 300, face, face + 70], black, 30),
    slab([hy + 1600, hy + 1800, hz - 40, hz + 40, face + 70, face + 76], dark, 5),
  );
}

/** The threshold (a black aluminium strip across the opening on the floor), and a stop on the floor where the door swings open. */
function doorFloor(g: Group, black: Material): void {
  const { z0, z1 } = DOOR,
    fl = FLOOR_Y,
    xs = WEST_X;
  g.add(
    softBox({ x: xs - 300, y: fl - 120, w: 900, h: 120 }, z0, z1, mat(STEEL, { roughness: 0.4, metalness: 0.5 }), 40),
  );
  g.add(
    post(xs + 12_500, fl, z1 - 1200, 330, 700, black, SEG.disc),
    post(xs + 12_500, fl - 700, z1 - 1200, 300, 120, mat(0x2a_2d_32, { roughness: 0.9 }), SEG.disc),
  );
}

/** The light switch beside the door: a thin square plate in black glass, a wide rocker. */
function doorSwitch(g: Group): void {
  const { z1 } = DOOR,
    fl = FLOOR_Y,
    xs = WEST_X;
  g.add(
    slab(
      [fl - 22_300, fl - 20_900, z1 + 1500, z1 + 2900, xs, xs + 110],
      mat(0x13_15_18, { roughness: 0.2, metalness: 0.1 }),
      40,
    ),
  );
  g.add(
    slab(
      [fl - 22_100, fl - 21_100, z1 + 1700, z1 + 2700, xs + 110, xs + 170],
      mat(0x1d_1e_22, { roughness: 0.35 }),
      40,
    ),
  );
}
