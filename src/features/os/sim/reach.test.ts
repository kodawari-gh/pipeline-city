import { describe, expect, it } from 'vitest';
import { getOsSpec, programSlotsOn, smpOn, threadsOn } from '.';

// What each OS does with a CPU's cores (docs/MULTICORE.md section 6): the numbers the OS sheet of Build my PC shows, and the ones the machine's boot image uses (`Game.osProgramSlots`).
const os = (id: string) => getOsSpec(id)!;

describe('programs at once', () => {
  it('the resident OS runs one, on core 0, whatever the CPU has', () => {
    expect(programSlotsOn(os('os1'), 1, 1)).toBe(1);
    expect(programSlotsOn(os('os1'), 4, 8)).toBe(1);
  });

  it('the paged OS runs one on each hardware core, two at most', () => {
    expect(programSlotsOn(os('os2'), 1, 1)).toBe(1);
    expect(programSlotsOn(os('os2'), 2, 2)).toBe(2);
    expect(programSlotsOn(os('os2'), 4, 8)).toBe(2);
  });

  it('the preemptive OS shares each core: its own four, up to eight with two for each logical core', () => {
    expect(programSlotsOn(os('os3'), 1, 1)).toBe(4);
    expect(programSlotsOn(os('os3'), 2, 2)).toBe(4);
    expect(programSlotsOn(os('os3'), 2, 4)).toBe(8);
    expect(programSlotsOn(os('os3'), 4, 8)).toBe(8);
  });

  it('the multicore OS runs eight, and never fewer than the preemptive one on the same CPU', () => {
    expect(programSlotsOn(os('os4'), 1, 1)).toBe(8);
    for (const [hw, logical] of [
      [1, 1],
      [2, 2],
      [2, 4],
      [4, 8],
    ] as const)
      expect(programSlotsOn(os('os4'), hw, logical)).toBeGreaterThanOrEqual(programSlotsOn(os('os3'), hw, logical));
  });
});

describe('the multicore kernel and the threaded jobs', () => {
  it('the paged OS boots its multicore kernel with a second core, the preemptive one with a second logical core', () => {
    expect(smpOn(1, 4, 8)).toBe(false);
    expect(smpOn(2, 1, 1)).toBe(false);
    expect(smpOn(2, 2, 2)).toBe(true);
    expect(smpOn(3, 1, 1)).toBe(false);
    expect(smpOn(3, 1, 2)).toBe(true);
    expect(smpOn(4, 2, 4)).toBe(true);
  });

  it('only the multicore OS spreads one job over cores, and only over a CPU that has them', () => {
    expect(threadsOn(os('os4'), 1)).toBe(false);
    expect(threadsOn(os('os4'), 2)).toBe(true);
    for (const id of ['os1', 'os2', 'os3']) expect(threadsOn(os(id), 8)).toBe(false);
  });
});
