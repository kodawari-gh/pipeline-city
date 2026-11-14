import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { debugLayer } from './city-layers';
import type { OutsideView } from '@/features/room/render/three/outside/view';

// The city layers hide by layer mask (not `visible`). A stub city holds one object per part.
const HIDDEN = 30;
const stub = () => {
  const parts = { streets: [new Object3D()], buildings: [new Object3D()], trees: [new Object3D()], cars: [new Object3D()] };
  const v = { off: new Set<string>(), key: 0, lamps: [], parts, age: 0 } as unknown as OutsideView;
  return { v, parts };
};
const shown = (os: Object3D[]) => os.map((o) => o.layers.isEnabled(0));

describe('debugLayer: buildings, trees and streets hide alone', () => {
  for (const k of ['buildings', 'trees', 'streets'] as const) {
    it(`${k} hides only its own objects, and on again shows them`, () => {
      const { v, parts } = stub();
      debugLayer(v, k, true);
      expect(v.off.has(k)).toBe(true);
      expect(parts[k][0]!.layers.mask).toBe(1 << HIDDEN);
      for (const other of ['streets', 'buildings', 'trees', 'cars'] as const) {
        if (other !== k) expect(shown(parts[other]), other).toEqual([true]);
      }
      debugLayer(v, k, false);
      expect(v.off.has(k)).toBe(false);
      expect(shown(parts[k])).toEqual([true]);
    });
  }
});
