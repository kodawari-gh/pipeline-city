// The NIC's controller as a real chip with its die (docs/render/net.md "Inside the NIC and the router"). A QFN on the gigabit card: a leadframe pad with the die on it, under a cap of
// black mould; a lidded BGA on the faster cards: a substrate with the die on it, under a nickel lid and the finned sink. Like the CPU's (cpu3d.ts), the die is a block of silicon whose
// top wears the floorplan (nicplan.ts) in a frame of its own, drawn at the die's scale; the cap or the lid, with the sink on it, fades away as the camera comes in and the die shows.
// Built in a frame whose y is the negative of layout's and whose depth runs up off the PCB (the card's component side, nic3d.ts, and the board's own frame, phychip3d.ts): it takes the
// rectangles mirrored in y (`mirror`) and the same function to turn them back (`U`).
import { Group } from 'three';
import type * as threeTypes from 'three';
import { dieShow } from '@/core/render/lod/lod';
import { fadeTree } from '@/core/render/three/artlod';
import { rectBox, softBox } from '@/core/render/three/geometry';
import type * as geometryTypes from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { MM, lidBase, pkg } from './pcbkit3d';

/** A rectangle mirrored in y about layout's origin: in the chip's frame and out of it (the mirror is its own inverse). */
export const mirror = (r: geometryTypes.RectLike): geometryTypes.RectLike => ({
  x: r.x,
  y: -(r.y + r.h),
  w: r.w,
  h: r.h,
});

/** The die's width in mm: a QFN's (a 9 mm package: the die fills it to a 0.2 mm rim) and a lidded BGA's (a 25 mm package: to a 0.5 mm rim). The floorplan covers the whole chip. */
export const DIE_MM = { qfn: 8.6, bga: 24 } as const;

/** Puts the floorplan on a frame: the die's baked art in `frame` (which is scaled by `scale`, a layout unit to a plan unit), and where its live face goes. Null: no art (the gallery's plain card). */
export type DieFloor = (frame: Group, scale: number) => { root: threeTypes.Object3D; z: number };

export interface NicChip {
  /** What fades as the die shows: the cap or the lid (the BGA's sink and its pins go in it too, `nic3d.ts`). */
  lid: Group;
  /** The die's face for the live layer (`Chips3D.face`): its parent and the depth over the baked floorplan in that frame. Null with no floorplan. */
  die: { root: threeTypes.Object3D; z: number } | null;
  /** Layout units a plan unit: the die's size over the plan's. */
  scale: number;
  /** The die's own rectangle (in the frame the chip was built in: mirrored in y, `mirror`), the package's height off the PCB, and the height of the die's top (where its floorplan lies). */
  rect: geometryTypes.RectLike;
  top: number;
  dieTop: number;
  /** The lid's fade for the zoom (screen pixels per layout unit): gone over the die view's band, as the CPU's. */
  lod: (zoom: number) => void;
}

/**
 * The controller on its pads: `chip` is the package's rectangle in the group's frame (layout mirrored in y: `U` turns it back), `qfn` its kind, `zu` the depth of the PCB's
 * face in the group, `mark` the laser marking. The terminals of a QFN and the sink of a BGA are the caller's: it adds them to `u` and to the returned `lid`. `plan`: the
 * rectangle the die's plan covers in its frame (the card's band, `NicGeo.die`): the frame is placed so the plan's middle lies on the die's. `o.height`: the QFN's height off the PCB when it is
 * not the card's 0.9 mm; `o.die`: the die's side (layout units) when it is not the card's (the motherboard's Ethernet chip is a taller package with a bigger pad, phychip3d.ts).
 */
export function nicChip(
  u: Group,
  chip: geometryTypes.RectLike,
  qfn: boolean,
  zu: number,
  mark: readonly string[],
  U: (r: geometryTypes.RectLike) => geometryTypes.RectLike,
  plan: geometryTypes.RectLike,
  floor?: DieFloor,
  o: { height?: number; die?: number } = {},
): NicChip {
  // (the die has its plan's shape, `plan.h` over `plan.w`: the floorplan fills the die and the die fills the package)
  const lid = new Group(),
    side = o.die ?? (qfn ? DIE_MM.qfn : DIE_MM.bga) * MM,
    scale = side / plan.w,
    dh = plan.h * scale;
  const cx = chip.x + chip.w / 2,
    cy = chip.y + chip.h / 2,
    rect = { x: cx - side / 2, y: cy - dh / 2, w: side, h: dh };
  const silicon = mat(0x1d_1e_22, { metalness: 0.35, roughness: 0.3 });
  let zTop: number, top: number, dieTop: number;
  if (qfn) {
    // a leadframe pad under the die, the mould's cap over both (its marking on top)
    const pad = { x: chip.x + 0.5 * MM, y: chip.y + 0.5 * MM, w: chip.w - MM, h: chip.h - MM };
    u.add(rectBox(U(pad), zu, zu + 0.12 * MM, mat(0xb9_ba_bf, { metalness: 0.85, roughness: 0.35 })));
    u.add(softBox(U(rect), zu + 0.12 * MM, zu + 0.4 * MM, silicon, 1));
    dieTop = 0.4 * MM;
    zTop = zu + dieTop;
    top = o.height ?? 0.9 * MM;
    pkg(lid, U(chip), zu, top, mark);
  } else {
    // the substrate, the die on it (flip-chip), the lid over them
    const h = 2.4 * MM,
      t = lidBase(h);
    u.add(softBox(U(chip), zu, zu + t, mat(0x17_3d_29, { roughness: 0.55 }), 2));
    u.add(softBox(U(rect), zu + t, zu + t + 0.8 * MM, silicon, 2));
    dieTop = t + 0.8 * MM;
    zTop = zu + dieTop;
    top = h;
    pkg(lid, U(chip), zu, h, mark, { lid: true, lidOnly: true });
  }
  u.add(lid);
  // the floorplan, in a frame on the die's top (in the die's own units, the CPU's way, cpu3d.ts): a plan's y runs down toward -y of the frame, so the plan's middle goes to (cx, cy)
  let die: NicChip['die'] = null;
  const frame = new Group();
  frame.position.set(cx - scale * (plan.x + plan.w / 2), cy + scale * (plan.y + plan.h / 2), zTop);
  frame.scale.setScalar(scale);
  const made = floor?.(frame, scale);
  if (made) {
    u.add(frame);
    die = made;
  }
  return {
    lid,
    die,
    scale,
    rect,
    top,
    dieTop,
    lod: (zoom) => {
      const a = dieShow(zoom, side);
      fadeTree(lid, 1 - a);
      if (made) {
        made.root.visible = a > 0.01;
      }
    },
  };
}
