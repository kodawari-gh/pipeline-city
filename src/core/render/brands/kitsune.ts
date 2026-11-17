// KITSUNE, motherboards (docs/brands/kitsune.md).
import { fill, knock, poly, type Brand, type Ctx } from './kit';

const eyes = (c: Ctx) => {
  poly(c, [0.22, 0.5, 0.43, 0.6, 0.41, 0.66, 0.25, 0.6]);
  poly(c, [0.78, 0.5, 0.57, 0.6, 0.59, 0.66, 0.75, 0.6]);
};

export const kitsune: Brand = {
  id: 'kitsune', word: 'KITSUNE', makes: 'motherboards',
  idea: 'a fox mask with lit eyes: the clever one that connects everything',
  colors: { accent: '#ff55dc', light: '#e2eaff', dark: '#131518', plate: '#131518', body: '#131518', trim: '#d4af5f' },
  type: { s: 0.15, round: 0.3, wide: 1.02, slant: 0, track: 0.13 },
  aspect: 1.0, lockup: { cap: 0.46, gap: 0.3 },
  mark: (c, ink, acc) => {
    // the mask: tall ears, wide cheeks, a pointed muzzle
    poly(c, [0.5, 1.0, 0.36, 0.86, 0.08, 0.62, 0.0, 0.38, 0.08, 0.0, 0.38, 0.24, 0.62, 0.24, 0.92, 0.0, 1.0, 0.38, 0.92, 0.62, 0.64, 0.86]);
    fill(c, ink);
    knock(c, () => {
      // the inner ears and the brow's line
      poly(c, [0.14, 0.14, 0.32, 0.29, 0.14, 0.4]);
      poly(c, [0.86, 0.14, 0.68, 0.29, 0.86, 0.4]);
      poly(c, [0.47, 0.3, 0.53, 0.3, 0.5, 0.44]);
      // the eyes' sockets (the lit eyes go in them with a margin)
      eyes(c); c.fill(); c.lineWidth = 0.08; c.lineJoin = 'miter'; c.stroke();
      // the snout's line
      poly(c, [0.44, 0.84, 0.56, 0.84, 0.5, 0.9]);
      c.fill();
    });
    eyes(c); fill(c, acc);
  },
};
