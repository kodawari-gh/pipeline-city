import type { Block, BlockKind, Pt, Rect } from './cpuplan';

// The geometry of the symbols drawn inside blocks (blockart.ts) that the wires need to know: where a symbol's pins are, so a link can run into the
// symbol (the A and B of an ALU, the +4 / branch / interrupt inputs of the next-PC multiplexer) instead of stopping at the block's edge
// (docs/DIE.md "Pins"). Pure, no drawing. blockart.ts draws the symbols with the same numbers: change them together (blockart.test.ts checks it).

/** The kinds drawn as symbols (the others keep their cell arrays). */
export const GLYPH_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>(['pc', 'pcadd', 'nextpc', 'fetch', 'imm', 'decode', 'alu', 'mul', 'lsu', 'wb', 'branch']);

/** Whether a block is drawn as a symbol (the dispatch stage is a queue by kind but a set of lanes by look). */
export const isGlyph = (b: Block): boolean => GLYPH_KINDS.has(b.kind) || b.id === 'disp';
/** The lanes a dispatch stage passes at once ("4 a cycle"). */
export const laneCount = (b: Block): number => Number(/^(\d+)/.exec(b.sub ?? '')?.[1] ?? 2);
/** The number of words a fetch block reads at once ("FETCH × 4"). */
export const fetchWidth = (b: Block): number => Number(/×\s*(\d+)/.exec(b.label)?.[1] ?? 1);

/** A narrow tall block (a queue, a latch) carries its name rotated along its left side. */
export const isTall = (b: Block): boolean => {
  const r = b.rect;
  return b.kind === 'latch' || (r.w < 56 && r.h > r.w * 2.2) || (r.w <= 110 && r.h >= r.w * 2.4 && b.label.length * 8.5 > r.w - 14);
};

/** The drawing area of a block's symbol: the box under the name (the same as its cell grid's). */
export function glyphArea(b: Block): Rect | null {
  const r = b.rect;
  const head = r.h >= 70 ? 44 : r.h * 0.55;
  const a = { x: r.x + 8, y: r.y + head, w: r.w - 16, h: r.y + r.h - 6 - (r.y + head) };
  return a.w > 14 && a.h > 8 ? a : null;
}

/** The pins of a block's symbol: where each input enters and where the output leaves, in die coordinates. */
export interface Pins { ins: Record<string, Pt>; out: Pt | null }

export function glyphPins(b: Block): Pins | null {
  if (!isGlyph(b) || isTall(b)) return null;
  const a = glyphArea(b);
  if (!a) return null;
  const { x, y, w, h } = a;
  if (b.id === 'disp') return { ins: { in: [x, y + h / 2] }, out: [x + w, y + h / 2] };
  switch (b.kind) {
    case 'pc': case 'fetch': case 'imm': return { ins: { in: [x, y + h / 2] }, out: [x + w, y + h / 2] };
    case 'decode': { const wh = Math.min(14, h * 0.4); return { ins: { in: [x, y + wh / 2] }, out: [x + w, y + wh / 2] }; }
    case 'nextpc': {
      const mh = Math.min(h, 40), mw = Math.min(w * 0.35, 46), mx = x + w * 0.38, my = y + (h - mh) / 2;
      const iy = (k: number, n: number) => my + mh * ((k + 0.5) / n);
      return { ins: { '+4': [mx - 7, iy(0, 3)], br: [mx - 7, iy(1, 3)], irq: [mx - 7, iy(2, 3)] }, out: [mx + mw + 7, my + mh / 2] };
    }
    case 'wb': {
      const mh = Math.min(h, 40), mw = Math.min(w * 0.3, 40), mx = x + w * 0.4, my = y + (h - mh) / 2;
      const iy = (k: number) => my + mh * ((k + 0.5) / 3);
      return { ins: { alu: [mx - 7, iy(0)], mem: [mx - 7, iy(1)], 'pc+4': [mx - 7, iy(2)] }, out: [mx + mw + 7, my + mh / 2] };
    }
    case 'pcadd': { const r = Math.min(h / 2, w / 5, 17), cx = x + w / 2, cy = y + h / 2; return { ins: { in: [cx - r - 7, cy - r * 0.55] }, out: [cx + r + 7, cy] }; }
    case 'alu': {
      const ah = Math.min(h, 56), ay = y + (h - ah) / 2, aw = Math.min(w * 0.5, 88), ax = x + w * 0.2, ow = Math.max(0, Math.min(40, x + w - (ax + aw + 8)));
      return { ins: { in: [ax - 18, ay + ah / 2] }, out: [ax + aw + 8 + ow, ay + ah / 2] };
    }
    case 'branch': { const bh = Math.min(h, 40), by = y + (h - bh) / 2, bw = Math.min(w * 0.4, 56), bx = x + w * 0.25; return { ins: { in: [bx - 14, by + bh / 2] }, out: [bx + bw + 32, by + bh / 2] }; }
    case 'mul': return { ins: { in: [x + 2, y + h / 2] }, out: [x + w * 0.62 + Math.min(60, w * 0.3), y + h / 2] };
    case 'lsu': { const r = Math.min(h / 2.4, 14), cx = x + r + 10; return { ins: { in: [cx - r - 12, y + h / 2] }, out: [x + w, y + h / 2] }; }
    default: return null;
  }
}

/** The input pin a link enters a symbol at (the next-PC multiplexer has three, write-back three). */
export function inPinFor(b: Block, linkId: string, pins: Pins): Pt | undefined {
  if (b.kind === 'nextpc') return pins.ins[/pcadd/.test(linkId) ? '+4' : /irq/.test(linkId) ? 'irq' : 'br'];
  if (b.kind === 'wb') return pins.ins[/lsu|l3|mem/.test(linkId) ? 'mem' : 'alu'];
  return pins.ins.in ?? Object.values(pins.ins)[0];
}

const sideOf = (p: Pt, r: Rect): 'W' | 'E' | 'N' | 'S' => (Math.abs(p[0] - r.x) < 0.6 ? 'W' : Math.abs(p[0] - (r.x + r.w)) < 0.6 ? 'E' : Math.abs(p[1] - r.y) < 0.6 ? 'N' : 'S');

const clean = (pts: Pt[]): Pt[] => {
  const out: Pt[] = [];
  for (const p of pts) {
    const n = out.length;
    if (n >= 1 && out[n - 1]![0] === p[0] && out[n - 1]![1] === p[1]) continue;
    if (n >= 2) { const u = out[n - 2]!, v = out[n - 1]!; if ((u[0] === v[0] && v[0] === p[0]) || (u[1] === v[1] && v[1] === p[1])) out.pop(); }
    out.push(p);
  }
  return out;
};

/** The trace from a block's edge point `e` into the symbol's input pin `p`: through a channel just left of the pins, so it never crosses the symbol. */
function intoPin(b: Block, e: Pt, p: Pt): Pt[] {
  const r = b.rect, xc = Math.max(r.x + 4, p[0] - 5), top = r.y + 5, bot = r.y + r.h - 4;
  switch (sideOf(e, r)) {
    case 'W': return [e, [xc, e[1]], [xc, p[1]], p];
    case 'N': return [e, [e[0], top], [xc, top], [xc, p[1]], p];
    case 'S': return [e, [e[0], bot], [xc, bot], [xc, p[1]], p];
    default: return [e, [e[0] - 4, e[1]], [e[0] - 4, top], [xc, top], [xc, p[1]], p];
  }
}

/** The trace from a symbol's output pin `p` out to the block's edge point `e`, through a channel just right of the symbol. */
function outOfPin(b: Block, p: Pt, e: Pt): Pt[] {
  const r = b.rect, xr = Math.min(r.x + r.w - 4, p[0] + 5), top = r.y + 5, bot = r.y + r.h - 4;
  switch (sideOf(e, r)) {
    case 'E': return [p, [xr, p[1]], [xr, e[1]], e];
    case 'N': return [p, [xr, p[1]], [xr, top], [e[0], top], e];
    case 'S': return [p, [xr, p[1]], [xr, bot], [e[0], bot], e];
    default: return [p, [xr, p[1]], [xr, top], [r.x + 4, top], [r.x + 4, e[1]], e];
  }
}

/**
 * Run a routed link on into the symbols it joins: out of the output pin of its `from` block, in at the input pin of its `to` block (where those
 * blocks have a symbol). The routed part between the two edges is unchanged.
 */
export function dockLink(from: Block, to: Block, id: string, pts: Pt[]): Pt[] {
  if (pts.length < 2) return pts;
  const pf = glyphPins(from), pt = glyphPins(to);
  const head = pf?.out ? outOfPin(from, pf.out, pts[0]!) : [pts[0]!];
  const pin = pt ? inPinFor(to, id, pt) : undefined;
  const tail = pin ? intoPin(to, pts[pts.length - 1]!, pin) : [pts[pts.length - 1]!];
  return clean([...head, ...pts.slice(1, -1), ...tail]);
}
