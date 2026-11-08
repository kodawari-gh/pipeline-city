import { describe, expect, it } from 'vitest';
import { Box3, Group, type Material } from 'three';
import { softBox, type RectLike } from '@/core/render/three/geometry';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { driveBody } from '@/features/storage/render/drives';
import { GEO, M2_SLOTS, setLayoutTier } from '../layout/layout';
import { m2Socket } from '../layout/pins';
import { nvmeStick } from './nvme3d';
import { chipset, coinCell, m2Standoff, PCH_OVER, sataDrive, type Raise } from './parts3d';

/** A `Raise` that only stands the box up (no art in a test), and keeps what it raised. */
const raiser = () => {
  const raised: RectLike[] = [];
  const raise: Raise = (parent, r, z0, z1, side: Material) => { raised.push(r); const g = new Group(); g.add(softBox(r, z0, z1, side as never, 0)); parent.add(g); return g; };
  return { raise, raised };
};

describe('the 3D board parts', () => {
  it('lays an NVMe stick on its socket and standoff: its fingers in the connector, its notch over the standoff', () => {
    setLayoutTier(3, 3);
    const m = M2_SLOTS[0]!, b = driveBody('ssd-nvme', 'm20'), post = new Box3().setFromObject(m2Standoff(m)), so = m2Socket(m);
    for (const heatsink of [false, true]) {
      const g = new Group();
      nvmeStick(g, b, { name: 'NVMe SSD 128K', capacityBytes: 128 * 1024, heatsink });
      const pcb = new Box3().setFromObject(g.getObjectByName('nvme-pcb')!), box = new Box3().setFromObject(g);
      // a real M.2 2280: 80 x 22 mm, 0.8 mm thick, from the fingers (in the socket's mouth) to the notch, the notch centred on the standoff
      expect(pcb.min.x).toBeGreaterThan(so.x);
      expect(pcb.min.x).toBeLessThan(so.x + so.w);
      expect(pcb.max.x - pcb.min.x).toBeCloseTo(80 * 23, 0);
      expect(pcb.max.y - pcb.min.y).toBeCloseTo(22 * 23, 0);
      expect(pcb.max.z - pcb.min.z).toBeCloseTo(0.8 * 23, 0);
      expect(pcb.max.x).toBeCloseTo((post.min.x + post.max.x) / 2, 0);
      // it lies on the standoff; a heat sink stands 9 mm over the board, under the cards' coolers
      expect(box.min.z, `heatsink ${heatsink}`).toBeGreaterThanOrEqual(post.max.z - 1);
      expect(box.max.z, `heatsink ${heatsink}`).toBeLessThan(BOARD_Z + (heatsink ? 215 : 100));
      // the heat sink's skirts clip it to the board's edges, within the slot's width
      expect(box.max.y - box.min.y, `heatsink ${heatsink}`).toBeLessThan(m.h);
    }
  });

  it('leaves the Starter\'s chipset bare and covers the others, legs and all, with a low heat sink', () => {
    for (const tier of [0, 1, 2, 3]) {
      setLayoutTier(tier, tier);
      const q = GEO.chip, { root, glow } = chipset(q, tier, raiser().raise), b = new Box3().setFromObject(root);
      // a real chipset sink is low: well under the PCIe cards and the M.2 sticks' neighbours
      expect(b.max.z - BOARD_Z, `tier ${tier}`).toBeLessThan(260);
      expect(b.max.z - BOARD_Z, `tier ${tier}`).toBeGreaterThan(tier === 0 ? 40 : 110);
      // the sink runs on past the package over its legs (they stand 18 out); the bare package does not
      const over = tier === 0 ? 0 : PCH_OVER;
      expect(b.min.x, `tier ${tier}`).toBeCloseTo(q.x - over, 0);
      expect(b.max.x, `tier ${tier}`).toBeCloseTo(q.x + q.w + over, 0);
      expect(!!glow, `tier ${tier}`).toBe(tier === 3);
    }
  });

  it('sits the coin cell in its holder over its 2D spot, and stands a drive on its bay\'s rails', () => {
    setLayoutTier(3, 3);
    const c = new Box3().setFromObject(coinCell(GEO.bat)), r = GEO.bat;
    expect(Math.abs((c.min.y + c.max.y) / 2 + (r.y + r.h / 2))).toBeLessThan(2);
    expect(c.min.z).toBeCloseTo(BOARD_Z, 0);
    for (const hdd of [true, false]) {
      const g = new Group(), b = driveBody(hdd ? 'hdd' : 'ssd-sata', 'sata0');
      sataDrive(g, hdd, b, 5000, raiser().raise);
      const d = new Box3().setFromObject(g);
      expect(d.min.z).toBeGreaterThanOrEqual(5000 - 1);
      expect(d.max.z - d.min.z).toBeGreaterThan(hdd ? 150 : 60);
    }
  });
});
