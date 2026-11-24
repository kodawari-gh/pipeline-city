// A chip package that shows its die (docs/PC_PARTS.md "Storage"): the package stands as a real one does, its cap (a mould, or a lid over a substrate) on top; as the camera comes in the cap fades and the die
// shows under it, wearing its own floorplan. The same for the NVMe stick's controller, DRAM and NAND and the SATA SSD's: the die is a block of silicon on the package's substrate, its top the baked 2D art
// (`ArtSet.surface`), drawn in a frame that scales the art's units to the board's. Hidden until the cap goes, so it bakes nothing before.
import { Group } from 'three';
import { dieShow, dieZoom } from '@/core/render/lod/lod';
import type { Theme } from '@/core/render/theme';
import { FINISH, fadeTree, ownMaterials } from '@/core/render/three/artlod';
import { softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import type { ArtBaker } from './bake';
import { LV_DIE, type ArtSet } from './artset3d';
import { lidBase, pkg, type PkgLook } from './pcbkit3d';

/**
 * The 3D drive's cover (a label, a heat sink, a shell, a lid) fades first, over this band in screen pixels per unit; then the packages' caps fade and the dies show, over the one band every chip uses (`dieShow`, lod.ts).
 * A drive here is small beside a card (the gallery fits an M.2 stick at about 0.41, a 2.5 in. drive at 0.33), so the cover's band lies higher than the 2D drives' (`DEVICE_LOD.disk`).
 */
export const COVER_BAND = [0.5, 0.65] as const;
/** The zoom a flight to a drive ends at, for its dies to be shown: where the widest package (an 18 mm NAND) has its die in. */
export const DRIVE_DIE_ZOOM = dieZoom(18 * 23);

/** What a part needs to show dies: the set that bakes the art, the palette, and how it asks for a zoom at a place (a machine's reveal, or a marker under the set's `reveal`). */
export interface DieHost {
  art: ArtSet;
  T: Theme;
  reveal: (r: RectLike, z: number, apply: (zoom: number) => void) => void;
}

/** How much of a package's top its die covers (the rest is its bevel): the package is the plan's shape, so this is a rim, not a margin. */
export const DIE_FILL = 0.97;

/** The picture of a die: its baked art and its size in the art's own units; `turn`: it lies a quarter turn round on the package (a tall package holds a wide die). */
export interface DieFace {
  w: number;
  h: number;
  bake: ArtBaker;
  turn?: boolean;
}

/**
 * The package over `r` on a board top at depth `z`, `h` tall, into `g`: its cap marked `marks`, the substrate under it, the die on that. `look.lid`: a lidded package, whose lid is the cap over a wide
 * substrate; else the mould is the cap. The cap fades over the shared band (`dieShow`) and the die shows; the die fills the package's top (its plan is cut to the package's shape, so nothing of the package shows round it). The cap has materials of its own, so one fading does not fade its neighbours.
 */
export function dieInPackage(
  g: Group,
  d: DieHost,
  r: RectLike,
  z: number,
  h: number,
  marks: readonly string[],
  look: PkgLook,
  face: DieFace,
): void {
  const lid = !!look.lid,
    cap = new Group(),
    ts = lid ? lidBase(h) : Math.min(h * 0.2, 14);
  pkg(cap, r, z, h, marks, lid ? { ...look, lidOnly: true } : look);
  ownMaterials(cap);
  g.add(cap);
  // (a moulded package's substrate stands a little in from its edge: both would be one plane)
  const sr = lid ? r : { x: r.x + 1.5, y: r.y + 1.5, w: r.w - 3, h: r.h - 3 };
  g.add(softBox(sr, z, z + ts, mat(0x173d29, { roughness: 0.55 }), 2));
  // the die: silicon as big as its floorplan reads at the package's size
  const fw = face.turn ? face.h : face.w,
    fh = face.turn ? face.w : face.h,
    k = DIE_FILL * Math.min(r.w / fw, r.h / fh),
    dw = fw * k,
    dh = fh * k;
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2,
    top = z + ts + Math.max(6, h * 0.25);
  g.add(
    softBox(
      { x: cx - dw / 2, y: cy - dh / 2, w: dw, h: dh },
      z + ts,
      top,
      mat(0x1d1e22, { metalness: 0.35, roughness: 0.3 }),
      1,
    ),
  );
  // (the art is drawn from its top left corner, y down: its own frame puts that corner at the die's, whose middle is the package's)
  const frame = new Group(),
    inner = new Group();
  frame.position.set(cx, -cy, top);
  frame.scale.setScalar(k);
  if (face.turn) frame.rotation.z = Math.PI / 2;
  frame.visible = false;
  inner.position.set(-face.w / 2, face.h / 2, 0);
  frame.add(inner);
  d.art.surface(inner, face.bake.bake, { x: 0, y: 0, w: face.w, h: face.h }, 0, LV_DIE, FINISH.die);
  g.add(frame);
  d.reveal(r, z + h, (zoom) => {
    const f = dieShow(zoom, Math.max(dw, dh));
    fadeTree(cap, 1 - f);
    frame.visible = f > 0.01;
  });
}
