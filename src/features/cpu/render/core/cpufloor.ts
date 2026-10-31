// The floorplan engine of the CPU die (docs/DIE.md): a slicing layout that fills a rectangle edge to edge (rows and columns of blocks
// with weights, a gutter between siblings), and a channel router that finds each wire's route through the gutters. Pure geometry. The tree
// (`placeTree`) and the router (`routeWires`) are generic over the block kind and need only `{id, rect, parent?}`, so the GPU card plan
// (render/gpu) uses them too; `place` and `routeLinks` are the CPU die's instances.

import { gridExact, type Block, type BlockKind, type Link, type LinkKind, type Pt, type Rect } from './cpuplan';
import { dockLink } from '../die/glyphgeom';

/** The gutter between sibling blocks: the wires run in it. */
export const GAP = 14;

/** What the router needs of a block: where it is and which frame (a container, never an obstacle) holds it. */
export interface Boxed { id: string; rect: Rect; parent?: string }

export interface Spec<K extends string = BlockKind> {
  id: string;
  kind: K;
  label: string;
  sub?: string;
  /** Show this many cells (registers, entries, lines), laid out as an exact grid. */
  cells?: number;
  /** Force the cell grid to cols x rows (bit-slices, lanes) instead of the best-fitting exact grid. */
  shape?: [number, number];
  ring?: boolean;
  /** `edge` (the board-facing ring, shared by the cores) or `core`; inherited from the enclosing split when absent. */
  zone?: Block['zone'];
  stage?: number;
  lane?: number;
  unit?: string;
}
export interface Leaf<K extends string = BlockKind> { spec: Spec<K>; f?: number; px?: number }
export interface Split<K extends string = BlockKind> {
  dir: 'row' | 'col';
  kids: Node<K>[];
  /** Weight (default 1) or a fixed size in pixels along the parent's axis. */
  f?: number;
  px?: number;
  gap?: number;
  /** A frame (a pipeline stage's column): a block drawn behind its children, with a title strip. */
  frame?: Spec<K>;
  pad?: number;
  title?: number;
  zone?: Block['zone'];
}
export type Node<K extends string = BlockKind> = Leaf<K> | Split<K>;

const isSplit = <K extends string>(n: Node<K>): n is Split<K> => 'dir' in n;

type Sized = { f?: number; px?: number };

export const leaf = <K extends string = BlockKind>(id: string, kind: K, label: string, o: Partial<Spec<K>> & Sized = {}): Leaf<K> => {
  const { f, px, ...spec } = o;
  return { spec: { id, kind, label, ...spec }, ...(f !== undefined ? { f } : {}), ...(px !== undefined ? { px } : {}) };
};
export const row = <K extends string = BlockKind>(kids: Node<K>[], o: Omit<Split<K>, 'dir' | 'kids'> = {}): Split<K> => ({ dir: 'row', kids, ...o });
export const col = <K extends string = BlockKind>(kids: Node<K>[], o: Omit<Split<K>, 'dir' | 'kids'> = {}): Split<K> => ({ dir: 'col', kids, ...o });

const sizeOf = (n: Node<string>): Sized => ({ f: n.f, px: n.px });

/** Start and size of each child along an axis of length `total`, the gutter between them; whole pixels, the gutters exact. */
export function spans(total: number, kids: Sized[], gap: number): [number, number][] {
  const fixed = kids.reduce((n, k) => n + (k.px ?? 0), 0);
  const free = total - fixed - gap * (kids.length - 1);
  const wsum = kids.reduce((n, k) => n + (k.px === undefined ? (k.f ?? 1) : 0), 0) || 1;
  const out: [number, number][] = [];
  let x = 0;
  for (const k of kids) {
    const s = k.px ?? (free * (k.f ?? 1)) / wsum;
    const a = Math.round(x), b = Math.round(x + s);
    out.push([a, b - a]);
    x += s + gap;
  }
  return out;
}

function make(s: Spec, r: Rect, parent: string | undefined, zone: Block['zone']): Block {
  const b: Block = { id: s.id, kind: s.kind, label: s.label, rect: { ...r }, zone: s.zone ?? zone };
  if (s.sub) b.sub = s.sub;
  if (parent) b.parent = parent;
  if (s.stage !== undefined) b.stage = s.stage;
  if (s.lane !== undefined) b.lane = s.lane;
  if (s.unit) b.unit = s.unit;
  if (s.shape) b.grid = { cols: s.shape[0], rows: s.shape[1], count: s.shape[0] * s.shape[1], ...(s.ring ? { ring: true } : {}) };
  else if (s.cells) b.grid = { ...gridExact(s.cells, r.w - 16, Math.max(8, r.h - 44)), ...(s.ring ? { ring: true } : {}) };
  return b;
}

/** Builds the block of a spec: `frame` is true for the container drawn behind a split's children. */
export type Maker<K extends string, B> = (s: Spec<K>, r: Rect, parent: string | undefined, zone: Block['zone'], frame: boolean) => B;

/** Lay a tree out in `r`, pushing the blocks (a frame before its children), each made by `mk`. */
export function placeTree<K extends string, B>(node: Node<K>, r: Rect, out: B[], mk: Maker<K, B>, zone: Block['zone'] = 'core', parent?: string): void {
  if (!isSplit(node)) { out.push(mk(node.spec, r, parent, zone, false)); return; }
  if (node.zone) zone = node.zone;
  let inner = r, par = parent;
  if (node.frame) {
    out.push(mk(node.frame, r, parent, zone, true));
    par = node.frame.id;
    const pad = node.pad ?? 8, title = node.title ?? 22;
    inner = { x: r.x + pad, y: r.y + title, w: r.w - 2 * pad, h: r.h - title - pad };
  }
  const horizontal = node.dir === 'row';
  const sp = spans(horizontal ? inner.w : inner.h, node.kids.map(sizeOf), node.gap ?? GAP);
  node.kids.forEach((k, i) => {
    const [a, s] = sp[i]!;
    placeTree(k, horizontal ? { x: inner.x + a, y: inner.y, w: s, h: inner.h } : { x: inner.x, y: inner.y + a, w: inner.w, h: s }, out, mk, zone, par);
  });
}

/** The CPU die's instance: a frame is a block of kind 'stage'. */
export function place(node: Node, r: Rect, out: Block[], zone: Block['zone'] = 'core', parent?: string): void {
  placeTree(node, r, out, (s, rr, p, z, frame) => make(frame ? { ...s, kind: 'stage' } : s, rr, p, z), zone, parent);
}

// ---------------------------------------------------------------- the channel router

export interface WireSpec<K extends string = LinkKind> { id: string; kind: K; from: string; to: string; lanes?: 1 | 2 | 3 | 4; label?: string; both?: boolean }
export type LinkSpec = WireSpec;
/** A routed wire: the spec with its polyline. */
export type Wire<K extends string = LinkKind> = Required<Pick<WireSpec<K>, 'id' | 'kind' | 'from' | 'to' | 'lanes'>> & Pick<WireSpec<K>, 'label' | 'both'> & { pts: Pt[] };

const STEP = 6;       // routing grid pitch
const CLEAR = 2;      // a wire keeps this far from every block
const DIRS: Pt[] = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W

interface Port { cell: number; side: number }

class Heap {
  private a: number[] = [];   // f
  private s: number[] = [];   // seq
  private v: number[] = [];   // state
  private n = 0;
  get size(): number { return this.a.length; }
  push(f: number, state: number): void {
    this.a.push(f); this.s.push(this.n++); this.v.push(state);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(i, p)) { this.swap(i, p); i = p; } else break;
    }
  }
  pop(): number {
    const top = this.v[0]!;
    const last = this.a.length - 1;
    this.swap(0, last);
    this.a.pop(); this.s.pop(); this.v.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < this.a.length && this.less(l, m)) m = l;
      if (r < this.a.length && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m); i = m;
    }
    return top;
  }
  private less(i: number, j: number): boolean { return this.a[i]! < this.a[j]! || (this.a[i] === this.a[j] && this.s[i]! < this.s[j]!); }
  private swap(i: number, j: number): void {
    [this.a[i], this.a[j]] = [this.a[j]!, this.a[i]!];
    [this.s[i], this.s[j]] = [this.s[j]!, this.s[i]!];
    [this.v[i], this.v[j]] = [this.v[j]!, this.v[i]!];
  }
}

/**
 * Two blocks side by side are joined by a hop across the gutter that is only a few units long, which reads as a stub, not a wire. Where the blocks
 * face each other along enough of their edges, the hop becomes a jog: out of one block high on its edge, along the gutter, into the other low on
 * its edge, so the trace is long enough to see and to run a pulse along.
 */
export function jog(ra: Rect, rb: Rect, pts: Pt[]): Pt[] {
  if (pts.length !== 2) return pts;
  const [p, q] = [pts[0]!, pts[1]!];
  if (p[1] === q[1] && Math.abs(q[0] - p[0]) <= 40) {
    const lo = Math.max(ra.y, rb.y) + 10, hi = Math.min(ra.y + ra.h, rb.y + rb.h) - 10;
    if (hi - lo < 24) return pts;
    const y1 = lo + (hi - lo) * 0.2, y2 = lo + (hi - lo) * 0.8, mx = (p[0] + q[0]) / 2;
    return [[p[0], y1], [mx, y1], [mx, y2], [q[0], y2]];
  }
  if (p[0] === q[0] && Math.abs(q[1] - p[1]) <= 40) {
    const lo = Math.max(ra.x, rb.x) + 10, hi = Math.min(ra.x + ra.w, rb.x + rb.w) - 10;
    if (hi - lo < 24) return pts;
    const x1 = lo + (hi - lo) * 0.2, x2 = lo + (hi - lo) * 0.8, my = (p[1] + q[1]) / 2;
    return [[x1, p[1]], [x1, my], [x2, my], [x2, q[1]]];
  }
  return pts;
}

/**
 * Route every wire through the gutters: orthogonal, as few bends as it can, keeping clear of every block (a frame, a block other blocks name
 * as their parent, is a container, not an obstacle), and avoiding the cells earlier wires already use. The ends are on the facing edges of
 * the two blocks; `dock` may run them on into the blocks' symbols. `tag` prefixes the errors.
 */
export function routeWires<B extends Boxed, K extends string>(die: Rect, blocks: B[], specs: WireSpec<K>[], dock?: (from: B, to: B, id: string, pts: Pt[]) => Pt[], tag = 'plan'): Wire<K>[] {
  const cols = Math.floor(die.w / STEP), rows = Math.floor(die.h / STEP);
  const cx = (i: number) => die.x + 3 + i * STEP, cy = (j: number) => die.y + 3 + j * STEP;
  const blocked = new Uint8Array(cols * rows);
  const margin = 18; // keep off the die's own border
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = cx(i), y = cy(j);
    if (x < die.x + margin || y < die.y + margin || x > die.x + die.w - margin || y > die.y + die.h - margin) blocked[j * cols + i] = 1;
  }
  const byId = new Map<string, B>();
  const frames = new Set(blocks.map((b) => b.parent).filter((p): p is string => p !== undefined));
  for (const b of blocks) {
    byId.set(b.id, b);
    if (frames.has(b.id)) continue;
    const r = b.rect;
    const i0 = Math.max(0, Math.floor((r.x - CLEAR - die.x) / STEP) - 1), i1 = Math.min(cols - 1, Math.ceil((r.x + r.w + CLEAR - die.x) / STEP) + 1);
    const j0 = Math.max(0, Math.floor((r.y - CLEAR - die.y) / STEP) - 1), j1 = Math.min(rows - 1, Math.ceil((r.y + r.h + CLEAR - die.y) / STEP) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = cx(i), y = cy(j);
      if (x > r.x - CLEAR && x < r.x + r.w + CLEAR && y > r.y - CLEAR && y < r.y + r.h + CLEAR) blocked[j * cols + i] = 1;
    }
  }
  const used = new Uint8Array(cols * rows);

  /** The free cells just outside a block's edges, facing out, inside the span of the side. */
  const ports = (r: Rect): Port[] => {
    const out: Port[] = [];
    const i0 = Math.max(0, Math.floor((r.x - CLEAR - STEP - die.x) / STEP)), i1 = Math.min(cols - 1, Math.ceil((r.x + r.w + CLEAR + STEP - die.x) / STEP));
    const j0 = Math.max(0, Math.floor((r.y - CLEAR - STEP - die.y) / STEP)), j1 = Math.min(rows - 1, Math.ceil((r.y + r.h + CLEAR + STEP - die.y) / STEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * cols + i;
      if (blocked[c]) continue;
      const x = cx(i), y = cy(j);
      const inX = x >= r.x + 3 && x <= r.x + r.w - 3, inY = y >= r.y + 3 && y <= r.y + r.h - 3;
      if (inX && y < r.y && y >= r.y - CLEAR - STEP) out.push({ cell: c, side: 0 });
      else if (inX && y > r.y + r.h && y <= r.y + r.h + CLEAR + STEP) out.push({ cell: c, side: 2 });
      else if (inY && x > r.x + r.w && x <= r.x + r.w + CLEAR + STEP) out.push({ cell: c, side: 1 });
      else if (inY && x < r.x && x >= r.x - CLEAR - STEP) out.push({ cell: c, side: 3 });
    }
    return out;
  };
  const onEdge = (r: Rect, p: Port): Pt => {
    const i = p.cell % cols, j = Math.floor(p.cell / cols), x = cx(i), y = cy(j);
    switch (p.side) {
      case 0: return [x, r.y];
      case 2: return [x, r.y + r.h];
      case 1: return [r.x + r.w, y];
      default: return [r.x, y];
    }
  };

  const links: Wire<K>[] = [];
  const dist = new Float64Array(cols * rows * 4);
  const prev = new Int32Array(cols * rows * 4);
  for (const spec of specs) {
    const a = byId.get(spec.from), b = byId.get(spec.to);
    if (!a || !b) throw new Error(`${tag}: link ${spec.id}: unknown block ${spec.from} / ${spec.to}`);
    const src = ports(a.rect), dst = ports(b.rect);
    if (src.length === 0 || dst.length === 0) throw new Error(`${tag}: link ${spec.id}: no free edge on ${src.length === 0 ? spec.from : spec.to}`);
    const target = new Map<number, Port>();
    for (const p of dst) target.set(p.cell, p);
    const heur = (c: number): number => {
      const x = cx(c % cols), y = cy(Math.floor(c / cols));
      const dx = Math.max(b.rect.x - x, 0, x - (b.rect.x + b.rect.w)), dy = Math.max(b.rect.y - y, 0, y - (b.rect.y + b.rect.h));
      return (dx + dy) / STEP;
    };
    dist.fill(Infinity);
    const heap = new Heap();
    for (const p of src) { const st = p.cell * 4 + p.side; dist[st] = 0; prev[st] = -1; heap.push(heur(p.cell), st); }
    let end = -1;
    while (heap.size > 0) {
      const st = heap.pop();
      const c = st >> 2, d = st & 3;
      const g = dist[st]!;
      if (target.has(c)) { end = st; break; }
      const ci = c % cols, cj = Math.floor(c / cols);
      for (let nd = 0; nd < 4; nd++) {
        if (nd === ((d + 2) & 3)) continue;
        const ni = ci + DIRS[nd]![0], nj = cj + DIRS[nd]![1];
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const nc = nj * cols + ni;
        if (blocked[nc]) continue;
        const ng = g + 1 + (nd !== d ? 5 : 0) + (used[nc] ? 3 : 0);
        const ns = nc * 4 + nd;
        if (ng < dist[ns]!) { dist[ns] = ng; prev[ns] = st; heap.push(ng + heur(nc), ns); }
      }
    }
    if (end < 0) throw new Error(`${tag}: no route for link ${spec.id} (${spec.from} to ${spec.to})`);
    const states: number[] = [];
    for (let st = end; st >= 0; st = prev[st]!) states.push(st);
    states.reverse();
    const cells = states.map((st) => st >> 2);
    // the first cell of the path is a source port (its start direction says which side), the last a target port
    const first = src.find((p) => p.cell === cells[0] && p.side === (states[0]! & 3))!;
    const last = target.get(cells[cells.length - 1]!)!;
    const pts: Pt[] = [onEdge(a.rect, first)];
    for (const c of cells) { pts.push([cx(c % cols), cy(Math.floor(c / cols))]); used[c] = 1; }
    pts.push(onEdge(b.rect, last));
    const out: Pt[] = [];
    for (const p of pts) {
      const n = out.length;
      if (n >= 1 && out[n - 1]![0] === p[0] && out[n - 1]![1] === p[1]) continue;
      if (n >= 2) {
        const u = out[n - 2]!, v = out[n - 1]!;
        if ((u[0] === v[0] && v[0] === p[0]) || (u[1] === v[1] && v[1] === p[1])) out.pop();
      }
      out.push(p);
    }
    links.push({ id: spec.id, kind: spec.kind, from: spec.from, to: spec.to, pts: dock ? dock(a, b, spec.id, jog(a.rect, b.rect, out)) : jog(a.rect, b.rect, out), lanes: spec.lanes ?? 2, ...(spec.label ? { label: spec.label } : {}), ...(spec.both ? { both: true } : {}) });
  }
  return links;
}

/** The CPU die's instance: wires docked into the block symbols (`dock` false leaves them on the block edges). */
export function routeLinks(die: Rect, blocks: Block[], specs: LinkSpec[], dock = true): Link[] {
  return routeWires(die, blocks, specs, dock ? dockLink : undefined, 'cpuplan');
}
