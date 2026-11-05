// Cloth patterns (docs/render/cloth.md): a garment is flat pieces of cloth, each an outline of named edges in millimetres, and seams that sew
// one piece's edge to another's, as a tailor cuts and sews them. `assemble` meshes each piece into near-even triangles, gives both edges of a
// seam the same number of points, places the pieces in 3D where the solver starts them and works out the rest lengths from the flat pieces.
// Pure maths: no DOM, no Three.

export type P2 = readonly [number, number];
export type P3 = [number, number, number];

/** A flat piece: its outline (edges in order round it, each one's last point the next one's first), and where each flat point starts in 3D. */
export interface Piece {
  name: string;
  edges: readonly { name: string; pts: readonly P2[] }[];
  place: (x: number, y: number) => P3;
  /** A triangle's material by its flat middle: an index into the garment's materials (0 when absent). */
  material?: (x: number, y: number) => number;
}

/** Two edges sewn point to point, `[piece, edge]` each, start to start; `flip` when they run opposite ways (start to end). */
export interface Seam { a: readonly [string, string]; b: readonly [string, string]; flip?: boolean }

export interface Garment { pieces: readonly Piece[]; seams: readonly Seam[]; materials: readonly string[] }

/** A meshed garment: per point its piece, flat and start positions; the triangles, wound one way over the sewn whole; the constraints. */
export interface ClothMesh {
  n: number;
  /** x, y on its piece (mm). */
  flat: Float64Array;
  /** x, y, z where it starts. */
  start: Float64Array;
  piece: Int32Array;
  tris: Uint32Array;
  /** Each triangle's material. */
  triMat: Uint8Array;
  /** Sewn point pairs (i, j). */
  sewn: Uint32Array;
  /** The point each point welds into: a sewn set shares its smallest index. */
  weld: Int32Array;
  /** Stretch: point pairs along the triangles' sides and their rest lengths. */
  edges: Uint32Array;
  rest: Float64Array;
  /** Bending: the two far corners of each pair of triangles that share a side, and their rest distance. */
  bends: Uint32Array;
  bendRest: Float64Array;
}

const dist = (a: P2, b: P2): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function polyLength(pts: readonly P2[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1]!, pts[i]!);
  return s;
}

/** `n` equal steps along a polyline: n + 1 points, its ends kept. */
export function resample(pts: readonly P2[], n: number): P2[] {
  const total = polyLength(pts), out: P2[] = [pts[0]!];
  let seg = 1, at = 0;
  for (let k = 1; k < n; k++) {
    const want = (total * k) / n;
    while (seg < pts.length - 1 && at + dist(pts[seg - 1]!, pts[seg]!) < want) { at += dist(pts[seg - 1]!, pts[seg]!); seg++; }
    const a = pts[seg - 1]!, b = pts[seg]!, l = dist(a, b) || 1, t = (want - at) / l;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** The point `s` of the way along a polyline (0 its start, 1 its end). */
export function pointAt(pts: readonly P2[], s: number): P2 {
  let want = polyLength(pts) * Math.min(1, Math.max(0, s));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, l = dist(a, b);
    if (want <= l || i === pts.length - 1) { const t = l > 0 ? Math.min(1, want / l) : 0; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
    want -= l;
  }
  return pts[0]!;
}

/** A quadratic Bezier from `a` to `b` pulled toward `c`, `n` steps. */
export function curve(a: P2, c: P2, b: P2, n = 16): P2[] {
  const out: P2[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

/** A cubic Bezier from `a` to `b` by the handles `c1`, `c2`, `n` steps. */
export function curve3(a: P2, c1: P2, c2: P2, b: P2, n = 24): P2[] {
  const out: P2[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    out.push([w0 * a[0] + w1 * c1[0] + w2 * c2[0] + w3 * b[0], w0 * a[1] + w1 * c1[1] + w2 * c2[1] + w3 * b[1]]);
  }
  return out;
}

export function inside(poly: readonly P2[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function edgeDist(poly: readonly P2[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j]!, [bx, by] = poly[i]!, dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

/** Delaunay triangles of the points (Bowyer-Watson), each wound counter-clockwise. */
export function delaunay(pts: readonly P2[]): number[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const d = Math.max(x1 - x0, y1 - y0) * 20 + 1, mx = (x0 + x1) / 2, my = (y0 + y1) / 2, n = pts.length;
  const P: P2[] = [...pts, [mx - d, my - d], [mx + d, my - d], [mx, my + d]];
  type T = { a: number; b: number; c: number; x: number; y: number; r: number };
  const make = (a: number, b: number, c: number): T => {
    const [ax, ay] = P[a]!, [bx, by] = P[b]!, [cx, cy] = P[c]!;
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (D < 0) [b, c] = [c, b];
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / D, uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / D;
    return { a, b, c, x: ux, y: uy, r: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris: T[] = [make(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const [px, py] = P[i]!, keep: T[] = [], open = new Map<string, [number, number]>();
    for (const t of tris) {
      if ((px - t.x) ** 2 + (py - t.y) ** 2 < t.r * (1 + 1e-9)) {
        for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as const) {
          const k = u < v ? `${u},${v}` : `${v},${u}`;
          if (open.has(k)) open.delete(k); else open.set(k, [u, v]);
        }
      } else keep.push(t);
    }
    for (const [u, v] of open.values()) keep.push(make(u, v, i));
    tris = keep;
  }
  const out: number[] = [];
  for (const t of tris) if (t.a < n && t.b < n && t.c < n) out.push(t.a, t.b, t.c);
  return out;
}

/** A small, fixed jitter for a lattice point (no two runs differ; no four points lie on one circle). */
const jitter = (i: number, j: number, k: number): number => { const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s) - 0.5; };

/** Mesh a flat outline (no point repeated) at spacing `h`: the outline's points, a triangle lattice inside kept clear of it, Delaunay. */
export function meshOutline(outline: readonly P2[], h: number): { pts: P2[]; tris: number[] } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of outline) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const pts: P2[] = [...outline], row = (h * Math.sqrt(3)) / 2;
  for (let j = 0, y = y0 + row / 2; y < y1; j++, y += row) {
    for (let i = 0, x = x0 + (j % 2 ? h / 2 : 0); x < x1; i++, x += h) {
      const px = x + 0.04 * h * jitter(i, j, 0), py = y + 0.04 * h * jitter(i, j, 1);
      if (inside(outline, px, py) && edgeDist(outline, px, py) > 0.6 * h) pts.push([px, py]);
    }
  }
  const all = delaunay(pts), tris: number[] = [];
  for (let t = 0; t < all.length; t += 3) {
    const a = pts[all[t]!]!, b = pts[all[t + 1]!]!, c = pts[all[t + 2]!]!;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (area > 1e-6 * h * h && inside(outline, (a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3)) tris.push(all[t]!, all[t + 1]!, all[t + 2]!);
  }
  return { pts, tris };
}

/** Union-find root with path halving. */
function root(up: Int32Array, i: number): number {
  while (up[i] !== i) { up[i] = up[up[i]!]!; i = up[i]!; }
  return i;
}

/**
 * Turn the triangles so that each side two of them share (over the welded points) runs one way in one and the other way in the other, then
 * the whole so that the faces look away from the garment's middle. Changes `tris` in place.
 */
export function orient(tris: Uint32Array, weld: Int32Array, pos: Float64Array): void {
  const m = tris.length / 3, sides = new Map<string, number[]>();
  const key = (u: number, v: number) => (u < v ? `${u},${v}` : `${v},${u}`);
  for (let t = 0; t < m; t++) for (let e = 0; e < 3; e++) {
    const k = key(weld[tris[3 * t + e]!]!, weld[tris[3 * t + ((e + 1) % 3)]!]!);
    const l = sides.get(k); if (l) l.push(t); else sides.set(k, [t]);
  }
  // does triangle t run from welded u to welded v along one of its sides
  const runs = (t: number, u: number, v: number) => {
    for (let e = 0; e < 3; e++) if (weld[tris[3 * t + e]!] === u && weld[tris[3 * t + ((e + 1) % 3)]!] === v) return true;
    return false;
  };
  const seen = new Uint8Array(m);
  for (let s = 0; s < m; s++) {
    if (seen[s]) continue;
    seen[s] = 1;
    const todo = [s];
    while (todo.length) {
      const t = todo.pop()!;
      for (let e = 0; e < 3; e++) {
        const u = weld[tris[3 * t + e]!]!, v = weld[tris[3 * t + ((e + 1) % 3)]!]!;
        for (const o of sides.get(key(u, v))!) {
          if (seen[o]) continue;
          seen[o] = 1;
          if (runs(o, u, v)) { const b = tris[3 * o + 1]!; tris[3 * o + 1] = tris[3 * o + 2]!; tris[3 * o + 2] = b; }
          todo.push(o);
        }
      }
    }
  }
  // the middle, then the summed facing of every face away from it
  let cx = 0, cy = 0, cz = 0;
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) { cx += pos[3 * i]!; cy += pos[3 * i + 1]!; cz += pos[3 * i + 2]!; }
  cx /= n; cy /= n; cz /= n;
  let out = 0;
  for (let t = 0; t < m; t++) {
    const a = 3 * tris[3 * t]!, b = 3 * tris[3 * t + 1]!, c = 3 * tris[3 * t + 2]!;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    out += nx * ((pos[a]! + pos[b]! + pos[c]!) / 3 - cx) + ny * ((pos[a + 1]! + pos[b + 1]! + pos[c + 1]!) / 3 - cy) + nz * ((pos[a + 2]! + pos[b + 2]! + pos[c + 2]!) / 3 - cz);
  }
  if (out < 0) for (let t = 0; t < m; t++) { const b = tris[3 * t + 1]!; tris[3 * t + 1] = tris[3 * t + 2]!; tris[3 * t + 2] = b; }
}

/** Mesh and sew a garment at a point spacing of `h` mm. */
export function assemble(g: Garment, h: number): ClothMesh {
  const byName = new Map(g.pieces.map((p) => [p.name, p]));
  const edgeOf = (piece: string, edge: string) => {
    const e = byName.get(piece)?.edges.find((x) => x.name === edge);
    if (!e) throw new Error(`no edge ${piece}.${edge}`);
    return e;
  };
  // every edge's step count: a seam's two edges share one, from the longer
  const steps = new Map<string, number>();
  for (const s of g.seams) {
    const n = Math.max(1, Math.round(Math.max(polyLength(edgeOf(...s.a).pts), polyLength(edgeOf(...s.b).pts)) / h));
    for (const k of [s.a.join('.'), s.b.join('.')]) { if (steps.has(k)) throw new Error(`edge ${k} in two seams`); steps.set(k, n); }
  }
  const flat: number[] = [], start: number[] = [], piece: number[] = [], tris: number[] = [], triMat: number[] = [], edges: number[] = [], rest: number[] = [];
  const bends: number[] = [], bendRest: number[] = [];
  const edgePts = new Map<string, number[]>();
  g.pieces.forEach((p, pi) => {
    const outline: P2[] = [], owned: [string, number, number][] = [];
    for (const e of p.edges) {
      const n = steps.get(`${p.name}.${e.name}`) ?? Math.max(1, Math.round(polyLength(e.pts) / h));
      const r = resample(e.pts, n);
      owned.push([e.name, outline.length, n]);
      outline.push(...r.slice(0, -1));
    }
    const { pts, tris: local } = meshOutline(outline, h), base = flat.length / 2;
    for (const [name, at, n] of owned) {
      const ids: number[] = [];
      for (let k = 0; k <= n; k++) ids.push(base + ((at + k) % outline.length));
      edgePts.set(`${p.name}.${name}`, ids);
    }
    for (const [x, y] of pts) { flat.push(x, y); start.push(...p.place(x, y)); piece.push(pi); }
    // the sides: each once, and the far corners of the two triangles on it (a bending pair)
    const sides = new Map<string, number[]>();
    for (let t = 0; t < local.length; t += 3) {
      const a = local[t]!, b = local[t + 1]!, c = local[t + 2]!;
      tris.push(base + a, base + b, base + c);
      const m = [pts[a]!, pts[b]!, pts[c]!].reduce((s, q) => [s[0] + q[0] / 3, s[1] + q[1] / 3], [0, 0]);
      triMat.push(p.material?.(m[0], m[1]) ?? 0);
      for (const [u, v, w] of [[a, b, c], [b, c, a], [c, a, b]] as const) {
        const k = u < v ? `${u},${v}` : `${v},${u}`, l = sides.get(k);
        if (l) l.push(w); else sides.set(k, [u, v, w]);
      }
    }
    for (const l of sides.values()) {
      edges.push(base + l[0]!, base + l[1]!); rest.push(dist(pts[l[0]!]!, pts[l[1]!]!));
      if (l.length === 4) { bends.push(base + l[2]!, base + l[3]!); bendRest.push(dist(pts[l[2]!]!, pts[l[3]!]!)); }
    }
  });
  const n = flat.length / 2, S = Float64Array.from(start);
  // the seams: point to point
  const sewn: number[] = [], up = new Int32Array(n).map((_, i) => i);
  for (const s of g.seams) {
    const A = edgePts.get(s.a.join('.'))!, B = edgePts.get(s.b.join('.'))!, k = A.length - 1;
    for (let i = 0; i <= k; i++) {
      const a = A[i]!, b = B[s.flip ? k - i : i]!;
      sewn.push(a, b);
      const ra = root(up, a), rb = root(up, b);
      if (ra !== rb) up[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  }
  const weld = new Int32Array(n);
  for (let i = 0; i < n; i++) weld[i] = root(up, i);
  const T = Uint32Array.from(tris);
  orient(T, weld, S);
  return {
    n, flat: Float64Array.from(flat), start: S, piece: Int32Array.from(piece), tris: T, triMat: Uint8Array.from(triMat), sewn: Uint32Array.from(sewn), weld,
    edges: Uint32Array.from(edges), rest: Float64Array.from(rest), bends: Uint32Array.from(bends), bendRest: Float64Array.from(bendRest),
  };
}
