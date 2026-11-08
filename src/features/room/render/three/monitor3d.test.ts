import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { DESK_Y, MONITOR, MONITOR_POWER, SCREEN, setLayoutTier, VIDEO_SOCKET } from '@/features/board/render/layout/layout';
import { MONITOR_Z } from './roomplan';
import { MONITOR_PLUG, monitorBody, monitorPlan, monitorSeats, type MonitorBox } from './monitor3d';

const MM = 18.7;
const inside = (p: readonly number[], b: MonitorBox) => p[0]! > b.r.x && p[0]! < b.r.x + b.r.w && -p[1]! > b.r.y && -p[1]! < b.r.y + b.r.h && p[2]! > b.z0 && p[2]! < b.z1;

describe('the 3D monitor', () => {
  it('stands its column on the foot, the foot on the desk, and holds the panel at the bracket', () => {
    for (const t of [0, 2]) {
      setLayoutTier(t, t);
      const p = monitorPlan(MONITOR, DESK_Y, MONITOR_Z);
      expect(p.foot.r.y + p.foot.r.h, `tier ${t}`).toBeCloseTo(DESK_Y);
      expect(p.column.r.y + p.column.r.h, `tier ${t} the column goes into the foot`).toBeGreaterThan(p.foot.r.y);
      expect(p.column.r.y, `tier ${t} the column reaches over the bracket`).toBeLessThan(p.vesa.y - 50 * MM);
      expect(p.column.z1, `tier ${t} the column behind the boss`).toBeLessThanOrEqual(p.boss.z0 + 40);
      expect(p.column.z0, `tier ${t} the column on the foot`).toBeGreaterThan(p.foot.z0);
      // a real 24 in. stand: a 200 x 165 mm foot, a 70 mm column
      expect(p.foot.r.w / MM).toBeCloseTo(200, 0);
      expect((p.foot.z1 - p.foot.z0) / MM).toBeCloseTo(165, 0);
      expect(p.column.r.w / MM).toBeCloseTo(70, 0);
      // the housing inside the panel's outline
      for (const b of [p.hump, p.boss]) {
        expect(b.r.x).toBeGreaterThan(MONITOR.x);
        expect(b.r.x + b.r.w).toBeLessThan(MONITOR.x + MONITOR.w);
        expect(b.r.y).toBeGreaterThan(MONITOR.y);
        expect(b.r.y + b.r.h).toBeLessThan(MONITOR.y + MONITOR.h);
      }
    }
  });

  it('lets the cables out where the layout has them, clear of the housing, under the panel', () => {
    for (const t of [0, 2]) {
      setLayoutTier(t, t);
      const s = monitorSeats(MONITOR, MONITOR_Z), p = monitorPlan(MONITOR, DESK_Y, MONITOR_Z);
      expect(s.video.at[0]).toBeCloseTo(VIDEO_SOCKET.x);
      expect(s.power.at[0]).toBeCloseTo(MONITOR_POWER.x);
      for (const seat of [s.video, s.power]) {
        for (const b of [p.panel, p.hump, p.boss, p.column, p.foot]) expect(inside(seat.at, b), `tier ${t}`).toBe(false);
        // the plug's end hangs under the panel, over the desk
        const end = -(seat.at[1] + seat.axis[1] * MONITOR_PLUG.l);
        expect(end).toBeGreaterThan(MONITOR.y + MONITOR.h);
        expect(end + MONITOR_PLUG.h).toBeLessThan(DESK_Y);
      }
    }
  });

  it('builds a body that stays inside its plan', () => {
    setLayoutTier(0, 0);
    const p = monitorPlan(MONITOR, DESK_Y, 0), b = new Box3().setFromObject(monitorBody(MONITOR, SCREEN, DESK_Y, 0));
    expect(b.min.y).toBeGreaterThanOrEqual(-DESK_Y - 1);
    expect(b.max.y).toBeLessThanOrEqual(-MONITOR.y + 1);
    expect(b.min.z).toBeGreaterThanOrEqual(p.foot.z0 - 1);
    expect(b.max.z).toBeLessThanOrEqual(p.foot.z1 + 1);
    expect(b.min.x).toBeGreaterThanOrEqual(MONITOR.x - 1);
    expect(b.max.x).toBeLessThanOrEqual(MONITOR.x + MONITOR.w + 1);
  });
});
