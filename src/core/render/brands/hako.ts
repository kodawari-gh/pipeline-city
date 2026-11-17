// HAKO, cases (docs/brands/hako.md).
import { at, fill, knock, poly, type Brand } from './kit';

export const hako: Brand = {
  id: 'hako', word: 'HAKO', makes: 'cases',
  idea: 'a box seen from its corner, its top lit and its side vented: a case, nothing more',
  colors: { accent: '#e2eaff', light: '#b9babf', dark: '#1d1e22', plate: '#1d1e22', body: '#2a2d32', trim: '#959aa3' },
  type: { s: 0.065, round: 0, wide: 1.38, slant: 0, track: 0.5 },
  aspect: 0.88, lockup: { cap: 0.36, gap: 0.4 },
  mark: (c, ink, acc) => {
    const cx = 0.44, cy = 0.5, v = Array.from({ length: 6 }, (_, k) => at(cx, cy, 0.5, -Math.PI / 2 + (k * Math.PI) / 3));
    const [t, ur, lr, bt, ll, ul] = v as [number, number][];
    // the side faces, then the vents cut into the right one, then the gaps between the faces
    poly(c, [...ul!, cx, cy, ...bt!, ...ll!]);
    poly(c, [cx, cy, ...ur!, ...lr!, ...bt!]);
    fill(c, ink);
    knock(c, () => {
      // three slots parallel to the face's top edge (it rises 0.577 per unit across)
      const x0 = cx + 0.08, x1 = ur![0] - 0.08, rise = (x1 - x0) * 0.577;
      for (let k = 0; k < 3; k++) { const y = cy + 0.15 + k * 0.1; poly(c, [x0, y, x1, y - rise, x1, y - rise + 0.045, x0, y + 0.045]); }
      c.fill();
    });
    poly(c, [...t!, ...ur!, cx, cy, ...ul!]);
    fill(c, acc);
    knock(c, () => {
      c.moveTo(...ul!); c.lineTo(cx, cy); c.lineTo(...ur!); c.moveTo(cx, cy); c.lineTo(...bt!);
      c.lineWidth = 0.05; c.lineCap = 'butt'; c.stroke();
    });
  },
};
