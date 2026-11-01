// The board's smaller hardware as real parts (docs/GRAPHICS_3D_OVERHAUL.md "Inside the case"), where the 2D drawing stands for a part seen from
// above: an NVMe stick on its socket and standoff (a thin PCB, the controller, the finned spreader over the NAND, the screw in its notch), the
// chipset's finned heat sink, the coin cell in its holder, the TPM module on its header, a SATA drive's cast body with its lid and connectors.
// Each top still wears its 2D drawing (`Raise`: machine3d's `raised`), so the 3D parts sit on their pictures.
import { BoxGeometry, CylinderGeometry, Group, Mesh, type Material, type MeshStandardMaterial, type Texture } from 'three';
import { drum, instanced, paint, place, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { BOARD_Z } from '@/features/room/render/three/roomplan';

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
/** The M.2 socket's standoff at the slot's east end (the 2D disc), where the stick's notch is screwed down. */
export function m2Standoff(m: RectLike): Mesh {
  return drum(m.x + m.w - 70, m.y + m.h / 2, BOARD_Z, BOARD_Z + 42, 24, brass(), 16);
}

/**
 * An NVMe stick over its 2D body `b` on slot `m`: the PCB from the fingers in the socket to the notch, the controller, the finned spreader over
 * the NAND (the 2D's fin lines stand up), the screw into the standoff, its head over the notch.
 */
export function nvmeStick(g: Group, m: RectLike, b: RectLike, raise: Raise): MeshStandardMaterial {
  const pcb = mat(0x142330, { roughness: 0.5 }), chip = mat(0x10151e, { roughness: 0.5 }), sink = mat(0x3a4660, { metalness: 0.7, roughness: 0.35 });
  const z = BOARD_Z + 42;
  raise(g, { x: b.x - 46, y: b.y, w: b.w + 46, h: b.h }, z, z + 16, pcb);
  raise(g, { x: b.x + 80, y: b.y + 50, w: 170, h: b.h - 100 }, z + 16, z + 34, chip, 4);
  const sp = { x: b.x + 270, y: b.y + 20, w: 740, h: b.h - 40 };
  raise(g, sp, z + 16, z + 58, sink, 6);
  const fins = [];
  for (let k = 0; k < 14; k++) fins.push({ x: sp.x + 40 + k * 50, y: -(sp.y + sp.h / 2), z: z + 76, sx: 12, sy: sp.h - 28, sz: 36 });
  g.add(instanced(new BoxGeometry(1, 1, 1), mat(0x56628a, { metalness: 0.75, roughness: 0.3 }), fins));
  screw(g, m.x + m.w - 70, m.y + m.h / 2, z + 16, 34);
  return sink;
}

// ------------------------------------------------------------------ chipset
/**
 * The chipset over its 2D rect, by board tier: a bare package (tier 0), a grooved cap (tier 1), a heat sink whose fins stand up where the 2D draws
 * them, a screw in each corner (tier 2 and up). Returns the group (the `chipset` hover id goes on it).
 */
export function chipset(q: RectLike, tier: number, raise: Raise): Group {
  const g = new Group(), alu = mat(0xc4c8cc, { metalness: 0.7, roughness: 0.35 });
  if (tier === 0) { raise(g, q, BOARD_Z, BOARD_Z + 60, mat(0x14161b, { roughness: 0.5 }), 10); return g; }
  if (tier === 1) { raise(g, q, BOARD_Z, BOARD_Z + 160, alu, 18); return g; }
  raise(g, q, BOARD_Z, BOARD_Z + 140, alu, 18);
  const lit = mat(0xd9dee6, { metalness: 0.75, roughness: 0.3 }), dark = mat(0x5a6170, { metalness: 0.7, roughness: 0.4 }), fins: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[][] = [[], []];
  for (let x = q.x + 60, k = 0; x < q.x + q.w - 40; x += 40, k++) fins[k % 2]!.push({ x, y: -(q.y + q.h / 2), z: BOARD_Z + 185, sx: 14, sy: q.h - 88, sz: 90 });
  g.add(instanced(new BoxGeometry(1, 1, 1), dark, fins[0]!), instanced(new BoxGeometry(1, 1, 1), lit, fins[1]!));
  for (const [sx, sy] of [[q.x + 40, q.y + 40], [q.x + q.w - 40, q.y + 40], [q.x + 40, q.y + q.h - 40], [q.x + q.w - 40, q.y + q.h - 40]] as const) screw(g, sx, sy, BOARD_Z + 140, 14);
  return g;
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
  const side = mat(0xaab2bc, { metalness: 0.85, roughness: 0.35 }), cell = place(new Mesh(new CylinderGeometry(R, R, 30, 40).rotateX(Math.PI / 2), [side, mat(0xffffff, { map: cellTop(), metalness: 0.8, roughness: 0.35 }), side]));
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
