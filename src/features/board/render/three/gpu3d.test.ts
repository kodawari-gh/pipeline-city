import { describe, expect, it } from 'vitest';
import { Box3, Group } from 'three';
import { NIC_BRACKET_X, nicY, setLayoutTier } from '../layout/layout';
import { cardReach, gpuVideoAt, HINGE_Z, STAND } from './card3d';
import * as gpu3d from './gpu3d';
import { COOLER_FROM } from './niccopper';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const MM = 23,
  Z = HINGE_Z,
  PCB_T = 24;
const frame = (len: number): gpu3d.CardFrame => ({ x0: 0, x1: len, xe: len, y0: nicY(0), end: nicY(0) + STAND.gpu });

describe("the GPU's real parts", () => {
  it('builds the outputs at their real size, each inside its opening in the bracket, the HDMI where the monitor plugs in', () => {
    setLayoutTier(3, 3);
    const f = frame(4000),
      holes = gpu3d.outputHoles(f.y0, Z - PCB_T);
    expect(
      gpu3d.OUTPUTS.map((o) => [o.kind, Math.round((o.w / MM) * 10) / 10, Math.round((o.h / MM) * 10) / 10]),
    ).toStrictEqual([
      ['hdmi', 15.2, 6],
      ['dp', 17, 6.2],
      ['dp', 17, 6.2],
      ['dp', 17, 6.2],
    ]);
    for (const [i, o] of gpu3d.OUTPUTS.entries()) {
      const g = new Group();
      gpu3d.gpuOutputs(g, f, Z - PCB_T);
      const h = must(holes[i]),
        yc = f.y0 + o.c;
      expect(h.y0).toBeLessThan(yc - o.w / 2);
      expect(h.y1).toBeGreaterThan(yc + o.w / 2);
      // (the openings never overlap)
      if (i) {
        expect(h.y0).toBeGreaterThan(must(holes[i - 1]).y1);
      }
    }
    // the HDMI's mouth, standing: just in from the bracket's outer face, its middle as deep as the shell's
    const v = gpuVideoAt('gpu-3', 0),
      hd = must(holes[0]);
    expect(v.x).toBeGreaterThan(NIC_BRACKET_X);
    expect(v.z - HINGE_Z).toBeCloseTo(must(gpu3d.OUTPUTS[0]).c, 3);
    expect(v.y - nicY(0)).toBeCloseTo(Z - (hd.z0 + hd.z1) / 2, 3);
  });

  it("keeps the cooler inside the card's reach under the PCB, and puts each 8-pin socket's mouth on the top edge", () => {
    setLayoutTier(3, 3);
    for (const [visual, ct, plugs] of [
      ['gpu-1', 20, 0],
      ['gpu-2', 22, 1],
      ['gpu-3', 24, 2],
    ] as const) {
      const g = new Group(),
        f = frame(260 * MM);
      expect(gpu3d.gpuCooler(g, [], visual, f, Z - PCB_T, Z, 18, ct * MM, false)).toHaveLength(2);
      const b = new Box3().setFromObject(g);
      expect(Z - b.min.z).toBeLessThanOrEqual(cardReach('gpu', visual).south + 1);
      expect(-b.min.y).toBeLessThanOrEqual(f.end + 1);
      // it starts east of the jacks of a NIC in the slot south of it, which stand toward it
      expect(b.min.x - f.x0).toBeGreaterThanOrEqual(COOLER_FROM - 1);
      const s = gpu3d.gpuSockets(new Group(), visual, f, Z - PCB_T, HINGE_Z, STAND.gpu, PCB_T);
      expect(s).toHaveLength(plugs);
      for (const p of s) {
        expect(p.x + 10.6 * MM).toBeLessThan(f.x1);
      }
    }
  });
});
