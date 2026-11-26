// AXIOM, processors and chipsets (docs/brands/axiom.md).
import { fill, knock, poly } from './kit';
import type * as kitTypes from './kit';

export const axiom: kitTypes.Brand = {
  id: 'axiom',
  word: 'AXIOM',
  makes: 'processors and chipsets',
  idea: 'a delta with its apex lit: the first principle everything else rests on',
  colors: { accent: '#3be3ff', light: '#e2eaff', dark: '#0a0e22', plate: '#0d1636', body: '#959aa3', trim: '#b9babf' },
  type: { s: 0.15, round: 0.22, wide: 1.28, slant: 0, track: 0.16, alt: { A: 'lambda' } },
  aspect: 1.08,
  lockup: { cap: 0.5, gap: 0.34 },
  mark: (c, ink, acc) => {
    const ax = 0.54,
      k = 0.54,
      cap = 0.29,
      gap = 0.075;
    // the delta: two legs round a deep counter, their feet cut flat
    poly(c, [ax, 0, 1.08, 1, 0.8, 1, ax, 0.5, 0.28, 1, 0, 1]);
    fill(c, ink);
    // the apex: cut off the delta, then lit
    knock(c, () => {
      c.rect(-0.1, -0.1, 1.3, 0.1 + cap + gap);
      c.fill();
    });
    poly(c, [ax, 0, ax + k * cap, cap, ax - k * cap, cap]);
    fill(c, acc);
  },
};
