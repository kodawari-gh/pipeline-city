// OCULA, graphics cards (docs/brands/ocula.md).
import { circle, fill, knock, type Brand } from './kit';

export const ocula: Brand = {
  id: 'ocula',
  word: 'OCULA',
  makes: 'graphics cards',
  idea: 'an eye that renders: a lens with a lit pupil, looking ahead',
  colors: { accent: '#a8ff55', light: '#e2eaff', dark: '#131518', plate: '#131518', body: '#1d1e22', trim: '#4e5360' },
  type: { s: 0.22, round: 0.72, wide: 1.04, slant: 0.2, track: 0.04 },
  aspect: 1.56,
  lockup: { cap: 0.52, gap: 0.3 },
  mark: (c, ink, acc) => {
    // the lens: two arcs meeting in sharp corners, the lower one flatter (the eye looks ahead, not up)
    c.moveTo(0, 0.56);
    c.quadraticCurveTo(0.7, -0.5, 1.56, 0.44);
    c.quadraticCurveTo(0.86, 1.42, 0, 0.56);
    c.closePath();
    fill(c, ink);
    const x = 0.86,
      y = 0.5;
    // a gap ring, the iris, the pupil's socket, the lit pupil
    knock(c, () => {
      circle(c, x, y, 0.33);
      c.fill();
    });
    circle(c, x, y, 0.255);
    fill(c, ink);
    knock(c, () => {
      circle(c, x, y, 0.135);
      c.fill();
    });
    circle(c, x, y, 0.085);
    fill(c, acc);
    // a glint cut into the iris, upper left
    knock(c, () => {
      circle(c, x - 0.15, y - 0.14, 0.045);
      c.fill();
    });
  },
};
