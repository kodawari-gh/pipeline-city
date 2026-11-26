// The paper lanterns' washi (`washiTex`, `washiShade`), the side of the bedside lantern (`lanternProfile`, `thinIndices`) and a lantern's bulb.
import { Color, DoubleSide, Mesh, SphereGeometry, Vector2 } from 'three';
import { SEG, paint } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough } from '@/core/render/three/pick';
import { LANTERN, OPAL } from '../palette';
import { rnd } from './seed';
import type { Group, MeshStandardMaterial, Texture, V3 } from './types';

/** A point for a missing one (none is: each index below is in range). */
const ORIGIN = new Vector2();

/** The lantern's bamboo ribs: rings evenly up its paper (by length along its side). */
export const RIBS = 16;
/**
 * Washi paper: long fibres in it, the lantern's ribs dark rings round it (they shade the light from inside), a faint paste line at each. `lit`
 * (0 at the paper's foot, 1 at its top) darkens it away from the bulb: the glow of a tall lantern, brightest at the bulb's height.
 */
export function washiTex(lit?: (v: number) => number, r: () => number = rnd): Texture | null {
  return paint(
    256,
    512,
    (c, w, h) => {
      c.fillStyle = '#ddd6c6';
      c.fillRect(0, 0, w, h);
      for (let k = 0; k < 900; k++) {
        c.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.08})`;
        c.fillRect(r() * w, r() * h, 1, 4 + r() * 14);
      }
      for (let k = 0; k < 160; k++) {
        c.fillStyle = `rgba(120,100,70,${0.03 + r() * 0.04})`;
        c.fillRect(r() * w, r() * h, 1, 6 + r() * 20);
      }
      for (let k = 0; k <= RIBS; k++) {
        const y = (k * h) / RIBS;
        c.fillStyle = 'rgba(150,130,100,0.18)';
        c.fillRect(0, y - 6, w, 12);
        c.fillStyle = 'rgba(62,50,36,0.6)';
        c.fillRect(0, y - 1.5, w, 3);
      }
      if (!lit) {
        return;
      }
      // (the canvas's top is the paper's top)
      c.globalCompositeOperation = 'multiply';
      for (let y = 0; y < h; y++) {
        const k = Math.round(255 * lit(1 - (y + 0.5) / h));
        c.fillStyle = `rgb(${k},${k},${k})`;
        c.fillRect(0, y, w, 1);
      }
    },
    [1, 1],
  );
}

/** A lantern's paper (`washiTex`): `map` its look, `lit` its glow (its bulb sets how bright). Seen from inside too. */
export function washiShade(map: Texture | null, lit: Texture | null): MeshStandardMaterial {
  return mat(0xff_ff_ff, {
    map,
    roughness: 0.9,
    side: DoubleSide,
    emissive: new Color(LANTERN),
    emissiveMap: lit,
    emissiveIntensity: 0,
  });
}

/** A lantern's bulb at `at`: an opal sphere whose glow (returned) the evening sets. It lets the light through: it casts no shadow. */
export function lanternBulb(g: Group, at: V3): MeshStandardMaterial {
  const glow = mat(OPAL, { roughness: 0.4, emissive: new Color(LANTERN), emissiveIntensity: 0 });
  const bulb = new Mesh(new SphereGeometry(420, SEG.roundCap, SEG.ringsBulb), glow);
  bulb.position.set(...at);
  g.add(seeThrough(bulb));
  return glow;
}

/**
 * The lantern's side, bottom opening to top: a round a little squat (a superellipse, wider than tall, not an egg), resampled evenly along its
 * length so the ribs fall on the paper's rings; between each two ribs the paper sags a little toward the middle.
 */
export function lanternProfile(R: number, H: number, ends: { rBottom: number; rTop: number }): Vector2[] {
  const e = 2.6,
    f = (t: number) =>
      new Vector2(
        R * Math.abs(Math.cos(t)) ** (2 / e),
        (H / 2) * (1 + Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** (2 / e)),
      );
  const t0 = -Math.acos((ends.rBottom / R) ** (e / 2)),
    t1 = Math.acos((ends.rTop / R) ** (e / 2)),
    fine: Vector2[] = [],
    len: number[] = [];
  let run = 0;
  for (let i = 0; i <= 600; i++) {
    const p = f(t0 + ((t1 - t0) * i) / 600),
      last = fine.at(-1);
    if (last) {
      run += p.distanceTo(last);
    }
    fine.push(p);
    len.push(run);
  }
  const out: Vector2[] = [],
    n = RIBS * 8,
    mid = new Vector2(0, H / 2),
    total = len[600] ?? 0,
    lenAt = (i: number) => len[i] ?? 0,
    ptAt = (i: number) => fine[i] ?? ORIGIN;
  for (let k = 0, j = 0; k <= n; k++) {
    const s = (total * k) / n;
    while (j < 599 && lenAt(j + 1) < s) {
      j++;
    }
    const p = ptAt(j)
      .clone()
      .lerp(ptAt(j + 1), (s - lenAt(j)) / Math.max(1e-6, lenAt(j + 1) - lenAt(j)));
    out.push(
      p
        .sub(mid)
        .multiplyScalar(1 - 0.016 * Math.sin((Math.PI * (k % 8)) / 8))
        .add(mid),
    );
  }
  return out;
}

/**
 * The indices of the `keep` profile points that bend the line most: each step drops the point whose triangle with its two neighbours is
 * smallest (a near-straight run), so the two ends (the rims) always stay.
 */
export function thinIndices(pts: Vector2[], keep: number): number[] {
  const idx = pts.map((_, i) => i);
  const at = (k: number): Vector2 => pts[idx[k] ?? 0] ?? ORIGIN;
  while (idx.length > keep) {
    let best = 1,
      bestArea = Infinity;
    for (let k = 1; k < idx.length - 1; k++) {
      const a = at(k - 1),
        b = at(k),
        c = at(k + 1);
      const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
      if (area < bestArea) {
        bestArea = area;
        best = k;
      }
    }
    idx.splice(best, 1);
  }
  return idx;
}
