import { describe, expect, it } from 'vitest';
import { specsOfKind } from '../../board/sim/specs';
import { headerRect, tpmHeader, tpmRect } from '@/core/render/accelart';
import { blockRect, tpmGeo, tpmIds, tpmParts, tpmPlanOf } from './tpmlayout';
import { setLayoutTier, type Rect } from '../../board/render/layout/layout';

const inside = (r: Rect, o: Rect): boolean => r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;

function header(): Rect {
  setLayoutTier(3, 3);
  return headerRect(tpmHeader(3)!);
}

describe('the secure module on its header', () => {
  it('puts the die in the band under the lid, the band on the daughterboard, and the board inside what a click hits', () => {
    const hdr = header();
    for (const s of specsOfKind('tpm')) {
      const g = tpmGeo(s.visual, hdr);
      expect(inside(g.die, g.band), s.id).toBe(true);
      expect(inside(g.band, g.pcb), s.id).toBe(true);
      expect(inside(g.pcb, tpmRect(3)!), s.id).toBe(true);
      expect(g.scale, s.id).toBeGreaterThan(0.1);
      // the pins stand below the band
      expect(g.band.y + g.band.h, s.id).toBeLessThanOrEqual(hdr.y + hdr.h - 12);
      for (const b of g.plan.blocks) expect(inside(blockRect(g, b), g.die), `${s.id} ${b.id}`).toBe(true);
    }
  });

  it('takes the plan of each tier of module from its spec', () => {
    const [a, b] = specsOfKind('tpm').map((s) => tpmPlanOf(s.visual));
    expect(a!.input.hashStages).toBe(specsOfKind('tpm')[0]!.tpm!.measureTicks);
    expect(a!.input).not.toEqual(b!.input);
  });

  it('gives every part a distinct slot-keyed id, the blocks before the lid over them', () => {
    const ids = tpmIds('tpm-2', 'tpm0', header());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((i) => i.startsWith('tpm0.'))).toBe(true);
    expect(ids).toEqual(expect.arrayContaining(['tpm0.regs', 'tpm0.hash', 'tpm0.vault', 'tpm0.guard', 'tpm0.lid']));
    expect(ids[ids.length - 1]).toBe('tpm0.lid');
    expect(tpmParts(tpmGeo('tpm-1', header())).filter((p) => !p.inner).map((p) => p.id)).toEqual(['lid']);
  });

  it('keeps the blocks apart, so a hover lands on one part', () => {
    const g = tpmGeo('tpm-1', header()), rs = g.plan.blocks.map((b) => blockRect(g, b));
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i]!, c = rs[j]!;
      expect(a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h, `${g.plan.blocks[i]!.id} / ${g.plan.blocks[j]!.id}`).toBe(false);
    }
  });
});
