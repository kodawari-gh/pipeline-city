import { afterAll, describe, expect, it } from 'vitest';
import { CASE_BD, CASE_IN, FAN_LEN, GEO, PCIE_RAILS, PSU, REAR_FAN, REAR_FAN_FITTED, TOP_FANS, setLayoutTier } from '@/features/board/render/layout/layout';
import { BOARD_Z, CASE_FRONT, REAR_ZC } from '@/features/room/render/three/roomplan';
import { basementPlan } from '@/features/board/render/three/basement3d';
import { frontFanRects, standoffs } from './case';

afterAll(() => setLayoutTier(2));

describe('the case\'s mounts and fans', () => {
  it('has a stud under every hole of every board it takes, all on the tray above the shroud', () => {
    for (let c = 0; c <= 3; c++) for (let b = 0; b <= c; b++) {
      setLayoutTier(b, c);
      const studs = standoffs();
      for (const [x, y] of GEO.holes) {
        expect(studs.some(([sx, sy]) => sx === x && sy === y), `case ${c} board ${b} hole ${x},${y}`).toBe(true);
        expect(y + 66, `case ${c} board ${b}`).toBeLessThan(PSU.y);
      }
      for (const [x, y] of studs) {
        expect(x > CASE_BD.x && x < CASE_BD.x + CASE_BD.w && y > CASE_BD.y && y < CASE_BD.y + CASE_BD.h, `case ${c} stud ${x},${y}`).toBe(true);
      }
    }
  });

  it('gives each board its own count of screws, more for the bigger boards', () => {
    const n = [0, 1, 2, 3].map((t) => { setLayoutTier(t, t); return GEO.holes.length; });
    expect(n).toEqual([6, 8, 9, 12]);
  });

  it('fits the tier\'s size of fan on every mount, inside the case', () => {
    for (let c = 0; c <= 3; c++) {
      setLayoutTier(c, c);
      expect(FAN_LEN, `case ${c}`).toBe([2120, 2120, 2760, 3220][c]);
      for (const r of frontFanRects()) {
        expect(r.h, `case ${c} front`).toBe(FAN_LEN);
        expect(r.y, `case ${c} front`).toBeGreaterThanOrEqual(CASE_IN.y);
        expect(r.y + r.h, `case ${c} front`).toBeLessThanOrEqual(CASE_IN.y + CASE_IN.h);
        // (a fan beside the basement stands east of the shroud, which stops short of it)
        if (r.y + r.h > PSU.y) expect(r.x, `case ${c} front`).toBeGreaterThan(basementPlan().east);
      }
      const front = frontFanRects()[0]!;
      for (const r of TOP_FANS) {
        expect(r.w, `case ${c} top`).toBe(FAN_LEN);
        expect(r.x + r.w, `case ${c} top clears the front fans`).toBeLessThan(front.x);
        if (REAR_FAN_FITTED) expect(r.y + r.h, `case ${c} top clears the rear fan`).toBeLessThan(REAR_FAN.y);
      }
      if (REAR_FAN_FITTED) {
        expect(REAR_FAN.h, `case ${c} rear`).toBe(FAN_LEN);
        // above the first expansion slot, beside the I/O plate in depth and inside the side panel
        expect(REAR_FAN.y + REAR_FAN.h, `case ${c} rear`).toBeLessThan(PCIE_RAILS[0]!.y);
        expect(REAR_ZC - FAN_LEN / 2, `case ${c} rear`).toBeGreaterThanOrEqual(BOARD_Z + 1240);
        expect(REAR_ZC + FAN_LEN / 2, `case ${c} rear`).toBeLessThan(CASE_FRONT - 100);
      }
    }
  });
});
