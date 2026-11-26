// SIGIL, security modules (docs/brands/sigil.md).
import { at, circle, fill, knock, poly } from './kit';
import type * as kitTypes from './kit';

const hex = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, k) => at(cx, cy, r, -Math.PI / 2 + (k * Math.PI) / 3)).flat();

/** The keyhole as a sub-path: a round head over a tapered slot. */
function keyhole(c: kitTypes.Ctx, x: number) {
  circle(c, x, 0.42, 0.12);
  poly(c, [x - 0.05, 0.46, x + 0.05, 0.46, x + 0.085, 0.75, x - 0.085, 0.75]);
}

export const sigil: kitTypes.Brand = {
  id: 'sigil',
  word: 'SIGIL',
  makes: 'security modules',
  idea: 'a seal with a lit keyhole: a hexagon that only one key opens',
  colors: { accent: '#6dffa6', light: '#e2eaff', dark: '#131518', plate: '#131518', body: '#173d29', trim: '#d4af5f' },
  type: { s: 0.12, round: 0, wide: 1.1, slant: 0, track: 0.34 },
  aspect: 0.88,
  lockup: { cap: 0.44, gap: 0.36 },
  mark: (c, ink, acc) => {
    const x = 0.44;
    poly(c, hex(x, 0.5, 0.5));
    fill(c, ink);
    // the seal's inner line, cut in
    knock(c, () => {
      poly(c, hex(x, 0.5, 0.405));
      c.lineWidth = 0.035;
      c.lineJoin = 'miter';
      c.stroke();
    });
    // the keyhole: cut with a margin, then lit
    knock(c, () => {
      keyhole(c, x);
      c.fill();
      c.lineWidth = 0.11;
      c.lineJoin = 'round';
      c.stroke();
    });
    keyhole(c, x);
    c.fillStyle = acc;
    c.fill();
    c.beginPath();
  },
};
