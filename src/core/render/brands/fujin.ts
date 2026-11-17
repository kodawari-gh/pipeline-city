// FUJIN, coolers, fans and radiators (docs/brands/fujin.md).
import { TAU, at, circle, fill, type Brand, type Ctx } from './kit';

/**
 * One tomoe's tail (a comma of the mitsudomoe crest): a band that leaves the head (radius `hr`, at radius `rh` and angle `a`) as wide as it,
 * sweeps `sweep` radians round and out toward the rim `R`, and thins to a point.
 */
function tail(c: Ctx, cx: number, cy: number, a: number, R: number, rh: number, hr: number, sweep: number) {
  const N = 48, mid = (u: number) => rh + (R - 0.02 - rh) * (1 - (1 - u) ** 2), half = (u: number) => hr * (1 - u) ** 1.1;
  for (let i = 0; i <= N; i++) {
    const u = i / N, [x, y] = at(cx, cy, mid(u) + half(u), a + sweep * u);
    if (i) c.lineTo(x, y); else c.moveTo(x, y);
  }
  for (let i = N; i >= 0; i--) {
    const u = i / N, [x, y] = at(cx, cy, mid(u) - half(u), a + sweep * u);
    c.lineTo(x, y);
  }
  c.closePath();
}

export const fujin: Brand = {
  id: 'fujin', word: 'FUJIN', makes: 'coolers, fans and radiators',
  idea: 'the wind god\'s crest: three tomoe chasing round a lit hub',
  colors: { accent: '#8fd9e6', light: '#b9babf', dark: '#0a0e22', plate: '#0a0e22', body: '#4e5360', trim: '#c0793a' },
  type: { s: 0.11, round: 0.55, wide: 1.32, slant: 0, track: 0.24 },
  aspect: 1.0, lockup: { cap: 0.42, gap: 0.34 },
  mark: (c, ink, acc) => {
    const rh = 0.25, hr = 0.13;
    for (let k = 0; k < 3; k++) {
      // each tomoe: its tail and its head, filled apart (they overlap)
      const a = -Math.PI / 2 + (k * TAU) / 3, [hx, hy] = at(0.5, 0.5, rh, a);
      tail(c, 0.5, 0.5, a, 0.5, rh, hr, 2.6); fill(c, ink);
      circle(c, hx, hy, hr); fill(c, ink);
    }
    circle(c, 0.5, 0.5, 0.055); fill(c, acc);
  },
};
