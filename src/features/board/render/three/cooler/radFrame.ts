// The radiator model's frame (cooler3d.ts `radiatorModel`): where its core lies along its side of the case and across its depth, and the plain
// boxes its parts are made of.
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import { BoxGeometry, Group, Mesh } from 'three';
import type { Material } from 'three';
import { FAN_SCREW, place } from '@/core/render/three/geometry';
import type { RectLike } from '@/core/render/three/geometry';
import { FAN_MAX, FAN_ZC } from '@/features/room/render/three/roomplan';
import { FAN_LEN } from '../../layout/layout';
import { frameOf, radiatorCore } from '../../cooler';
import type { Frame, RadiatorFit } from '../../cooler';
import { radiatorDepth } from './radiator';

/** A radiator being built: its root, its frame and length along the side, its core's span and thickness, and its depths across the case. */
export interface Rad {
  root: Group;
  fr: Frame;
  L: number;
  v0: number;
  v1: number;
  t: number;
  side: RadiatorFit['mount']['side'];
  D: number;
  zc: number;
  z0: number;
  z1: number;
  /** How far a fan's screw holes are from its middle, and how far each side plate folds over a face. */
  hole: number;
  fold: number;
  /** The unit box every plain part scales. */
  unit: BoxGeometry;
}

/** The frame of the radiator fitted at `fit`. */
export function radOf(fit: RadiatorFit): Rad {
  const fr = frameOf(fit.mount, fit.end),
    { L } = fr,
    { v0, v1 } = radiatorCore(fit);
  const D = radiatorDepth(),
    zc = FAN_ZC,
    hole = Math.min(FAN_LEN, FAN_MAX) * FAN_SCREW;
  return {
    root: new Group(),
    fr,
    L,
    v0,
    v1,
    t: v1 - v0,
    side: fit.mount.side,
    D,
    zc,
    z0: zc - D / 2,
    z1: zc + D / 2,
    hole,
    fold: D / 2 - hole + 90,
    unit: new BoxGeometry(1, 1, 1),
  };
}

/** A box over the rect `r` (the board's plane), from depth `za` to `zb`. */
export interface Item {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
}
export const item = (r: RectLike, za: number, zb: number): Item => ({
  x: r.x + r.w / 2,
  y: -(r.y + r.h / 2),
  z: (za + zb) / 2,
  sx: r.w,
  sy: r.h,
  sz: zb - za,
});
/** The boxes as plain meshes, not instanced ones: the skin's merge (`radiatorModel`) takes those. */
export const boxes = (rad: Rad, m: Material, items: readonly Item[]): Mesh[] =>
  items.map((it) => {
    const o = place(new Mesh(rad.unit, m));
    o.position.set(it.x, it.y, it.z);
    o.scale.set(it.sx, it.sy, it.sz);
    return o;
  });
