// kura, drives (docs/brands/kura.md).
import { fill, poly, type Brand } from './kit';

export const kura: Brand = {
  id: 'kura',
  word: 'kura',
  makes: 'drives',
  idea: 'a kura (a storehouse) built of stacked layers, the one being written lit: what goes in is kept',
  colors: { accent: '#9ab8ff', light: '#e2eaff', dark: '#0a0e22', plate: '#0d1636', body: '#4e5360', trim: '#959aa3' },
  type: { s: 0.2, round: 1, wide: 1.0, slant: 0, track: 0.03, xh: 0.72 },
  aspect: 1.0,
  lockup: { cap: 0.6, gap: 0.26 },
  mark: (c, ink, acc) => {
    const box = (y0: number, y1: number) => poly(c, [0.1, y0, 0.9, y0, 0.9, y1, 0.1, y1]);
    // the ridge over a heavy hip roof, its eaves running past the walls
    poly(c, [0.27, 0, 0.73, 0, 0.73, 0.06, 0.27, 0.06]);
    poly(c, [0.34, 0.06, 0.66, 0.06, 1.0, 0.27, 1.0, 0.33, 0.0, 0.33, 0.0, 0.27]);
    // the store: three layers, the base the heaviest
    box(0.38, 0.55);
    box(0.82, 1.0);
    fill(c, ink);
    box(0.6, 0.77);
    fill(c, acc);
  },
};
