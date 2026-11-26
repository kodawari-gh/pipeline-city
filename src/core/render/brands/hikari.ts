// hikari, monitors (docs/brands/hikari.md).
import { fill, knock, poly } from './kit';
import type * as kitTypes from './kit';

export const hikari: kitTypes.Brand = {
  id: 'hikari',
  word: 'hikari',
  makes: 'monitors',
  idea: 'first light: a sun rising over the horizon, read in scan lines, its rim lit',
  colors: { accent: '#3be3ff', light: '#e2eaff', dark: '#131518', plate: '#04060f', body: '#131518', trim: '#4e5360' },
  type: { s: 0.1, round: 1, wide: 1, slant: 0, track: 0.11, ends: 'soft', xh: 0.66, litDots: true },
  aspect: 1.36,
  lockup: { cap: 0.58, gap: 0.28 },
  mark: (c, ink, acc) => {
    const W = 1.36,
      cx = W / 2,
      cy = 0.8,
      R = 0.62,
      rim = 0.32;
    const sun = (y0: number, y1: number, color: string) => {
      c.save();
      c.beginPath();
      c.rect(0, y0, W, y1 - y0);
      c.clip();
      c.beginPath();
      c.moveTo(cx - R, cy);
      c.arc(cx, cy, R, Math.PI, Math.PI * 2);
      c.closePath();
      fill(c, color);
      c.restore();
      c.beginPath();
    };
    // the sun's rim, lit; below it the sun in scan lines, the gaps widening toward the horizon
    sun(0, rim, acc);
    sun(rim + 0.04, 1, ink);
    knock(c, () => {
      for (const [y, h] of [
        [0.47, 0.045],
        [0.59, 0.05],
        [0.7, 0.055],
      ] as const) {
        c.rect(0, y, W, h);
      }
      c.fill();
    });
    // the horizon
    poly(c, [0, 0.86, W, 0.86, W, 0.92, 0, 0.92]);
    fill(c, ink);
  },
};
