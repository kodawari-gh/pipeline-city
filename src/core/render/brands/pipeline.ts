// PIPELINE CITY, the game itself: the OS splash, the screen on standby, the city's signs (docs/brands/pipeline.md).
import { circle, fill, knock, poly, stroke, type Brand } from './kit';

export const pipeline: Brand = {
  id: 'pipeline',
  word: 'PIPELINE CITY',
  makes: 'the game (OS splash, standby screen, city signs)',
  idea: 'a P routed as a board trace: 45° bends, a pad at its foot, a lit via at its end',
  colors: { accent: '#a68bff', light: '#e2eaff', dark: '#0a0e22', plate: '#0a0e22', body: '#0d1636', trim: '#b9babf' },
  type: { s: 0.12, round: 0.3, wide: 1.1, slant: 0, track: 0.15 },
  aspect: 0.8,
  lockup: { cap: 0.42, gap: 0.3 },
  mark: (c, ink, acc) => {
    const w = 0.15,
      vx = 0.4,
      vy = 0.6;
    // the trace: up the stem, a 45° bend, across, down round the bowl, back to the via
    c.moveTo(0.16, 0.86);
    c.lineTo(0.16, 0.24);
    c.lineTo(0.28, 0.12);
    c.lineTo(0.56, 0.12);
    c.lineTo(0.7, 0.26);
    c.lineTo(0.7, 0.46);
    c.lineTo(0.56, vy);
    c.lineTo(vx, vy);
    stroke(c, ink, w, 'butt', 'miter');
    // the pad at the foot
    poly(c, [0.04, 0.84, 0.28, 0.84, 0.28, 1, 0.04, 1]);
    fill(c, ink);
    // the via: a gap round it, a lit ring, a drilled hole
    knock(c, () => {
      circle(c, vx, vy, 0.15);
      c.fill();
    });
    circle(c, vx, vy, 0.105);
    circle(c, vx, vy, 0.045);
    fill(c, acc);
  },
};
