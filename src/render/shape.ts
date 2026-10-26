import type { Rect } from './layout';

// What the pointer can pick: the silhouette of a thing, not its bounding box. A `Shape` answers "how far is this point from the thing" (0 on it), so a hit test can
// be exact where the thing is big and forgiving where it is small or thin, and it can trace the thing's outline for the hover ring. Shapes come from a rectangle,
// a union of rectangles (a cable's lanes), a disc, or the alpha of the thing's own art read back once (`fieldShape`): a distance field over the pixels, so the
// outline of a lamp or a key is what you see, with a margin the caller chooses. Pure and GPU-free; `capture` (in `silhouette.ts`) is the only part that reads pixels.

export type Pt = [number, number];

export interface Shape {
  /** The smallest box round the silhouette. */
  readonly bounds: Rect;
  /** About how thick the thing is, for the reach a small or thin one is given; unknown (the box tells) for plain geometry. */
  readonly thickness?: number;
  /** World distance from the point to the silhouette: 0 on it, growing outside. */
  dist(x: number, y: number): number;
  /** Closed polygons at distance `e` outside the silhouette (the hover ring), or null when the caller should draw its rounded box round `bounds`. */
  outline(e: number): Pt[][] | null;
}

/** How far the margin of a field shape reaches (world units): the largest growth a hit test or a ring will ask for. */
export const SHAPE_PAD = 280;

export const rectDist = (r: Rect, x: number, y: number) => Math.hypot(Math.max(r.x - x, 0, x - r.x - r.w), Math.max(r.y - y, 0, y - r.y - r.h));
/** The smallest rectangle round all of them. */
export const unionRect = (rs: Rect[]): Rect => {
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export function rectShape(r: Rect): Shape {
  return { bounds: r, dist: (x, y) => rectDist(r, x, y), outline: () => null };
}

/** Several rectangles as one thing (the lanes of a cable, the frame of the case). */
export function rectsShape(rs: Rect[]): Shape {
  if (rs.length === 1) return rectShape(rs[0]!);
  const bounds = unionRect(rs);
  return { bounds, dist: (x, y) => { let d = Infinity; for (const r of rs) { const e = rectDist(r, x, y); if (e < d) d = e; } return d; }, outline: () => null };
}

/** A disc (a round button): its ring is a circle. */
export function discShape(cx: number, cy: number, r: number): Shape {
  return {
    bounds: { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r },
    dist: (x, y) => Math.max(0, Math.hypot(x - cx, y - cy) - r),
    outline: (e) => {
      const n = 48, pts: Pt[] = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([cx + Math.cos(a) * (r + e), cy + Math.sin(a) * (r + e)]); }
      return [pts];
    },
  };
}

/** The same shape moved by (dx, dy): one silhouette read from one key serves every key. */
export function movedShape(s: Shape, dx: number, dy: number): Shape {
  const b = s.bounds;
  return {
    bounds: { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h },
    dist: (x, y) => s.dist(x - dx, y - dy),
    outline: (e) => s.outline(e)?.map((poly) => poly.map(([x, y]): Pt => [x + dx, y + dy])) ?? null,
  };
}

/** A shape built on first use (reading pixels costs a moment, and most things are never hovered): a point farther than the margin from the box never builds it. */
export function lazyShape(bounds: Rect, make: () => Shape): Shape {
  let real: Shape | null = null;
  const get = () => (real ??= make());
  return {
    get bounds() { return real?.bounds ?? bounds; },
    get thickness() { return real?.thickness; },
    dist: (x, y) => { const d = rectDist(bounds, x, y); return d > SHAPE_PAD ? d : get().dist(x, y); },
    outline: (e) => get().outline(e),
  };
}

// ------------------------------------------------------------------ picking

/** Something the pointer can pick: a silhouette, or a rectangle (with extra rectangles for a thin thing like a cable). */
export interface Pickable { id: string; rect: Rect; more?: Rect[]; shape?: Shape; /** A backdrop (the board, the case): it answers only where nothing else is. */ base?: boolean }

/** A target smaller than this on screen (px, its shorter side) is grown to it for the pointer, by at most `MAX_GROW_PX` on each side. */
export const MIN_TARGET_PX = 30;
export const MAX_GROW_PX = 16;

export function pickDist(h: Pickable, x: number, y: number): number {
  if (h.shape) return h.shape.dist(x, y);
  let d = rectDist(h.rect, x, y);
  if (h.more) for (const r of h.more) d = Math.min(d, rectDist(r, x, y));
  return d;
}

/** How far (world units) the pointer may miss a target and still pick it at zoom `z`: nothing for a big one, up to `MAX_GROW_PX` on screen for a small or thin one. */
export function pickReach(h: Pickable, z: number): number {
  const b = h.shape?.bounds ?? h.rect;
  let s = h.shape?.thickness ?? Math.min(b.w, b.h);
  if (h.more) for (const r of h.more) s = Math.min(s, r.w, r.h);
  return Math.min(Math.max(0, (MIN_TARGET_PX / z - s) / 2), MAX_GROW_PX / z, SHAPE_PAD - 20);
}

const pickBounds = (h: Pickable): Rect => h.shape?.bounds ?? (h.more ? unionRect([h.rect, ...h.more]) : h.rect);
/** Whether the middle of `a` is inside `b`. */
const centredIn = (a: Rect, b: Rect) => { const x = a.x + a.w / 2, y = a.y + a.h / 2; return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; };

/**
 * What is under the world point (x, y) at zoom `z`, `hits` in front-to-back order (`skip` drops the ones that do not count now). The front-most target the point is on
 * wins, except that a small target within its grown reach that sits on that target (its middle is inside that target's box) and in front of it wins instead (a key beside the rack it hangs
 * on, the USB port beside the plate it is set in). Off every target, the nearest one within its reach; then a backdrop the point is on.
 */
export function pick<T extends Pickable>(hits: Iterable<T>, x: number, y: number, z: number, skip: (h: T) => boolean = () => false): string | null {
  let on: { id: string; b: Rect; i: number } | null = null, back: string | null = null, i = -1;
  const near: { id: string; b: Rect; i: number; d: number }[] = [];
  for (const h of hits) {
    i++;
    if (skip(h)) continue;
    const d = pickDist(h, x, y);
    if (h.base) { if (d === 0 && !back) back = h.id; continue; }
    if (d === 0) { on ??= { id: h.id, b: pickBounds(h), i }; continue; }
    if (d <= pickReach(h, z)) near.push({ id: h.id, b: pickBounds(h), i, d });
  }
  let best: { id: string; d: number } | null = null;
  for (const n of near) if ((!on || (n.i < on.i && centredIn(n.b, on.b))) && (!best || n.d < best.d)) best = n;
  return best?.id ?? on?.id ?? back;
}

// ------------------------------------------------------------------ distance field

/** A silhouette on a grid: `f` is the signed distance from each cell centre to the silhouette's edge in world units (negative inside), `cell` the world size of a cell. */
interface Field { x: number; y: number; cell: number; cols: number; rows: number; f: Float32Array; /** the mean depth of the inside cells */ depth: number }

/** Chamfer sweeps (axis steps cost 1 cell, diagonals 1.414: good to a few percent) that only write into the cells `open` allows. */
function sweep(d: Float32Array, open: Uint8Array, cols: number, rows: number, cell: number) {
  const D = 1.41421356 * cell;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (!open[i]) continue;
    let v = d[i]!;
    if (x > 0) v = Math.min(v, d[i - 1]! + cell);
    if (y > 0) { v = Math.min(v, d[i - cols]! + cell); if (x > 0) v = Math.min(v, d[i - cols - 1]! + D); if (x < cols - 1) v = Math.min(v, d[i - cols + 1]! + D); }
    d[i] = v;
  }
  for (let y = rows - 1; y >= 0; y--) for (let x = cols - 1; x >= 0; x--) {
    const i = y * cols + x;
    if (!open[i]) continue;
    let v = d[i]!;
    if (x < cols - 1) v = Math.min(v, d[i + 1]! + cell);
    if (y < rows - 1) { v = Math.min(v, d[i + cols]! + cell); if (x < cols - 1) v = Math.min(v, d[i + cols + 1]! + D); if (x > 0) v = Math.min(v, d[i + cols - 1]! + D); }
    d[i] = v;
  }
}

/**
 * The signed distance to the silhouette of every cell. `alpha` is one byte per pixel (row by row), the silhouette is where it is above `level`. The cells on the edge
 * are placed from their own alpha (an anti-aliased pixel says where in it the edge runs: a sixth of a cell, not a whole one), and the rest of the grid is reached
 * from them by chamfer sweeps, one for the outside and one for the inside (neither crosses the silhouette). The grid is padded by `SHAPE_PAD` all round, so the
 * distance stays right out to the largest margin anyone asks for.
 */
function buildField(alpha: Uint8Array, w: number, h: number, frame: Rect, cell: number, level: number): Field {
  const P = Math.ceil(SHAPE_PAD / cell), cols = w + 2 * P, rows = h + 2 * P, n = cols * rows, INF = 1e9, T = level / 255;
  const a = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[(y + P) * cols + x + P] = alpha[y * w + x]!;
  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) inside[i] = a[i]! > level ? 1 : 0;
  // the edge cells: a partly covered cell with a 4-neighbour on the other side of the edge is placed from its own alpha (it says where in it the edge runs); a clear
  // or solid cell is an edge cell only where the edge between it and its neighbour is hard (the neighbour is clear or solid too), half a cell off; otherwise it is
  // reached from the partly covered cell beside it
  const seed = new Float32Array(n).fill(NaN);
  const hard = (j: number) => a[j] === 0 || a[j] === 255;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x, c = inside[i]!, v = a[i]!, full = v === 0 || v === 255;
    const across = (j: number) => inside[j] !== c && (!full || hard(j));
    if ((x > 0 && across(i - 1)) || (x < cols - 1 && across(i + 1)) || (y > 0 && across(i - cols)) || (y < rows - 1 && across(i + cols))) {
      seed[i] = v === 0 ? 0.5 * cell : v === 255 ? -0.5 * cell : Math.max(-0.75 * cell, Math.min(0.75 * cell, (T - v / 255) * cell));
    }
  }
  const dOut = new Float32Array(n).fill(INF), dIn = new Float32Array(n).fill(INF), openOut = new Uint8Array(n), openIn = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = seed[i]!, seeded = !Number.isNaN(s);
    if (seeded) { dOut[i] = s; dIn[i] = -s; }
    openOut[i] = !inside[i] && !seeded ? 1 : 0; // the outside spreads over the outside, the inside over the inside; the edge cells are the sources
    openIn[i] = inside[i] && !seeded ? 1 : 0;
  }
  sweep(dOut, openOut, cols, rows, cell);
  sweep(dIn, openIn, cols, rows, cell);
  const f = new Float32Array(n);
  let sum = 0, count = 0;
  for (let i = 0; i < n; i++) {
    const s = seed[i]!;
    f[i] = !Number.isNaN(s) ? s : inside[i] ? -dIn[i]! : dOut[i]!;
    if (f[i]! < 0) { sum -= f[i]!; count++; }
  }
  return { x: frame.x - P * cell, y: frame.y - P * cell, cell, cols, rows, f, depth: count ? sum / count : 0 };
}

/** The field at a world point, bilinear between cell centres; outside the grid it is the nearest cell plus the way out. */
function sample(F: Field, x: number, y: number): number {
  const gx = (x - F.x) / F.cell - 0.5, gy = (y - F.y) / F.cell - 0.5;
  const cx = Math.min(F.cols - 1, Math.max(0, gx)), cy = Math.min(F.rows - 1, Math.max(0, gy));
  const x0 = Math.min(F.cols - 2, Math.floor(cx)), y0 = Math.min(F.rows - 2, Math.floor(cy)), tx = cx - x0, ty = cy - y0;
  const i = y0 * F.cols + x0, f = F.f;
  const v = (f[i]! * (1 - tx) + f[i + 1]! * tx) * (1 - ty) + (f[i + F.cols]! * (1 - tx) + f[i + F.cols + 1]! * tx) * ty;
  const out = Math.hypot(gx - cx, gy - cy) * F.cell;
  return v + out;
}

// Marching squares: for each corner pattern, the cell edges (0 top, 1 right, 2 bottom, 3 left) a contour segment joins. Corner bits: top-left 1, top-right 2, bottom-right 4, bottom-left 8.
const SEGS: number[][][] = [[], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [[3, 0], [1, 2]], [[0, 2]], [[3, 2]], [[2, 3]], [[0, 2]], [[0, 1], [2, 3]], [[1, 2]], [[3, 1]], [[0, 1]], [[3, 0]], []];

/** Douglas-Peucker on an open polyline: the points that matter within `eps`. */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = pts[i]!, [bx, by] = pts[j]!, dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let worst = -1, at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k]![0] - ax) * dy - (pts[k]![1] - ay) * dx) / len;
      if (d > worst) { worst = d; at = k; }
    }
    if (worst > eps) { keep[at] = 1; stack.push([i, at], [at, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

/** The closed contours of the field at level `e` (world units outside the edge), each a polygon of points on the cell edges, simplified; specks and pinholes under two cells across are dropped. */
function contours(F: Field, e: number): Pt[][] {
  const { cols, rows, f, cell } = F;
  const px = (c: number) => F.x + (c + 0.5) * cell, py = (r: number) => F.y + (r + 0.5) * cell;
  const at = new Map<number, Pt>(), seg: [number, number][] = [], touch = new Map<number, number[]>();
  const edge = (r: number, c: number, side: number): number => {
    // an edge is identified by its cell corner and its direction (0 horizontal, 1 vertical), so two neighbouring cells name it the same
    const [r0, c0, r1, c1, id] = side === 0 ? [r, c, r, c + 1, 2 * (r * cols + c)] : side === 2 ? [r + 1, c, r + 1, c + 1, 2 * ((r + 1) * cols + c)] : side === 3 ? [r, c, r + 1, c, 2 * (r * cols + c) + 1] : [r, c + 1, r + 1, c + 1, 2 * (r * cols + c + 1) + 1];
    if (!at.has(id)) {
      const a = f[r0 * cols + c0]!, b = f[r1 * cols + c1]!, t = a === b ? 0.5 : (e - a) / (b - a);
      at.set(id, [px(c0) + (px(c1) - px(c0)) * t, py(r0) + (py(r1) - py(r0)) * t]);
    }
    return id;
  };
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const k = (f[r * cols + c]! < e ? 1 : 0) | (f[r * cols + c + 1]! < e ? 2 : 0) | (f[(r + 1) * cols + c + 1]! < e ? 4 : 0) | (f[(r + 1) * cols + c]! < e ? 8 : 0);
    if (k === 0 || k === 15) continue;
    for (const [s0, s1] of SEGS[k]!) {
      const a = edge(r, c, s0!), b = edge(r, c, s1!), i = seg.length;
      seg.push([a, b]);
      (touch.get(a) ?? touch.set(a, []).get(a)!).push(i);
      (touch.get(b) ?? touch.set(b, []).get(b)!).push(i);
    }
  }
  const used = new Uint8Array(seg.length), out: Pt[][] = [];
  for (let i = 0; i < seg.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const poly: Pt[] = [at.get(seg[i]![0])!];
    let cur = seg[i]![1];
    for (;;) {
      poly.push(at.get(cur)!);
      const next = (touch.get(cur) ?? []).find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = 1;
      cur = seg[next]![0] === cur ? seg[next]![1] : seg[next]![0];
    }
    let area = 0;
    for (let k = 0; k < poly.length - 1; k++) area += poly[k]![0] * poly[k + 1]![1] - poly[k + 1]![0] * poly[k]![1];
    if (Math.abs(area) / 2 < 4 * cell * cell) continue;
    // a closed loop (its last point is its first): split it at the point farthest from the start so each half is a proper polyline
    let far = 1, best = -1;
    for (let k = 1; k < poly.length - 1; k++) { const d = Math.hypot(poly[k]![0] - poly[0]![0], poly[k]![1] - poly[0]![1]); if (d > best) { best = d; far = k; } }
    const ring = [...simplify(poly.slice(0, far + 1), cell * 0.3), ...simplify(poly.slice(far), cell * 0.3).slice(1)];
    if (ring.length > 3) out.push(ring);
  }
  return out;
}

export interface FieldOpts {
  /** Alpha (0 to 255) above which a pixel is part of the silhouette. */
  threshold?: number;
}

/**
 * A silhouette from pixels. `pixels` is RGBA (4 bytes a pixel, `w` by `h`), `frame` the world rectangle they cover (so one pixel is `frame.w / w` world units).
 * Returns null when nothing is opaque.
 */
export function fieldShape(pixels: ArrayLike<number>, w: number, h: number, frame: Rect, opts: FieldOpts = {}): Shape | null {
  const thr = opts.threshold ?? 40, alpha = new Uint8Array(w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = pixels[(y * w + x) * 4 + 3]!;
    alpha[y * w + x] = v;
    if (v > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const cell = frame.w / w, F = buildField(alpha, w, h, frame, cell, thr);
  const bounds: Rect = { x: frame.x + x0 * cell, y: frame.y + y0 * cell, w: (x1 - x0 + 1) * cell, h: (y1 - y0 + 1) * cell };
  const cache = new Map<number, Pt[][]>();
  return {
    bounds,
    // about how thick the thing is (a thin stroke: its width; a block: a bit more than its short side): the mean depth is a quarter of it for a stroke
    thickness: 4 * F.depth,
    dist: (x, y) => Math.max(0, sample(F, x, y)),
    outline: (e) => {
      const k = Math.round(Math.min(e, SHAPE_PAD - cell));
      let c = cache.get(k);
      if (!c) { c = contours(F, k); cache.set(k, c); }
      return c;
    },
  };
}
