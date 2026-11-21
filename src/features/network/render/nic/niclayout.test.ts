import { describe, expect, it } from 'vitest';
import { BD, NIC_BRACKET_X, NIC_LEN, nicY, setLayoutTier, type Rect } from '../../../board/render/layout/layout';
import { NIC_FACE, NIC_PLAN_TOP, moveBy, nicFaceRect, nicGeo, nicIds, nicParts } from './niclayout';
import { nicInput } from './nicplan';

const VISUALS = ['nic-gbe', 'nic-10g', 'nic-40g'];
const inside = (r: Rect, o: Rect): boolean => r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;
const apart = (a: Rect, b: Rect): boolean => a.x >= b.x + b.w - 0.01 || b.x >= a.x + a.w - 0.01 || a.y >= b.y + b.h - 0.01 || b.y >= a.y + a.h - 0.01;

describe('the card\'s face on the board', () => {
  setLayoutTier(3, 3);

  it('reaches from the slot\'s line up over the finger tab and down over the body, the way a graphics card does', () => {
    for (const v of VISUALS) for (const slot of [0, 1, 2]) {
      const f = nicFaceRect(slot, v);
      expect(f.y, `${v} ${slot}`).toBe(nicY(slot) - NIC_FACE.north);
      expect(f.h, `${v} ${slot}`).toBe(NIC_FACE.north + NIC_FACE.south);
      // a card of the PCIe slot's pitch above and below does not touch it
      expect(f.h, `${v} ${slot}`).toBeLessThanOrEqual(640);
    }
    expect(NIC_FACE.north).toBeGreaterThanOrEqual(140);
  });

  it('reaches from the jack at the bracket to the far end of the board, and keeps the faces of the slots apart', () => {
    for (const v of VISUALS) {
      const faces = [0, 1, 2].map((i) => nicFaceRect(i, v));
      for (const f of faces) {
        expect(f.x, v).toBeLessThanOrEqual(NIC_BRACKET_X);
        expect(f.x + f.w, v).toBe(BD.x + NIC_LEN[v]!);
      }
      for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) expect(apart(faces[i]!, faces[j]!), `${v} ${i}/${j}`).toBe(true);
    }
  });

  it('puts the plan on the face, under the finger tab, and the controller\'s frame inside the plan', () => {
    for (const v of VISUALS) for (const slot of [0, 1, 2]) {
      const g = nicGeo(v, slot);
      expect(g.face, v).toEqual(nicFaceRect(slot, v));
      expect(g.origin.y, v).toBe(nicY(slot) + NIC_PLAN_TOP);
      expect(inside(moveBy(g.plan.die, g.origin), g.face), `${v} ${slot} plan in face`).toBe(true);
      expect(inside(g.chip, moveBy(g.plan.die, g.origin)), `${v} ${slot} chip in plan`).toBe(true);
      // the gold fingers (a band along the slot's line) lie above the plan
      expect(g.origin.y, v).toBeGreaterThan(nicY(slot));
    }
  });

  it('is the same object for the same card, and a different plan for each tier', () => {
    expect(nicGeo('nic-10g', 1)).toBe(nicGeo('nic-10g', 1));
    expect(nicGeo('nic-gbe', 1).plan).not.toBe(nicGeo('nic-40g', 1).plan);
    expect(nicGeo('nic-gbe', 1).plan.input).toBe(nicInput('nic-gbe'));
  });
});

describe('the parts of the card that a pointer can meet', () => {
  setLayoutTier(3, 3);

  it('has an id for every block, with the slot in front, and no id twice', () => {
    for (const v of VISUALS) {
      const ids = nicIds(v, 'pcie1', 1);
      expect(new Set(ids).size, v).toBe(ids.length);
      expect(ids.every((i) => i.startsWith('pcie1.nic-')), v).toBe(true);
      expect(ids, v).toEqual(expect.arrayContaining(['pcie1.nic-ctl', 'pcie1.nic-jack', 'pcie1.nic-mag', 'pcie1.nic-phy', 'pcie1.nic-mac', 'pcie1.nic-stats', 'pcie1.nic-rxq', 'pcie1.nic-txq', 'pcie1.nic-dma', 'pcie1.nic-pcie', 'pcie1.nic-nvm', 'pcie1.nic-xtal', 'pcie1.nic-vreg', 'pcie1.nic-temp']));
    }
  });

  it('keeps the parts on the face, the blocks apart, and the frame under the blocks it holds', () => {
    for (const v of VISUALS) {
      const g = nicGeo(v, 2), parts = nicParts(g), leaves = parts.filter((p) => p.id !== 'nic-ctl');
      for (const p of parts) expect(inside(p.rect, g.face), `${v} ${p.id}`).toBe(true);
      for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) expect(apart(leaves[i]!.rect, leaves[j]!.rect), `${v} ${leaves[i]!.id} / ${leaves[j]!.id}`).toBe(true);
      // the smallest rectangle under the pointer wins, so the frame must be larger than each block it holds
      const ctl = parts.find((p) => p.id === 'nic-ctl')!.rect;
      for (const id of ['nic-phy', 'nic-mac', 'nic-rxq', 'nic-dma', 'nic-pcie']) expect(parts.find((p) => p.id === id)!.rect.w * parts.find((p) => p.id === id)!.rect.h, `${v} ${id}`).toBeLessThan(ctl.w * ctl.h);
    }
  });
});
