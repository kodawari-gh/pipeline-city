// The kit the 3D cases are built from (case3d.ts, casedetail3d.ts): outlines with rounded or chamfered corners, slabs extruded from them along
// z (the side) or along x (the rear and front walls, with their openings), decals on any face, and the painted sheets (perforations, brushed
// metal, badges). Shapes are drawn in the layout (y down) and come out in the world (y up), z out of the wall.
import {
  BoxGeometry, CircleGeometry, DoubleSide, Group, LatheGeometry, Mesh, Path, PlaneGeometry, RepeatWrapping, Shape, Vector2,
  type BufferGeometry, type ExtrudeGeometry, type ExtrudeGeometryOptions, type Material, type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { drawLockup, lockupWidth, type BrandId, type LockupOpts } from '@/core/render/brands';
import { bakedTex } from '@/core/render/three/baked';
import { extrude, instanced, LOW_TOL, lowSides, paintLow, place, SEG, shareTex, withLow, type RectLike } from '@/core/render/three/geometry';
import { sheetCut } from '@/core/render/three/detail';
import { mat } from '@/core/render/three/materials';
import { isCut, type Cuts } from '@/features/room/render/shell/casedecor';

export { CASE_FRONT as FRONT } from '@/features/room/render/three/roomplan';
/** The outer side panel's thickness: it closes the body's open side, its face at `FRONT`. */
export const SIDE_T = 36;
export const NONE: Cuts = [0, 0, 0, 0];
export const hex = (s: string) => parseInt(s.slice(1, 7), 16);

/** The outline of a layout rect as world points (y up), clockwise in the layout: a corner with a cut is chamfered at 45 degrees, the others rounded by `r`. */
export function outlinePts(rc: RectLike, r: number, cuts: Cuts = NONE, seg: number = SEG.corner): Vector2[] {
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

/** The part of a convex outline (world points) east (`keep` +1) or west (-1) of `x`: the pieces beside an opening in the top or the floor. */
export function clipX(pts: Vector2[], x: number, keep: 1 | -1): Vector2[] {
  const out: Vector2[] = [], inside = (p: Vector2) => (p.x - x) * keep >= 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    if (inside(p)) out.push(p.clone());
    if (inside(p) !== inside(q)) { const t = (x - p.x) / (q.x - p.x); out.push(new Vector2(x, p.y + (q.y - p.y) * t)); }
  });
  return out;
}

/** A body's top or floor (the outline `pts`, depth `z0` to `z1`) with a rectangular opening through it: whole bands before and after, the pieces either side between. */
export function slabWithOpening(pts: Vector2[], z0: number, z1: number, o: { x0: number; x1: number; z0: number; z1: number }, m: Material): Mesh[] {
  return [slab(shapeOf(pts), z0, o.z0, m), slab(shapeOf(pts), o.z1, z1, m), slab(shapeOf(clipX(pts, o.x0, -1)), o.z0, o.z1, m), slab(shapeOf(clipX(pts, o.x1, 1)), o.z0, o.z1, m)];
}

/** A round opening in a wall across x, a true circle (`wallX`'s rounded span bulges at its diagonals past a round grille). */
export const wallCircle = (y: number, z: number, r: number, n = 48): Vector2[] => Array.from({ length: n }, (_, k) => wallPt(y + Math.sin((k / n) * Math.PI * 2) * r, z + Math.cos((k / n) * Math.PI * 2) * r));

export const grow = (r: RectLike, e: number): RectLike => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });
export const growCuts = (c: Cuts, e: number): Cuts => c.map((v) => (v > 0 ? Math.max(1, v + e * 0.6) : 0)) as Cuts;
export const shapeOf = (pts: Vector2[], holes: Vector2[][] = []): Shape => {
  const s = new Shape(pts);
  for (const h of holes) s.holes.push(new Path(h));
  return s;
};

/**
 * A closed outline for a lower detail level: the points that stand less than `tol` off the line between the points kept round them are left
 * out (a small rounded corner becomes a chamfer, a round hole keeps about half its sides). Every point on the outline's bounds stays, so
 * its size does not change.
 */
export function coarse(pts: readonly Vector2[], tol: number = LOW_TOL): Vector2[] {
  const p = pts.length > 1 && pts[0]!.distanceTo(pts[pts.length - 1]!) < 1e-6 ? pts.slice(0, -1) : [...pts];
  if (p.length <= 4) return p;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const q of p) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
  const e = 1e-6 * (x1 - x0 + y1 - y0), onBounds = (q: Vector2) => q.x - x0 <= e || x1 - q.x <= e || q.y - y0 <= e || y1 - q.y <= e;
  const first = p.findIndex(onBounds), ring = [...p.slice(first), ...p.slice(0, first), p[first]!], keep = ring.map(onBounds);
  const cut = (a: number, b: number): void => {
    const A = ring[a]!, B = ring[b]!, dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
    let at = -1, worst = tol;
    for (let i = a + 1; i < b; i++) {
      const q = ring[i]!, d = len > 0 ? Math.abs((q.x - A.x) * dy - (q.y - A.y) * dx) / len : q.distanceTo(A);
      if (d > worst) { worst = d; at = i; }
    }
    if (at < 0) return;
    keep[at] = true;
    cut(a, at); cut(at, b);
  };
  for (let a = 0, b = 1; b < ring.length; b++) if (keep[b]) { cut(a, b); a = b; }
  return ring.slice(0, -1).filter((_, i) => keep[i]);
}

/** The triangles `extrude` makes of `n` outline points in all, round `holes` holes, with `bands` bands up its sides. */
const extrudeTris = (n: number, holes: number, bands: number): number => 2 * (n + 2 * holes - 2) + 2 * n * bands;

/**
 * `extrude`, moved into place by `fit`, with a lower detail level on the geometry (LOD-05; `lowOf`, merge.ts): the same shape with each
 * outline through `coarse` and its bevel in one step. A shape gets a level only when the level has at most half its triangles and saves
 * 100 at least (a plain plate has none).
 */
function extruded(s: Shape, o: ExtrudeGeometryOptions, fit: (g: ExtrudeGeometry) => ExtrudeGeometry): ExtrudeGeometry {
  const seg = o.curveSegments ?? SEG.curveRound, ends = (a: Vector2[]) => (a.length > 1 && a[0]!.distanceTo(a[a.length - 1]!) < 1e-6 ? a.length - 1 : a.length);
  const outer = s.getPoints(seg), holes = s.holes.map((h) => h.getPoints(seg)), lowOuter = coarse(outer), lowHoles = holes.map((h) => coarse(h));
  const bands = (k: number) => (o.bevelEnabled ? 1 + 2 * k : 1), sum = (a: number[]) => a.reduce((t, v) => t + v, 0);
  const full = extrudeTris(ends(outer) + sum(holes.map(ends)), holes.length, bands(o.bevelSegments ?? 3));
  const low = extrudeTris(lowOuter.length + sum(lowHoles.map((h) => h.length)), holes.length, bands(1));
  return withLow(fit(extrude(s, o)), () => fit(extrude(shapeOf(lowOuter, lowHoles), { ...o, bevelSegments: 1 })), low <= full / 2 && full - low >= 100);
}

/** A flat shape extruded from depth z0 to z1, its edges rounded by `bevel` inside its outline. */
export function slab(shape: Shape, z0: number, z1: number, m: Material, bevel = 0): Mesh {
  const b = Math.max(0, Math.min(bevel, (z1 - z0) / 2.2));
  const g = extruded(shape, { depth: z1 - z0 - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: SEG.bevel, curveSegments: SEG.caseCurve }, (x) => x.translate(0, 0, z0 + b));
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

/** A point of a wall across x, as `wallX` lays its outlines out: layout `y` and depth `z`. */
export const wallPt = (y: number, z: number): Vector2 => new Vector2(z, -y);

/**
 * A wall across x (from x0 to x1) over the span `s`, with its openings `holes` (the rear wall's slot row and fan, a front's intake). A hole is a
 * span, or any outline of `wallPt` points (a keyed mouth).
 */
export function wallX(x0: number, x1: number, s: Span, holes: (Span | Vector2[])[], m: Material, bevel = 0): Mesh {
  const b = Math.max(0, Math.min(bevel, (x1 - x0) / 2.2));
  // the shape's (u, v) is the world's (z, y); its extrusion runs to -x after the turn
  const g = extruded(shapeOf(spanPts(s), holes.map((h) => (Array.isArray(h) ? h : spanPts(h)))), { depth: x1 - x0 - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: SEG.bevel, curveSegments: SEG.holeCurve },
    (x) => x.translate(0, 0, b).rotateY(-Math.PI / 2).translate(x1, 0, 0));
  return place(new Mesh(g, m));
}

/** A sheet lying flat across the case (a shelf, the shroud's top): layout x from `x0` to `x1`, depth `z0` to `z1`, `t` thick under its top at layout `y`, with holes as world (x, z) outlines. */
export function plateY(x0: number, x1: number, z0: number, z1: number, y: number, t: number, holes: Vector2[][], m: Material, bevel = 0): Mesh {
  const b = Math.max(0, Math.min(bevel, t / 2.2)), s = shapeOf([new Vector2(x0, z0), new Vector2(x1, z0), new Vector2(x1, z1), new Vector2(x0, z1)], holes);
  // (the shape's (u, v) is the world's (x, z); its extrusion runs down from the top)
  const g = extruded(s, { depth: t - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: SEG.bevelFlat, curveSegments: SEG.caseCurve },
    (x) => x.translate(0, 0, b).rotateX(Math.PI / 2).translate(0, -y, 0));
  return place(new Mesh(g, m));
}
/** A rounded slot in a `plateY` sheet, as its (x, z) outline. */
export const flatSlot = (x: number, z: number, w: number, d: number): Vector2[] => outlinePts({ x, y: -z - d, w, h: d }, Math.min(w, d) / 2);

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

// ---------------------------------------------------------------- the fixings, at their real size (23 units per mm: a case screw's head is 6 mm across, r 65)

/** Which way a fixing's head looks, along a world axis. */
export type Facing = 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-';
/** A fixing's place on the surface its head stands on (world: y up). */
export interface Spot { x: number; y: number; z: number }

/** Turn a part modelled round +z to look along `f`. Its lower detail level (`userData.low`) turns with it. */
export function turned<T extends BufferGeometry>(g: T, f: Facing): T {
  const low = g.userData.low as BufferGeometry | undefined;
  if (low) turned(low, f);
  if (f === 'z-') g.rotateX(Math.PI);
  else if (f === 'x+') g.rotateY(Math.PI / 2);
  else if (f === 'x-') g.rotateY(-Math.PI / 2);
  else if (f === 'y+') g.rotateX(-Math.PI / 2);
  else if (f === 'y-') g.rotateX(Math.PI / 2);
  return g;
}

/**
 * A solid turned round +z from its profile, [radius, height] from the foot up. Its lower detail level (LOD-05): `lowSides` sides, and of the
 * profile only its two ends, the first and the last point at its widest, and the first at its top. So the level has the same outer size; a
 * head's recess closes to a dimple.
 */
function lathe(pts: readonly (readonly [number, number])[], sides: number = SEG.disc): BufferGeometry {
  const turn = (p: readonly (readonly [number, number])[], n: number) => new LatheGeometry(p.map(([r, h]) => new Vector2(r, h)), n).rotateX(Math.PI / 2);
  const rs = pts.map((p) => p[0]), hs = pts.map((p) => p[1]), R = Math.max(...rs), H = Math.max(...hs);
  const keep = new Set([0, rs.indexOf(R), rs.lastIndexOf(R), hs.indexOf(H), pts.length - 1]);
  return withLow(turn(pts, sides), () => turn(pts.filter((_, i) => keep.has(i)), lowSides(sides)));
}
const driveM = () => mat(0x050608, { roughness: 0.8 });

/** Pan-head screws: a low head with a cross recess in its flat crown. */
export function screws(spots: readonly Spot[], f: Facing, r: number, m: Material): Group {
  const g = new Group(), h = r * 0.38, arm = r, w = r * 0.2, t = Math.max(1, r * 0.03);
  if (!spots.length) return g;
  const cross = mergeGeometries([new BoxGeometry(arm, w, t), new BoxGeometry(w, arm, t)])!.translate(0, 0, h);
  g.add(instanced(turned(lathe([[r, 0], [r, r * 0.14], [r * 0.86, r * 0.28], [r * 0.6, h], [0, h]]), f), m, spots), instanced(turned(cross, f), driveM(), spots));
  return g;
}

/** Blind rivets: a shallow dome with the mandrel's hole in its centre. */
export function rivets(spots: readonly Spot[], f: Facing, r: number, m: Material): Group {
  const g = new Group();
  if (!spots.length) return g;
  const floor = r * 0.2;
  g.add(instanced(turned(lathe([[r, 0], [r, r * 0.1], [r * 0.82, r * 0.26], [r * 0.5, r * 0.38], [r * 0.26, r * 0.4], [r * 0.23, floor], [0, floor]], SEG.rivetDome), f), m, spots));
  g.add(instanced(turned(new CircleGeometry(r * 0.24, SEG.rivetHole).translate(0, 0, floor + 0.5), f), driveM(), spots));
  return g;
}

/** Thumbscrews: a knurled head `len` tall over a washer, with a slot across its crown. */
export function thumbscrews(spots: readonly Spot[], f: Facing, r: number, len: number, m: Material): Group {
  const g = new Group(), teeth = 24, b = Math.min(r * 0.06, len * 0.1), s = new Shape();
  if (!spots.length) return g;
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2, q = i % 2 ? r * 0.94 : r;
    if (i) s.lineTo(Math.cos(a) * q, Math.sin(a) * q); else s.moveTo(Math.cos(a) * q, Math.sin(a) * q);
  }
  s.closePath();
  // (the head's lower level is `extruded`'s: the teeth go, an octagon of the same width stays)
  const washer = r * 0.16, head = extruded(s, { depth: len - washer - 2 * b, bevelEnabled: true, bevelSize: b, bevelThickness: b, bevelOffset: -b, bevelSegments: SEG.bevelFlat }, (x) => x.translate(0, 0, washer + b));
  g.add(instanced(turned(head, f), m, spots), instanced(turned(lathe([[r * 1.1, 0], [r * 1.1, washer * 0.8], [r * 0.9, washer], [0, washer]]), f), m, spots));
  g.add(instanced(turned(new BoxGeometry(r * 1.3, r * 0.2, Math.max(1, r * 0.03)).translate(0, 0, len + 0.5), f), driveM(), spots));
  return g;
}

/** Hex-socket cap screws: a tall polished head with a dark socket (what holds a tempered glass panel off its frame). */
export function capScrews(spots: readonly Spot[], f: Facing, r: number, m: Material): Group {
  const g = new Group(), h = r * 0.6;
  if (!spots.length) return g;
  g.add(instanced(turned(lathe([[r, 0], [r, h * 0.82], [r * 0.9, h], [r * 0.56, h], [r * 0.5, h * 0.5], [0, h * 0.5]]), f), m, spots));
  g.add(instanced(turned(new CircleGeometry(r * 0.52, SEG.capSocket).translate(0, 0, h * 0.5 + 0.5), f), driveM(), spots));
  return g;
}

/** Soft rubber pads: a flat-topped button (the bumpers a side panel closes on). */
export function pads(spots: readonly Spot[], f: Facing, r: number, m: Material): Group {
  const g = new Group();
  if (spots.length) g.add(instanced(turned(lathe([[r, 0], [r, r * 0.26], [r * 0.82, r * 0.4], [0, r * 0.4]], SEG.padTop), f), m, spots));
  return g;
}

// ---------------------------------------------------------------- painted sheets (painted once, shared by every rebuild)
const TEX = new Map<string, Texture | null>();
export function tex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): Texture | null {
  // (a big sheet is half size at Low and has its own cache entry: a switch back to High paints the full one)
  const cut = sheetCut(w, h), id = cut < 1 ? key + '@low' : key;
  if (TEX.has(id)) return TEX.get(id)!;
  // (a baked sheet, `part-<key>` in `public/tex/`, stands for the canvas: `brushed` and `grain`)
  let t: Texture | null = bakedTex('part-' + key);
  if (t) t.wrapS = t.wrapT = RepeatWrapping;
  else t = paintLow(w, h, draw, [1, 1]);
  TEX.set(id, shareTex(t));
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
export function perfMat(kind: Perf, w: number, h: number, pitch: number, tone: number, o: { metal?: number; rough?: number; inside?: boolean } = {}): Material {
  const t = tiled(perforation(kind), w / pitch, h / (pitch * (kind === 'mesh' || kind === 'slot' ? 1 : 1.73)));
  // The holes are alpha-tested. A hard cut on mip-averaged alpha shimmers when the view moves: the coverage mask (the scene is multisampled) smooths it.
  // The sheet is pulled forward in depth, so the dark backing a few units behind it never wins a pixel at a far zoom (the hole flicker).
  // Once a hole is smaller than a few pixels no filter can draw it steadily: the sheet fades to a solid, darker average (the holes' mean look).
  // (a thin sheet: over a real opening it shows from inside the case too)
  // (`inside`: a sheet in the case, behind the door. The factor scales the pull by the face's depth slope, which has no bound on a face seen
  // edge-on: a tray's floor, looked at from just under it, came forward through the shut door as a dark line. Such a sheet takes a fixed pull.)
  const m = mat(tone, { map: t, alphaTest: 0.5, alphaToCoverage: true, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: o.inside ? 0 : -2, polygonOffsetUnits: o.inside ? -8 : -2, metalness: o.metal ?? 0.3, roughness: o.rough ?? 0.5 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_MAP
      { float tpp = max(length(dFdx(vMapUv * vec2(128.0))), length(dFdy(vMapUv * vec2(128.0))));
        float far = smoothstep(2.5, 9.0, tpp);
        diffuseColor.a = mix(diffuseColor.a, 1.0, far);
        diffuseColor.rgb *= mix(1.0, 0.55, far); }
      #endif`);
  };
  m.customProgramCacheKey = () => 'perf-fade';
  return m;
}

/** A perforated plate over `r` at depth z on a dark backing (the holes show the dark), `pitch` units per hole. */
export function perforated(g: Group, r: RectLike, z: number, kind: Perf, pitch: number, tone: number, o: { metal?: number; rough?: number } = {}): void {
  g.add(decal(r, z, mat(0x050608, { roughness: 0.9 })));
  g.add(decal(r, z + 5, perfMat(kind, r.w, r.h, pitch, tone, o)));
}

/** The same perforated sheet, lying flat at world height `top` over x `x0`–`x1` and z `z0`–`z1` (the holes show a dark backing). */
export function perforatedFlat(top: number, x0: number, x1: number, z0: number, z1: number, kind: Perf, pitch: number, tone: number, o: { metal?: number; rough?: number } = {}): Group {
  return perforatedFlatRun(top, [[x0, x1, z0, z1]], kind, pitch, tone, o);
}

/**
 * Many flat windows (`[x0, x1, z0, z1, top?]`, any sizes, each at world height `top` unless it gives its own): one backing mesh and one
 * perforated mesh for the whole run (merged geometry, one material; each window's UVs keep the hole pitch), so a run costs two draws.
 */
export function perforatedFlatRun(top: number, rects: [number, number, number, number, number?][], kind: Perf, pitch: number, tone: number, o: { metal?: number; rough?: number } = {}): Group {
  const g = new Group();
  if (!rects.length) return g;
  const w = rects[0]![1] - rects[0]![0], h = rects[0]![3] - rects[0]![2];
  const geo = (lift: number): BufferGeometry => mergeGeometries(rects.map(([x0, x1, z0, z1, y = top]) => {
    const p = new PlaneGeometry(x1 - x0, z1 - z0), uv = p.getAttribute('uv');
    // the material tiles the first window's size: scale the others' UVs to the same pitch
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (x1 - x0)) / w, (uv.getY(i) * (z1 - z0)) / h);
    p.rotateX(-Math.PI / 2);
    p.translate((x0 + x1) / 2, y + lift, (z0 + z1) / 2);
    return p;
  }), false)!;
  const back = new Mesh(geo(3), mat(0x050608, { roughness: 0.9 }));
  const perf = new Mesh(geo(5), perfMat(kind, w, h, pitch, tone, { ...o, inside: true }));
  back.receiveShadow = perf.receiveShadow = true;
  g.add(back, perf);
  return g;
}

/** A random stream from a fixed seed (Lehmer, as the pump cap's rings): the same map on every run, so a bake gives the same file (ASSET-07). */
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** Brushed metal: fine streaks along the sheet's u, for the map of anodised parts (the material's colour tints it). */
export function brushed(): Texture | null {
  return tex('brushed', 256, 256, (c, w, h) => {
    const rnd = seeded(11);
    c.fillStyle = '#e6e6e6'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const y = rnd() * h, l = 40 + rnd() * 200, x = rnd() * w, v = rnd() < 0.5 ? 255 : 160;
      c.fillStyle = `rgba(${v},${v},${v},${0.06 + rnd() * 0.1})`;
      c.fillRect(x, y, l, 1);
      if (x + l > w) c.fillRect(x - w, y, l, 1);
    }
  });
}

/** A fine grain for painted and powder-coated steel: the bump map that keeps a large panel from looking like plastic film. */
export function grain(): Texture | null {
  return tex('grain', 256, 256, (c, w, h) => {
    const d = c.createImageData(w, h), rnd = seeded(13);
    for (let i = 0; i < d.data.length; i += 4) { const v = 118 + rnd() * 20; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    c.putImageData(d, 0, 0);
  });
}

/**
 * A maker's badge (`core/render/brands`): its lockup centred on the sheet (clear where `bg` is null), the mark `o.h` of the sheet's height (default
 * 0.56) or less where the sheet is too narrow. `acc` null prints it in the ink alone (an etching, a deboss).
 */
export function badgeTex(key: string, w: number, h: number, brand: BrandId, ink: string, acc: string | null, bg: string | null, o: LockupOpts & { h?: number } = {}): Texture | null {
  return tex('badge-' + key, w, h, (c) => {
    if (bg) { c.fillStyle = bg; c.fillRect(0, 0, w, h); } else c.clearRect(0, 0, w, h);
    const opts = { ...o, acc, align: 'center' as const }, mh = h * (o.h ?? 0.56);
    const m = Math.min(mh, (mh * w * 0.84) / lockupWidth(brand, mh, opts));
    drawLockup(c, brand, w / 2, h / 2, m, ink, opts);
  });
}

/** A maker's lockup debossed into a sheet (`core/render/brands`): a dark print over a paler lip just under it, on a clear ground (a decal's material). */
export function debossMat(key: string, brand: BrandId, w: number, h: number, ink = '#050608', lip = '#2a2d32'): Material {
  const t = tex('deboss-' + key, w, h, (c) => {
    c.clearRect(0, 0, w, h);
    const o = { acc: null, align: 'center' as const }, mh = h * 0.8, m = Math.min(mh, (mh * w * 0.96) / lockupWidth(brand, mh, o));
    drawLockup(c, brand, w / 2, h / 2 + m * 0.05, m, lip, o);
    drawLockup(c, brand, w / 2, h / 2, m, ink, o);
  });
  return mat(0xffffff, { map: t, transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

/** The approved base colours a case may use (docs/3D_STYLE.md "Asset standard" §1): families 1, 2, 4 and 5, the dark PCB mask, and the void behind a hole. */
const FAMILY = [0x050608, 0x131518, 0x1d1e22, 0x2a2d32, 0x4e5360, 0x959aa3, 0xb9babf, 0xd4af5f, 0xc0793a];
/** A colour this near a family colour (RGB distance, 0–255) is that family colour. */
const FAMILY_NEAR = 45;
/** Each family colour's one finish on a case: [metalness, roughness]. Matte plastic for the darks, satin paint, brushed metal, gold plate. */
const FINISH: Record<number, readonly [number, number]> = {
  0x050608: [0.05, 0.9], 0x131518: [0.05, 0.9], 0x1d1e22: [0.7, 0.38], 0x2a2d32: [0.4, 0.5], 0x4e5360: [0.7, 0.38],
  0x959aa3: [0.7, 0.38], 0xb9babf: [0.7, 0.38], 0xd4af5f: [0.7, 0.5], 0xc0793a: [0.7, 0.38],
};
const step = (v: number, steps: readonly number[]): number => steps.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

/**
 * One look per family across a case (§2, the material cap): each plain material's colour goes to the nearest family colour, and its metalness and
 * roughness to a few steps, so near-duplicates become the same look and the machine's material share folds them. Left as built: a lit
 * material (its emissive is written live), a see-through one, and a printed one (a white base under its map).
 */
export function foldCaseLooks(root: Group): void {
  const seen = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const s = m as Material & { color?: { getHex(): number; setHex(h: number): void }; emissive?: { getHex(): number }; metalness?: number; roughness?: number };
      if (seen.has(m) || !s.color || s.metalness === undefined || s.roughness === undefined) continue;
      seen.add(m);
      if (m.transparent || (s.emissive && s.emissive.getHex() !== 0) || s.color.getHex() === 0xffffff) continue;
      const c = s.color.getHex(), r = c >> 16, g = (c >> 8) & 255, b = c & 255;
      let best = c, near = FAMILY_NEAR;
      for (const f of FAMILY) { const d = Math.hypot(r - (f >> 16), g - ((f >> 8) & 255), b - (f & 255)); if (d < near) { near = d; best = f; } }
      // the old OEM cream (an anti-reference, ASR1) is the satin metal: the pale creams the bright one, the darker ones the brushed one
      if (best === c && r > 120 && r >= g && g > b && r - b >= 15 && r - b <= 70) best = r > 190 ? 0xb9babf : 0x959aa3;
      // a matte plastic part in a charcoal goes to the dark mask (the charcoals are the painted and anodised metal); a perforated sheet has one tone
      if ((best === 0x1d1e22 || best === 0x2a2d32) && s.metalness < 0.2 && s.roughness > 0.7) best = 0x131518;
      // (a dark one; a perforated sheet in the light satin metal is the pressed vent of a light panel, and keeps the panel's colour)
      if (m.alphaTest > 0 && FINISH[best] && best !== 0xb9babf && best !== 0x959aa3) best = 0x2a2d32;
      s.color.setHex(best);
      const f = FINISH[best];
      // one finish per family colour; a colour outside the families (a port's plastic, a button) keeps a stepped finish of its own
      s.metalness = f ? f[0] : step(s.metalness, [0.05, 0.4, 0.7]);
      s.roughness = f ? f[1] : step(s.roughness, [0.38, 0.5, 0.9]);
    }
  });
}
