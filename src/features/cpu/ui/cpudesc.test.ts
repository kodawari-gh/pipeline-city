import { describe, expect, it } from 'vitest';
import { getSpec, specsOfKind } from '../../board/sim/specs';
import { cpuFeatures, describeSpec } from '@/core/ui/logic';
import { specBrief } from '../../economy/ui/picker';

describe('CPU descriptions', () => {
  it('every CPU says what its engine is and what it has', () => {
    for (const s of specsOfKind('cpu')) {
      const f = cpuFeatures(s.engine);
      expect(f.length, s.id).toBeGreaterThan(0);
      expect(describeSpec(s).nerd, s.id).toContain(f[0]!);
      if (s.engine.kind !== 'unpipelined') expect(specBrief(s), s.id).toContain(f[0]!);
    }
  });

  it('the optional parts are named', () => {
    expect(cpuFeatures(getSpec('cpu2f')!.kind === 'cpu' ? (getSpec('cpu2f') as never as { engine: never }).engine : (null as never)).join(' | ')).toMatch(/instruction cache.*2-bit predictor/);
    const m = describeSpec(getSpec('cpu3m')!).nerd;
    expect(m).toMatch(/4-way/);
    expect(m).toMatch(/L2/);
    expect(m).toMatch(/2-wide in-order/);
    expect(describeSpec(getSpec('cpu4w')!).nerd).toMatch(/4-wide out of order, ROB 32/);
    expect(describeSpec(getSpec('cpu2f')!).nerd).toMatch(/front end/);
    expect(describeSpec(getSpec('cpu2')!).nerd).not.toMatch(/leans/);
  });
});
