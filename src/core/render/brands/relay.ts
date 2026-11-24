// relay, network cards and routers (docs/brands/relay.md).
import { fill, knock, poly, type Brand, type Ctx } from './kit';

const chev = (c: Ctx, x: number) => poly(c, [x, 0.0, x + 0.3, 0.0, x + 0.64, 0.5, x + 0.3, 1.0, x, 1.0, x + 0.34, 0.5]);

export const relay: Brand = {
  id: 'relay',
  word: 'relay',
  makes: 'network cards and routers',
  idea: 'the hand-off: one chevron passes the signal to the next, lit one',
  colors: { accent: '#ffc27d', light: '#e2eaff', dark: '#0a0e22', plate: '#16294d', body: '#16294d', trim: '#959aa3' },
  type: { s: 0.17, round: 0.5, wide: 1.0, slant: 0.12, track: 0.02, xh: 0.72 },
  aspect: 1.2,
  lockup: { cap: 0.6, gap: 0.24 },
  mark: (c, ink, acc) => {
    chev(c, 0.0);
    fill(c, ink);
    // the lit chevron overlaps the first one's point: a gap cut round it, so it reads as passing over
    knock(c, () => {
      chev(c, 0.5);
      c.fill();
      c.lineWidth = 0.12;
      c.lineJoin = 'miter';
      c.stroke();
    });
    chev(c, 0.5);
    fill(c, acc);
  },
};
