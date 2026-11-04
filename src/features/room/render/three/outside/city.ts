// The land round the city (`view.ts` sees it past the last blocks): flat and grey under the city's edge, suburbs and fields beyond, hills
// rising from five kilometres to wooded ridges at nine to eleven, hazed by the fog. One mesh in vertex colours.
import { BufferGeometry, Color, Float32BufferAttribute, Mesh } from 'three';
import type { Kit } from './kit';

const smooth = (a: number, b: number, v: number): number => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The land: a polar heightfield round the view, from the city's edge out to 11 km, coloured by height and patch. */
export function land(k: Kit): Mesh {
  const A = 160, R = 56, spread = 1.75;
  const hash = (i: number, j: number) => { const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return v - Math.floor(v); };
  const noise = (x: number, y: number) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (hash(i, j) * (1 - u) + hash(i + 1, j) * u) * (1 - v) + (hash(i, j + 1) * (1 - u) + hash(i + 1, j + 1) * u) * v;
  };
  const fbm = (x: number, y: number) => noise(x, y) * 0.55 + noise(x * 2.1, y * 2.1) * 0.28 + noise(x * 4.3, y * 4.3) * 0.17;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const city = new Color(0x5d6064), sub = new Color(0x6f7369), field = [new Color(0x7f8c4f), new Color(0x8f9258), new Color(0x6c8547)], wood = new Color(0x3d5636), high = new Color(0x56664f);
  for (let j = 0; j <= R; j++) {
    const rad = 3000 * Math.pow(12000 / 3000, j / R);
    for (let i = 0; i <= A; i++) {
      const a = Math.PI - spread + (2 * spread * i) / A, x = Math.sin(a) * rad, z = Math.cos(a) * rad, px = a * 9, py = rad / 1400;
      const hill = smooth(5600, 8500, rad) * (120 + 380 * fbm(px * 0.7, py * 0.6)) + smooth(8500, 11000, rad) * 200 * fbm(px * 1.3 + 5, py);
      pos.push(x, hill - 0.3, z);
      const patch = field[Math.floor(hash(Math.floor(px * 3), Math.floor(py * 6)) * 3)]!;
      const c = rad < 4800 ? city.clone().lerp(sub, smooth(3800, 4800, rad)) : patch.clone().lerp(wood, smooth(0.45, 0.65, fbm(px * 2, py * 2)) * 0.8 + smooth(5600, 8000, rad) * 0.5);
      if (rad < 5800) c.lerp(sub, 1 - smooth(4800, 5800, rad));
      if (rad > 8000) c.lerp(high, smooth(8000, 11000, rad) * 0.6);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < A; i++) {
    const a = j * (A + 1) + i, b = a + A + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new Mesh(g, k.land);
}
