import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../economy/sim/economy';
import { createBoard, engineConfigFor, getSpec, install, specsOfKind } from './index';
import type * as simTypes from './index';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

ECONOMY.levelGating = false;

const ladder = (): simTypes.RamSpec[] => specsOfKind('ram') as simTypes.RamSpec[];

/** The extra tick of latency an ECC stick `b` may cost over a non-ECC stick `a`. */
const eccTick = (a: simTypes.RamSpec, b: simTypes.RamSpec): number => Number(b.ecc === true && a.ecc !== true);

/** How many memory channels a tier-3 board with one stick of `ram` gets (0 on the reference engine). */
function channels(ram: string): number {
  const b = createBoard(3);
  for (const s of ['cpu3m', 'display0', 'cooler2', 'psu2', ram]) {
    expect(install(b, s).ok).toBe(true);
  }
  const c = must(engineConfigFor(b));
  return c.kind === 'ref' ? 0 : must(c.dram).channels;
}

describe('the RAM ladder', () => {
  it('climbs by generation: banks, bank groups and price never go down, timings never get slower, ECC only on the ECC sticks', () => {
    const l = ladder();
    expect(l.map((s) => s.gen)).toStrictEqual(['SDR', 'DDR2', 'DDR3', 'DDR4', 'DDR4', 'DDR5', 'DDR5']);
    expect(l.map((s) => s.sizeBytes / 1024)).toStrictEqual([16, 32, 64, 128, 128, 256, 256]);
    for (let i = 1; i < l.length; i++) {
      const a = must(l[i - 1]),
        b = must(l[i]);
      expect(b.tier).toBe(a.tier + 1);
      expect(b.banks).toBeGreaterThanOrEqual(a.banks);
      expect(b.bankGroups).toBeGreaterThanOrEqual(a.bankGroups);
      expect(b.price).toBeGreaterThan(a.price);
      expect(b.tCL + b.tRCD + b.tRP).toBeLessThanOrEqual(a.tCL + a.tRCD + a.tRP + 1);
      expect(b.latency).toBeLessThanOrEqual(a.latency + eccTick(a, b)); // ECC costs a tick
    }
    expect(l.filter((s) => s.ecc === true).map((s) => s.id)).toStrictEqual(['ram3', 'ram5']);
    for (const s of l) {
      expect(s.banks % s.bankGroups).toBe(0);
    }
  });

  it('a stick is never more than the 1 MiB a paged OS can use, and four of the biggest fill that', () => {
    for (const s of ladder()) {
      expect(s.sizeBytes).toBeLessThanOrEqual(256 * 1024);
    }
    expect(Math.max(...ladder().map((s) => s.sizeBytes)) * 4).toBe(1024 * 1024);
  });

  it('only DDR5 brings two channels on one stick: one stick feeds a dual-channel controller', () => {
    expect(getSpec('ram4')).toMatchObject({ subChannels: 2 });
    expect(channels('ram2')).toBe(1);
    expect(channels('ram4')).toBe(2);
    expect(channels('ram5')).toBe(2);
  });
});
