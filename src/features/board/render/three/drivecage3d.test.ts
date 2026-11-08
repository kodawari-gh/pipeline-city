import { describe, expect, it } from 'vitest';
import { BASE_BAYS, BAY_CELLS, CASE_IN, FAN_HUB, FAN_SLOT, GUTTER_X, RAD_GAP, RAD_ROOM, setLayoutTier } from '../layout/layout';
import { basementPlan } from './basement3d';
import { frontFanRects } from '@/features/room/render/desk/props/case';
import { CASE_FRONT as FRONT } from '@/features/room/render/three/roomplan';
import { baseCagePlan, cagePlan, onTray, TRAY, traySpot, type CagePlan } from './drivecage3d';
import { HDD_MM, SSD_MM } from './drive3d';
import { MM } from './pcbkit3d';
import { TRAY_Z } from './wires3d';

/** A cage's own checks: its trays 34 mm apart, each inside it with room for the plugs behind. */
function trays(p: CagePlan, t: number) {
  expect(p.z0, `tier ${t}`).toBeGreaterThanOrEqual(TRAY_Z);
  expect(p.z1, `tier ${t}`).toBeLessThan(FRONT);
  for (let i = 1; i < p.trays.length; i++) expect(p.trays[i]!.y - p.trays[i - 1]!.y, `tier ${t}`).toBe(-785);
  for (const s of p.trays) {
    expect(s.x, `tier ${t}`).toBeGreaterThan(p.x0);
    expect(s.x + TRAY.w, `tier ${t}`).toBeLessThan(p.x1);
    expect(s.z, `tier ${t} room for the plugs behind the tray`).toBeGreaterThan(p.z0 + 13 * MM);
    expect(s.z + TRAY.l, `tier ${t}`).toBeLessThan(p.z1);
    expect(-s.y, `tier ${t}`).toBeLessThan(p.bottom);
    expect(-s.y - 700, `tier ${t}`).toBeGreaterThan(p.top);
  }
}

describe('the 3D drive cages', () => {
  it('hold a tray for every bay, the first two in the basement, the rest in the main cage, inside the case between the gutter and the front fans', () => {
    for (const t of [0, 1, 2, 3]) {
      setLayoutTier(t, t);
      const p = cagePlan(), q = baseCagePlan(), b = basementPlan();
      expect(q.trays.map((s) => s.slot), `tier ${t}`).toEqual(Array.from({ length: BASE_BAYS }, (_, i) => i));
      expect(p.trays.map((s) => s.slot), `tier ${t}`).toEqual(Array.from({ length: BAY_CELLS.length - BASE_BAYS }, (_, i) => BASE_BAYS + i));
      for (let i = 0; i < BAY_CELLS.length; i++) expect(traySpot([q, p], i), `tier ${t} bay ${i}`).toBeDefined();
      expect(p.x0, `tier ${t}`).toBeGreaterThan(GUTTER_X);
      expect(p.top, `tier ${t}`).toBeGreaterThan(CASE_IN.y);
      // the main cage stands on the shroud's shelf, which runs on past it to its slotted east wall, short of a front radiator; the fan cords pass under the shelf
      expect(p.bottom, `tier ${t}`).toBe(b.top);
      expect(p.x1, `tier ${t}`).toBeLessThan(b.east - 40);
      expect(FAN_SLOT.y, `tier ${t} the fan cords pass under the shelf`).toBeGreaterThan(b.top + 30);
      for (const f of frontFanRects()) expect(b.east, `tier ${t} clear of a front radiator`).toBeLessThan(f.x - RAD_ROOM + RAD_GAP);
      // the basement's cage under it: on the floor, under the shroud's top, behind its folded edge at the glass side; the side panels end west of the hub, which is clear of the cage's flanges and of the supply's room
      expect([q.x0, q.x1], `tier ${t}`).toEqual([p.x0, p.x1]);
      expect(q.bottom, `tier ${t}`).toBe(b.floor);
      expect(q.top, `tier ${t}`).toBeGreaterThan(b.top + 30);
      expect(q.z1, `tier ${t}`).toBeLessThan(FRONT - 110);
      expect(b.shelf, `tier ${t}`).toBeLessThan(FAN_HUB.x);
      expect(FAN_HUB.x + FAN_HUB.w, `tier ${t}`).toBeLessThan(q.x0 - 60);
      expect(FAN_HUB.x, `tier ${t}`).toBeGreaterThan(b.vent.x);
      expect(FAN_HUB.y + FAN_HUB.h, `tier ${t}`).toBeLessThan(b.floor);
      trays(p, t);
      trays(q, t);
    }
  });

  it('fits a real 3.5 in. hard disk on its pins and a 2.5 in. SSD on its floor, inside the rails and under the tray above', () => {
    for (const [hdd, d] of [[true, HDD_MM], [false, SSD_MM]] as const) {
      const o = onTray(hdd), w = d.w * MM, l = d.l * MM, t = d.t * MM;
      expect(o.x, `${hdd}`).toBeGreaterThan(TRAY.rail);
      expect(o.x + w, `${hdd}`).toBeLessThan(TRAY.w - TRAY.rail);
      expect(o.y, `${hdd}`).toBeGreaterThanOrEqual(TRAY.floor);
      expect(o.z + l, `${hdd}`).toBeLessThan(TRAY.l - 26);
      expect(o.y + t, `${hdd} clears the tray above`).toBeLessThan(785 - 40);
    }
  });
});
