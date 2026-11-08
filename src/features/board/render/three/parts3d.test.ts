import { describe, expect, it } from 'vitest';
import { Box3, Group, type Material } from 'three';
import { softBox, type RectLike } from '@/core/render/three/geometry';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { driveBody } from '@/features/storage/render/drives';
import { GEO, M2_SLOTS, setLayoutTier } from '../layout/layout';
import { m2Socket } from '../layout/pins';
import { chipset, coinCell, m2Standoff, nvmeStick, PCH_OVER, sataDrive, type Raise } from './parts3d';

/** A `Raise` that only stands the box up (no art in a test), and keeps what it raised. */
const raiser = () => {
  const raised: RectLike[] = [];
  const raise: Raise = (parent, r, z0, z1, side: Material) => { raised.push(r); const g = new Group(); g.add(softBox(r, z0, z1, side as never, 0)); parent.add(g); return g; };
  return { raise, raised };
};

describe('the 3D board parts', () => {
  it('lays an NVMe stick on its socket and standoff: its fingers in the connector, its notch over the standoff', () => {
    setLayoutTier(3, 3);
    const m = M2_SLOTS[0]!, b = driveBody('ssd-nvme', 'm20'), { raise, raised } = raiser(), g = new Group();
    nvmeStick(g, m, b, raise);
    const pcb = raised[0]!, box = new Box3().setFromObject(g), post = new Box3().setFromObject(m2Standoff(m)), so = m2Socket(m);
    // a real M.2 2280: 80 x 22 mm from the fingers (in the socket's mouth) to the notch, the notch centred on the standoff
    expect(pcb.x).toBeGreaterThan(so.x);
    expect(pcb.x).toBeLessThan(so.x + so.w);
    expect(pcb.w).toBe(80 * 23);
    expect(pcb.h).toBe(22 * 23);
    expect(pcb.x + pcb.w).toBeCloseTo((post.min.x + post.max.x) / 2, 0);
    // the screw's head (34 round) on the standoff reaches over the PCB's end
    expect(pcb.x + pcb.w + 34).toBeGreaterThan((post.min.x + post.max.x) / 2);
    expect(box.min.z).toBeGreaterThanOrEqual(post.max.z - 1);
    expect(box.max.z).toBeLessThan(BOARD_Z + 200);
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
