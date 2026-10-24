import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../sim/game/game';
import { levelRows } from '../sim/game/levels';
import { levelBar } from './levelui';
import { snap } from './testdata';

const at = (o: Partial<Snapshot['level']>): Snapshot => {
  const base = snap();
  return snap({ level: { ...base.level, ...o } });
};

describe('level bar', () => {
  it('shows the level, the fraction to the next threshold and the fill', () => {
    const m = levelBar(at({ level: 2, name: 'Hobby Shop', clientBase: 6.4, floor: 4, next: 12, progress: 0.3 }));
    expect(m.level).toBe(2);
    expect(m.label).toBe('6 / 12');
    expect(m.pct).toBeCloseTo(30);
    expect(m.atMax).toBe(false);
    expect(m.tooltip).toContain('Client base is how many clients trust you');
    expect(m.tooltip).toContain('Client base 6 of 12 for level 3');
  });

  it('clamps the fill and names what the next level unlocks', () => {
    const m = levelBar(at({ progress: 1.4 }));
    expect(m.pct).toBe(100);
    expect(m.tooltip).toContain('Next level unlocks:');
    expect(m.tooltip).toContain(levelRows()[1]!.unlocks[0]!.name);
  });

  it('at the last level the bar is full and shows the raw score', () => {
    const m = levelBar(at({ level: 18, name: 'Metropolis', clientBase: 1402.7, floor: 1350, next: null, progress: 1 }));
    expect(m.atMax).toBe(true);
    expect(m.pct).toBe(100);
    expect(m.label).toBe('1402');
    expect(m.tooltip).toContain('top level');
    expect(m.tooltip).not.toContain('Next level unlocks');
  });

  it('in the sandbox it is a rules-level chip with no progress', () => {
    const m = levelBar(at({ sandbox: true, level: 7, name: 'District' }));
    expect(m.sandbox).toBe(true);
    expect(m.label).toBe('rules level 7');
    expect(m.pct).toBe(0);
  });
});
