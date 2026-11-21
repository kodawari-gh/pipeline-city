import { describe, expect, it } from 'vitest';
import { BD, NIC_BRACKET_X, NIC_LEN, nicY, setLayoutTier, type Rect } from '../../../board/render/layout/layout';
import { NIC_BAND, NIC_BODIES, NIC_FACE, folded, moveBy, nicBuildRect, nicFaceRect, nicGeo, nicIds, nicParts } from './niclayout';
import { NIC_DIE, nicInput } from './nicplan';

const VISUALS = ['nic-gbe', 'nic-10g', 'nic-40g'];
const inside = (r: Rect, o: Rect): boolean => r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;
const apart = (a: Rect, b: Rect): boolean => a.x >= b.x + b.w - 0.01 || b.x >= a.x + a.w - 0.01 || a.y >= b.y + b.h - 0.01 || b.y >= a.y + a.h - 0.01;

describe('the card\'s flat strip on the board', () => {
  setLayoutTier(3, 3);

  it('reaches north of the slot\'s line over the card\'s body and south of it over the finger tab: the card lies at its own slot', () => {
    for (const v of VISUALS) for (const slot of [0, 1, 2]) {
      const f = nicFaceRect(slot, v);
      expect(f.y, `${v} ${slot}`).toBe(nicY(slot) - NIC_FACE.north);
      expect(f.h, `${v} ${slot}`).toBe(NIC_FACE.north + NIC_FACE.south);
      // a card of the PCIe slot's pitch above and below does not touch it
      expect(f.h, `${v} ${slot}`).toBeLessThanOrEqual(640);
    }
    // (the 3D card's finger tab is 140 high)
    expect(NIC_FACE.south).toBeGreaterThanOrEqual(140);
  });

  it('reaches from the jack at the bracket to the far end of the board, and keeps the strips of the slots apart', () => {
    for (const v of VISUALS) {
      const faces = [0, 1, 2].map((i) => nicFaceRect(i, v));
      for (const f of faces) {
        expect(f.x, v).toBeLessThanOrEqual(NIC_BRACKET_X);
        expect(f.x + f.w, v).toBe(BD.x + NIC_LEN[v]!);
      }
      for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) expect(apart(faces[i]!, faces[j]!), `${v} ${i}/${j}`).toBe(true);
    }
  });

  it('folds a rectangle over about the slot\'s line: its x stays, its distance from the line stays, the sides swap', () => {
    for (const v of VISUALS) for (const slot of [0, 2]) {
      const y0 = nicY(slot), r = { x: 300, y: y0 + 40, w: 120, h: 90 }, t = folded(r, slot);
      expect(t.x, v).toBe(r.x);
      expect(t.w, v).toBe(r.w);
      expect(t.h, v).toBe(r.h);
      expect(t.y + t.h / 2 - y0, v).toBeCloseTo(-(r.y + r.h / 2 - y0), 6);
      // (folding twice is the card as it was)
      expect(folded(t, slot).y, v).toBeCloseTo(r.y, 6);
    }
  });

  it('builds the card with its body south of the line and its finger tab north of it: the flat strip folded over', () => {
    for (const v of VISUALS) for (const slot of [0, 2]) {
      const b = nicBuildRect(slot, v), f = nicFaceRect(slot, v);
      expect(b.y, v).toBe(nicY(slot) - NIC_FACE.south);
      expect(b.y + b.h, v).toBe(nicY(slot) + NIC_FACE.north);
      expect(b.x, v).toBe(f.x);
      expect(b.w, v).toBe(f.w);
      expect(folded(b, slot), v).toEqual(f);
    }
  });
});

describe('the die\'s frame', () => {
  setLayoutTier(3, 3);

  it('gives each card a band of its own in the die frame, wide enough that two plans never meet', () => {
    expect(NIC_BAND).toBeGreaterThan(NIC_DIE.w);
    for (const v of VISUALS) for (const slot of [0, 1, 2, 3]) {
      const g = nicGeo(v, slot);
      expect(g.origin, `${v} ${slot}`).toEqual({ x: slot * NIC_BAND, y: 0 });
      expect(g.die, `${v} ${slot}`).toEqual({ x: slot * NIC_BAND, y: 0, w: NIC_DIE.w, h: NIC_DIE.h });
      expect(g.face, v).toEqual(nicFaceRect(slot, v));
    }
    const a = nicGeo('nic-gbe', 0).die, b = nicGeo('nic-gbe', 1).die;
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
      expect(new Set(ids).size, v).toBe(ids.length);
      expect(ids.every((i) => i.startsWith('pcie1.nic-')), v).toBe(true);
      expect(ids, v).toEqual(expect.arrayContaining(['pcie1.nic-ctl', 'pcie1.nic-jack', 'pcie1.nic-edge', 'pcie1.nic-label', 'pcie1.nic-phy', 'pcie1.nic-mac', 'pcie1.nic-stats', 'pcie1.nic-rxq', 'pcie1.nic-txq', 'pcie1.nic-dma', 'pcie1.nic-pcie', 'pcie1.nic-nvm', 'pcie1.nic-xtal', 'pcie1.nic-vreg', 'pcie1.nic-temp']));
      expect(ids, v).not.toContain('pcie1.nic-mag');
    }
  });

  it('names the controller once: its frame is the die\'s block and its chip is the 3D body (the die\'s id is the chip\'s)', () => {
    const g = nicGeo('nic-10g', 1), blocks = nicParts(g).map((p) => p.id);
    expect(blocks.filter((i) => i === 'nic-ctl')).toHaveLength(1);
    expect((NIC_BODIES as readonly string[]).includes('nic-ctl')).toBe(false);
    expect(nicIds('nic-10g', 'pcie1', 1).filter((i) => i === 'pcie1.nic-ctl')).toHaveLength(1);
  });

  it('keeps the blocks inside the die, apart, and the frame under the blocks it holds', () => {
    for (const v of VISUALS) {
      const g = nicGeo(v, 2), parts = nicParts(g), leaves = parts.filter((p) => p.id !== 'nic-ctl');
      for (const p of parts) expect(inside(p.rect, g.die), `${v} ${p.id}`).toBe(true);
      for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) expect(apart(leaves[i]!.rect, leaves[j]!.rect), `${v} ${leaves[i]!.id} / ${leaves[j]!.id}`).toBe(true);
      // the smallest rectangle under the pointer wins, so the frame must be larger than each block it holds
      const ctl = parts.find((p) => p.id === 'nic-ctl')!.rect;
      for (const id of ['nic-phy', 'nic-mac', 'nic-rxq', 'nic-dma', 'nic-pcie']) expect(parts.find((p) => p.id === id)!.rect.w * parts.find((p) => p.id === id)!.rect.h, `${v} ${id}`).toBeLessThan(ctl.w * ctl.h);
    }
  });

  it('moves a rectangle by the band\'s origin', () => {
    expect(moveBy({ x: 10, y: 20, w: 30, h: 40 }, { x: 2000, y: 0 })).toEqual({ x: 2010, y: 20, w: 30, h: 40 });
  });
});
