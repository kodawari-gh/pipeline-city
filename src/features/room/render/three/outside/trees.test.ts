// The trees' triangle caps (docs/3D_STYLE.md "Asset standard", ASR2): a tree in each ring of detail stays under its cap, and a farther
// ring never costs more than a nearer one.
import { describe, expect, it } from 'vitest';
import type { Tree } from './plan';
import { RINGS, TREE_CAPS, treeTriangles } from './trees';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const AWAY = [RINGS[0] - 1, RINGS[1] - 1, RINGS[2] - 1, RINGS[2] + 1];

describe("the trees' triangle caps", () => {
  it("holds each ring's cap for every kind, height and seed", async ({ annotate }) => {
    let worst = [0, 0, 0, 0];
    for (const kind of ['plane', 'lime', 'shrub'] as const) {
      for (const h of [5, 9, 14]) {
        for (let seed = 1; seed <= 40; seed++) {
          const t: Tree = { x: 0, z: 0, kind, h, seed: seed * 7919 };
          const n = AWAY.map((a) => treeTriangles(t, a));
          for (const [i, v] of n.entries()) {
            expect(v, `${kind} h${h} seed ${seed} ring ${i}`).toBeLessThanOrEqual(must(TREE_CAPS[i]));
          }
          for (let i = 1; i < n.length; i++) {
            expect(must(n[i]), `${kind} ring ${i} against ring ${i - 1}`).toBeLessThanOrEqual(must(n[i - 1]));
          }
          worst = worst.map((w, i) => Math.max(w, must(n[i])));
        }
      }
    }
    await annotate(`trees: the most triangles per ring ${worst.join(' / ')} (caps ${TREE_CAPS.join(' / ')})`);
  });
});
