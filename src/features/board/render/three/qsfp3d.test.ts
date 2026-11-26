import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { mat } from '@/core/render/three/materials';
import type { Span } from './casekit3d';
import { QSFP, qsfpFace, qsfpLamps, qsfpLook } from './qsfp3d';

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;
function asMesh(o: unknown): three.Mesh {
  if (!isMesh(o)) {
    throw new Error('expected a Mesh');
  }
  return o;
}

const K = 23,
  W = QSFP.cage.w * K,
  H = QSFP.cage.h * K,
  DEEP = 22 * K;
/** A card's cage (its width along y, lying) and a router's (its width along z), on the same size of span. */
const card: Span = { y0: 100, y1: 100 + W, z0: 10, z1: 10 + H };
const front: Span = { y0: 100, y1: 100 + H, z0: 10, z1: 10 + W };
const lamps = { link: mat(0x58_e0_8a, {}), act: mat(0xff_b5_47, {}) };
const look = qsfpLook(mat(0x8a_90_99, {}));

/** The box of every mesh made of `m` in `g`, in layout terms (the model's y is the layout's negated). */
const boxOf = (g: three.Group, m: three.Material) => {
  const b = new three.Box3();
  g.traverse((o) => {
    if (o instanceof three.Mesh && o.material === m) {
      b.expandByObject(o);
    }
  });
  return { empty: b.isEmpty(), x0: b.min.x, x1: b.max.x, y0: -b.max.y, y1: -b.min.y, z0: b.min.z, z1: b.max.z };
};

describe("the QSFP+ cage's face", () => {
  it('is a real module and cage: the module fits the mouth, the mouth the cage (a sheet 0.2 mm at the sides, 0.6 over and under)', () => {
    expect(QSFP.module.w).toBeLessThan(QSFP.mouth.w);
    expect(QSFP.module.h).toBeLessThan(QSFP.mouth.h);
    expect(QSFP.mouth.w).toBeLessThan(QSFP.cage.w);
    expect(QSFP.mouth.h).toBeLessThan(QSFP.cage.h);
    expect((QSFP.cage.w - QSFP.mouth.w) / 2).toBeCloseTo(0.2, 3);
    expect((QSFP.cage.h - QSFP.mouth.h) / 2).toBeCloseTo(0.625, 3);
  });

  it('stands over its span and runs back to its depth, whichever way the span is wide', () => {
    for (const [, s] of [
      ['card', card],
      ['router', front],
    ] as const) {
      const g = new three.Group();
      qsfpFace(g, 0, s, DEEP, look);
      const b = boxOf(g, look.shell);
      expect(b.x0).toBeCloseTo(0, 3);
      expect(b.x1).toBeCloseTo(DEEP, 3);
      expect(b.y0).toBeCloseTo(s.y0, 3);
      expect(b.y1).toBeCloseTo(s.y1, 3);
      expect(b.z0).toBeCloseTo(s.z0, 3);
      expect(b.z1).toBeCloseTo(s.z1, 3);
    }
  });

  it('draws the connector (its housing, the slot and the 38 gold contacts in two rows) only when it is fine', () => {
    const plain = new three.Group(),
      fine = new three.Group();
    qsfpFace(plain, 0, card, DEEP, look, false);
    qsfpFace(fine, 0, card, DEEP, look, true);
    expect(fine.children.length - plain.children.length).toBe(3);
    // the gold: one instanced draw, 19 contacts a row
    const gold = fine.children.find((o) => asMesh(o).material === look.gold) as
      (three.Mesh & { count?: number }) | undefined;
    expect(gold?.count).toBe(38);
    expect(boxOf(plain, look.gold).empty).toBe(true);
    // (the connector stands at the back, behind the mouth: nothing of it is in the first half)
    expect(boxOf(fine, look.gold).x0).toBeGreaterThan(DEEP / 2);
  });

  it("puts the link light and the activity light 5.3 mm either side of the cage's middle, in a block over a card's cage", () => {
    const g = new three.Group();
    qsfpLamps(g, 0, card, 'z', lamps, look, true);
    // the block: the cage's width, 2.4 mm tall over it, 8.6 mm deep (it ends inside the bracket)
    const block = boxOf(g, look.housing),
      mid = (card.y0 + card.y1) / 2;
    expect(block.y0).toBeCloseTo(card.y0, 3);
    expect(block.y1).toBeCloseTo(card.y1, 3);
    expect(block.z0).toBeCloseTo(card.z1, 3);
    expect(block.z1 - block.z0).toBeCloseTo(QSFP.lamp.h * K, 3);
    expect(block.x1 - block.x0).toBeCloseTo(QSFP.lamp.d * K, 3);
    // the lenses: link toward -y, activity toward +y, on the block's face, over its middle, a hair proud (under a unit: the card stays inside its strip)
    const link = boxOf(g, lamps.link),
      act = boxOf(g, lamps.act),
      over = card.z1 + (QSFP.lamp.h * K) / 2;
    expect((link.y0 + link.y1) / 2).toBeCloseTo(mid - 5.3 * K, 3);
    expect((act.y0 + act.y1) / 2).toBeCloseTo(mid + 5.3 * K, 3);
    expect((link.z0 + link.z1) / 2).toBeCloseTo(over, 3);
    expect((act.z0 + act.z1) / 2).toBeCloseTo(over, 3);
    expect(link.x0).toBeGreaterThanOrEqual(-1);
    expect(link.x0).toBeLessThan(0);
  });

  it("puts a router's lights in its front over the cage with no block, and a room router's over its side cage in a block", () => {
    const bare = new three.Group();
    qsfpLamps(bare, 0, front, '-y', lamps, look, false);
    expect(boxOf(bare, look.housing).empty).toBe(true);
    const link = boxOf(bare, lamps.link),
      act = boxOf(bare, lamps.act),
      mid = (front.z0 + front.z1) / 2;
    // (over the cage: toward -y, clear of it by a gap)
    expect(link.y1).toBeLessThan(front.y0);
    expect(act.y1).toBeLessThan(front.y0);
    expect((link.z0 + link.z1) / 2).toBeCloseTo(mid - 5.3 * K, 3);
    expect((act.z0 + act.z1) / 2).toBeCloseTo(mid + 5.3 * K, 3);
    const withBlock = new three.Group();
    qsfpLamps(withBlock, 0, front, '-y', lamps, look, true);
    const b = boxOf(withBlock, look.housing);
    expect(b.y1).toBeCloseTo(front.y0, 3);
    expect(b.y1 - b.y0).toBeCloseTo(QSFP.lamp.h * K, 3);
    expect(b.z0).toBeCloseTo(front.z0, 3);
    expect(b.z1).toBeCloseTo(front.z1, 3);
  });
});
