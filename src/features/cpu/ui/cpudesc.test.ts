import { describe, expect, it } from 'vitest';
import { getSpec, specsOfKind } from '../../board/sim/specs';
import { cpuFeatures, describeSpec } from '@/core/ui/logic';
import { specBrief } from '../../economy/ui/shop/picker';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const CPUS = specsOfKind('cpu');

/** The CPU spec with id `id`. */
const cpu = (id: string) => must(CPUS.find((s) => s.id === id));

/** The nerd description of spec `id`. */
const nerdOf = (id: string) => describeSpec(must(getSpec(id))).nerd;

describe('CPU descriptions', () => {
  it('every CPU says what its engine is and what it has', () => {
    for (const s of CPUS) {
      const f = cpuFeatures(s.engine);
      expect(f.length, `spec ${s.id}`).toBeGreaterThan(0);
      expect(describeSpec(s).nerd, `spec ${s.id}`).toContain(must(f[0]));
    }
    for (const s of CPUS.filter((c) => c.engine.kind !== 'unpipelined')) {
      expect(specBrief(s), `spec ${s.id}`).toContain(must(cpuFeatures(s.engine)[0]));
    }
  });

  it('the optional parts are named', () => {
    expect(cpuFeatures(cpu('cpu2f').engine).join(' | ')).toMatch(/instruction cache.*2-bit predictor/u);
    const m = nerdOf('cpu3m');
    expect(m).toMatch(/4-way/u);
    expect(m).toMatch(/L2/u);
    expect(m).toMatch(/2-wide in-order/u);
    expect(nerdOf('cpu4w')).toMatch(/4-wide out of order, ROB 32/u);
    expect(nerdOf('cpu2f')).toMatch(/front end/u);
    expect(nerdOf('cpu2')).not.toMatch(/leans/u);
  });
});
