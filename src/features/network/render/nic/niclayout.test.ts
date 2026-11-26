import { describe, expect, it } from 'vitest';
import { BD, NIC_BRACKET_X, NIC_LEN, nicY, setLayoutTier } from '../../../board/render/layout/layout';
import type * as layoutTypes from '../../../board/render/layout/layout';
import {
  BOARD_BAND,
  NIC_BAND,
  NIC_BODIES,
  NIC_FACE,
  boardNicIds,
  moveBy,
  nicFaceRect,
  nicGeo,
  nicIds,
  nicParts,
} from './niclayout';
import { BOARD_DIE, NIC_DIE, nicInput } from './nicplan';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const VISUALS = ['nic-gbe', 'nic-10g', 'nic-40g'];
const inside = (r: layoutTypes.Rect, o: layoutTypes.Rect): boolean =>
  r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;
const apart = (a: layoutTypes.Rect, b: layoutTypes.Rect): boolean =>
  a.x >= b.x + b.w - 0.01 || b.x >= a.x + a.w - 0.01 || a.y >= b.y + b.h - 0.01 || b.y >= a.y + a.h - 0.01;

describe("the card's flat strip on the board", () => {
  setLayoutTier(3, 3);

  it("reaches south of the slot's line over the card's body and north of it over the finger tab: the card lies at its own slot, as a GPU does", () => {
    for (const v of VISUALS) {
      for (const slot of [0, 1, 2]) {
        const f = nicFaceRect(slot, v);
        expect(f.y, `${v} ${slot}`).toBe(nicY(slot) - NIC_FACE.north);
        expect(f.y + f.h, `${v} ${slot}`).toBe(nicY(slot) + NIC_FACE.south);
        // a card of the PCIe slot's pitch above and below does not touch it
        expect(f.h, `${v} ${slot}`).toBeLessThanOrEqual(640);
      }
    }
    // (the 3D card's finger tab is 140 high; the body is the longer side)
    expect(NIC_FACE.north).toBeGreaterThanOrEqual(140);
    expect(NIC_FACE.south).toBeGreaterThan(NIC_FACE.north);
  });

  it('reaches from the jack at the bracket to the far end of the board, and keeps the strips of the slots apart', () => {
    for (const v of VISUALS) {
      const faces = [0, 1, 2].map((i) => nicFaceRect(i, v));
      for (const f of faces) {
        expect(f.x, `for ${v}`).toBeLessThanOrEqual(NIC_BRACKET_X);
        expect(f.x + f.w, `for ${v}`).toBe(BD.x + must(NIC_LEN[v]));
      }
      for (let i = 0; i < faces.length; i++) {
        for (let j = i + 1; j < faces.length; j++) {
          expect(apart(must(faces[i]), must(faces[j])), `${v} ${i}/${j}`).toBe(true);
        }
      }
    }
  });
});

describe("the die's frame", () => {
  setLayoutTier(3, 3);

  it('gives each card a band of its own in the die frame, wide enough that two plans never meet', () => {
    expect(NIC_BAND).toBeGreaterThan(NIC_DIE.w);
    for (const v of VISUALS) {
      for (const slot of [0, 1, 2, 3]) {
        const g = nicGeo(v, slot);
        expect(g.origin, `${v} ${slot}`).toStrictEqual({ x: slot * NIC_BAND, y: 0 });
        expect(g.die, `${v} ${slot}`).toStrictEqual({ x: slot * NIC_BAND, y: 0, w: NIC_DIE.w, h: NIC_DIE.h });
        expect(g.face, `for ${v}`).toStrictEqual(nicFaceRect(slot, v));
      }
    }
    const a = nicGeo('nic-gbe', 0).die,
      b = nicGeo('nic-gbe', 1).die;
    expect(apart(a, b)).toBe(true);
  });

  it('is the same object for the same card, and a different plan for each tier', () => {
    expect(nicGeo('nic-10g', 1)).toBe(nicGeo('nic-10g', 1));
    expect(nicGeo('nic-gbe', 1).plan).not.toBe(nicGeo('nic-40g', 1).plan);
    expect(nicGeo('nic-gbe', 1).plan.input).toBe(nicInput('nic-gbe'));
  });
});

describe('the parts of the card that a pointer can meet', () => {
  setLayoutTier(3, 3);

  it('has an id for every body and every block of the die, with the slot in front, and no id twice', () => {
    for (const v of VISUALS) {
      const ids = nicIds(v, 'pcie1', 1);
      expect(new Set(ids).size, `for ${v}`).toBe(ids.length);
      expect(
        ids.every((i) => i.startsWith('pcie1.nic-')),
        `for ${v}`,
      ).toBe(true);
      expect(ids, `for ${v}`).toStrictEqual(
        expect.arrayContaining([
          'pcie1.nic-ctl',
          'pcie1.nic-jack',
          'pcie1.nic-edge',
          'pcie1.nic-label',
          'pcie1.nic-phy',
          'pcie1.nic-mac',
          'pcie1.nic-stats',
          'pcie1.nic-rxq',
          'pcie1.nic-txq',
          'pcie1.nic-dma',
          'pcie1.nic-pcie',
          'pcie1.nic-nvm',
          'pcie1.nic-xtal',
          'pcie1.nic-vreg',
          'pcie1.nic-temp',
        ]),
      );
      expect(ids, `for ${v}`).not.toContain('pcie1.nic-mag');
    }
  });

  it("names the controller once: its frame is the die's block and its chip is the 3D body (the die's id is the chip's)", () => {
    const g = nicGeo('nic-10g', 1),
      blocks = nicParts(g).map((p) => p.id);
    expect(blocks.filter((i) => i === 'nic-ctl')).toHaveLength(1);
    expect(NIC_BODIES).not.toContain('nic-ctl');
    expect(nicIds('nic-10g', 'pcie1', 1).filter((i) => i === 'pcie1.nic-ctl')).toHaveLength(1);
  });

  it('keeps the blocks inside the die, apart, and the frame under the blocks it holds', () => {
    for (const v of VISUALS) {
      const g = nicGeo(v, 2),
        parts = nicParts(g),
        leaves = parts.filter((p) => p.id !== 'nic-ctl');
      for (const p of parts) {
        expect(inside(p.rect, g.die), `${v} ${p.id}`).toBe(true);
      }
      for (let i = 0; i < leaves.length; i++) {
        for (let j = i + 1; j < leaves.length; j++) {
          expect(
            apart(must(leaves[i]).rect, must(leaves[j]).rect),
            `${v} ${must(leaves[i]).id} / ${must(leaves[j]).id}`,
          ).toBe(true);
        }
      }
      // the smallest rectangle under the pointer wins, so the frame must be larger than each block it holds
      const ctl = must(parts.find((p) => p.id === 'nic-ctl')).rect;
      for (const id of ['nic-phy', 'nic-mac', 'nic-rxq', 'nic-dma', 'nic-pcie']) {
        expect(
          must(parts.find((p) => p.id === id)).rect.w * must(parts.find((p) => p.id === id)).rect.h,
          `${v} ${id}`,
        ).toBeLessThan(ctl.w * ctl.h);
      }
    }
  });

  it("moves a rectangle by the band's origin", () => {
    expect(moveBy({ x: 10, y: 20, w: 30, h: 40 }, { x: 2000, y: 0 })).toStrictEqual({ x: 2010, y: 20, w: 30, h: 40 });
  });
});

describe('the Ethernet chip on the motherboard', () => {
  setLayoutTier(3, 3);
  const LOOKS = ['board-fe', 'board-ge'];

  it("has a band of its own in the die frame, past the cards' slots, and no flat strip", () => {
    expect(BOARD_BAND).toBeGreaterThan(3);
    for (const v of LOOKS) {
      const g = nicGeo(v, BOARD_BAND);
      expect(g.face, `for ${v}`).toBeNull();
      expect(g.origin, `for ${v}`).toStrictEqual({ x: BOARD_BAND * NIC_BAND, y: 0 });
      expect(g.die, `for ${v}`).toStrictEqual({ x: BOARD_BAND * NIC_BAND, y: 0, ...BOARD_DIE });
      expect(g.plan.input, `for ${v}`).toBe(nicInput(v));
      for (const slot of [0, 1, 2, 3]) {
        expect(apart(g.die, nicGeo('nic-gbe', slot).die), `${v} ${slot}`).toBe(true);
      }
    }
    // the cards keep their strip, the two looks are two plans
    for (const v of VISUALS) {
      expect(nicGeo(v, 1).face, `for ${v}`).not.toBeNull();
    }
    expect(nicGeo('board-fe', BOARD_BAND).plan).not.toBe(nicGeo('board-ge', BOARD_BAND).plan);
    expect(nicGeo('board-ge', BOARD_BAND)).toBe(nicGeo('board-ge', BOARD_BAND));
  });

  it("has an id for every block of its die with the board in front, none twice, and none of a card's bodies or heat sensor", () => {
    for (const v of LOOKS) {
      const ids = boardNicIds(v);
      expect(new Set(ids).size, `for ${v}`).toBe(ids.length);
      expect(
        ids.every((i) => i.startsWith('board.nic-')),
        `for ${v}`,
      ).toBe(true);
      expect(ids, `for ${v}`).toStrictEqual(
        expect.arrayContaining([
          'board.nic-ctl',
          'board.nic-phy',
          'board.nic-mac',
          'board.nic-stats',
          'board.nic-rxq',
          'board.nic-txq',
          'board.nic-dma',
          'board.nic-pcie',
        ]),
      );
      expect(ids, `for ${v}`).not.toContain('board.nic-temp');
      for (const b of NIC_BODIES) {
        expect(ids, `${v} ${b}`).not.toContain(`board.${b}`);
      }
      expect(ids).toHaveLength(8);
    }
  });

  it('keeps the blocks inside its die, apart, with the frame larger than any block it holds', () => {
    for (const v of LOOKS) {
      const g = nicGeo(v, BOARD_BAND),
        parts = nicParts(g),
        leaves = parts.filter((p) => p.id !== 'nic-ctl'),
        ctl = must(parts.find((p) => p.id === 'nic-ctl')).rect;
      for (const p of parts) {
        expect(inside(p.rect, g.die), `${v} ${p.id}`).toBe(true);
      }
      for (let i = 0; i < leaves.length; i++) {
        for (let j = i + 1; j < leaves.length; j++) {
          expect(
            apart(must(leaves[i]).rect, must(leaves[j]).rect),
            `${v} ${must(leaves[i]).id} / ${must(leaves[j]).id}`,
          ).toBe(true);
        }
      }
      for (const p of leaves) {
        expect(p.rect.w * p.rect.h, `${v} ${p.id}`).toBeLessThan(ctl.w * ctl.h);
      }
    }
  });
});
