// The board's smaller hardware as real parts (docs/GRAPHICS_3D_OVERHAUL.md "Inside the case"), where the 2D drawing stands for a part seen from
// above: the M.2 standoff (the stick itself: nvme3d.ts), the chipset under its low heat sink, the coin cell in its holder, the TPM module on its
// header, a SATA drive's cast body with its lid and connectors.
// Each top still wears its 2D drawing (`Raise`: `ArtSet.raise`), so the 3D parts sit on their pictures; `driveRaise` and `tpmModel` give the
// drives and the module their own drawing, the same in the case, in Build my PC and in the gallery.
import { BoxGeometry, CylinderGeometry, Group, Mesh, type Material, type MeshStandardMaterial, type Texture } from 'three';
import { Container, Graphics } from 'pixi.js';
import { headerRect, tpmArt, tpmHeader, tpmRect } from '@/core/render/accelart';
import type { Theme } from '@/core/render/theme';
import { drum, instanced, paint, place, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { drawDriveLive, driveArt, type DriveKind } from '@/features/storage/render/drives';
import { pchFixings, pchPlateau } from '../boardArt';
import { GEO } from '../layout/layout';
import { m2Standoffs } from '../layout/pins';
import { hexNum, skinOf } from '../skins';
import type { ArtSet } from './artset3d';
import { brushed, grow, NONE, outlinePts, shapeOf, slab, tiled } from './casekit3d';

/** Stand a rect up from depth z0 to z1, its top wearing the 2D drawing of that rect (`bevel` rounds a moulded body). */
export type Raise = (parent: Group, r: RectLike, z0: number, z1: number, side: Material, bevel?: number) => Group;

const brass = () => mat(0xc9a24a, { metalness: 0.9, roughness: 0.3 });
const steel = () => mat(0x9aa3ae, { metalness: 0.85, roughness: 0.32 });

/** A pan-head screw from depth z, radius r: the head and its cross slot. */
function screw(g: Group, x: number, y: number, z: number, r: number) {
  g.add(drum(x, y, z, z + r * 0.45, r, steel(), 20));
  const slot = mat(0x20242c, { roughness: 0.6 });
  g.add(rectBox({ x: x - r * 0.6, y: y - r * 0.1, w: r * 1.2, h: r * 0.2 }, z + r * 0.4, z + r * 0.47, slot), rectBox({ x: x - r * 0.1, y: y - r * 0.6, w: r * 0.2, h: r * 1.2 }, z + r * 0.4, z + r * 0.47, slot));
}

// ------------------------------------------------------------------ M.2
/**
 * The M.2 slot's standoff for an 80 mm stick (the 2D disc), where the stick's notch is screwed down (nvme3d.ts): a brass hex, 4.5 mm across its
 * corners and as tall as the socket holds the stick, its M2 thread dark in its top.
 */
export function m2Standoff(m: RectLike): Group {
  const [x, y] = m2Standoffs(m)[2]!, g = new Group();
  g.add(drum(x, y, BOARD_Z, BOARD_Z + 42, 52, brass(), 6));
  const hole = new Mesh(new CylinderGeometry(20, 20, 0.6, 16).rotateX(Math.PI / 2), mat(0x2a2418, { roughness: 0.8 }));
  hole.position.set(x, -y, BOARD_Z + 41.7);
  g.add(hole);
  return g;
}

// ------------------------------------------------------------------ chipset
/** How far the chipset's heat sink runs on past the package, over its legs (the lanes go in under its edge, as real traces do). */
export const PCH_OVER = 44;

/**
 * The chipset over its 2D rect, by board tier, as real boards carry it. The Starter's bare moulded package. On the others a low heat sink over
 * the package and its legs, sitting on a thermal pad: a flat black anodised plate with a grooved plateau held by two push pins (Basic); a faceted
 * block, chamfered at every corner, with a raised brushed plateau and two spring screws on a diagonal (Mainstream: gunmetal; Enthusiast: graphite
 * with a silver plateau and a lit strip along its south face). The plateau wears the 2D drawing (`pchPlateau`). `glow`: the strip's material.
 */
export function chipset(q: RectLike, tier: number, raise: Raise): { root: Group; glow: MeshStandardMaterial | null } {
  const g = new Group(), Z = BOARD_Z;
  if (tier === 0) { raise(g, q, Z, Z + 50, mat(0x0c0d10, { roughness: 0.62 }), 8); return { root: g, glow: null }; }
  // (the package's legs stand 30 high: the sink's base clears them by a hair, so from any angle its edge hides them)
  const facet = tier >= 2, s = grow(q, PCH_OVER), pad = Z + 34, top = Z + (facet ? 150 : 112);
  // the package under it (its sides show in the shadow gap) and the thermal pad's edge
  g.add(rectBox(q, Z, pad - 4, mat(0x0c0d10, { roughness: 0.6 })), rectBox(grow(q, -16), pad - 4, pad, mat(0x8e98a8, { roughness: 0.85 })));
  const sk = skinOf(tier), body = facet
    ? mat(hexNum(sk.sink), { metalness: 0.55, roughness: 0.42, map: tiled(brushed(), 2, 2) })
    : mat(hexNum(sk.sink), { metalness: 0.35, roughness: 0.55 });
  // (the chamfers stay clear of the corner legs' tips: a leg row starts 30 in from the package's corner and its legs reach 22 out)
  const cut = 64;
  g.add(slab(shapeOf(outlinePts(s, facet ? 0 : 24, facet ? [cut, cut, cut, cut] : NONE)), pad, top, body, facet ? 10 : 8));
  const pl = pchPlateau(q, tier);
  raise(g, pl, top - 4, top + (facet ? 38 : 14), sk.insert ? mat(hexNum(sk.insert), { metalness: 0.6, roughness: 0.42 }) : body, facet ? 8 : 4);
  for (const [x, y] of pchFixings(q, tier)) {
    if (facet) {
      // a spring screw: the coil round the shank under the head
      g.add(drum(x, y, top, top + 26, 13, mat(0x8b939e, { metalness: 0.7, roughness: 0.4 }), 14));
      screw(g, x, y, top + 26, 20);
    } else g.add(drum(x, y, top, top + 10, 18, mat(0xd9d4c7, { roughness: 0.6 }), 18), drum(x, y, top + 10, top + 18, 11, mat(0xcfc9bb, { roughness: 0.6 }), 14));
  }
  let glow: MeshStandardMaterial | null = null;
  if (tier === 3) {
    glow = mat(0x1a1430, { emissive: hexNum(sk.accent), emissiveIntensity: 0.9, roughness: 0.4 });
    g.add(rectBox({ x: s.x + 110, y: s.y + s.h - 3, w: s.w - 220, h: 8 }, pad + 30, top - 30, glow));
  }
  return { root: g, glow };
}

// ------------------------------------------------------------------ the coin cell
let cellTex: Texture | null | undefined;

/** The coin cell's top: brushed steel, the + and the type stamped in it. */
function cellTop(): Texture | null {
  if (cellTex !== undefined) return cellTex;
  return cellTex = paint(256, 256, (c, w, h) => {
    const g = c.createRadialGradient(w * 0.4, h * 0.35, 10, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#dfe4ea'); g.addColorStop(1, '#8d96a2');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(40,46,56,0.55)'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '700 64px system-ui, sans-serif'; c.fillText('+', w / 2, h * 0.34);
    c.font = '600 40px system-ui, sans-serif'; c.fillText('CR2032', w / 2, h * 0.62);
  });
}

/** The board's coin cell over its 2D rect: a dark holder, the cell in it, the spring clip across its top. */
export function coinCell(r: RectLike): Group {
  const g = new Group(), cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = Math.min(r.w, r.h) / 2;
  g.add(drum(cx, cy, BOARD_Z, BOARD_Z + 26, R + 14, mat(0x1a1d24, { roughness: 0.55 }), 32));
  // (a satin top: a mirror one flares white under the lamp up close)
  const side = mat(0xaab2bc, { metalness: 0.8, roughness: 0.4 }), cell = place(new Mesh(new CylinderGeometry(R, R, 30, 40).rotateX(Math.PI / 2), [side, mat(0xffffff, { map: cellTop(), metalness: 0.65, roughness: 0.48 }), side]));
  cell.position.set(cx, -cy, BOARD_Z + 34);
  cell.rotation.z = -Math.PI / 2; // the stamp reads across, as the board's text does
  g.add(cell);
  g.add(softBox({ x: cx - R - 22, y: cy - 16, w: R * 0.9, h: 32 }, BOARD_Z + 46, BOARD_Z + 56, steel(), 6));
  return g;
}

// ------------------------------------------------------------------ the TPM module
/** The TPM module on its header: a female connector over the header's pins, the module's PCB on it wearing its 2D drawing. */
export function tpmModule(g: Group, r: RectLike, header: RectLike, raise: Raise) {
  g.add(softBox(header, BOARD_Z + 120, BOARD_Z + 290, mat(0x0d0f14, { roughness: 0.55 }), 8));
  raise(g, r, BOARD_Z + 290, BOARD_Z + 312, mat(0x1d3b2c, { roughness: 0.5 }));
}

/**
 * The module on this tier's header (`GEO`), its PCB wearing `tpmArt`, into `g`. `onLid`: the PCB's top, its rect and depth (the machine runs the
 * die on it). False: the board has no header.
 */
export function tpmModel(g: Group, art: ArtSet, T: Theme, visual: string, onLid?: (top: Group, r: RectLike, z: number) => void): boolean {
  const r = tpmRect(GEO.tier), h = tpmHeader(GEO.tier);
  if (!r || !h) return false;
  const raise = art.raise(art.baker(() => tpmArt(T, visual, h)));
  tpmModule(g, r, headerRect(h), (parent, rr, z0, z1, s, bevel) => {
    const top = raise(parent, rr, z0, z1, s, bevel);
    if (rr === r) onLid?.(top, r, z1);
    return top;
  });
  return true;
}

// ------------------------------------------------------------------ the drives' drawing
/** A drive's raised parts wear its 2D drawing (`driveArt`: the label, the window, the chips) with its moving parts at rest. */
export function driveRaise(art: ArtSet, T: Theme, kind: DriveKind, slot: string, name: string, capacityBytes: number): Raise {
  return art.raise(art.baker(() => {
    const c = new Container(), live = new Graphics();
    drawDriveLive(live, T, kind, slot, { spin: 0.4, head: 0.35, led: 0, burnt: false });
    c.addChild(driveArt(T, kind, slot, name, `${Math.round(capacityBytes / 1024)}K`), live);
    return c;
  }));
}

// ------------------------------------------------------------------ SATA drives
/**
 * A SATA drive on its bay's rails over its 2D body `b`, from depth z: a hard disk's cast base with its lid inset on top (the lid wears the 2D
 * drawing) and the lid's screws round it; an SSD's slim two-part shell. Both have the SATA power and data sockets on their west end.
 */
export function sataDrive(g: Group, hdd: boolean, b: RectLike, z: number, raise: Raise): MeshStandardMaterial {
  const shell = mat(hdd ? 0x6f7680 : 0x2d3035, { metalness: hdd ? 0.75 : 0.3, roughness: hdd ? 0.42 : 0.35 });
  const black = mat(0x0b0d11, { roughness: 0.55 });
  if (hdd) {
    g.add(softBox(b, z, z + 150, shell, 16));
    const lid = { x: b.x + 10, y: b.y + 10, w: b.w - 20, h: b.h - 20 };
    raise(g, lid, z + 150, z + 176, mat(0xa9b0b9, { metalness: 0.8, roughness: 0.32 }), 12);
    const k = Math.min(b.w, b.h) * 0.06;
    for (const [fx, fy] of [[0.04, 0.06], [0.5, 0.04], [0.96, 0.06], [0.04, 0.94], [0.5, 0.96], [0.96, 0.94]] as const) screw(g, b.x + b.w * fx, b.y + b.h * fy, z + 176, k * 0.5);
  } else {
    // a base tray and a top shell meeting at a seam, the top wearing the label
    g.add(softBox(b, z, z + 34, black, 10));
    raise(g, { x: b.x + 4, y: b.y + 4, w: b.w - 8, h: b.h - 8 }, z + 36, z + 76, shell, 12);
  }
  // the SATA sockets on the west end: the long power one and the short data one
  const h = hdd ? 150 : 70, mid = z + h * 0.5;
  g.add(rectBox({ x: b.x - 18, y: b.y + b.h * 0.18, w: 22, h: b.h * 0.34 }, mid - 18, mid + 18, black), rectBox({ x: b.x - 18, y: b.y + b.h * 0.58, w: 22, h: b.h * 0.2 }, mid - 18, mid + 18, black));
  return shell;
}
