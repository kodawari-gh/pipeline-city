import { assert, describe, expect, it } from 'vitest';
import { RAM_DIE, bankCell, pageSlot, ramDiePlan } from './ramdie';
import type * as ramdieTypes from './ramdie';

const inside = (a: ramdieTypes.DieRect, b: ramdieTypes.DieRect): boolean =>
  a.x >= b.x - 1e-6 && a.y >= b.y - 1e-6 && a.x + a.w <= b.x + b.w + 1e-6 && a.y + a.h <= b.y + b.h + 1e-6;
const meet = (a: ramdieTypes.DieRect, b: ramdieTypes.DieRect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('the DRAM die plan', () => {
  // the banks of each generation (RAM.md "The ladder"): SDR 2, DDR2 4, DDR3 8, DDR4 16 in 4 groups, DDR5 32 in 8 groups on two sub-channels
  const specs = [
    { banks: 2, bankGroups: 1 },
    { banks: 4, bankGroups: 1 },
    { banks: 8, bankGroups: 1 },
    { banks: 16, bankGroups: 4 },
    { banks: 32, bankGroups: 8, subChannels: 2 },
  ];

  it('has the banks the stick has, each in the die and clear of the spine and of every other bank', () => {
    for (const s of specs) {
      const p = ramDiePlan(s);
      expect(p.banks, `for ${s.banks}`).toHaveLength(s.banks);
      expect(p.w).toBe(RAM_DIE.w);
      for (const b of p.banks) {
        expect(inside(b.rect, p.die), `bank ${b.index} of ${s.banks}`).toBe(true);
        expect(meet(b.rect, p.spine), `bank ${b.index} of ${s.banks}`).toBe(false);
        for (const o of p.banks.filter((x) => x !== b)) {
          expect(meet(b.rect, o.rect), `${b.index}/${o.index} of ${s.banks}`).toBe(false);
        }
      }
    }
  });

  it('puts half the banks over the spine and half under it, in as many groups as the spec says', () => {
    for (const s of specs) {
      const p = ramDiePlan(s),
        above = p.banks.filter((b) => b.rect.y < p.spine.y).length;
      expect(above, `for ${s.banks}`).toBe(s.banks / 2);
      expect(new Set(p.banks.map((b) => b.group)).size, `for ${s.banks}`).toBe(s.bankGroups);
    }
  });

  it('gives a DDR5 die two sub-channels with a spine of logic each, a DDR4 die one', () => {
    assert.exists(specs[4]);
    expect(ramDiePlan(specs[4]).divide).not.toBeNull();
    expect(ramDiePlan(specs[4]).logic).toHaveLength(8);
    assert.exists(specs[3]);
    expect(ramDiePlan(specs[3]).divide).toBeNull();
    expect(ramDiePlan(specs[3]).logic).toHaveLength(4);
  });

  it('puts every page of a window in a cell of its own, and each cell in its bank', () => {
    for (const [channels, banks] of [
      [1, 2],
      [1, 16],
      [2, 16],
      [4, 32],
    ] as const) {
      const seen = new Set<string>();
      for (let q = 0; q < 200; q++) {
        const s = pageSlot(q, channels, banks);
        expect(s.bank).toBeLessThan(banks);
        const key = `${s.bank}:${s.k}`;
        expect(seen.has(key), `${channels}x${banks} page ${q}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('keeps the cells of a bank inside its rect, one under the other', () => {
    assert.exists(specs[3]);
    const bank2 = ramDiePlan(specs[3]).banks.at(5);
    assert.exists(bank2);
    const bank = bank2.rect;
    let at = bank.y;
    for (let k = 0; k < 6; k++) {
      const c = bankCell(bank, k, 6);
      expect(inside(c, bank), `cell ${k}`).toBe(true);
      expect(c.y).toBeGreaterThanOrEqual(at - 1e-6);
      at = c.y;
    }
  });
});
