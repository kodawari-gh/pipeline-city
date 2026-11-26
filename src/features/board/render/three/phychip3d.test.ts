import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { findById } from '@/core/render/three/pick';
import { BOARD_NIC, boardLook } from '@/features/network/render/nic/nicplan';
import { BOARD_BAND, nicGeo } from '@/features/network/render/nic/niclayout';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { GEO, setLayoutTier } from '../layout/layout';
import { PHY_MARK, phyChip } from './phychip3d';
import { CHIP_H } from './solids3d';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;

const ID = `${BOARD_NIC}.nic-ctl`;
const LOOKS = ['board-fe', 'board-ge'];

/** The chip over the board's own rectangle for it (a tier with an Ethernet chip), with its plan and a floorplan that only records how it was put on. */
function chip(look: string, seen: { frame: three.Group; scale: number }[] = [], root = new three.Group()) {
  setLayoutTier(3, 3);
  return phyChip(must(GEO.phy), look, ID, nicGeo(look, BOARD_BAND).die, (frame, scale) => {
    seen.push({ frame, scale });
    return { root, z: 3 / scale };
  });
}

describe('the Ethernet chip on the motherboard, in 3D', () => {
  it("stands over the rectangle the board draws for it, a quad flat package as tall as the board's other small chips, tagged with its part id", () => {
    for (const look of LOOKS) {
      const c = chip(look),
        r = must(GEO.phy),
        b = new three.Box3().setFromObject(c.root);
      // (the board's own frame: layout y is the negative of the world's y, depth up from the board's face)
      expect(b.min.x).toBeCloseTo(r.x, 3);
      expect(b.max.x).toBeCloseTo(r.x + r.w, 3);
      expect(-b.max.y).toBeCloseTo(r.y, 3);
      expect(-b.min.y).toBeCloseTo(r.y + r.h, 3);
      expect(b.min.z).toBeGreaterThanOrEqual(BOARD_Z - 0.01);
      // (the mould's top, and its marking a hair above it)
      expect(b.max.z - BOARD_Z).toBeGreaterThanOrEqual(CHIP_H);
      expect(b.max.z - BOARD_Z).toBeLessThan(CHIP_H + 1);
      expect(c.top).toBe(CHIP_H);
      expect(c.root.userData['id']).toBe(ID);
      expect(findById(c.root, ID)).toBe(c.root);
    }
  });

  it("has its die as wide as the pad, in the middle of the chip, the die's rectangle in layout units as the board's", () => {
    for (const look of LOOKS) {
      const c = chip(look),
        r = must(GEO.phy),
        plan = nicGeo(look, BOARD_BAND).die;
      // (no bare package round the floorplan: the die has the plan's shape and fills the chip to a rim of 3 % at most)
      expect(c.rect.w / c.rect.h).toBeCloseTo(plan.w / plan.h, 6);
      expect(c.rect.w / r.w).toBeGreaterThan(0.97);
      expect(c.rect.h / r.h).toBeGreaterThan(0.97);
      expect(c.rect.w).toBeLessThanOrEqual(r.w);
      expect(c.rect.h).toBeLessThanOrEqual(r.h);
      expect(c.rect.x + c.rect.w / 2).toBeCloseTo(r.x + r.w / 2, 6);
      expect(c.rect.y + c.rect.h / 2).toBeCloseTo(r.y + r.h / 2, 6);
      // the die stands on its pad, under the mould's top
      expect(c.dieTop).toBeGreaterThan(0);
      expect(c.dieTop).toBeLessThan(c.top);
      // the plan covers the whole chip's pad: a plan unit is the die over the plan
      expect(c.scale * nicGeo(look, BOARD_BAND).die.w).toBeCloseTo(c.rect.w, 6);
      expect(c.plan).toBe(nicGeo(look, BOARD_BAND).die);
    }
  });

  it("puts the floorplan on the die: its frame is placed so the plan's middle lies on the die's, drawn at the die's scale, face up", () => {
    for (const look of LOOKS) {
      const seen: { frame: three.Group; scale: number }[] = [],
        c = chip(look, seen),
        p = c.plan;
      expect(seen).toHaveLength(1);
      const f = must(seen[0]).frame;
      expect(f.scale.x).toBeCloseTo(c.scale, 9);
      expect(f.scale.y).toBeCloseTo(c.scale, 9);
      // the plan's middle (a plan's y runs down: toward -y of the frame) lands on the die's middle, on its top
      f.updateMatrixWorld(true);
      const mid = f.localToWorld(new three.Vector3(p.x + p.w / 2, -(p.y + p.h / 2), 0));
      expect(mid.x).toBeCloseTo(c.rect.x + c.rect.w / 2, 4);
      expect(-mid.y).toBeCloseTo(c.rect.y + c.rect.h / 2, 4);
      expect(mid.z).toBeCloseTo(BOARD_Z + c.dieTop, 4);
      // the die's face for the live layer stands in that frame, over the baked floorplan
      expect(c.die).not.toBeNull();
      expect(must(c.die).z).toBeCloseTo(3 / c.scale, 9);
    }
  });

  it("shows the mould far away and the floorplan close in: the lid fades with the zoom, the die's face shows when it has gone", () => {
    for (const look of LOOKS) {
      const root = new three.Group(),
        c = chip(look, [], root);
      c.lod(0.05);
      expect(c.lid.visible).toBe(true);
      expect(root.visible).toBe(false);
      c.lod(30);
      expect(c.lid.visible).toBe(false);
      expect(root.visible).toBe(true);
      // (the mould is in the root, tagged with the part's id, so a pick on it names the controller)
      expect(findById(c.root, ID)).toBe(c.root);
      let n = 0;
      c.lid.traverse((o) => {
        if (isMesh(o)) {
          n++;
        }
      });
      expect(n).toBeGreaterThan(0);
    }
  });

  it('has no floorplan when it is given none (a plain die)', () => {
    setLayoutTier(3, 3);
    const c = phyChip(must(GEO.phy), 'board-ge', ID, nicGeo('board-ge', BOARD_BAND).die);
    expect(c.die).toBeNull();
    c.lod(30);
    expect(c.lid.visible).toBe(false);
  });

  it('wears the laser marking of its look: the chip, the standard it speaks and a date code', () => {
    expect(Object.keys(PHY_MARK).toSorted()).toStrictEqual([...LOOKS].toSorted());
    for (const look of LOOKS) {
      expect(must(PHY_MARK[look])).toHaveLength(3);
      expect(must(PHY_MARK[look])[0]).toBe(look === 'board-fe' ? 'RL-E100' : 'RL-E111');
    }
    expect(boardLook(100)).toBe('board-fe');
    expect(boardLook(1000)).toBe('board-ge');
  });
});
