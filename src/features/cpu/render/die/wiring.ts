import type { Block, Pt, Rect } from '../core/cpuplan';

// The last stretch of a link's trace inside a block with a symbol (docs/DIE.md "Pins"): the turns from the block's edge into a symbol's input pin and
// out of its output pin, and the clean-up of the joined points. Pure, no drawing. `dockLink` (glyphgeom.ts) puts them together.

type Side = 'W' | 'E' | 'N' | 'S';

/** The side of rectangle `r` that edge point `p` sits on. */
const sideOf = (p: Pt, r: Rect): Side => {
  if (Math.abs(p[0] - r.x) < 0.6) {
    return 'W';
  }
  if (Math.abs(p[0] - (r.x + r.w)) < 0.6) {
    return 'E';
  }
  return Math.abs(p[1] - r.y) < 0.6 ? 'N' : 'S';
};

/** The points of a trace without repeats, and without the middle point of three on one straight line. */
export const clean = (pts: Pt[]): Pt[] => {
  const out: Pt[] = [];
  for (const p of pts) {
    const v = out.at(-1);
    if (v && v[0] === p[0] && v[1] === p[1]) {
      continue;
    }
    const u = out.at(-2);
    if (u && v && ((u[0] === v[0] && v[0] === p[0]) || (u[1] === v[1] && v[1] === p[1]))) {
      out.pop();
    }
    out.push(p);
  }
  return out;
};

/** The trace from a block's edge point `e` into the symbol's input pin `p`: through a channel just left of the pins, so it never crosses the symbol. */
export function intoPin(b: Block, e: Pt, p: Pt): Pt[] {
  const r = b.rect,
    xc = Math.max(r.x + 4, p[0] - 5),
    top = r.y + 5,
    bot = r.y + r.h - 4;
  const side = sideOf(e, r);
  if (side === 'W') {
    return [e, [xc, e[1]], [xc, p[1]], p];
  }
  if (side === 'N') {
    return [e, [e[0], top], [xc, top], [xc, p[1]], p];
  }
  if (side === 'S') {
    return [e, [e[0], bot], [xc, bot], [xc, p[1]], p];
  }
  return [e, [e[0] - 4, e[1]], [e[0] - 4, top], [xc, top], [xc, p[1]], p];
}

/** The trace from a symbol's output pin `p` out to the block's edge point `e`, through a channel just right of the symbol. */
export function outOfPin(b: Block, p: Pt, e: Pt): Pt[] {
  const r = b.rect,
    xr = Math.min(r.x + r.w - 4, p[0] + 5),
    top = r.y + 5,
    bot = r.y + r.h - 4;
  const side = sideOf(e, r);
  if (side === 'E') {
    return [p, [xr, p[1]], [xr, e[1]], e];
  }
  if (side === 'N') {
    return [p, [xr, p[1]], [xr, top], [e[0], top], e];
  }
  if (side === 'S') {
    return [p, [xr, p[1]], [xr, bot], [e[0], bot], e];
  }
  return [p, [xr, p[1]], [xr, top], [r.x + 4, top], [r.x + 4, e[1]], e];
}
