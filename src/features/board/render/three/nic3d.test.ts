import { describe, expect, it } from 'vitest';
import { Box3, Group } from 'three';
import { BD, NIC_BRACKET_X, NIC_LEN, nicY, setLayoutTier } from '../layout/layout';
import { cardReach, HINGE_Z, nicJackAt, STAND } from './card3d';
import type { CardFrame } from './gpu3d';
import { JACK, JACK_X, jacksOf, MOUTH, mouthAt, nicBack, nicParts } from './nic3d';
import { NIC_LANES, nicCopper } from './niccopper';
import { TAB, tabOf } from './pcie';

const MM = 23, Z = HINGE_Z, PCB_T = 24, Zp = Z - PCB_T;
const frame = (visual: string): CardFrame => {
  const y0 = nicY(0), x1 = BD.x + NIC_LEN[visual]!;
  return { x0: BD.x, x1, xe: x1, y0, end: y0 + STAND.nic };
};
const copper = (visual: string, f: CardFrame) => nicCopper(visual, f, tabOf(0, f.x1, NIC_LANES[visual]!));

describe("the network card's real parts", () => {
  it('builds the RJ45 jacks at their real size, out through the bracket, and seats the LAN plug in the first one\'s mouth', () => {
    setLayoutTier(3, 3);
    expect([JACK.w, JACK.h, JACK.d].map((v) => v / MM)).toEqual([16, 13.5, 22]);
    expect(MOUTH.w / MM).toBeCloseTo(11.68, 2);
    for (const [visual, n] of [['nic-gbe', 1], ['nic-10g', 1], ['nic-40g', 2]] as const) {
      const y0 = nicY(0), ys = jacksOf(visual, y0);
      expect(ys, visual).toHaveLength(n);
      // the jacks stand inside the card's height, apart
      expect(ys[ys.length - 1]! + JACK.w, visual).toBeLessThan(y0 + STAND.nic);
      if (n > 1) expect(ys[1]! - ys[0]!).toBeGreaterThan(JACK.w);
      // the plug's seat, standing: the first mouth's middle, out past the bracket's face
      const p = nicJackAt(visual, 0), m = mouthAt(ys[0]!, Zp);
      expect(p.x).toBe(JACK_X);
      expect(p.x).toBeLessThan(NIC_BRACKET_X);
      expect(p.y - y0).toBeGreaterThan(PCB_T);
      expect(p.y - y0).toBeLessThan(PCB_T + JACK.h);
      expect(p.z - HINGE_Z).toBeCloseTo(m.y - y0, 3);
      expect(p.z - HINGE_Z).toBeCloseTo(ys[0]! - y0 + JACK.w / 2, 3);
    }
  });

  it('keeps every part on the component side, inside the card\'s reach and its outline (the finger tab\'s face down in the slot)', () => {
    setLayoutTier(3, 3);
    for (const visual of ['nic-gbe', 'nic-10g', 'nic-40g']) {
      const f = frame(visual), g = new Group();
      nicParts(g, visual, f, Zp, NIC_BRACKET_X + 24, copper(visual, f));
      const b = new Box3().setFromObject(g);
      expect(Z - b.min.z, visual).toBeLessThanOrEqual(cardReach('nic', visual).south + 1);
      expect(b.max.z, visual).toBeLessThanOrEqual(Zp + 1);
      expect(-b.min.y, visual).toBeLessThanOrEqual(f.end + 1);
      expect(-b.max.y, visual).toBeGreaterThanOrEqual(f.y0 - TAB - 1);
      expect(b.min.x, visual).toBeGreaterThanOrEqual(JACK_X - 1);
      expect(b.max.x, visual).toBeLessThanOrEqual(f.x1 + 1);
    }
  });

  it('dresses the back (the solder side): its parts, joints and pin tips stand low over it, inside the card\'s outline', () => {
    setLayoutTier(3, 3);
    for (const visual of ['nic-gbe', 'nic-10g', 'nic-40g']) {
      const f = frame(visual), g = new Group(), cu = copper(visual, f);
      nicBack(g, visual, f, Z, cu);
      const b = new Box3().setFromObject(g);
      // above the tab's face (a unit under the PCB's), under the card's reach north of the slot's line
      expect(b.min.z, visual).toBeGreaterThanOrEqual(Z - 1.5);
      expect(b.max.z - Z, visual).toBeLessThanOrEqual(cardReach('nic', visual).north);
      expect(-b.min.y, visual).toBeLessThanOrEqual(f.end + 1);
      expect(-b.max.y, visual).toBeGreaterThanOrEqual(f.y0 - TAB - 1);
      expect(b.min.x, visual).toBeGreaterThanOrEqual(f.x0 - 1);
      expect(b.max.x, visual).toBeLessThanOrEqual(f.x1 + 1);
      // a joint over every through-hole pin, a tip through every unplated hole, the solder side's passives
      expect(cu.holes.length, visual).toBeGreaterThanOrEqual(10 * jacksOf(visual, f.y0).length);
      expect(cu.parts.filter((p) => p.face === 'bottom').length, visual).toBeGreaterThan(4);
    }
  });
});
