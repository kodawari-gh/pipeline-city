// Invariants of the secure module's floorplans (docs/ACCEL.md "TPM"): the blocks tile the die, nothing overlaps, every link starts and ends on
// the edge of the blocks it names and runs square through the gutters, and the two tiers differ.
import { describe, expect, it } from 'vitest';
import { specsOfKind } from '../../board/sim/specs';
import type { Pt, Rect } from '../../cpu/render/core/cpuplan';
import { tpmPlanInput, type TpmPlan } from './tpmplan';
import { DIE_MARGIN, TPM_DIE, tpmPlan } from './tpmplans';
import { TPM_KEYS_SHOWN } from '../sim/tpm';

const inside = (a: Rect, o: Rect): boolean => a.x >= o.x && a.y >= o.y && a.x + a.w <= o.x + o.w && a.y + a.h <= o.y + o.h;
const apart = (a: Rect, c: Rect): boolean => a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y;
const onEdge = (p: Pt, r: Rect): boolean => {
  const inX = p[0] >= r.x && p[0] <= r.x + r.w, inY = p[1] >= r.y && p[1] <= r.y + r.h;
  return (inX && (p[1] === r.y || p[1] === r.y + r.h)) || (inY && (p[0] === r.x || p[0] === r.x + r.w));
};
const crosses = (a: Pt, b: Pt, r: Rect): boolean => {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  return x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h;
};

function check(plan: TpmPlan): string[] {
  const bad: string[] = [];
  const byId = new Map(plan.blocks.map((b) => [b.id, b]));
  if (byId.size !== plan.blocks.length) bad.push('duplicate block id');
  for (const b of plan.blocks) {
    if (!inside(b.rect, plan.die)) bad.push(`${b.id} is outside the die`);
    if (b.rect.w <= 0 || b.rect.h <= 0) bad.push(`${b.id} has no area`);
  }
  for (let i = 0; i < plan.blocks.length; i++) for (let j = i + 1; j < plan.blocks.length; j++) if (!apart(plan.blocks[i]!.rect, plan.blocks[j]!.rect)) bad.push(`${plan.blocks[i]!.id} overlaps ${plan.blocks[j]!.id}`);
  const ids = new Set<string>();
  for (const l of plan.links) {
    if (ids.has(l.id)) bad.push(`duplicate link id ${l.id}`);
    ids.add(l.id);
    const a = byId.get(l.from), c = byId.get(l.to);
    if (!a || !c) { bad.push(`${l.id}: unknown end ${l.from} / ${l.to}`); continue; }
    if (!onEdge(l.pts[0]!, a.rect)) bad.push(`${l.id} starts off the edge of ${l.from}`);
    if (!onEdge(l.pts[l.pts.length - 1]!, c.rect)) bad.push(`${l.id} ends off the edge of ${l.to}`);
    for (let k = 1; k < l.pts.length; k++) {
      const u = l.pts[k - 1]!, v = l.pts[k]!;
      if (u[0] !== v[0] && u[1] !== v[1]) bad.push(`${l.id} has a diagonal segment`);
      if (u[0] === v[0] && u[1] === v[1]) bad.push(`${l.id} has a zero-length segment`);
      for (const o of plan.blocks) if (o.id !== l.from && o.id !== l.to && crosses(u, v, o.rect)) bad.push(`${l.id} runs through ${o.id}`);
    }
  }
  return bad;
}

const plans = specsOfKind('tpm').map((s) => ({ name: s.visual, plan: tpmPlan(tpmPlanInput(s.tpm!, TPM_KEYS_SHOWN)) }));

describe('the secure module floorplans', () => {
  it('has a plan for each tier of module', () => expect(plans.length).toBeGreaterThanOrEqual(2));
  for (const { name, plan } of plans) {
    it(`${name}: blocks tile the die and every wire routes square through the gutters`, () => expect(check(plan)).toEqual([]));
    it(`${name}: carries every part the sim models`, () => {
      expect(plan.blocks.map((b) => b.id).sort()).toEqual(['guard', 'hash', 'lpc', 'quote', 'ramport', 'regs', 'seq', 'vault']);
      expect(plan.links.length).toBe(11);
    });
    it(`${name}: the blocks fill the die inside its margins`, () => {
      const area = plan.blocks.reduce((n, b) => n + b.rect.w * b.rect.h, 0), room = (TPM_DIE.w - 2 * DIE_MARGIN.x) * (TPM_DIE.h - DIE_MARGIN.top - DIE_MARGIN.bottom);
      expect(area / room).toBeGreaterThan(0.9);
    });
  }
  it('the better module has the one-tick hash and the single signing round', () => {
    const [a, b] = plans;
    expect(a!.plan.input.hashStages).toBeGreaterThan(b!.plan.input.hashStages);
    expect(a!.plan.input.quoteRounds).toBeGreaterThan(b!.plan.input.quoteRounds);
  });
});
