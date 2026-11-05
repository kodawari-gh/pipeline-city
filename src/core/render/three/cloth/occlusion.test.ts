import { describe, expect, it } from 'vitest';
import { occlusion } from './occlusion';
import { floor } from './solid';

/** Square sheets of `k` × `k` points 200 mm wide, level at each height in `ys`, their normals up. */
function sheets(ys: readonly number[], k = 9) {
  const pos: number[] = [], nrm: number[] = [], tris: number[] = [];
  for (const y of ys) {
    const o = pos.length / 3;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) { pos.push(-100 + (200 * i) / (k - 1), y, -100 + (200 * j) / (k - 1)); nrm.push(0, 1, 0); }
    // (z, then x) round each corner: the face's normal is up
    for (let j = 0; j < k - 1; j++) for (let i = 0; i < k - 1; i++) {
      const a = o + i + k * j;
      tris.push(a, a + k, a + 1, a + 1, a + k, a + k + 1);
    }
  }
  const n = pos.length / 3;
  return { pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), tris: Uint32Array.from(tris), weld: Int32Array.from({ length: n }, (_, i) => i) };
}

const far = () => 1e6;
/** The middle point of the sheet `s` (of 9 × 9). */
const mid = (s: number) => 81 * s + 40;

describe('cloth occlusion', () => {
  it('leaves a lone sheet open on both sides', () => {
    const s = sheets([500]), ao = occlusion(s.pos, s.nrm, s.tris, s.weld, far, 32, 40);
    expect(ao[2 * mid(0)]).toBeCloseTo(1, 5);
    expect(ao[2 * mid(0) + 1]).toBeCloseTo(1, 5);
  });

  it('shuts the sides two close layers turn to each other, and less as they part', () => {
    const near = sheets([500, 505]), apart = sheets([500, 520]);
    const a = occlusion(near.pos, near.nrm, near.tris, near.weld, far, 32, 40), b = occlusion(apart.pos, apart.nrm, apart.tris, apart.weld, far, 32, 40);
    // the lower sheet's top and the upper sheet's underside face each other; the lower sheet's underside is open
    expect(a[2 * mid(0)]).toBeLessThan(0.2);
    expect(a[2 * mid(1) + 1]).toBeLessThan(0.2);
    expect(a[2 * mid(0) + 1]).toBeCloseTo(1, 5);
    expect(b[2 * mid(0)]).toBeGreaterThan(a[2 * mid(0)]!);
    expect(b[2 * mid(0)]).toBeLessThan(0.8);
  });

  it('does not count cloth nearer than the skin, and counts farther cloth as before', () => {
    const near = sheets([500, 502]), apart = sheets([500, 520]);
    const bare = occlusion(near.pos, near.nrm, near.tris, near.weld, far, 32, 40), skin = occlusion(near.pos, near.nrm, near.tris, near.weld, far, 32, 40, 4);
    expect(bare[2 * mid(0)]).toBeLessThan(0.2);
    // only the rays that graze the layer meet it beyond the skin
    expect(skin[2 * mid(0)]).toBeGreaterThan(0.6);
    const a = occlusion(apart.pos, apart.nrm, apart.tris, apart.weld, far, 32, 40), b = occlusion(apart.pos, apart.nrm, apart.tris, apart.weld, far, 32, 40, 4);
    expect(b[2 * mid(0)]).toBe(a[2 * mid(0)]);
  });

  it('shuts the side that lies on the solid', () => {
    const s = sheets([3]), ao = occlusion(s.pos, s.nrm, s.tris, s.weld, floor(0), 32, 40);
    expect(ao[2 * mid(0) + 1]).toBeLessThan(0.1);
    expect(ao[2 * mid(0)]).toBeCloseTo(1, 5);
  });

  it('gives welded points one value', () => {
    const s = sheets([500, 505]);
    s.weld[mid(1)] = mid(0);
    s.pos.set(s.pos.subarray(3 * mid(0), 3 * mid(0) + 3), 3 * mid(1));
    const ao = occlusion(s.pos, s.nrm, s.tris, s.weld, far, 16, 40);
    expect(ao[2 * mid(1)]).toBe(ao[2 * mid(0)]);
    expect(ao[2 * mid(1) + 1]).toBe(ao[2 * mid(0) + 1]);
  });
});
