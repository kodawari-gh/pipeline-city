import { describe, expect, it } from 'vitest';
import { Box3, Group } from 'three';
import { BD, nicY, setLayoutTier } from '../layout/layout';
import { cardReach, HINGE_Z, STAND } from './card3d';
import type { CardFrame } from './gpu3d';
import { npuBackplate, npuCooler, npuPlan } from './npu3d';
import type { Spin } from './fans3d';

const MM = 23, Z = HINGE_Z, PCB_T = 24;
const frame = (visual: string): CardFrame => {
  const y0 = nicY(0);
  return { x0: BD.x, x1: BD.x + 3000, xe: BD.x + cardReach('npu', visual).len, y0, end: y0 + STAND.npu };
};

describe("the AI card's blower cooler", () => {
  it('turns a 65 mm impeller in its scroll near the far end, inside the walls, with the fin block between it and the bracket', () => {
    setLayoutTier(3, 3);
    for (const visual of ['npu-1', 'npu-2']) {
      const f = frame(visual), P = npuPlan(f);
      expect(P.r / MM, visual).toBeCloseTo(32.5, 1);
      // the scroll's widest reach stays inside the walls on every side
      let x = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let k = 0; k <= 200; k++) {
        const a = P.a0 + ((P.a1 - P.a0) * k) / 200, R = P.Rs(a) + 1.2 * MM;
        x = Math.max(x, P.fx + Math.cos(a) * R); y0 = Math.min(y0, P.cy + Math.sin(a) * R); y1 = Math.max(y1, P.cy + Math.sin(a) * R);
      }
      expect(x, visual).toBeLessThan(P.xb - 1.6 * MM);
      expect(y0, visual).toBeGreaterThan(P.ya + 1.6 * MM);
      expect(y1, visual).toBeLessThan(P.yb - 1.6 * MM);
      // the fin block runs from the bracket to the scroll's outlet, the die under its middle
      expect((P.fins.x1 - P.fins.x0) / MM, visual).toBeGreaterThan(60);
      expect(P.fins.x1).toBeLessThan(P.fx - P.R0);
      expect(P.die.x).toBeGreaterThan(P.fins.x0);
      expect(P.die.x).toBeLessThan(P.fins.x1);
    }
  });

  it('keeps the shroud inside the card\'s reach under the PCB and the backplate over it, and spins its one fan', () => {
    setLayoutTier(3, 3);
    for (const visual of ['npu-1', 'npu-2']) {
      const f = frame(visual), g = new Group(), spins: Spin[] = [], ct = cardReach('npu', visual).south - PCB_T;
      expect(npuCooler(g, spins, visual, f, Z - PCB_T, ct)).toBeTruthy();
      expect(spins).toHaveLength(1);
      const b = new Box3().setFromObject(g);
      expect(Z - b.min.z, visual).toBeLessThanOrEqual(cardReach('npu', visual).south + 1);
      expect(b.max.z, visual).toBeLessThanOrEqual(Z - PCB_T);
      expect(-b.min.y, visual).toBeLessThanOrEqual(f.end + 1);
      expect(b.max.x, visual).toBeLessThanOrEqual(f.xe + 1);
      const back = new Group();
      npuBackplate(back, visual, f, Z, 18);
      const bb = new Box3().setFromObject(back);
      expect(bb.min.z).toBeGreaterThanOrEqual(Z - 1);
      expect(bb.max.z - Z).toBeLessThanOrEqual(cardReach('npu', visual).north + 4 * MM);
    }
  });
});
