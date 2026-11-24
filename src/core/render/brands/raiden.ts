// RAIDEN, power supplies (docs/brands/raiden.md).
import { circle, fill, knock, poly, stroke, type Brand, type Ctx } from './kit';

const bolt = (c: Ctx) => poly(c, [0.5, -0.04, 0.84, -0.04, 0.62, 0.4, 0.82, 0.4, 0.3, 1.04, 0.44, 0.56, 0.22, 0.56]);

export const raiden: Brand = {
  id: 'raiden',
  word: 'RAIDEN',
  makes: 'power supplies',
  idea: 'the thunder drum struck: a lit bolt breaking through its ring',
  colors: { accent: '#ffc247', light: '#e2eaff', dark: '#131518', plate: '#131518', body: '#1d1e22', trim: '#4e5360' },
  type: { s: 0.16, round: 0.08, wide: 0.88, slant: 0.2, track: 0.07 },
  aspect: 1.0,
  lockup: { cap: 0.5, gap: 0.28 },
  mark: (c, ink, acc) => {
    circle(c, 0.52, 0.5, 0.42);
    stroke(c, ink, 0.12);
    knock(c, () => {
      bolt(c);
      c.fill();
      c.lineWidth = 0.14;
      c.lineJoin = 'miter';
      c.stroke();
    });
    bolt(c);
    fill(c, acc);
  },
};
