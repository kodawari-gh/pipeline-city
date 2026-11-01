// The kit the 3D cases are built from (case3d.ts, casedetail3d.ts): outlines with rounded or chamfered corners, slabs extruded from them along
// z (the side) or along x (the rear and front walls, with their openings), decals on any face, and the painted sheets (perforations, brushed
// metal, badges). Shapes are drawn in the layout (y down) and come out in the world (y up), z out of the wall.
import {
  CanvasTexture, ExtrudeGeometry, Mesh, Path, PlaneGeometry, RepeatWrapping, SRGBColorSpace, Shape, Vector2, type Group, type Material, type Texture,
} from 'three';
import { place, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { CASE_D, CASE_Z } from '@/features/room/render/three/roomplan';
import { isCut, type Cuts } from '@/features/room/render/shell/casedecor';

export const FRONT = CASE_Z + CASE_D;
/** The outer side panel's thickness: it closes the body's open side, its face at `FRONT`. */
export const SIDE_T = 36;
export const NONE: Cuts = [0, 0, 0, 0];
export const hex = (s: string) => parseInt(s.slice(1, 7), 16);

/** The outline of a layout rect as world points (y up), clockwise in the layout: a corner with a cut is chamfered at 45 degrees, the others rounded by `r`. */
export function outlinePts(rc: RectLike, r: number, cuts: Cuts = NONE, seg = 5): Vector2[] {
  const { x, y, w, h } = rc, rr = Math.max(0, Math.min(r, w / 2, h / 2)), out: Vector2[] = [];
  const corners: [number, number, number, number][] = [[x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]];
  corners.forEach(([cx, cy, dx, dy], k) => {
    const c = cuts[k]!, d = c > 0 ? c : rr, yFirst = k % 2 === 0; // the walk comes into the top left and the bottom right along y
    const a = yFirst ? [cx, cy + dy * d] : [cx + dx * d, cy], b = yFirst ? [cx + dx * d, cy] : [cx, cy + dy * d];
    if (d <= 0) { out.push(new Vector2(cx, -cy)); return; }
    if (c > 0) { out.push(new Vector2(a[0]!, -a[1]!), new Vector2(b[0]!, -b[1]!)); return; }
    for (let i = 0; i <= seg; i++) {
      const t = i / seg, u = 1 - t;
      out.push(new Vector2(u * u * a[0]! + 2 * u * t * cx + t * t * b[0]!, -(u * u * a[1]! + 2 * u * t * cy + t * t * b[1]!)));
    }
  });
  return out;
}

/** The part of a convex outline (world points) above (`keep` +1) or below (-1) the world height `y`: the top and the floor of a body. */
export function clipY(pts: Vector2[], y: number, keep: 1 | -1): Vector2[] {
  const out: Vector2[] = [], inside = (p: Vector2) => (p.y - y) * keep >= 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    if (inside(p)) out.push(p.clone());
    if (inside(p) !== inside(q)) { const t = (y - p.y) / (q.y - p.y); out.push(new Vector2(p.x + (q.x - p.x) * t, y)); }
  });
  return out;
}

export const grow = (r: RectLike, e: number): RectLike => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });
export const growCuts = (c: Cuts, e: number): Cuts => c.map((v) => (v > 0 ? Math.max(1, v + e * 0.6) : 0)) as Cuts;
export const shapeOf = (pts: Vector2[], holes: Vector2[][] = []): Shape => {
  const s = new Shape(pts);
  for (const h of holes) s.holes.push(new Path(h));
  return s;
};

/** A flat shape extruded from depth z0 to z1, its edges rounded by `bevel` inside its outline. */
export function slab(shape: Shape, z0: number, z1: number, m: Material, bevel = 0): Mesh {
  const b = Math.max(0, Math.min(bevel, (z1 - z0) / 2.2));
  const g = new ExtrudeGeometry(shape, { depth: z1 - z0 - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, z0 + b);
  return place(new Mesh(g, m));
}

/** A ring: the outline of `r` grown by `e`, less `r` itself (a bezel, a trim line, a light frame), `z0` to `z1`. */
export function ring(r: RectLike, rad: number, cuts: Cuts, e: number, z0: number, z1: number, m: Material, inset = 0): Mesh {
  const inner = grow(r, -inset);
  return slab(shapeOf(outlinePts(grow(r, e), rad + e, isCut(cuts) ? growCuts(cuts, e) : NONE), [outlinePts(inner, Math.max(0, rad - inset), isCut(cuts) ? growCuts(cuts, -inset) : NONE)]), z0, z1, m);
}

/** A span across a wall that runs along x: layout y from `y0` to `y1`, depth from `z0` to `z1`. */
export interface Span { y0: number; y1: number; z0: number; z1: number; r?: number }
const spanPts = (s: Span) => outlinePts({ x: s.z0, y: s.y0, w: s.z1 - s.z0, h: s.y1 - s.y0 }, s.r ?? 0);

/** A wall across x (from x0 to x1) over the span `s`, with its openings `holes` (the rear wall's slot row and fan, a front's intake). */
export function wallX(x0: number, x1: number, s: Span, holes: Span[], m: Material, bevel = 0): Mesh {
  const b = Math.max(0, Math.min(bevel, (x1 - x0) / 2.2));
  const g = new ExtrudeGeometry(shapeOf(spanPts(s), holes.map(spanPts)), { depth: x1 - x0 - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 8 });
  // the shape's (u, v) is the world's (z, y); its extrusion runs to -x after the turn
  g.translate(0, 0, b).rotateY(-Math.PI / 2).translate(x1, 0, 0);
  return place(new Mesh(g, m));
}

/** A flat textured face over a layout rect at depth z, facing the viewer (a decal on the side). */
export function decal(r: RectLike, z: number, m: Material): Mesh {
  const o = new Mesh(new PlaneGeometry(r.w, r.h), m);
  o.position.set(r.x + r.w / 2, -(r.y + r.h / 2), z);
  o.receiveShadow = true;
  return o;
}

/** A flat face on a wall across x at `x`, over the span `s`, facing east (`dir` +1) or west (-1). */
export function decalX(x: number, s: Span, dir: 1 | -1, m: Material): Mesh {
  const o = new Mesh(new PlaneGeometry(s.z1 - s.z0, s.y1 - s.y0), m);
  o.rotation.y = (dir * Math.PI) / 2;
  o.position.set(x, -(s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2);
  o.receiveShadow = true;
  return o;
}

/** A flat face on the top of the case at layout height `y`, over x from `x0` to `x1` and depth `z0` to `z1`, facing up. */
export function decalTop(y: number, x0: number, x1: number, z0: number, z1: number, m: Material): Mesh {
  const o = new Mesh(new PlaneGeometry(x1 - x0, z1 - z0), m);
  o.rotation.x = -Math.PI / 2;
  o.position.set((x0 + x1) / 2, -y, (z0 + z1) / 2);
  o.receiveShadow = true;
  return o;
}

// ---------------------------------------------------------------- painted sheets (painted once, shared by every rebuild)
const TEX = new Map<string, Texture | null>();
export function tex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): Texture | null {
  if (TEX.has(key)) return TEX.get(key)!;
  let t: Texture | null = null;
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d')!, w, h);
    t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    t.wrapS = t.wrapT = RepeatWrapping;
  }
  TEX.set(key, t);
  return t;
}

/** A copy of a shared sheet repeated `rx` by `ry` times (the copy shares the picture). */
export function tiled(t: Texture | null, rx: number, ry: number): Texture | null {
  if (!t) return null;
  const c = t.clone();
  c.needsUpdate = true;
  c.repeat.set(rx, ry);
  return c;
}

export type Perf = 'round' | 'hex' | 'mesh' | 'slot';
/** A sheet with holes cut through it (white, so the material tints it): round holes in staggered rows, a honeycomb, a diamond mesh or long slots. */
export function perforation(kind: Perf): Texture | null {
  return tex('perf-' + kind, 128, kind === 'mesh' || kind === 'slot' ? 128 : 222, (c, w, h) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    if (kind === 'round') for (const [x, y] of [[64, 55], [0, 166], [128, 166]]) { c.beginPath(); c.arc(x!, y!, 25, 0, Math.PI * 2); c.fill(); }
    else if (kind === 'hex') {
      const s = 128 / Math.sqrt(3), hs = s - 17;
      for (const [x, y] of [[64, s * 0.5], [0, s * 2], [128, s * 2], [64, s * 3.5]]) {
        c.beginPath();
        for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; c.lineTo(x! + Math.cos(a) * hs, y! + Math.sin(a) * hs); }
        c.fill();
      }
    } else if (kind === 'slot') { c.beginPath(); c.roundRect(40, 10, 48, 108, 24); c.fill(); }
    else for (const [x, y] of [[64, 64], [0, 0], [128, 0], [0, 128], [128, 128]]) { c.beginPath(); c.moveTo(x!, y! - 52); c.lineTo(x! + 52, y!); c.lineTo(x!, y! + 52); c.lineTo(x! - 52, y!); c.fill(); }
  });
}

/** The material of a perforated sheet over a face `w` by `h` units, `pitch` units per hole. */
export function perfMat(kind: Perf, w: number, h: number, pitch: number, tone: number, o: { metal?: number; rough?: number } = {}): Material {
  const t = tiled(perforation(kind), w / pitch, h / (pitch * (kind === 'mesh' || kind === 'slot' ? 1 : 1.73)));
  return mat(tone, { map: t, alphaTest: 0.5, metalness: o.metal ?? 0.3, roughness: o.rough ?? 0.5 });
}

/** A perforated plate over `r` at depth z on a dark backing (the holes show the dark), `pitch` units per hole. */
export function perforated(g: Group, r: RectLike, z: number, kind: Perf, pitch: number, tone: number, o: { metal?: number; rough?: number } = {}): void {
  g.add(decal(r, z, mat(0x040506, { roughness: 0.9 })));
  g.add(decal(r, z + 5, perfMat(kind, r.w, r.h, pitch, tone, o)));
}

/** Brushed metal: fine streaks along the sheet's u, for the map of anodised parts (the material's colour tints it). */
export function brushed(): Texture | null {
  return tex('brushed', 256, 256, (c, w, h) => {
    c.fillStyle = '#e6e6e6'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const y = Math.random() * h, l = 40 + Math.random() * 200, x = Math.random() * w, v = Math.random() < 0.5 ? 255 : 160;
      c.fillStyle = `rgba(${v},${v},${v},${0.06 + Math.random() * 0.1})`;
      c.fillRect(x, y, l, 1);
      if (x + l > w) c.fillRect(x - w, y, l, 1);
    }
  });
}

/** A fine grain for painted and powder-coated steel: the bump map that keeps a large panel from looking like plastic film. */
export function grain(): Texture | null {
  return tex('grain', 256, 256, (c, w, h) => {
    const d = c.createImageData(w, h);
    for (let i = 0; i < d.data.length; i += 4) { const v = 118 + Math.random() * 20; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    c.putImageData(d, 0, 0);
  });
}

/** The pipeline mark (four rising bars on a foot) and a word, painted for a badge: `ink` the bars, `acc` the last bar. */
export function badgeTex(key: string, w: number, h: number, word: string, ink: string, acc: string, bg: string | null, mark = true): Texture | null {
  return tex('badge-' + key, w, h, (c) => {
    if (bg) { c.fillStyle = bg; c.fillRect(0, 0, w, h); }
    const s = h * 0.5, bw = s * 0.17, gap = s * 0.07, x0 = word ? w * 0.12 : (w - 4 * bw - 3 * gap) / 2, y0 = (h - s) / 2;
    if (mark) {
      for (let k = 0; k < 4; k++) { const bh = s * (0.34 + k * 0.2); c.fillStyle = k === 3 ? acc : ink; c.fillRect(x0 + k * (bw + gap), y0 + s - bh, bw, bh); }
      c.fillStyle = ink; c.fillRect(x0 - gap, y0 + s + gap, 4 * bw + 4 * gap, s * 0.07);
    }
    if (word) {
      c.fillStyle = ink; c.textBaseline = 'middle'; c.textAlign = mark ? 'left' : 'center';
      c.font = `700 ${Math.round(h * 0.36)}px system-ui, sans-serif`;
      c.fillText(word, mark ? x0 + 4 * bw + 4 * gap + w * 0.06 : w / 2, h / 2 + h * 0.02);
    }
  });
}
