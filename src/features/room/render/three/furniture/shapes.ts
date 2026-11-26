// The furniture's shared shapes: a board with rounded edges (`board`), a cushion, a stuffed pillow and a soft shadow on the floor.
import { BoxGeometry, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SEG, place, shadowBlob } from '@/core/render/three/geometry';
import { seeThrough } from '@/core/render/three/pick';
import { FLOOR_Y } from '../roomplan';
import type { BufferGeometry, Material, RectLike } from './types';

/**
 * The furniture's edge round (the bookcase, the desk top, the drawer unit, the bed frame, the bedside drawer, the east wall's shelf): about
 * 6 mm, so that at a room's distance each edge is a few pixels wide and catches the light as a thin line, as the machine case's edges do.
 */
export const EDGE_R = 120;
/** How many steps turn the round (`softBox`'s two read as a hard corner and a flat chamfer at this size). */
const EDGE_STEPS = SEG.softBevel;

/** A furniture board over a layout rect, from depth z0 to z1: every edge rounded `EDGE_R` (less on a thin board) in `EDGE_STEPS` steps. */
export function board(r: RectLike, [z0, z1]: readonly [number, number], m: Material): Mesh {
  const rad = Math.min(EDGE_R, r.w / 2.01, r.h / 2.01, (z1 - z0) / 2.01),
    o = new Mesh(new RoundedBoxGeometry(r.w, r.h, z1 - z0, EDGE_STEPS, rad), m);
  o.position.set(r.x + r.w / 2, -(r.y + r.h / 2), (z0 + z1) / 2);
  return place(o);
}

// ---------------------------------------------------------------- shapes
/** A cushion or pillow: a box whose faces puff out, thick in the middle and thin at the seams. */
export function cushion([w, h, d]: readonly [number, number, number], puff = 1): BufferGeometry {
  const g = new BoxGeometry(2, 2, 2, 10, 4, 10),
    p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const fall = (1 - Math.abs(x) ** 3) * (1 - Math.abs(z) ** 3);
    const r = Math.hypot(x, z) || 1,
      round = Math.max(Math.abs(x), Math.abs(z)) / r;
    p.setXYZ(
      i,
      (x * (0.82 + 0.18 * round) * w) / 2,
      (y * (0.25 + 0.75 * Math.max(0, fall) ** (0.6 * puff)) * h) / 2,
      (z * (0.82 + 0.18 * round) * d) / 2,
    );
  }
  g.computeVertexNormals();
  return g;
}

/** A pillow's thickness at its seam, a share of its middle's: the piped welt the two panels are sewn on. */
export const PILLOW_WELT = 0.05;

/**
 * A stuffed pillow: two cloth panels sewn round their edge. Thick and round in the middle, each panel curving down to the seam, where the two
 * meet at an angle on a thin piped welt (`PILLOW_WELT`: no flat band round the edge); the corners rounded (the square's to a superellipse's),
 * each edge drawn in a little between them (the stuffing pulls the cloth); the top a little lumpy, `seed` setting where. `w` across (x), `d`
 * deep (z), `h` thick (y). The grid is closer toward the seam, where the cloth bends most.
 */
export function pillow(
  [w, h, d]: readonly [number, number, number],
  o: { pinch?: number; lumps?: number; seed?: number } = {},
): BufferGeometry {
  const g = new BoxGeometry(2, 2, 2, 24, 2, 18),
    p = g.getAttribute('position');
  const pinch = o.pinch ?? 0.06,
    lumps = o.lumps ?? 0.06,
    s = o.seed ?? 0;
  for (let i = 0; i < p.count; i++) {
    const x = Math.sin((p.getX(i) * Math.PI) / 2),
      y = p.getY(i),
      z = Math.sin((p.getZ(i) * Math.PI) / 2);
    // the panel's rise from the seam: steep at first, then flat over the middle
    const fill = (1 - x * x) * (1 - z * z),
      rise = 1 - (1 - fill) ** 2.2;
    const lump =
      1 +
      lumps *
        (Math.sin(x * 2.3 + s) * Math.sin(z * 1.9 + s * 1.7) + 0.5 * Math.sin(x * 4.1 - z * 3.3 + s * 2.3)) *
        rise;
    const r = Math.max(Math.abs(x), Math.abs(z)),
      round = r > 0 ? r / (x ** 4 + z ** 4) ** 0.25 : 1;
    const px = x * round * (1 - pinch * (1 - z * z)),
      pz = z * round * (1 - pinch * (1 - x * x));
    p.setXYZ(i, (px * w) / 2, (y * (PILLOW_WELT + (1 - PILLOW_WELT) * rise) * lump * h) / 2, (pz * d) / 2);
  }
  g.computeVertexNormals();
  return g;
}

/** A soft dark patch on the floor under a thing, `lift` over it (more to lie over the rug): a baked contact shadow. */
export function floorShadow(
  [x, z]: readonly [number, number],
  [w, d]: readonly [number, number],
  { k = 1, lift = 140 }: { k?: number; lift?: number } = {},
): Mesh {
  const m = new Mesh(
    new PlaneGeometry(w, d),
    new MeshBasicMaterial({
      map: shadowBlob(),
      transparent: true,
      opacity: 0.9 * k,
      depthWrite: false,
      color: 0x00_00_00,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, -FLOOR_Y + lift, z);
  return seeThrough(m);
}
