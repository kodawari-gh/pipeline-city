import { assert, describe, expect, it } from 'vitest';
import type { RamRegion } from '../sim/ramregions';
import { bubblesOf, coresText, regionOf } from './rambubbles';
import type * as rambubblesTypes from './rambubbles';

const reg = (id: string, { lo, hi }: { lo: number; hi: number }, name = id): RamRegion => ({
  id,
  kind: 'os',
  name,
  note: '',
  lo,
  hi,
});
const regions = [
  reg('kernel', { lo: 0x10_00, hi: 0x20_00 }, 'OS kernel'),
  reg('table', { lo: 0x20_00, hi: 0x30_00 }, 'Job table'),
  reg('app', { lo: 0x40_00, hi: 0x80_00 }, '#07 calc'),
  reg('work', { lo: 0x50_00, hi: 0x54_00 }, 'calc memory'),
];
const touch = (addr: number, core: number, { write = false, t = 0 } = {}): rambubblesTypes.BubbleTouch => ({
  addr,
  core,
  write,
  t,
});

describe('RAM bubbles', () => {
  it('finds the region of an address, the smallest when they overlap, none outside them', () => {
    expect(regionOf(0x18_00, regions)?.id).toBe('kernel');
    expect(regionOf(0x51_00, regions)?.id).toBe('work');
    expect(regionOf(0x41_00, regions)?.id).toBe('app');
    expect(regionOf(0x90_00, regions)).toBeUndefined();
  });

  it('gives one bubble to a resource that several cores reach for, flagged shared, with what each core did', () => {
    const b = bubblesOf(
      [
        touch(0x20_04, 0, { write: false, t: 1 }),
        touch(0x20_08, 1, { write: true, t: 2 }),
        touch(0x20_10, 1, { write: false, t: 3 }),
      ],
      regions,
    );
    expect(b).toHaveLength(1);
    assert.exists(b[0]);
    expect(b[0].label).toBe('Job table');
    expect(b[0].contended).toBe(true);
    expect(b[0].writes).toBe(1);
    expect(b[0].addr).toBe(0x20_10); // where the newest touch was
    expect(b[0].cores).toStrictEqual([
      { core: 1, reads: 1, writes: 1 },
      { core: 0, reads: 1, writes: 0 },
    ]);
    expect(coresText(b[0].cores)).toBe('C1+C0');
  });

  it('gives distinct resources distinct bubbles, newest first, and one core is not contention', () => {
    const b = bubblesOf(
      [touch(0x11_00, 0, { write: false, t: 1 }), touch(0x41_00, 0, { write: false, t: 5 })],
      regions,
    );
    expect(b.map((x) => x.id)).toStrictEqual(['app', 'kernel']);
    expect(b.every((x) => !x.contended)).toBe(true);
  });

  it('puts an address in no region on a bubble of RAM', () => {
    expect(bubblesOf([touch(0x90_00, 2)], regions)[0]).toMatchObject({ id: 'ram', label: 'RAM' });
  });

  it('folds the resources past the cap into one bubble with the cores that reached them', () => {
    const rs = Array.from({ length: 5 }, (_, k) => reg(`r${k}`, { lo: k * 0x1_00, hi: k * 0x1_00 + 0x1_00 }));
    const touches = rs.map((r, k) => touch(r.lo, k % 2, { write: k % 2 === 1, t: 10 - k }));
    const b = bubblesOf(touches, rs, 3);
    expect(b.map((x) => x.id)).toStrictEqual(['r0', 'r1', '+']);
    assert.exists(b[2]);
    expect(b[2].label).toBe('+3');
    expect(b[2].cores.map((c) => c.core).toSorted((x, y) => x - y)).toStrictEqual([0, 1]);
    expect(b[2].contended).toBe(true);
    expect(b[2].writes).toBe(1);
  });
});
