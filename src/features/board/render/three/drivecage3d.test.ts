import { describe, expect, it } from 'vitest';
import { BAY_CELLS, CASE_IN, FAN_SLOT, GUTTER_X, RAD_GAP, RAD_ROOM, setLayoutTier } from '../layout/layout';
import { basementPlan } from './basement3d';
import { frontFanRects } from '@/features/room/render/desk/props/case';
import { CASE_FRONT as FRONT } from '@/features/room/render/three/roomplan';
import { cagePlan, onTray, TRAY } from './drivecage3d';
import { HDD_MM, SSD_MM } from './drive3d';
import { MM } from './pcbkit3d';
import { TRAY_Z } from './wires3d';

describe('the 3D drive cage', () => {
  it('holds a tray for every bay, 34 mm apart as a real cage, inside the case between the gutter and the front fans', () => {
    for (const t of [0, 1, 2, 3]) {
      setLayoutTier(t, t);
      const p = cagePlan();
      expect(p.trays.length, `tier ${t}`).toBe(BAY_CELLS.length);
      expect(p.x0, `tier ${t}`).toBeGreaterThan(GUTTER_X);
      expect(p.top, `tier ${t}`).toBeGreaterThan(CASE_IN.y);
      // it stands on the shroud's shelf, which runs on past it to its slotted east wall, short of a front radiator; the fan cords pass under the shelf
      const b = basementPlan();
      expect(p.bottom, `tier ${t}`).toBe(b.top);
      expect(p.x0, `tier ${t}`).toBeGreaterThanOrEqual(b.shelf);
      expect(p.x1, `tier ${t}`).toBeLessThan(b.east - 40);
      expect(FAN_SLOT.y, `tier ${t} the fan cords pass under the shelf`).toBeGreaterThan(b.top + 30);
      for (const f of frontFanRects()) expect(b.east, `tier ${t} clear of a front radiator`).toBeLessThan(f.x - RAD_ROOM + RAD_GAP);
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
