import { describe, expect, it } from 'vitest';
import type { RamRegion } from '../../sim/game/ramregions';
import { bubblesOf, coresText, regionOf, type BubbleTouch } from './rambubbles';

const reg = (id: string, lo: number, hi: number, name = id): RamRegion => ({ id, kind: 'os', name, note: '', lo, hi });
const regions = [reg('kernel', 0x1000, 0x2000, 'OS kernel'), reg('table', 0x2000, 0x3000, 'Job table'), reg('app', 0x4000, 0x8000, '#07 calc'), reg('work', 0x5000, 0x5400, 'calc memory')];
const touch = (addr: number, core: number, write = false, t = 0): BubbleTouch => ({ addr, core, write, t });

describe('RAM bubbles', () => {
  it('finds the region of an address, the smallest when they overlap, none outside them', () => {
    expect(regionOf(0x1800, regions)?.id).toBe('kernel');
    expect(regionOf(0x5100, regions)?.id).toBe('work');
    expect(regionOf(0x4100, regions)?.id).toBe('app');
    expect(regionOf(0x9000, regions)).toBeUndefined();
  });

  it('gives one bubble to a resource that several cores reach for, flagged shared, with what each core did', () => {
    const b = bubblesOf([touch(0x2004, 0, false, 1), touch(0x2008, 1, true, 2), touch(0x2010, 1, false, 3)], regions);
    expect(b).toHaveLength(1);
    expect(b[0]!.label).toBe('Job table');
    expect(b[0]!.contended).toBe(true);
    expect(b[0]!.writes).toBe(1);
    expect(b[0]!.addr).toBe(0x2010); // where the newest touch was
    expect(b[0]!.cores).toEqual([{ core: 1, reads: 1, writes: 1 }, { core: 0, reads: 1, writes: 0 }]);
    expect(coresText(b[0]!.cores)).toBe('C1+C0');
  });

  it('gives distinct resources distinct bubbles, newest first, and one core is not contention', () => {
    const b = bubblesOf([touch(0x1100, 0, false, 1), touch(0x4100, 0, false, 5)], regions);
    expect(b.map((x) => x.id)).toEqual(['app', 'kernel']);
    expect(b.every((x) => !x.contended)).toBe(true);
  });

  it('puts an address in no region on a bubble of RAM', () => {
    expect(bubblesOf([touch(0x9000, 2)], regions)[0]).toMatchObject({ id: 'ram', label: 'RAM' });
  });

  it('folds the resources past the cap into one bubble with the cores that reached them', () => {
    const rs = Array.from({ length: 5 }, (_, k) => reg('r' + k, k * 0x100, k * 0x100 + 0x100));
    const touches = rs.map((r, k) => touch(r.lo, k % 2, k % 2 === 1, 10 - k));
    const b = bubblesOf(touches, rs, 3);
    expect(b.map((x) => x.id)).toEqual(['r0', 'r1', '+']);
    expect(b[2]!.label).toBe('+3');
    expect(b[2]!.cores.map((c) => c.core).sort()).toEqual([0, 1]);
    expect(b[2]!.contended).toBe(true);
    expect(b[2]!.writes).toBe(1);
  });
});
