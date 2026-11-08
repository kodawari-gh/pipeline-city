// Braided sleeves and plugs in 3D, after the 2D cable look (`paintCable`, `cableArt`, docs/render/board.md "Cable look and physics"): a dark
// sleeve woven with strands of the lead's accent, a plug body (a dark moulding, the accent collar where the cable leaves it), the clamps round a
// hose. The power leads, the fans' cords and the loop's hoses use them (wires3d.ts hangs them).
import { CatmullRomCurve3, CylinderGeometry, Group, Mesh, Vector3, type MeshStandardMaterial, type Texture } from 'three';
import { mix } from '@/core/render/ink';
import { paint, place, rectBox, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import type { V3 } from '@/core/render/three/rope';
import { Sleeve } from '@/core/render/three/sleeve';

const hex = (c: string): number => parseInt(c.slice(1), 16);
const braids = new Map<string, Texture | null>();
/** Yarn bands across a weave tile (each way), and the tile's size in pixels. */
const BANDS = 4, TILE = 64;

/**
 * A woven sleeve's tile, a 2-over-2 twill as PET sleeving is braided: two sets of round yarns cross on the diagonals, each over two and under
 * two, with dark gaps between them. Both sets are alike (one set brighter than the other read as a twisted rope); one yarn in four is the accent.
 */
function braid(base: string, tint: string): Texture | null {
  const key = base + tint;
  if (!braids.has(key)) braids.set(key, paint(TILE, TILE, (c, w, h) => {
    const img = c.createImageData(w, h), band = w / BANDS, rgb = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
    const gap = rgb(mix(base, '#000000', 0.55)), yarn = rgb(mix(base, tint, 0.14)), accent = rgb(mix(base, tint, 0.62));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      // the two diagonal sets: which yarn (ia, ib) and where across it (fa, fb, 0 to 1)
      const a = (x + y + 0.5) / band, b = (x - y + h + 0.5) / band, ia = Math.floor(a), ib = Math.floor(b), fa = a - ia, fb = b - ib;
      // a goes over b on two crossings in four, along both sets: the twill's steps
      const overA = ((ia + ib) & 3) < 2, f = overA ? fa : fb, along = overA ? fb : fa, which = overA ? ia : ib + 2;
      // round across the yarn, a little sunk where it dives under at the run's ends
      const across = Math.sin(Math.PI * f), dive = 0.78 + 0.22 * Math.sin(Math.PI * ((along + ((ia + ib) & 1)) / 2));
      const lit = Math.pow(across, 0.6) * dive, col = (which & 3) === 0 ? accent : yarn, o = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) img.data[o + k] = Math.round(gap[k]! + (col[k]! - gap[k]!) * Math.min(1, lit * 1.08));
      img.data[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }, [1, 1]));
  return braids.get(key) ?? null;
}

/** A sleeve's material: the weave of `base` toward `tint` (its pitch lives in the geometry's u, `Sleeve`), or a plain jacket. */
export function sleeveMat(base: string, tint: string | null): MeshStandardMaterial {
  if (!tint) return mat(hex(base), { roughness: 0.55 });
  const tex = braid(base, tint);
  return mat(0xffffff, { map: tex, bumpMap: tex, bumpScale: 0.6, roughness: 0.62 });
}

/** Segments along a strand of `n` settled points. */
export const samplesFor = (n: number): number => Math.max(24, (n - 1) * 3);

/** A braided tube through world points, `r` thick: the sleeve `base` woven toward `tint`. Its curve is returned for what sits along it. */
export function braidedTube(pts: readonly Vector3[], r: number, base: string, tint: string): { mesh: Mesh; curve: CatmullRomCurve3 } {
  const sl = new Sleeve(1, r, samplesFor(pts.length), 14);
  sl.update([pts.map((p): V3 => [p.x, p.y, p.z])]);
  return { mesh: place(new Mesh(sl.geometry, sleeveMat(base, tint))), curve: new CatmullRomCurve3(pts.map((p) => p.clone()), false, 'centripetal') };
}

/** A band round a tube at `s` along its curve (a hose clamp, a cable tie), `len` long. */
export function band(curve: CatmullRomCurve3, s: number, r: number, len: number, m: MeshStandardMaterial): Mesh {
  const u = Math.max(0, Math.min(1, s / curve.getLength())), o = place(new Mesh(new CylinderGeometry(r, r, len, 20), m));
  o.position.copy(curve.getPointAt(u));
  o.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), curve.getTangentAt(u));
  return o;
}

/** A plug's body over a layout rect from depth z0 to z1, the accent collar round it near z1 where the cable leaves, the dark cap over that end. */
export function plugBody(r: { x: number; y: number; w: number; h: number }, z0: number, z1: number, accent: string): Group {
  const g = new Group(), dark = mat(0x1b2230, { roughness: 0.5 }), k = Math.min(14, r.w / 4, r.h / 4);
  g.add(softBox(r, z0, z1 - 34, dark, k));
  g.add(softBox({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }, z1 - 36, z1 - 12, mat(hex(accent), { roughness: 0.45 }), Math.min(8, k)));
  g.add(softBox(r, z1 - 14, z1, dark, Math.min(6, k)));
  return g;
}


/** A card's 8-pin plug (a Mini-Fit housing, 2 x 4 wires) over its socket's mouth, in mm: its width along the card and its depth across it. */
export const CARD_PLUG = { w: 20.5 * 23, h: 9.1 * 23 };

/**
 * A card's 8-pin plug seated in its socket, whose mouth faces the glass (a card's top edge): its body from just inside the mouth at (x, y, z) up to
 * `top`, where the wires leave; its latch arm down the side away from the PCB (+y), hooked under the socket's ridge, pressed at its top to pull it.
 */
export function standingPlug(at: { x: number; y: number; z: number }, accent: string, top: number): Group {
  const { w, h } = CARD_PLUG, g = plugBody({ x: at.x - w / 2, y: at.y - h / 2, w, h }, at.z - 30, top, accent), m = mat(0x1b2230, { roughness: 0.5 });
  const y1 = at.y + 6.5 * 23;
  g.add(rectBox({ x: at.x - 60, y: y1, w: 120, h: 30 }, at.z - 125, at.z + 70, m));
  g.add(rectBox({ x: at.x - 60, y: at.y + h / 2, w: 120, h: y1 - at.y - h / 2 }, at.z + 30, at.z + 70, m), rectBox({ x: at.x - 60, y: at.y + 4.9 * 23, w: 120, h: y1 - at.y - 4.9 * 23 }, at.z - 125, at.z - 105, m));
  return g;
}
