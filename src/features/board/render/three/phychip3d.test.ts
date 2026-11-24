import { describe, expect, it } from 'vitest';
import { Box3, Group, Mesh, Vector3 } from 'three';
import { findById } from '@/core/render/three/pick';
import { BOARD_NIC, boardLook } from '@/features/network/render/nic/nicplan';
import { BOARD_BAND, nicGeo } from '@/features/network/render/nic/niclayout';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { GEO, setLayoutTier } from '../layout/layout';
import { MM } from './pcbkit3d';
import { PHY_MARK, phyChip } from './phychip3d';
import { CHIP_H } from './solids3d';

const ID = `${BOARD_NIC}.nic-ctl`;
const LOOKS = ['board-fe', 'board-ge'];

/** The chip over the board's own rectangle for it (a tier with an Ethernet chip), with its plan and a floorplan that only records how it was put on. */
function chip(look: string, seen: { frame: Group; scale: number }[] = [], root = new Group()) {
  setLayoutTier(3, 3);
  return phyChip(GEO.phy!, look, ID, nicGeo(look, BOARD_BAND).die, (frame, scale) => {
    seen.push({ frame, scale });
    return { root, z: 3 / scale };
  });
}

describe('the Ethernet chip on the motherboard, in 3D', () => {
  it("stands over the rectangle the board draws for it, a quad flat package as tall as the board's other small chips, tagged with its part id", () => {
    for (const look of LOOKS) {
      const c = chip(look),
        r = GEO.phy!,
        b = new Box3().setFromObject(c.root);
      // (the board's own frame: layout y is the negative of the world's y, depth up from the board's face)
      expect(b.min.x, look).toBeCloseTo(r.x, 3);
      expect(b.max.x, look).toBeCloseTo(r.x + r.w, 3);
      expect(-b.max.y, look).toBeCloseTo(r.y, 3);
      expect(-b.min.y, look).toBeCloseTo(r.y + r.h, 3);
      expect(b.min.z, look).toBeGreaterThanOrEqual(BOARD_Z - 0.01);
      // (the mould's top, and its marking a hair above it)
      expect(b.max.z - BOARD_Z, look).toBeGreaterThanOrEqual(CHIP_H);
      expect(b.max.z - BOARD_Z, look).toBeLessThan(CHIP_H + 1);
      expect(c.top, look).toBe(CHIP_H);
      expect(c.root.userData['id'], look).toBe(ID);
      expect(findById(c.root, ID), look).toBe(c.root);
    }
  });

  it("has its die as wide as the pad, in the middle of the chip, the die's rectangle in layout units as the board's", () => {
    for (const look of LOOKS) {
      const c = chip(look),
        r = GEO.phy!,
        plan = nicGeo(look, BOARD_BAND).die;
      // (no bare package round the floorplan: the die has the plan's shape and fills the chip to a rim of 3 % at most)
      expect(c.rect.w / c.rect.h, look).toBeCloseTo(plan.w / plan.h, 6);
      expect(c.rect.w / r.w, look).toBeGreaterThan(0.97);
      expect(c.rect.h / r.h, look).toBeGreaterThan(0.97);
      expect(c.rect.w, look).toBeLessThanOrEqual(r.w);
      expect(c.rect.h, look).toBeLessThanOrEqual(r.h);
      expect(c.rect.x + c.rect.w / 2, look).toBeCloseTo(r.x + r.w / 2, 6);
      expect(c.rect.y + c.rect.h / 2, look).toBeCloseTo(r.y + r.h / 2, 6);
      // the die stands on its pad, under the mould's top
      expect(c.dieTop, look).toBeGreaterThan(0);
      expect(c.dieTop, look).toBeLessThan(c.top);
      // the plan covers the whole chip's pad: a plan unit is the die over the plan
      expect(c.scale * nicGeo(look, BOARD_BAND).die.w, look).toBeCloseTo(c.rect.w, 6);
      expect(c.plan, look).toBe(nicGeo(look, BOARD_BAND).die);
    }
  });

  it("puts the floorplan on the die: its frame is placed so the plan's middle lies on the die's, drawn at the die's scale, face up", () => {
    for (const look of LOOKS) {
      const seen: { frame: Group; scale: number }[] = [],
        c = chip(look, seen),
        p = c.plan;
      expect(seen, look).toHaveLength(1);
      const f = seen[0]!.frame;
      expect(f.scale.x, look).toBeCloseTo(c.scale, 9);
      expect(f.scale.y, look).toBeCloseTo(c.scale, 9);
      // the plan's middle (a plan's y runs down: toward -y of the frame) lands on the die's middle, on its top
      f.updateMatrixWorld(true);
      const mid = f.localToWorld(new Vector3(p.x + p.w / 2, -(p.y + p.h / 2), 0));
      expect(mid.x, look).toBeCloseTo(c.rect.x + c.rect.w / 2, 4);
      expect(-mid.y, look).toBeCloseTo(c.rect.y + c.rect.h / 2, 4);
      expect(mid.z, look).toBeCloseTo(BOARD_Z + c.dieTop, 4);
      // the die's face for the live layer stands in that frame, over the baked floorplan
      expect(c.die, look).not.toBeNull();
      expect(c.die!.z, look).toBeCloseTo(3 / c.scale, 9);
    }
  });

  it("shows the mould far away and the floorplan close in: the lid fades with the zoom, the die's face shows when it has gone", () => {
    for (const look of LOOKS) {
      const root = new Group(),
        c = chip(look, [], root);
      c.lod(0.05);
      expect(c.lid.visible, look).toBe(true);
      expect(root.visible, look).toBe(false);
      c.lod(30);
      expect(c.lid.visible, look).toBe(false);
      expect(root.visible, look).toBe(true);
      // (the mould is in the root, tagged with the part's id, so a pick on it names the controller)
      expect(findById(c.root, ID)).toBe(c.root);
      let n = 0;
      c.lid.traverse((o) => {
        if ((o as Mesh).isMesh) n++;
      });
      expect(n, look).toBeGreaterThan(0);
    }
  });

  it('has no floorplan when it is given none (a plain die)', () => {
    setLayoutTier(3, 3);
    const c = phyChip(GEO.phy!, 'board-ge', ID, nicGeo('board-ge', BOARD_BAND).die);
    expect(c.die).toBeNull();
    c.lod(30);
    expect(c.lid.visible).toBe(false);
  });

  it('wears the laser marking of its look: the chip, the standard it speaks and a date code', () => {
    expect(Object.keys(PHY_MARK).sort()).toEqual([...LOOKS].sort());
    for (const look of LOOKS) {
      expect(PHY_MARK[look]!, look).toHaveLength(3);
      expect(PHY_MARK[look]![0], look).toBe(look === 'board-fe' ? 'RL-E100' : 'RL-E111');
    }
    expect(boardLook(100)).toBe('board-fe');
    expect(boardLook(1000)).toBe('board-ge');
  });
});
