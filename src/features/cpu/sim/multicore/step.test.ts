import { describe, expect, it } from 'vitest';
import { ECONOMY } from '@/features/economy/sim/economy';
import { rig } from '@/worker/game/testkit';
import type { Game } from '@/worker/game/game';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

/** A powered rig with the paging OS's CPU. */
function poweredRig(): Game {
  const g = rig('ssd1', { cpu: 'cpu2' });
  g.powerButton();
  return g;
}

/** Ticks `g` until its OS is idle, at most `max` times. */
function bootToIdle(g: Game, max: number): void {
  for (let i = 0; i < max && g.currentPhase() !== 'idle-os'; i++) {
    g.advanceBaseTick();
  }
}

describe('stepping the paused machine', () => {
  it('runs exactly the cycles asked for, and does nothing while the machine is off', () => {
    const g = rig('ssd1', { cpu: 'cpu2' });
    expect(g.stepCycles(5)).toBe(0); // off
    g.powerButton();
    bootToIdle(g, 40);
    const e = must(g.machine.engine);
    const c0 = e.cycle;
    const one = g.stepCycles(1); // (a load in the kernel's idle loop takes two cycles)
    expect(one).toBeGreaterThanOrEqual(1);
    expect(one).toBeLessThan(3);
    expect(e.cycle).toBe(c0 + one);
    const n = g.stepCycles(250); // (an instruction that takes several cycles is not cut: it may end a cycle or two past the ask)
    expect(n).toBeGreaterThanOrEqual(250);
    expect(n).toBeLessThan(255);
    expect(e.cycle).toBe(c0 + one + n);
  });

  it('stepping whole ticks and then cycles gives the same machine as running ticks', () => {
    const a = poweredRig(),
      b = poweredRig();
    for (let i = 0; i < 30; i++) {
      a.advanceBaseTick();
    }
    for (let i = 0; i < 30; i++) {
      b.advanceBaseTick();
    }
    const before = must(a.machine.engine).cycle;
    a.advanceBaseTick();
    // one tick is a number of cycles; stepping that many cycles gets to the same cycle count
    const per = must(a.machine.engine).cycle - before;
    b.stepCycles(per);
    expect(must(b.machine.engine).cycle).toBe(must(a.machine.engine).cycle);
    expect(b.machine.ram.slice(0, 8192)).toStrictEqual(a.machine.ram.slice(0, 8192));
  });
});
