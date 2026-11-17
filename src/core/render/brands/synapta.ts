// synapta, neural accelerators (docs/brands/synapta.md).
import { circle, fill, type Brand } from './kit';

export const synapta: Brand = {
  id: 'synapta', word: 'synapta', makes: 'neural accelerators',
  idea: 'a synapse: two nerve ends and the lit signal crossing the gap',
  colors: { accent: '#a68bff', light: '#e2eaff', dark: '#0a0e22', plate: '#0a0e22', body: '#2a2d32', trim: '#959aa3' },
  type: { s: 0.085, round: 1, wide: 1.06, slant: 0, track: 0.12, ends: 'soft', xh: 0.68 },
  aspect: 1.5, lockup: { cap: 0.56, gap: 0.3 },
  mark: (c, ink, acc) => {
    // two nerve ends: half discs, their flat faces (the membranes) turned to each other
    c.moveTo(0.56, 0.06); c.arc(0.56, 0.5, 0.44, -Math.PI / 2, Math.PI / 2, true); c.closePath();
    c.moveTo(0.94, 0.06); c.arc(0.94, 0.5, 0.44, -Math.PI / 2, Math.PI / 2); c.closePath();
    fill(c, ink);
    // the signal in the cleft: three lit quanta, the middle one largest
    circle(c, 0.75, 0.5, 0.07); circle(c, 0.75, 0.27, 0.04); circle(c, 0.75, 0.73, 0.04);
    fill(c, acc);
  },
};
