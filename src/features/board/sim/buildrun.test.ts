import { describe, expect, it } from 'vitest';
import type { Phase } from '@/worker/game/types';
import { OFF, RUN_SPEEDS, runState, sameRun } from './buildrun';

const PHASES: Phase[] = ['waiting-for-key', 'done-remove-key', 'off', 'posting', 'mounting', 'loading', 'running', 'writing', 'halted', 'error', 'booting-os', 'idle-os', 'ingesting', 'running-os', 'flashing'];

describe('buildrun', () => {
  it('a machine that is off is OFF whatever its phase says', () => {
    for (const p of PHASES) expect(runState(false, p, null)).toBe(OFF);
  });

  it('every phase of a machine that is on has words and a tone', () => {
    for (const p of PHASES.filter((x) => x !== 'off')) {
      const r = runState(true, p, null);
      expect(r.on).toBe(true);
      expect(r.text.length).toBeGreaterThan(2);
      expect(['busy', 'ok', 'bad']).toContain(r.tone);
    }
  });

  it('an error says why, and only an error does', () => {
    expect(runState(true, 'error', 'no CPU').why).toBe('no CPU');
    expect(runState(true, 'error', 'no CPU').tone).toBe('bad');
    expect(runState(true, 'idle-os', 'stale').why).toBeNull();
  });

  it('the chip redraws on a change of phase or reason, not on a repeat', () => {
    expect(sameRun(runState(true, 'idle-os', null), runState(true, 'idle-os', null))).toBe(true);
    expect(sameRun(runState(true, 'idle-os', null), runState(true, 'running-os', null))).toBe(false);
    expect(sameRun(runState(true, 'error', 'a'), runState(true, 'error', 'b'))).toBe(false);
    expect(sameRun(OFF, runState(true, 'posting', null))).toBe(false);
  });

  it('the speeds climb, from the game\'s 1x', () => {
    expect(RUN_SPEEDS[0]).toBe(1);
    expect([...RUN_SPEEDS]).toEqual([...RUN_SPEEDS].sort((a, b) => a - b));
  });
});
