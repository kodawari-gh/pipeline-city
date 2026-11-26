import { assert, describe, expect, it } from 'vitest';
import { assemble } from '../../cpu/sim/asm';
import { KDATA_BASE, KERNEL_BASE, USER_BASE } from '@/core/sim/memmap';
import { KERNEL_IMAGE } from '../../os/sim';
import { ECONOMY } from '../../economy/sim/economy';
import type { Game } from '@/worker/game/game';
import { rig } from '@/worker/game/testkit';

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const until = (g: Game, done: () => boolean, max = 4000): void => {
  for (let t = 0; t < max && !done(); t++) {
    g.advanceBaseTick();
  }
  expect(done()).toBe(true);
};

/** The plugged job is done and its key is out of the port. */
const jobDone = (g: Game) => (): boolean => g.completed === 1 && g.pluggedKey() === null;

const ramView = (g: Game) => new DataView(g.machine.ram.buffer);
/** The job runs and its program is in user memory. */
const jobLoaded = (g: Game) => (): boolean =>
  g.currentPhase() === 'running-os' && ramView(g).getUint32(USER_BASE, true) !== 0;
const faulted = (g: Game) => (): boolean => (g.snapshot().faults ?? 0) === 1;
/** The kernel is flashing the result to the key, or done with it. */
const resultOut = (g: Game) => (): boolean => {
  const stage = g.snapshot().plugged?.stage;
  return stage === 'flashing' || stage === 'done' || g.pluggedKey() === null;
};
const isProtectionFault = (l: { kind: string; text: string }): boolean =>
  l.kind === 'fault' && l.text.includes('protected memory');

/** A job that scribbles over the kernel and the job table. */
const SCRIBBLER = assemble(`
  li s0, ${KERNEL_BASE}
  li s1, ${KDATA_BASE}
  li t0, 0
  sw t0, 0(s0)
  sw t0, 4(s0)
  sw t0, 0(s1)
  sw t0, 8(s1)
  li t0, 77
  sw t0, 0x3000(zero)   # after the fault: must not land
spin:
  j spin`).program;

describe('a job that writes to OS memory', () => {
  it('is killed by the OS: the write is refused, the job ends with a fault result, the fault is counted, and the machine goes on', () => {
    const g = rig('ssd1');
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    expect(g.snapshot().faults).toBe(0);
    const dv = () => ramView(g);
    const [firstTrayKeyId] = g.trayKeyIds();
    assert.exists(firstTrayKeyId);
    expect(g.plugKey(firstTrayKeyId).ok).toBe(true);
    until(g, jobLoaded(g));
    // the "program" the CPU runs from here on
    for (const [i, w] of SCRIBBLER.entries()) {
      dv().setUint32(USER_BASE + 4 * i, w, true);
    }
    until(g, faulted(g));
    // nothing of the OS was touched
    expect([...KERNEL_IMAGE].every((w, i) => dv().getUint32(KERNEL_BASE + 4 * i, true) === w)).toBe(true);
    expect(dv().getUint32(0x30_00, true)).toBe(0);
    // the kernel took the job off the CPU, recorded the fault as the result, and carried on: it flashes the result to the key
    until(g, resultOut(g));
    expect(g.snapshot().log.some(isProtectionFault)).toBe(true);
    expect(g.currentPhase()).not.toBe('error');
  });

  it('normal jobs never fault', () => {
    const g = rig('ssd1', { keys: [{ template: 'cli.scan', scale: 3 }, { template: 'cli.calc' }] });
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    const [firstTrayKeyId2] = g.trayKeyIds();
    assert.exists(firstTrayKeyId2);
    expect(g.plugKey(firstTrayKeyId2).ok).toBe(true);
    until(g, jobDone(g));
    expect(g.snapshot().faults).toBe(0);
  });
});
