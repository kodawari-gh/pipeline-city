import { describe, expect, it } from 'vitest';
import { specsOfKind } from '@/features/board/sim/specs';
import { gpuPlanInput } from './gpuplan';
import { gpuPlan } from './gpuplans';
import { entryOf, gpuRoute, launchRoute, pathBetween } from './gpuroute';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** The id prefix of the blocks of SM `sm`: a single-SM card has none. */
function smPrefix(sms: number, sm: number): string {
  if (sms > 1) {
    return `sm${sm}.`;
  }
  return '';
}

const plans = () => specsOfKind('gpu').map((s) => ({ id: s.id, plan: gpuPlan(gpuPlanInput(must(s.gpu))) }));

describe('the way through a card', () => {
  it('finds the shortest chain of links, following their direction', () => {
    for (const { id, plan } of plans()) {
      const entry = entryOf(plan, 0);
      expect(
        plan.blocks.some((b) => b.id === entry),
        `${id} entry`,
      ).toBe(true);
      const path = must(pathBetween(plan.links, entry, `${smPrefix(plan.input.sms, 0)}regs`));
      expect(path.length, `${id} path`).toBeGreaterThan(0);
      expect(must(path[0]).from).toBe(entry);
      for (let k = 1; k < path.length; k++) {
        expect(must(path[k]).from, `${id} hop ${k}`).toBe(must(path[k - 1]).to);
      }
    }
    expect(pathBetween([], 'a', 'b')).toBeNull();
    expect(pathBetween([], 'a', 'a')).toStrictEqual([]);
  });

  it('an ALU instruction goes front end, registers, lanes; a load goes on to the card memory; a halt stops at the registers', () => {
    for (const { id, plan } of plans()) {
      for (let sm = 0; sm < plan.input.sms; sm++) {
        const p = smPrefix(plan.input.sms, sm);
        const alu = gpuRoute(plan, { kind: 'alu' }, sm),
          ld = gpuRoute(plan, { kind: 'ld' }, sm),
          sys = gpuRoute(plan, { kind: 'sys' }, sm);
        expect(must(alu.at(-1)).link.to, `${id} alu`).toBe(`${p}lanes`);
        expect(must(ld.at(-1)).link.to, `${id} ld`).toBe('dram');
        expect(ld.length, `${id} ld`).toBeGreaterThan(alu.length);
        expect(must(sys.at(-1)).link.to, `${id} sys`).toBe(`${p}regs`);
      }
    }
  });

  it.each(plans().filter(({ plan }) => plan.input.l2Lines > 0))(
    'the memory path of $id, a card with caches, goes through them',
    ({ id, plan }) => {
      for (let sm = 0; sm < plan.input.sms; sm++) {
        const p = smPrefix(plan.input.sms, sm);
        expect(
          gpuRoute(plan, { kind: 'ld' }, sm).map((h) => h.link.to),
          `${id} ld`,
        ).toStrictEqual(expect.arrayContaining([`${p}l1`, 'l2']));
      }
    },
  );

  it('a mask set runs the mask wire against its direction, and a launch crosses the host link and the launch registers', () => {
    for (const { id, plan } of plans()) {
      const m = gpuRoute(plan, { kind: 'mask' }, 0);
      expect(m.at(-1), `${id} mask`).toMatchObject({ reverse: true });
      const l = launchRoute(plan);
      expect(l.map((h) => h.link.to).slice(0, 2), `${id} launch`).toStrictEqual(
        ['launch', entryOf(plan, 0)].slice(0, Math.min(2, l.length)),
      );
      expect(must(l[0]).link.from).toBe('pcie');
    }
  });
});
