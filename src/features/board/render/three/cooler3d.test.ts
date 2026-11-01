import { describe, expect, it } from 'vitest';
import { Box3, Mesh, TubeGeometry, Vector3 } from 'three';
import { radiatorSpan } from '@/features/room/render/desk/props/case';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { radiatorFit, radiatorPorts } from '../cooler';
import { COOLER, setLayoutTier } from '../layout/layout';
import { FAN_MAX, FAN_ZC, barbZ, coolerModel, hose, hoseEnds, radiatorModel } from './cooler3d';

const rad = (side: 'top' | 'front') => {
  const span = radiatorSpan(side)!;
  return { span, fit: radiatorFit(span, COOLER.x + COOLER.w / 2), count: span.ids.length };
};

describe('the 3D coolers', () => {
  it('stands every cooler on its plate over the CPU, with its fan (and on the loop the ring light) for the live frame', () => {
    setLayoutTier(3, 3);
    for (const [visual, spins] of [['cooler-stock', 1], ['cooler-tower', 1], ['cooler-liquid', 2]] as const) {
      const m = coolerModel(visual), b = new Box3().setFromObject(m.root);
      expect(m.spins.length, visual).toBe(spins);
      expect(b.min.z, visual).toBeGreaterThanOrEqual(BOARD_Z + 250);
      expect(b.min.x, visual).toBeGreaterThanOrEqual(COOLER.x - 1);
      expect(b.max.x, visual).toBeLessThanOrEqual(COOLER.x + COOLER.w + 1);
    }
  });

  it('hangs the loop\'s two hoses from the pump\'s ports to the radiator\'s barbs, whichever side it is bolted on', () => {
    setLayoutTier(3, 3);
    for (const side of ['top', 'front'] as const) {
      const r = rad(side), ends = hoseEnds(r);
      expect(ends.length, side).toBe(2);
      const tips = radiatorPorts(r.fit).tips.map((t) => new Vector3(t[0], -t[1], barbZ(r)));
      for (const [a, b] of ends) {
        const t = hose(a, b, { planes: [], solids: [] }).children.find((o): o is Mesh => o instanceof Mesh && o.geometry instanceof TubeGeometry)!;
        const path = (t.geometry as TubeGeometry).parameters.path;
        expect(path.getPointAt(0).distanceTo(new Vector3(...a.at)), side).toBeLessThan(2);
        expect(Math.min(...tips.map((p) => p.distanceTo(path.getPointAt(1)))), side).toBeLessThan(40);
      }
      // the barbs sit inside the radiator's depth
      expect(barbZ(r)).toBeGreaterThan(FAN_ZC - FAN_MAX / 2);
      expect(barbZ(r)).toBeLessThan(FAN_ZC);
    }
  });

  it('gives a radiator one fan per mount it covers, each on its mount\'s cable', () => {
    setLayoutTier(3, 3);
    for (const side of ['top', 'front'] as const) {
      const r = rad(side), m = radiatorModel(r.fit, 2, r.span.ids);
      expect(m.spins.map((s) => s.needs), side).toEqual(r.span.ids.map((id) => 'fan:' + id));
    }
  });
});
