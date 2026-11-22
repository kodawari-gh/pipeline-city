import { describe, expect, it } from 'vitest';
import { Box3, Group } from 'three';
import { findById } from '@/core/render/three/pick';
import { nicGeo } from '@/features/network/render/nic/niclayout';
import { BD, NIC_BRACKET_X, NIC_LEN, nicY, setLayoutTier } from '../layout/layout';
import { cardReach, HINGE_Z, nicJackAt, STAND } from './card3d';
import type { CardFrame } from './gpu3d';
import { CAGE, JACK, JACK_X, jackOf, jacksOf, MOUTH, mouthAt, nicBack, nicParts, type NicBuild } from './nic3d';
import { DIE_MM } from './nicchip3d';
import { COOLER_FROM, NIC_LANES, nicCopper } from './niccopper';
import { TAB, tabOf } from './pcie';
import { QSFP } from './qsfp3d';

const MM = 23, Z = HINGE_Z, PCB_T = 24, Zp = Z - PCB_T;
const frame = (visual: string): CardFrame => {
  const y0 = nicY(0), x1 = BD.x + NIC_LEN[visual]!;
  return { x0: BD.x, x1, xe: x1, y0, end: y0 + STAND.nic };
};
const copper = (visual: string, f: CardFrame) => nicCopper(visual, f, tabOf(0, f.x1, NIC_LANES[visual]!));
/** What the parts are built for: the card in slot 0 of the case's board, a plain die (no floorplan) unless `floor` says how to put one on. */
const build = (visual: string, floor?: NicBuild['floor']): NicBuild => ({ slot: 'pcie0', plan: nicGeo(visual, 0).die, ...(floor ? { floor } : {}) });

describe("the network card's real parts", () => {
  it('builds the ports at their real size (the RJ45 jacks, the 40G card\'s QSFP+ cages), out through the bracket, and seats the LAN plug in the first one\'s mouth', () => {
    setLayoutTier(3, 3);
    expect([JACK.w, JACK.h, JACK.d].map((v) => v / MM)).toEqual([16, 13.5, 22]);
    expect(MOUTH.w / MM).toBeCloseTo(11.68, 2);
    // (the cage: 18.95 x 10 mm, the lights' block 2.4 mm over it, as deep as the jack so the controller and the sink stay where they are)
    expect([CAGE.w, CAGE.h, CAGE.d].map((v) => v / MM)).toEqual([expect.closeTo(18.95, 6), expect.closeTo(12.4, 6), 22]);
    expect(jackOf('nic-gbe')).toBe(JACK);
    expect(jackOf('nic-10g')).toBe(JACK);
    expect(jackOf('nic-40g')).toBe(CAGE);
    for (const [visual, n] of [['nic-gbe', 1], ['nic-10g', 1], ['nic-40g', 2]] as const) {
      const y0 = nicY(0), ys = jacksOf(visual, y0), P = jackOf(visual), up = visual === 'nic-40g' ? (QSFP.cage.h * MM) / 2 : MOUTH.base + MOUTH.main / 2;
      expect(ys, visual).toHaveLength(n);
      // the ports stand inside the card's height, apart
      expect(ys[ys.length - 1]! + P.w, visual).toBeLessThan(y0 + STAND.nic);
      if (n > 1) expect(ys[1]! - ys[0]!).toBeGreaterThan(P.w);
      // the plug's seat, standing: the first mouth's middle, out past the bracket's face, north of the slot's line (the port stands on the PCB's top face: the PCB is below it)
      const p = nicJackAt(visual, 0), m = mouthAt(ys[0]!, Z, visual);
      expect(p.x).toBe(JACK_X);
      expect(p.x).toBeLessThan(NIC_BRACKET_X);
      expect(y0 - p.y).toBeGreaterThan(0);
      expect(y0 - p.y).toBeLessThan(P.h);
      expect(y0 - p.y).toBeCloseTo(up, 3);
      expect(p.z - HINGE_Z).toBeCloseTo(m.y - y0, 3);
      expect(p.z - HINGE_Z).toBeCloseTo(ys[0]! - y0 + P.w / 2, 3);
    }
  });

  it('stands every part on the PCB\'s top face, the jacks 13.5 mm up at the bracket (the PCB is below the ports) and the rest low (a GPU or an NPU may stand just south of it), all inside the card\'s outline', () => {
    setLayoutTier(3, 3);
    for (const visual of ['nic-gbe', 'nic-10g', 'nic-40g']) {
      const f = frame(visual), g = new Group(), out = nicParts(g, visual, f, Z, NIC_BRACKET_X + 24, copper(visual, f), build(visual));
      const b = new Box3().setFromObject(g), up = new Box3().setFromObject(out.top);
      // (nothing is under the top face; the part east of the jacks rises off it no higher than the card's north reach)
      expect(b.min.z, visual).toBeGreaterThanOrEqual(Z - 1);
      expect(up.min.z, visual).toBeGreaterThanOrEqual(Z - 1);
      expect(up.max.z - Z, visual).toBeLessThanOrEqual(cardReach('nic', visual).north);
      expect(-b.min.y, visual).toBeLessThanOrEqual(f.end + 1);
      expect(-b.max.y, visual).toBeGreaterThanOrEqual(f.y0 - TAB - 1);
      expect(b.min.x, visual).toBeGreaterThanOrEqual(JACK_X - 1);
      expect(b.max.x, visual).toBeLessThanOrEqual(f.x1 + 1);
      // the jacks are the tallest thing (their ground springs and ribs a hair over their shield's face), in front of the controller, and clear of the cooler of a card north of it (`COOLER_FROM`)
      const jacks = findById(g, 'pcie0.nic-jack')!, ju = new Box3().setFromObject(jacks), P = jackOf(visual);
      expect(ju.min.z, visual).toBeGreaterThanOrEqual(Z - 1);
      expect(ju.max.z - Z, visual).toBeGreaterThanOrEqual(P.h - 1e-6);
      expect(ju.max.z - Z, visual).toBeLessThanOrEqual(P.h + 0.5 * MM + 1);
      expect(b.max.z, visual).toBeCloseTo(ju.max.z, 6);
      expect(ju.max.x - BD.x, visual).toBeLessThanOrEqual(COOLER_FROM);
    }
  });

  it('tags each body a pick can meet with its id (the slot and the part), and reports where each stands and how tall', () => {
    setLayoutTier(3, 3);
    for (const visual of ['nic-gbe', 'nic-10g', 'nic-40g']) {
      const f = frame(visual), g = new Group(), out = nicParts(g, visual, f, Z, NIC_BRACKET_X + 24, copper(visual, f), build(visual));
      const ids = ['jack', 'ctl', 'xtal', 'nvm', 'vreg', 'label'].map((p) => `pcie0.nic-${p}`);
      expect(out.bodies.map((b) => b.id), visual).toEqual(ids);
      for (const id of ids) expect(findById(g, id), `${visual} ${id}`).not.toBeNull();
      for (const b of out.bodies) {
        // (a footprint on the card: inside its strip, as the card is built)
        expect(b.rect.x, `${visual} ${b.id}`).toBeGreaterThanOrEqual(JACK_X - 1);
        expect(b.rect.x + b.rect.w, `${visual} ${b.id}`).toBeLessThanOrEqual(f.x1 + 1);
        expect(b.rect.y, `${visual} ${b.id}`).toBeGreaterThanOrEqual(f.y0 - 1);
        expect(b.rect.y + b.rect.h, `${visual} ${b.id}`).toBeLessThanOrEqual(f.end + 1);
        expect(b.h, `${visual} ${b.id}`).toBeGreaterThanOrEqual(0);
      }
      // the jack is the tallest, its height the real 13.5 mm (the 40G card's cage with its lights' block, 12.4 mm); the others stand no higher than the card's north reach; the label is a sticker with no height
      const jack = out.bodies.find((b) => b.id === 'pcie0.nic-jack')!;
      expect(jack.h, visual).toBeCloseTo(jackOf(visual).h, 6);
      expect(Math.max(...out.bodies.map((b) => b.h)), visual).toBe(jack.h);
      for (const b of out.bodies.filter((o) => o !== jack)) expect(b.h, `${visual} ${b.id}`).toBeLessThanOrEqual(cardReach('nic', visual).north);
      expect(out.bodies.find((b) => b.id === 'pcie0.nic-label')!.h, visual).toBe(0);
      // the two lights follow the network: out until it lights them
      expect(out.lamps.link, visual).toBeDefined();
      expect(out.lamps.act, visual).toBeDefined();
    }
  });

  it('puts a die of the real size under each controller\'s lid, which the zoom takes away to show the floorplan on the die', () => {
    setLayoutTier(3, 3);
    for (const [visual, side] of [['nic-gbe', DIE_MM.qfn], ['nic-10g', DIE_MM.bga], ['nic-40g', DIE_MM.bga]] as const) {
      const f = frame(visual), g = new Group(), seen: { frame: Group; scale: number }[] = [], root = new Group();
      const out = nicParts(g, visual, f, Z, NIC_BRACKET_X + 24, copper(visual, f), build(visual, (fr, scale) => { seen.push({ frame: fr, scale }); return { root, z: 3 / scale }; }));
      const chip = out.chip;
      expect(chip.rect.w / MM, visual).toBeCloseTo(side, 3);
      expect(chip.rect.h / MM, visual).toBeCloseTo(side, 3);
      expect(seen, visual).toHaveLength(1);
      expect(seen[0]!.frame.scale.x, visual).toBeCloseTo(chip.scale, 9);
      expect(chip.scale * nicGeo(visual, 0).die.w, visual).toBeCloseTo(chip.rect.w, 6);
      expect(chip.die, visual).not.toBeNull();
      // the die stands on its substrate or pad, under the package's top
      expect(chip.dieTop, visual).toBeGreaterThan(0);
      expect(chip.dieTop, visual).toBeLessThan(chip.top);
      // far away the lid hides the die; close in it has faded and the floorplan shows
      chip.lod(0.05);
      expect(chip.lid.visible, visual).toBe(true);
      expect(root.visible, visual).toBe(false);
      chip.lod(30);
      expect(chip.lid.visible, visual).toBe(false);
      expect(root.visible, visual).toBe(true);
      // a lidded BGA's sink goes with the lid
      const sink = out.bodies.find((b) => b.id === 'pcie0.nic-ctl')!;
      expect(sink.h, visual).toBeGreaterThanOrEqual(chip.top - 1);
    }
  });

  it('has no die at all when it is given no floorplan (the plain chip of the gallery)', () => {
    setLayoutTier(3, 3);
    const f = frame('nic-gbe'), out = nicParts(new Group(), 'nic-gbe', f, Z, NIC_BRACKET_X + 24, copper('nic-gbe', f), build('nic-gbe'));
    expect(out.chip.die).toBeNull();
    out.chip.lod(30);
    expect(out.chip.lid.visible).toBe(false);
  });

  it('dresses the back (the solder side, under the PCB): its parts and pin tips hang low under it, inside the card\'s outline', () => {
    setLayoutTier(3, 3);
    for (const visual of ['nic-gbe', 'nic-10g', 'nic-40g']) {
      const f = frame(visual), g = new Group(), cu = copper(visual, f);
      nicBack(g, visual, f, Zp, cu);
      const b = new Box3().setFromObject(g);
      // under the PCB's underside (a unit over it at most: the mask's face), no deeper than the card's reach south of the slot's line
      expect(b.max.z, visual).toBeLessThanOrEqual(Zp + 1.5);
      expect(Z - b.min.z, visual).toBeLessThanOrEqual(cardReach('nic', visual).south);
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
