// KAIJU, memory (docs/brands/kaiju.md).
import { fill } from './kit';
import type * as kitTypes from './kit';

/** A claw slash: a curved blade from its point (x0, y0) to its tail (x1, y1), `w` wide at its belly, bowed by `bow`. */
function slash(c: kitTypes.Ctx, x0: number, y0: number, x1: number, y1: number, w: number, bow: number) {
  const mx = (x0 + x1) / 2,
    my = (y0 + y1) / 2,
    dx = x1 - x0,
    dy = y1 - y0,
    n = Math.hypot(dx, dy),
    nx = -dy / n,
    ny = dx / n;
  const bx = mx + nx * bow,
    by = my + ny * bow;
  c.moveTo(x0, y0);
  c.quadraticCurveTo(bx + nx * w, by + ny * w, x1, y1);
  c.quadraticCurveTo(bx - nx * w * 0.2, by - ny * w * 0.2, x0, y0);
  c.closePath();
}

export const kaiju: kitTypes.Brand = {
  id: 'kaiju',
  word: 'KAIJU',
  makes: 'memory',
  idea: 'three claw marks torn through the metal, the middle one still glowing',
  colors: { accent: '#ff5a78', light: '#e2eaff', dark: '#131518', plate: '#1d1e22', body: '#2a2d32', trim: '#4e5360' },
  type: { s: 0.23, round: 0.12, wide: 1, slant: 0.24, track: 0.03 },
  aspect: 1,
  lockup: { cap: 0.52, gap: 0.26 },
  mark: (c, ink, acc) => {
    slash(c, 0.4, 0.06, 0.04, 0.9, 0.17, -0.05);
    slash(c, 0.97, 0.12, 0.6, 0.98, 0.17, -0.05);
    fill(c, ink);
    slash(c, 0.71, 0, 0.31, 1, 0.2, -0.06);
    fill(c, acc);
  },
};
