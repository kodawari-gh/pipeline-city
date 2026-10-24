import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../sim/game/game';
import { levelRows } from '../sim/game/levels';
import { hasArt, levelBar, milestoneRows } from './levelui';
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

describe('milestone list', () => {
  const s = at({ level: 3, name: 'Local Gigs', progress: 0.5 });
  const rows = milestoneRows(s);

  it('has all 18 levels in order with passed, current and upcoming', () => {
    expect(rows.map((r) => r.level)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(rows.filter((r) => r.status === 'passed').map((r) => r.level)).toEqual([1, 2]);
    expect(rows.filter((r) => r.status === 'current').map((r) => r.level)).toEqual([3]);
    expect(rows[3]!.status).toBe('upcoming');
  });

  it('only the current row carries progress', () => {
    expect(rows[2]!.progress).toBe(0.5);
    expect(rows[3]!.progress).toBe(0);
  });

  it('lists what each level unlocks, with art only for real parts', () => {
    const l10 = rows[9]!;
    expect(l10.unlocks.map((u) => u.id)).toContain('gpu1');
    const router = l10.unlocks.find((u) => u.id === 'gpu1')!;
    expect(router.planned).toBe(true);
    expect(hasArt(router.id, router.kind, router.planned)).toBe(false);
    expect(router.icon).toBe('screen');
    const cpu = rows[0]!.unlocks.find((u) => u.id === 'cpu1')!;
    expect(hasArt(cpu.id, cpu.kind, cpu.planned)).toBe(true);
    expect(hasArt('board1', 'board', false)).toBe(true);
  });

  it('names the job classes that arrive at a level and compares with the level before', () => {
    expect(rows[2]!.newJobs.map((j) => j.id)).toEqual(['db']);
    expect(rows[3]!.newJobs.map((j) => j.label)).toEqual(['Web']);
    expect(rows[0]!.patience).toBeNull();
    expect(rows[1]!.patience).toBe('same');
    expect(rows[2]!.patience).toBe('stricter');
    expect(rows[2]!.pay).toBe('bigger');
    expect(rows[2]!.waitS).toBe(540);
  });
});
