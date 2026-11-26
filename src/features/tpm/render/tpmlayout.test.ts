import { assert, describe, expect, it } from 'vitest';
import { specsOfKind } from '../../board/sim/specs';
import { headerRect, tpmHeader, tpmRect } from '@/core/render/accelart';
import { blockRect, tpmGeo, tpmIds, tpmParts, tpmPlanOf } from './tpmlayout';
import { setLayoutTier } from '../../board/render/layout/layout';
import type * as layoutTypes from '../../board/render/layout/layout';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const inside = (r: layoutTypes.Rect, o: layoutTypes.Rect): boolean =>
  r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;

function header(): layoutTypes.Rect {
  setLayoutTier(3, 3);
  const tpmHeaderResult = tpmHeader(3);
  assert.exists(tpmHeaderResult);
  return headerRect(tpmHeaderResult);
}

const overlaps = (a: layoutTypes.Rect, c: layoutTypes.Rect): boolean =>
  a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;

describe('the secure module on its header', () => {
  it('puts the die in the band under the lid, the band on the daughterboard, and the board inside what a click hits', () => {
    const hdr = header();
    for (const s of specsOfKind('tpm')) {
      const g = tpmGeo(s.visual, hdr);
      // the chip is a real TSSOP-28 body (9.7 x 4.4 mm at 23 units a mm), in the band; the die lies on its top
      expect(g.chip.w / 23, `for ${s.id}`).toBeCloseTo(9.7, 2);
      expect(g.chip.h / 23, `for ${s.id}`).toBeCloseTo(4.4, 2);
      expect(inside(g.chip, g.band), `for ${s.id}`).toBe(true);
      expect(inside(g.die, g.chip), `for ${s.id}`).toBe(true);
      expect(inside(g.band, g.pcb), `for ${s.id}`).toBe(true);
      const tpmRectResult = tpmRect(3);
      assert.exists(tpmRectResult);
      expect(inside(g.pcb, tpmRectResult), `for ${s.id}`).toBe(true);
      expect(g.scale, `for ${s.id}`).toBeGreaterThan(0.1);
      // the pins stand below the band
      expect(g.band.y + g.band.h, `for ${s.id}`).toBeLessThanOrEqual(hdr.y + hdr.h - 12);
      for (const b of g.plan.blocks) {
        expect(inside(blockRect(g, b), g.die), `${s.id} ${b.id}`).toBe(true);
      }
    }
  });

  it('takes the plan of each tier of module from its spec', () => {
    const [a, b] = specsOfKind('tpm').map((s) => tpmPlanOf(s.visual));
    assert.exists(a);
    const [first] = specsOfKind('tpm');
    assert.exists(first);
    expect(a.input.hashStages).toBe(must(first.tpm).measureTicks);
    assert.exists(b);
    expect(a.input).not.toStrictEqual(b.input);
  });

  it('gives every part a distinct slot-keyed id, the blocks before the lid over them', () => {
    const ids = tpmIds('tpm-2', 'tpm0', header());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((i) => i.startsWith('tpm0.'))).toBe(true);
    expect(ids).toStrictEqual(
      expect.arrayContaining(['tpm0.regs', 'tpm0.hash', 'tpm0.vault', 'tpm0.guard', 'tpm0.lid']),
    );
    expect(ids.at(-1)).toBe('tpm0.lid');
    const geo = tpmGeo('tpm-1', header());
    expect(
      tpmParts(geo)
        .filter((p) => !p.inner)
        .map((p) => p.id),
    ).toStrictEqual(['lid']);
  });

  it('keeps the blocks apart, so a hover lands on one part', () => {
    const g = tpmGeo('tpm-1', header()),
      rs = g.plan.blocks.map((b) => blockRect(g, b));
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = must(rs[i]),
          c = must(rs[j]);
        expect(overlaps(a, c), `${must(g.plan.blocks[i]).id} / ${must(g.plan.blocks[j]).id}`).toBe(false);
      }
    }
  });
});
