import { assert, afterAll, describe, expect, it } from 'vitest';
import {
  CASE_BD,
  CASE_IN,
  FAN_LEN,
  GEO,
  PCIE_RAILS,
  PSU,
  REAR_FAN,
  REAR_FAN_FITTED,
  TOP_FANS,
  setLayoutTier,
} from '@/features/board/render/layout/layout';
import { BOARD_Z, CASE_FRONT, REAR_ZC } from '@/features/room/render/three/roomplan';
import { basementPlan } from '@/features/board/render/three/basement3d';
import { frontFanRects, standoffs } from './case';

afterAll(() => {
  setLayoutTier(2);
});

/** Whether a stud stands at the hole. */
const hasStud = (studs: readonly (readonly [number, number])[], x: number, y: number): boolean =>
  studs.some(([sx, sy]) => sx === x && sy === y);

/** Whether a point is inside the board's tray. */
const onTray = (x: number, y: number): boolean =>
  x > CASE_BD.x && x < CASE_BD.x + CASE_BD.w && y > CASE_BD.y && y < CASE_BD.y + CASE_BD.h;

/** Whether a front fan clears the shroud: a fan beside the basement stands east of it, which stops short of it. */
const clearsShroud = (r: { x: number; y: number; h: number }): boolean =>
  r.y + r.h <= PSU.y || r.x > basementPlan().east;

/** Whether a top fan clears the rear fan (always, with none fitted). */
const clearsRear = (r: { y: number; h: number }): boolean => !REAR_FAN_FITTED || r.y + r.h < REAR_FAN.y;

/** How the rear fan fits, each check true with none fitted: the tier's size, above the first expansion slot, beside the I/O plate in depth and inside the side panel. */
function rearFit(): { size: boolean; aboveSlot: boolean; besideIo: boolean; inside: boolean } {
  if (!REAR_FAN_FITTED) {
    return { size: true, aboveSlot: true, besideIo: true, inside: true };
  }
  assert.exists(PCIE_RAILS[0]);
  return {
    size: REAR_FAN.h === FAN_LEN,
    aboveSlot: REAR_FAN.y + REAR_FAN.h < PCIE_RAILS[0].y,
    besideIo: REAR_ZC - FAN_LEN / 2 >= BOARD_Z + 1240,
    inside: REAR_ZC + FAN_LEN / 2 < CASE_FRONT - 100,
  };
}

describe("the case's mounts and fans", () => {
  it('has a stud under every hole of every board it takes, all on the tray above the shroud', () => {
    for (let c = 0; c <= 3; c++) {
      for (let b = 0; b <= c; b++) {
        setLayoutTier(b, c);
        const studs = standoffs();
        for (const [x, y] of GEO.holes) {
          expect(hasStud(studs, x, y), `case ${c} board ${b} hole ${x},${y}`).toBe(true);
          expect(y + 66, `case ${c} board ${b}`).toBeLessThan(PSU.y);
        }
        for (const [x, y] of studs) {
          expect(onTray(x, y), `case ${c} stud ${x},${y}`).toBe(true);
        }
      }
    }
  });

  it('gives each board its own count of screws, more for the bigger boards', () => {
    const n = [0, 1, 2, 3].map((t) => {
      setLayoutTier(t, t);
      return GEO.holes.length;
    });
    expect(n).toStrictEqual([6, 8, 9, 12]);
  });

  it("fits the tier's size of fan on every mount, inside the case", () => {
    for (let c = 0; c <= 3; c++) {
      setLayoutTier(c, c);
      expect(FAN_LEN, `case ${c}`).toBe([2120, 2120, 2760, 3220][c]);
      for (const r of frontFanRects()) {
        expect(r.h, `case ${c} front`).toBe(FAN_LEN);
        expect(r.y, `case ${c} front`).toBeGreaterThanOrEqual(CASE_IN.y);
        expect(r.y + r.h, `case ${c} front`).toBeLessThanOrEqual(CASE_IN.y + CASE_IN.h);
        // (a fan beside the basement stands east of the shroud, which stops short of it)
        expect(clearsShroud(r), `case ${c} front`).toBe(true);
      }
      const [front] = frontFanRects();
      assert.exists(front);
      for (const r of TOP_FANS) {
        expect(r.w, `case ${c} top`).toBe(FAN_LEN);
        expect(r.x + r.w, `case ${c} top clears the front fans`).toBeLessThan(front.x);
        expect(clearsRear(r), `case ${c} top clears the rear fan`).toBe(true);
      }
      // the rear fan: the tier's size, above the first expansion slot, beside the I/O plate in depth and inside the side panel
      expect(rearFit(), `case ${c} rear`).toStrictEqual({ size: true, aboveSlot: true, besideIo: true, inside: true });
    }
  });
});
