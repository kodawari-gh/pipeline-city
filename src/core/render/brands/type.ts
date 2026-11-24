// The brands' wordmarks (docs/brands/README.md): one stroke-built type family, cut per brand. A glyph is a skeleton (lines and rounded
// corners) stroked `s` wide inside its box: cap height 1, baseline at y = 1, y down. The style's `round` sets the corner radius of the curved
// letters (0 square and technical, 1 fully round and geometric), `wide` their width, `s` the weight, `ends` cut or soft stroke ends.
// Diagonals run past the band and the box clips them, so their ends are flat and flush with the baseline and the cap line.
import type { Ctx } from './kit';

export interface TypeStyle {
  /** Weight: the stroke width as a share of the cap height (0.07 hairline .. 0.23 black). */
  s: number;
  /** Corner radius of the curved letters: 0 square (technical) .. 1 full round (geometric). */
  round: number;
  /** Width of the letters (1 normal, 1.3 extended, 0.88 condensed). */
  wide: number;
  /** Lean: x moved per unit up (0.2 leans right). */
  slant: number;
  /** Extra space between the letters, as a share of the cap height. */
  track: number;
  /** Stroke ends and joins: `cut` square and flush (the default) or `soft` round. */
  ends?: 'cut' | 'soft';
  /** Lowercase x-height, as a share of the cap height (default 0.7). */
  xh?: number;
  /** Glyph alternates by letter, e.g. `{ A: 'lambda' }` (no crossbar): see the glyphs below. */
  alt?: Readonly<Record<string, string>>;
  /** In the brand's own word only: the letters (by index) printed in the accent. */
  lit?: readonly number[];
  /** In the brand's own word only: the dots of i and j printed in the accent. */
  litDots?: boolean;
}

/** The descender's depth below the baseline, in cap heights. */
export const DSC = 0.26;

/** The tools a glyph draws with, in its box (`W` wide, cap height 1, y down). Skeleton bounds: `l r` (sides), `b` (baseline), `h` (half the weight). */
interface G {
  c: Ctx;
  W: number;
  s: number;
  h: number;
  l: number;
  r: number;
  cx: number;
  b: number;
  /** The outer top of the x-height band (1 - xh). */
  x0: number;
  /** The descender's skeleton bottom. */
  d: number;
  /** The glyph's alternate, if the style picks one. */
  alt: string | undefined;
  round: number;
  /** The style's corner radius for a skeleton shape `bw` by `bh`. */
  R(bw: number, bh: number): number;
  /**
   * A sub-path through `pts` (x0, y0, x1, y1...), each corner rounded to its radius: `rad` one radius for all, or one per corner (for an open
   * path, its inner points only). `ext`: 1 runs the start past its point, 2 the end, 3 both (the box clips them flat). `trim`: the lengths
   * cut off an open path's start and end (a terminal that stops part way round a curve).
   */
  P(
    pts: readonly number[],
    rad?: number | readonly number[],
    closed?: boolean,
    ext?: number,
    trim?: readonly [number, number],
  ): void;
  /** A straight stroke; `ext` as for `P`. */
  L(x0: number, y0: number, x1: number, y1: number, ext?: number): void;
  /** The horizontal half-width of a diagonal stroke that runs `run` across for `rise` down. */
  hx(run: number, rise: number): number;
  /** A dot (i, j, full stop), its centre at (x, y), as wide as the stroke. */
  dot(x: number, y: number): void;
  /** Strokes what is drawn so far, then clips what follows to y >= `y` (arms that must stop at the x-height). */
  cut(y: number): void;
}

type Draw = (g: G) => void;
interface Glyph {
  /** Width before the style's `wide` and weight (0: as wide as the stroke). */
  w: number;
  draw: Draw;
  /** It reaches below the baseline. */
  desc?: true;
  /** It lives in the x-height band only (the box clips at the x-height). */
  x?: true;
  /** Fixed width: not scaled by the weight (the space). */
  fixed?: true;
  /** Side bearings added to the spacing, left and right (negative pulls the neighbours in). */
  sb?: readonly [number, number];
}

// ---------------------------------------------------------------- shared shapes (`y0` the band's outer top: 0 for caps, x0 for lowercase)

/**
 * The length to trim off a stroke end so that it stops `f` of the way round a corner of radius `k`, after a straight run `run` (an open
 * terminal: c, e, s, 3...). The stroke's cap is allowed for, so the gap shows at every weight.
 */
const term = (g: G, run: number, k: number, f: number) =>
  Math.max(0, run) + (k > 1e-6 ? f * k * (Math.PI / 2) + g.h * Math.min(1, k / g.s) : 0);

const bowl = (g: G, y0: number) => {
  const { l, r, b, h } = g,
    t = y0 + h;
  g.P([l, t, r, t, r, b, l, b], g.R(r - l, b - t), true);
};
const cee = (g: G, y0: number) => {
  const { l, r, b, h } = g,
    t = y0 + h,
    k = g.R(r - l, b - t),
    ym = (t + b) / 2,
    cut = term(g, ym - t - k, k, 0.5);
  g.P([r, ym, r, t, l, t, l, b, r, b, r, ym], k, false, 0, [cut, cut]);
};
const ess = (g: G, y0: number) => {
  const { l, r, b, h } = g,
    t = y0 + h,
    m = t + (b - t) * 0.49,
    ku = g.R(r - l, m - t),
    kl = g.R(r - l, b - m);
  // a square S keeps short spurs at its ends (else it reads as a 5); a round one opens its ends part way round the curve
  const end = (bh: number, k: number) => {
    const spur = bh * 0.3 * Math.max(0, 1 - g.round * 3);
    return spur > 0 ? Math.max(0, bh - k - spur) : term(g, bh - k, k, 0.42);
  };
  g.P([r, m, r, t, l, t, l, m, r, m, r, b, l, b, l, m], [ku, ku, ku, kl, kl, kl], false, 0, [
    end(m - t, ku),
    end(b - m, kl),
  ]);
};
const vee = (g: G, y0: number) => {
  const { W, s } = g,
    ft = s * 0.8,
    run = W / 2 - ft / 2,
    hx = g.hx(run, 1 - y0);
  g.L(hx, y0, run + hx, 1, 3);
  g.L(W - hx, y0, W - run - hx, 1, 3);
};
const dub = (g: G, y0: number) => {
  const { W, s } = g,
    ft = s * 0.7,
    q = W / 4,
    run = q - ft / 2,
    hx = g.hx(run, 1 - y0);
  g.P([hx, y0, q, 1 + ft, W / 2, y0, W - q, 1 + ft, W - hx, y0], 0, false, 3);
};
const ex = (g: G, y0: number) => {
  const { W, h } = g,
    hx = g.hx(W - 2 * h, 1 - y0);
  g.L(hx, y0, W - hx, 1, 3);
  g.L(W - hx, y0, hx, 1, 3);
};
const zed = (g: G, y0: number) => {
  const { l, r, b, h } = g,
    t = y0 + h;
  g.P([l, t, r, t, l, b, r, b]);
};
/** An arch from the stem at `x0` over to `x1` and down (n, h, m). */
const arch = (g: G, x0: number, x1: number, y0: number) => {
  const { b, h } = g,
    t = y0 + h,
    k = g.R(x1 - x0, b - t);
  g.P([x0, b, x0, t, x1, t, x1, b], k);
};
/** The x-height top skeleton line. */
const xt = (g: G) => g.x0 + g.h;
/** The centre of an i or j dot, above the x-height. */
const dotY = (g: G) => g.x0 - g.s * 0.8 - g.h;

// ---------------------------------------------------------------- the glyphs

const CAPS: Record<string, Glyph> = {
  A: {
    w: 0.74,
    sb: [-0.05, -0.05],
    draw: (g) => {
      const { W, s } = g,
        ft = s * 0.8,
        run = W / 2 - ft / 2,
        hx = g.hx(run, 1);
      g.L(hx, 1, run + hx, 0, 3);
      g.L(W - hx, 1, W - run - hx, 0, 3);
      if (g.alt === 'lambda') return;
      const y = 0.68,
        xl = hx + run * (1 - y);
      g.L(xl, y, W - xl, y);
    },
  },
  B: {
    w: 0.62,
    draw: (g) => {
      const { l, r, b, h } = g,
        t = h,
        m = 0.47,
        ru = r - 0.04,
        ku = g.R(ru - l, m - t),
        kl = g.R(r - l, b - m);
      g.P([l, t, ru, t, ru, m, l, m], [0, ku, ku, 0], true);
      g.P([l, m, r, m, r, b, l, b], [0, kl, kl, 0], true);
    },
  },
  C: { w: 0.64, sb: [0, -0.05], draw: (g) => cee(g, 0) },
  D: {
    w: 0.66,
    draw: (g) => {
      const { l, r, b, h } = g,
        t = h,
        k = g.R(r - l, b - t),
        ch = (r - l) * 0.3 * Math.max(0, 1 - g.round * 10);
      // a square D cuts its right corners (else it reads as an O)
      if (ch > 0) g.P([l, t, r - ch, t, r, t + ch, r, b - ch, r - ch, b, l, b], 0, true);
      else g.P([l, t, r, t, r, b, l, b], [0, k, k, 0], true);
    },
  },
  E: {
    w: 0.56,
    draw: (g) => {
      const { l, r, b, h } = g;
      g.P([r, h, l, h, l, b, r, b]);
      g.L(l, 0.5, r - 0.05, 0.5);
    },
  },
  F: {
    w: 0.54,
    sb: [0, -0.04],
    draw: (g) => {
      const { l, r, h } = g;
      g.P([r, h, l, h, l, 1], 0, false, 2);
      g.L(l, 0.5, r - 0.06, 0.5);
    },
  },
  G: {
    w: 0.68,
    draw: (g) => {
      const { l, r, b, h, cx } = g,
        t = h,
        k = g.R(r - l, b - t),
        ym = (t + b) / 2;
      g.P([r, ym, r, t, l, t, l, b, r, b, r, 0.52, cx + 0.02, 0.52], [k, k, k, k, 0], false, 0, [
        term(g, ym - t - k, k, 0.5),
        0,
      ]);
    },
  },
  H: {
    w: 0.66,
    draw: (g) => {
      const { l, r, b, h } = g;
      g.L(l, h, l, b);
      g.L(r, h, r, b);
      g.L(l, 0.5, r, 0.5);
    },
  },
  I: { w: 0, draw: (g) => g.L(g.l, g.h, g.l, g.b) },
  J: {
    w: 0.52,
    sb: [-0.03, 0],
    draw: (g) => {
      const { l, r, b, h } = g,
        k = g.R(r - l, b - h);
      g.P([r, h, r, b, l, b, l, Math.min(b - k, 0.68)], [k, k]);
    },
  },
  K: {
    w: 0.64,
    draw: (g) => {
      const { l, W, b, h } = g,
        jy = 0.62,
        hxu = g.hx(W - l - h, jy),
        tx = W - hxu;
      g.L(l, h, l, b);
      g.L(l, jy, tx, 0, 3);
      const ax = l + (tx - l) * 0.4,
        ay = jy * 0.6,
        hxd = g.hx(W - ax, 1 - ay);
      g.L(ax, ay, W - hxd, 1, 2);
    },
  },
  L: {
    w: 0.5,
    sb: [0, -0.05],
    draw: (g) => {
      const { l, r, b, h } = g;
      g.P([l, h, l, b, r, b]);
    },
  },
  M: {
    w: 0.84,
    draw: (g) => {
      const { l, r, b, h, cx } = g;
      g.P([l, b, l, h, cx, g.alt === 'v' ? b : 0.66, r, h, r, b]);
    },
  },
  N: {
    w: 0.68,
    draw: (g) => {
      const { l, r, b, h } = g;
      g.P([l, b, l, h, r, b, r, h]);
    },
  },
  O: { w: 0.72, draw: (g) => bowl(g, 0) },
  P: {
    w: 0.62,
    draw: (g) => {
      const { l, r, b, h } = g,
        t = h,
        m = 0.56,
        k = g.R(r - l, m - t);
      g.P([l, b, l, t, r, t, r, m, l, m], [0, k, k]);
    },
  },
  Q: {
    w: 0.72,
    draw: (g) => {
      bowl(g, 0);
      g.L(g.cx + 0.04, 0.66, g.W, 1.02, 2);
    },
  },
  R: {
    w: 0.64,
    draw: (g) => {
      const { l, r, b, h, W, cx } = g,
        t = h,
        m = 0.54,
        k = g.R(r - l, m - t);
      g.P([l, b, l, t, r, t, r, m, l, m], [0, k, k]);
      if (g.alt === 'straight') g.L(r, m, r, b);
      else g.L(cx - 0.04, m + h * 0.4, W - g.hx(W - cx, 1 - m), 1, 2);
    },
  },
  S: { w: 0.62, draw: (g) => ess(g, 0) },
  T: {
    w: 0.6,
    sb: [-0.04, -0.04],
    draw: (g) => {
      const { l, r, b, h, cx } = g;
      g.L(l, h, r, h);
      g.L(cx, h, cx, b);
    },
  },
  U: {
    w: 0.66,
    draw: (g) => {
      const { l, r, b, h } = g,
        k = g.R(r - l, b - h);
      g.P([l, h, l, b, r, b, r, h], k);
    },
  },
  V: { w: 0.72, sb: [-0.05, -0.05], draw: (g) => vee(g, 0) },
  W: { w: 1, sb: [-0.04, -0.04], draw: (g) => dub(g, 0) },
  X: { w: 0.7, sb: [-0.03, -0.03], draw: (g) => ex(g, 0) },
  Y: {
    w: 0.7,
    sb: [-0.04, -0.04],
    draw: (g) => {
      const { W, b, cx } = g,
        jy = 0.56,
        hx = g.hx(cx, jy);
      g.P([hx, 0, cx, jy, W - hx, 0], 0, false, 3);
      g.L(cx, jy, cx, b);
    },
  },
  Z: { w: 0.62, draw: (g) => zed(g, 0) },
};

const DIGITS: Record<string, Glyph> = {
  0: { w: 0.6, draw: (g) => bowl(g, 0) },
  1: {
    w: 0.4,
    sb: [-0.04, 0],
    draw: (g) => {
      const { l, r, b, h } = g;
      g.P([l, 0.3, r, h, r, b]);
    },
  },
  2: {
    w: 0.6,
    draw: (g) => {
      const { l, r, b, h } = g,
        t = h,
        m = 0.52,
        k = g.R(r - l, m - t);
      g.P([l, t + k, l, t, r, t, r, m, l, m, l, b, r, b], [k, k, k, k * 0.5, 0], false, 0, [term(g, 0, k, 0.3), 0]);
    },
  },
  3: {
    w: 0.6,
    draw: (g) => {
      const { l, r, b, h } = g,
        t = h,
        k = g.R(r - l, (b - t) / 2),
        cut = term(g, 0, k, 0.3);
      g.P([l, t + k, l, t, r, t, r, b, l, b, l, b - k], k, false, 0, [cut, cut]);
      g.L(l + 0.12, 0.5, r, 0.5);
    },
  },
  4: {
    w: 0.62,
    draw: (g) => {
      const { l, r, b, h } = g,
        x4 = r - 0.12,
        y = 0.7;
      g.P([x4, b, x4, h, l, y, r, y]);
    },
  },
  5: {
    w: 0.6,
    draw: (g) => {
      const { l, r, b, h } = g,
        m = 0.47,
        k = g.R(r - l, b - m);
      g.P([r, h, l, h, l, m, r, m, r, b, l, b, l, b - k], [0, 0, k, k, k], false, 0, [0, term(g, 0, k, 0.3)]);
    },
  },
  6: {
    w: 0.6,
    draw: (g) => {
      const { l, r, b, h } = g,
        t = h,
        m = 0.47,
        kt = g.R(r - l, b - t),
        k = g.R(r - l, b - m);
      g.P([r, t + kt, r, t, l, t, l, b, r, b, r, m, l, m], [kt, kt, k, k, k], false, 0, [term(g, 0, kt, 0.4), 0]);
    },
  },
  7: {
    w: 0.58,
    sb: [0, -0.03],
    draw: (g) => {
      const { l, r, h, cx } = g;
      g.P([l, h, r, h, cx - 0.08, 1], 0, false, 2);
    },
  },
  8: {
    w: 0.6,
    draw: (g) => {
      const { l, r, b, h } = g,
        m = 0.47,
        i = 0.03;
      g.P([l + i, h, r - i, h, r - i, m, l + i, m], g.R(r - l - 2 * i, m - h), true);
      g.P([l, m, r, m, r, b, l, b], g.R(r - l, b - m), true);
    },
  },
  9: {
    w: 0.6,
    draw: (g) => {
      const { l, r, b, h } = g,
        t = h,
        m = 0.53,
        kb = g.R(r - l, b - t),
        k = g.R(r - l, m - t);
      g.P([l, b - kb, l, b, r, b, r, t, l, t, l, m, r, m], [kb, kb, k, k, k], false, 0, [term(g, 0, kb, 0.4), 0]);
    },
  },
};

const MARKS: Record<string, Glyph> = {
  ' ': { w: 0.3, fixed: true, draw: () => {} },
  '-': { w: 0.34, draw: (g) => g.L(g.l, 0.6, g.r, 0.6) },
  '/': {
    w: 0.42,
    sb: [-0.03, -0.03],
    draw: (g) => {
      const hx = g.hx(g.W, 1);
      g.L(hx, 1, g.W - hx, 0, 3);
    },
  },
  '.': { w: 0, draw: (g) => g.dot(g.h, 1 - g.h) },
  ':': {
    w: 0,
    draw: (g) => {
      g.dot(g.h, 1 - g.h);
      g.dot(g.h, g.x0 + g.h);
    },
  },
  '·': { w: 0, draw: (g) => g.dot(g.h, 0.58) },
  '+': {
    w: 0.5,
    draw: (g) => {
      const { l, r, cx } = g,
        a = (r - l) / 2;
      g.L(l, 0.6, r, 0.6);
      g.L(cx, 0.6 - a, cx, 0.6 + a);
    },
  },
  '×': {
    w: 0.46,
    draw: (g) => {
      const { l, r } = g,
        y0 = 0.6 - (r - l) / 2,
        y1 = 0.6 + (r - l) / 2;
      g.L(l, y0, r, y1);
      g.L(r, y0, l, y1);
    },
  },
};

const LOWER: Record<string, Glyph> = {
  a: {
    w: 0.6,
    x: true,
    draw: (g) => {
      bowl(g, g.x0);
      if (g.alt === 'open') return;
      g.L(g.r, xt(g), g.r, g.b);
    },
  },
  b: {
    w: 0.6,
    draw: (g) => {
      g.L(g.l, g.h, g.l, g.b);
      bowl(g, g.x0);
    },
  },
  c: { w: 0.54, x: true, sb: [0, -0.05], draw: (g) => cee(g, g.x0) },
  d: {
    w: 0.6,
    draw: (g) => {
      g.L(g.r, g.h, g.r, g.b);
      bowl(g, g.x0);
    },
  },
  e: {
    w: 0.58,
    x: true,
    draw: (g) => {
      const { l, r, b } = g,
        t = xt(g),
        m = (t + b) / 2 + 0.01,
        k = g.R(r - l, b - t);
      g.P([l, m, r, m, r, t, l, t, l, b, r, b, r, m], [0, k, k, k, k], false, 0, [0, term(g, b - m - k, k, 0.5)]);
    },
  },
  f: {
    w: 0.4,
    sb: [-0.02, -0.05],
    draw: (g) => {
      const { l, r, b, h } = g,
        x = l + 0.07,
        k = g.R(r - x, 0.6) * 0.8;
      g.P([r, h, x, h, x, b], [k]);
      g.L(l, xt(g), r - 0.02, xt(g));
    },
  },
  g: {
    w: 0.6,
    desc: true,
    x: true,
    draw: (g) => {
      const { l, r, d } = g,
        k = g.R(r - l, g.b - xt(g));
      bowl(g, g.x0);
      g.P([r, xt(g), r, d, l, d], [k]);
    },
  },
  h: {
    w: 0.6,
    draw: (g) => {
      g.L(g.l, g.h, g.l, g.b);
      arch(g, g.l, g.r, g.x0);
    },
  },
  i: {
    w: 0,
    draw: (g) => {
      g.L(g.l, xt(g), g.l, g.b);
      g.dot(g.l, dotY(g));
    },
  },
  j: {
    w: 0.26,
    desc: true,
    sb: [-0.05, 0],
    draw: (g) => {
      const { l, r, d } = g,
        k = g.R(r - l, 0.5);
      g.P([r, xt(g), r, d, l, d], [k]);
      g.dot(r, dotY(g));
    },
  },
  k: {
    w: 0.56,
    draw: (g) => {
      const { l, W, b, h, x0 } = g,
        jy = x0 + (1 - x0) * 0.64,
        hxu = g.hx(W - l - h, jy - x0),
        tx = W - hxu;
      g.L(l, h, l, b);
      g.cut(x0);
      g.L(l, jy, tx, x0, 3);
      const ax = l + (tx - l) * 0.42,
        ay = jy - (jy - x0) * 0.42,
        hxd = g.hx(W - ax, 1 - ay);
      g.L(ax, ay, W - hxd, 1, 2);
    },
  },
  l: {
    w: 0,
    draw: (g) => {
      if (g.alt !== 'tail') return g.L(g.l, g.h, g.l, g.b);
      const { l, b, h } = g;
      g.P([l, h, l, b, l + 0.14, b], [g.R(0.28, 0.3)]);
    },
  },
  m: {
    w: 0.9,
    x: true,
    draw: (g) => {
      const { l, r, b, cx } = g;
      g.L(l, xt(g), l, b);
      arch(g, l, cx, g.x0);
      arch(g, cx, r, g.x0);
    },
  },
  n: {
    w: 0.6,
    x: true,
    draw: (g) => {
      g.L(g.l, xt(g), g.l, g.b);
      arch(g, g.l, g.r, g.x0);
    },
  },
  o: { w: 0.62, x: true, draw: (g) => bowl(g, g.x0) },
  p: {
    w: 0.6,
    desc: true,
    x: true,
    draw: (g) => {
      g.L(g.l, xt(g), g.l, g.d);
      bowl(g, g.x0);
    },
  },
  q: {
    w: 0.6,
    desc: true,
    x: true,
    draw: (g) => {
      g.L(g.r, xt(g), g.r, g.d);
      bowl(g, g.x0);
    },
  },
  r: {
    w: 0.42,
    x: true,
    sb: [0, -0.05],
    draw: (g) => {
      const { l, r, b } = g,
        t = xt(g),
        k = g.R((r - l) * 2, b - t);
      g.L(l, t, l, b);
      g.P([l, b, l, t, r, t], [k]);
    },
  },
  s: { w: 0.54, x: true, draw: (g) => ess(g, g.x0) },
  t: {
    w: 0.42,
    sb: [-0.02, -0.04],
    draw: (g) => {
      const { l, r, b, h } = g,
        x = l + 0.08,
        k = g.R((r - x) * 2, 0.5);
      g.P([x, 0.12 + h, x, b, r, b], [k]);
      g.L(l, xt(g), r, xt(g));
    },
  },
  u: {
    w: 0.6,
    x: true,
    draw: (g) => {
      const { l, r, b } = g,
        t = xt(g),
        k = g.R(r - l, b - t);
      g.P([l, t, l, b, r, b, r, t], k);
      g.L(r, t, r, b);
    },
  },
  v: { w: 0.6, x: true, sb: [-0.04, -0.04], draw: (g) => vee(g, g.x0) },
  w: { w: 0.86, x: true, sb: [-0.03, -0.03], draw: (g) => dub(g, g.x0) },
  x: { w: 0.58, x: true, sb: [-0.02, -0.02], draw: (g) => ex(g, g.x0) },
  y: {
    w: 0.6,
    desc: true,
    x: true,
    sb: [-0.04, -0.04],
    draw: (g) => {
      const { W, l, r, b, d, x0, cx } = g;
      if (g.alt === 'u') {
        const t = xt(g),
          k = g.R(r - l, b - t);
        g.P([l, t, l, b, r, b], [k]);
        g.P([r, t, r, d, l, d], [k]);
        return;
      }
      const hr = g.hx(W - cx, 1 - x0),
        xr = W - hr,
        slope = (cx - xr) / (1 - x0);
      g.L(xr, x0, xr + slope * (1 + DSC - x0), 1 + DSC, 3);
      const hl = g.hx(cx, 1 - x0);
      g.L(hl, x0, cx, 1 - g.h, 1);
    },
  },
  z: { w: 0.54, x: true, draw: (g) => zed(g, g.x0) },
};

const GLYPHS: Record<string, Glyph> = { ...CAPS, ...DIGITS, ...MARKS, ...LOWER };

/** True when every letter of `text` has a glyph (else the caller sets it in a font). */
export const hasGlyphs = (text: string) => [...text].every((ch) => ch in GLYPHS);

const glyphW = (gl: Glyph, st: TypeStyle) =>
  gl.fixed ? gl.w * st.wide : gl.w === 0 ? st.s : gl.w * st.wide + st.s * 0.6;
const gap = (st: TypeStyle, a: Glyph, b: Glyph) => st.track + 0.05 + st.s * 0.25 + (a.sb?.[1] ?? 0) + (b.sb?.[0] ?? 0);

// ---------------------------------------------------------------- the skeleton paths: straight runs and corner arcs, so an end can be trimmed

type Seg =
  | { arc: false; x0: number; y0: number; x1: number; y1: number; len: number }
  | { arc: true; cx: number; cy: number; r: number; a0: number; a1: number; len: number };

/** The segments through n points, each corner rounded to `rv(k)` (clamped to its legs); `start` / `end` move an open path's ends. */
function path(
  n: number,
  X: (k: number) => number,
  Y: (k: number) => number,
  rv: (k: number) => number,
  closed: boolean,
  start: [number, number] | null,
  end: [number, number] | null,
): Seg[] {
  const segs: Seg[] = [];
  let px = 0,
    py = 0;
  const line = (x: number, y: number) => {
    const len = Math.hypot(x - px, y - py);
    if (len > 1e-9) segs.push({ arc: false, x0: px, y0: py, x1: x, y1: y, len });
    px = x;
    py = y;
  };
  const corner = (k: number) => {
    const bx = X(k),
      by = Y(k);
    let ux = X(k - 1) - bx,
      uy = Y(k - 1) - by,
      vx = X(k + 1) - bx,
      vy = Y(k + 1) - by;
    const l1 = Math.hypot(ux, uy),
      l2 = Math.hypot(vx, vy);
    let r = rv(k);
    if (r <= 1e-9 || l1 < 1e-9 || l2 < 1e-9) return line(bx, by);
    ux /= l1;
    uy /= l1;
    vx /= l2;
    vy /= l2;
    const th = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));
    if (th < 1e-4 || th > Math.PI - 1e-4) return line(bx, by);
    let d = r / Math.tan(th / 2);
    if (d > Math.min(l1, l2)) {
      d = Math.min(l1, l2);
      r = d * Math.tan(th / 2);
    }
    const t1x = bx + ux * d,
      t1y = by + uy * d,
      t2x = bx + vx * d,
      t2y = by + vy * d;
    const mx = ux + vx,
      my = uy + vy,
      ml = Math.hypot(mx, my),
      dc = r / Math.sin(th / 2),
      cx = bx + (mx / ml) * dc,
      cy = by + (my / ml) * dc;
    line(t1x, t1y);
    const a0 = Math.atan2(t1y - cy, t1x - cx);
    let sw = Math.atan2(t2y - cy, t2x - cx) - a0;
    while (sw > Math.PI) sw -= Math.PI * 2;
    while (sw < -Math.PI) sw += Math.PI * 2;
    segs.push({ arc: true, cx, cy, r, a0, a1: a0 + sw, len: r * Math.abs(sw) });
    px = t2x;
    py = t2y;
  };
  if (closed) {
    px = (X(0) + X(1)) / 2;
    py = (Y(0) + Y(1)) / 2;
    const sx = px,
      sy = py;
    for (let k = 1; k <= n; k++) corner(k % n);
    line(sx, sy);
    return segs;
  }
  [px, py] = start ?? [X(0), Y(0)];
  for (let k = 1; k < n - 1; k++) corner(k);
  line(...(end ?? [X(n - 1), Y(n - 1)]));
  return segs;
}

/** Cuts `t0` off the path's start and `t1` off its end (whole segments, then part of one). */
function cutEnds(segs: Seg[], t0: number, t1: number) {
  for (const [fromEnd, t] of [
    [false, t0],
    [true, t1],
  ] as const) {
    let left = t;
    while (segs.length && left > 0) {
      const s = fromEnd ? segs[segs.length - 1]! : segs[0]!;
      if (left >= s.len - 1e-9) {
        left -= s.len;
        if (fromEnd) segs.pop();
        else segs.shift();
        continue;
      }
      const f = left / s.len;
      if (s.arc) {
        if (fromEnd) s.a1 -= (s.a1 - s.a0) * f;
        else s.a0 += (s.a1 - s.a0) * f;
      } else if (fromEnd) {
        s.x1 -= (s.x1 - s.x0) * f;
        s.y1 -= (s.y1 - s.y0) * f;
      } else {
        s.x0 += (s.x1 - s.x0) * f;
        s.y0 += (s.y1 - s.y0) * f;
      }
      s.len -= left;
      left = 0;
    }
  }
}

function emit(c: Ctx, segs: readonly Seg[], closed: boolean) {
  const s0 = segs[0];
  if (!s0) return;
  if (s0.arc) c.moveTo(s0.cx + Math.cos(s0.a0) * s0.r, s0.cy + Math.sin(s0.a0) * s0.r);
  else c.moveTo(s0.x0, s0.y0);
  for (const s of segs) {
    if (s.arc) c.arc(s.cx, s.cy, s.r, s.a0, s.a1, s.a1 < s.a0);
    else c.lineTo(s.x1, s.y1);
  }
  if (closed) c.closePath();
}

/** The width of `text` set in `st`, in cap heights, its lean included. */
export function typeWidth(text: string, st: TypeStyle): number {
  let w = 0,
    prev: Glyph | null = null;
  for (const ch of text) {
    const gl = GLYPHS[ch];
    if (!gl) continue;
    if (prev) w += gap(st, prev, gl);
    w += glyphW(gl, st);
    prev = gl;
  }
  return w + Math.max(0, st.slant);
}

export interface SetOpts {
  /** The accent for the lit letters and dots (null: they take the ink). */
  acc?: string | null;
  lit?: readonly number[] | undefined;
  litDots?: boolean | undefined;
}

/** Sets `text` in `st`: its left end at x, its cap height `cap` px and centred on y. Returns the width in px. */
export function setType(
  c: Ctx,
  text: string,
  st: TypeStyle,
  x: number,
  y: number,
  cap: number,
  ink: string,
  o: SetOpts = {},
): number {
  const soft = st.ends === 'soft',
    x0 = 1 - (st.xh ?? 0.7),
    s = st.s,
    h = s / 2,
    E = s * 2.5;
  c.save();
  c.translate(x, y + cap / 2);
  if (st.slant) c.transform(1, 0, -st.slant, 1, 0, 0);
  c.scale(cap, cap);
  c.translate(0, -1);
  c.lineWidth = s;
  c.lineCap = soft ? 'round' : 'square';
  c.lineJoin = soft ? 'round' : 'miter';
  c.miterLimit = 12;
  let gx = 0,
    prev: Glyph | null = null,
    i = -1;
  for (const ch of text) {
    i++;
    const gl = GLYPHS[ch];
    if (!gl) continue;
    if (prev) gx += gap(st, prev, gl);
    const W = glyphW(gl, st),
      color = o.lit?.includes(i) && o.acc ? o.acc : ink,
      dots: [number, number][] = [];
    c.save();
    c.translate(gx, 0);
    c.beginPath();
    c.rect(0, gl.x ? x0 : 0, W, (gl.desc ? 1 + DSC : 1) - (gl.x ? x0 : 0));
    c.clip();
    c.beginPath();
    c.strokeStyle = color;
    const ext = (ax: number, ay: number, bx: number, by: number): [number, number] => {
      const dx = bx - ax,
        dy = by - ay,
        n = Math.hypot(dx, dy) || 1;
      return [bx + (dx / n) * E, by + (dy / n) * E];
    };
    const g: G = {
      c,
      W,
      s,
      h,
      l: h,
      r: W - h,
      cx: W / 2,
      b: 1 - h,
      x0,
      d: 1 + DSC - h,
      alt: st.alt?.[ch],
      round: st.round,
      R: (bw, bh) => (st.round * Math.max(0, Math.min(bw, bh))) / 2,
      P: (pts, rad = 0, closed = false, e = 0, trim) => {
        const q: number[] = [];
        for (let k = 0; k < pts.length; k += 2) {
          const px = pts[k]!,
            py = pts[k + 1]!,
            n = q.length;
          if (n && Math.abs(q[n - 2]! - px) < 1e-6 && Math.abs(q[n - 1]! - py) < 1e-6) continue;
          q.push(px, py);
        }
        const n = q.length / 2,
          X = (k: number) => q[2 * ((k + n) % n)]!,
          Y = (k: number) => q[2 * ((k + n) % n) + 1]!;
        if (n < 2) return;
        const rv = (k: number) => Math.max(0, typeof rad === 'number' ? rad : (rad[closed ? k : k - 1] ?? 0));
        const segs = path(
          n,
          X,
          Y,
          rv,
          closed,
          e & 1 ? ext(X(1), Y(1), X(0), Y(0)) : null,
          e & 2 ? ext(X(n - 2), Y(n - 2), X(n - 1), Y(n - 1)) : null,
        );
        if (trim && !closed) cutEnds(segs, trim[0], trim[1]);
        emit(c, segs, closed);
      },
      L: (ax, ay, bx, by, e = 0) => g.P([ax, ay, bx, by], 0, false, e),
      hx: (run, rise) => (h * Math.hypot(run, rise)) / Math.max(1e-6, rise),
      dot: (dx, dy) => {
        dots.push([dx, dy]);
      },
      cut: (y) => {
        c.stroke();
        c.beginPath();
        c.rect(-1, y, W + 2, 4);
        c.clip();
        c.beginPath();
      },
    };
    gl.draw(g);
    c.stroke();
    if (dots.length) {
      c.beginPath();
      for (const [dx, dy] of dots) {
        c.moveTo(dx, dy - 0.001);
        c.lineTo(dx, dy + 0.001);
      }
      c.strokeStyle = o.litDots && o.acc ? o.acc : color;
      c.stroke();
    }
    c.restore();
    gx += W;
    prev = gl;
  }
  c.restore();
  return (gx + Math.max(0, st.slant)) * cap;
}
