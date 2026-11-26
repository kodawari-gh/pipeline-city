import { Material, Mesh } from 'three';
import type * as threeTypes from 'three';
import { describe, expect, it } from 'vitest';
import { pothos } from './plants3d';

/** Whether an object is a mesh. */
const isMesh = (o: unknown): o is Mesh => o instanceof Mesh;

const matsOf = (o: threeTypes.Object3D) => {
  const s = new Set<Material>();
  o.traverse((x) => {
    if (isMesh(x) && x.material instanceof Material) {
      s.add(x.material);
    }
  });
  return s;
};
const plant = () =>
  matsOf(
    pothos(0, 0, 0, 1000, [
      { dz: 600, len: 9000 },
      { dz: -900, len: 5200 },
    ]),
  );

describe('plant materials', () => {
  it('the plants of one room share their leaves and pot; a room built again takes new ones', () => {
    const a = plant(),
      b = plant(),
      shared = [...a].filter((m) => b.has(m));
    // the three leaf tones and the stoneware
    expect(shared).toHaveLength(4);
    // the room's dispose: the next room patches and registers its own (a kept one took a second box patch)
    for (const m of a) {
      m.dispose();
    }
    const c = plant();
    expect([...c].filter((m) => a.has(m))).toStrictEqual([]);
    expect(plant().size).toBe(c.size);
    expect([...plant()].filter((m) => c.has(m))).toHaveLength(4);
  });
});
