import { describe, expect, it } from 'vitest';
import { specsOfKind } from '../../board/sim/specs';
import { gpuPlanInput } from './gpuplan';
import { gpuPlan } from './gpuplans';
import { entryOf, gpuRoute, launchRoute, pathBetween } from './gpuroute';

const plans = () => specsOfKind('gpu').map((s) => ({ id: s.id, plan: gpuPlan(gpuPlanInput(s.gpu!)) }));

describe('the way through a card', () => {
  it('finds the shortest chain of links, following their direction', () => {
    for (const { id, plan } of plans()) {
      const entry = entryOf(plan, 0);
      expect(plan.blocks.some((b) => b.id === entry), id).toBe(true);
      const path = pathBetween(plan.links, entry, plan.input.sms > 1 ? 'sm0.regs' : 'regs')!;
      expect(path.length, id).toBeGreaterThan(0);
      expect(path[0]!.from).toBe(entry);
      for (let k = 1; k < path.length; k++) expect(path[k]!.from, id).toBe(path[k - 1]!.to);
    }
    expect(pathBetween([], 'a', 'b')).toBeNull();
    expect(pathBetween([], 'a', 'a')).toEqual([]);
  });

  it('an ALU instruction goes front end, registers, lanes; a load goes on to the card memory; a halt stops at the registers', () => {
    for (const { id, plan } of plans()) {
      for (let sm = 0; sm < plan.input.sms; sm++) {
        const p = plan.input.sms > 1 ? `sm${sm}.` : '';
        const alu = gpuRoute(plan, { kind: 'alu' }, sm), ld = gpuRoute(plan, { kind: 'ld' }, sm), sys = gpuRoute(plan, { kind: 'sys' }, sm);
        expect(alu[alu.length - 1]!.link.to, `${id} alu`).toBe(`${p}lanes`);
        expect(ld[ld.length - 1]!.link.to, `${id} ld`).toBe('dram');
        expect(ld.length, id).toBeGreaterThan(alu.length);
        expect(sys[sys.length - 1]!.link.to, `${id} sys`).toBe(`${p}regs`);
        // the memory path of a card with caches goes through them
        if (plan.input.l2Lines > 0) expect(ld.map((h) => h.link.to), id).toEqual(expect.arrayContaining([`${p}l1`, 'l2']));
      }
    }
  });

  it('a mask set runs the mask wire against its direction, and a launch crosses the host link and the launch registers', () => {
    for (const { id, plan } of plans()) {
      const m = gpuRoute(plan, { kind: 'mask' }, 0);
      expect(m[m.length - 1], id).toMatchObject({ reverse: true });
      const l = launchRoute(plan);
      expect(l.map((h) => h.link.to).slice(0, 2), id).toEqual(['launch', entryOf(plan, 0)].slice(0, l.length >= 2 ? 2 : l.length));
      expect(l[0]!.link.from).toBe('pcie');
    }
  });
});
