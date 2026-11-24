import { describe, expect, it } from 'vitest';
import type { TaskResult } from '@/features/sandbox/sim/benchtasks';
import { BENCH_GROUPS } from '@/features/sandbox/sim/benchtasks';
import { barPct, deltaPct, deltaText, groupScore, overallOfRuns, secondsText, whyShort } from './benchhud';

const r = (id: string, score: number | null): TaskResult => ({ id, score, seconds: score === null ? null : 10 });
const by = (...rs: TaskResult[]): Record<string, TaskResult> => Object.fromEntries(rs.map((x) => [x.id, x]));

describe('benchhud', () => {
  it('fills a bar to half at par and to the end at twice of it', () => {
    expect(barPct(1000)).toBe(50);
    expect(barPct(2000)).toBe(100);
    expect(barPct(5000)).toBe(100);
    expect(barPct(0)).toBe(0);
    expect(barPct(null)).toBe(0);
  });

  it('says a time in seconds, then in minutes', () => {
    expect(secondsText(27)).toBe('27 s');
    expect(secondsText(119)).toBe('119 s');
    expect(secondsText(120)).toBe('2 min');
    expect(secondsText(738)).toBe('12 min 18 s');
  });

  it('gives the change in percent, and nothing when a side has no score', () => {
    expect(deltaPct(1100, 1000)).toBe(10);
    expect(deltaPct(900, 1000)).toBe(-10);
    expect(deltaPct(null, 1000)).toBeNull();
    expect(deltaPct(1000, undefined)).toBeNull();
    expect(deltaText(10)).toBe('+10%');
    expect(deltaText(-4)).toBe('-4%');
    expect(deltaText(0)).toBe('');
    expect(deltaText(null)).toBe('');
  });

  it('keeps what comes before the first colon of a reason', () => {
    expect(whyShort('Needs a graphics card: without one it runs on the CPU, many times slower')).toBe(
      'Needs a graphics card',
    );
    expect(whyShort('Needs a TPM and ECC RAM')).toBe('Needs a TPM and ECC RAM');
  });

  it('works out the overall score and its change on the tasks both machines were scored on', () => {
    const now = by(r('a', 1000), r('b', 2000), r('c', 500), r('d', null));
    const was = by(r('a', 1000), r('b', 1000));
    expect(overallOfRuns(now, was)).toEqual({ overall: 1000, n: 3, delta: 41 });
    expect(overallOfRuns(now, {})).toEqual({ overall: 1000, n: 3, delta: null });
    expect(overallOfRuns({}, was)).toEqual({ overall: 0, n: 0, delta: null });
  });

  it('works out the mean of a group from the tasks that have a result', () => {
    const g = BENCH_GROUPS[0]!;
    const ids = g.tasks.map((t) => t.id);
    expect(groupScore(g, by(r(ids[0]!, 1000), r(ids[1]!, 250)))).toBe(500);
    expect(groupScore(g, {})).toBe(0);
  });
});
