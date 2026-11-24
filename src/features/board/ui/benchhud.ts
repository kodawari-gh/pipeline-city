// The numbers and words of the benchmark screen, pure (BuildBench.tsx and the right panel's card draw them). The scores come from `sandbox/sim/pcbench.ts`.
import { overallOf, type BenchGroup, type TaskResult } from '@/features/sandbox/sim/benchtasks';

/** A score of this is par: what the reference machine built for the task gets. A bar is full at twice of it. */
export const PAR = 1000;

/** How full a score's bar is, in percent: par is half. */
export const barPct = (score: number | null | undefined): number =>
  score ? Math.max(0, Math.min(100, (score / (2 * PAR)) * 100)) : 0;

/** How long a run took: seconds up to two minutes, then minutes. */
export function secondsText(s: number): string {
  if (s < 120) return `${s} s`;
  const m = Math.floor(s / 60),
    r = s % 60;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}

/** The change from a score on the machine before to the score now, in whole percent; null when either has none. */
export function deltaPct(now: number | null | undefined, was: number | null | undefined): number | null {
  if (!now || !was) return null;
  return Math.round(((now - was) / was) * 100);
}

/** `+12%`, `-4%`, or an empty text for no change. */
export const deltaText = (d: number | null): string => (d === null || d === 0 ? '' : `${d > 0 ? '+' : ''}${d}%`);

/** A reason in a row, short: what comes before the first colon ("Needs a graphics card: without one it runs on the CPU" is "Needs a graphics card"). */
export const whyShort = (why: string): string => why.split(': ')[0]!;

/** The overall score of the results in `now`, and its change from the same tasks in `was` (the machine scored before); `n` is how many tasks count. */
export function overallOfRuns(
  now: Readonly<Record<string, TaskResult>>,
  was: Readonly<Record<string, TaskResult>>,
): { overall: number; n: number; delta: number | null } {
  const mine = Object.values(now).filter((r) => r.score !== null);
  const both = mine.filter((r) => was[r.id]?.score);
  return {
    overall: overallOf(mine),
    n: mine.length,
    delta: both.length > 0 ? deltaPct(overallOf(both), overallOf(both.map((r) => was[r.id]!))) : null,
  };
}

/** The mean score of a group's tasks that have one (0 when none has). */
export const groupScore = (g: BenchGroup, now: Readonly<Record<string, TaskResult>>): number =>
  overallOf(g.tasks.map((t) => now[t.id]).filter((r): r is TaskResult => !!r));
