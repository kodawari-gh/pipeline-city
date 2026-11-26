import { describe, expect, it } from 'vitest';
import { TpmCmd } from '@/core/sim/memmap';
import { tpmPlan } from './tpmplans';
import { tpmRoute } from './tpmroute';

const plan = tpmPlan({ hashStages: 4, quoteRounds: 3, keys: 8 });
const ids = (cmd: number, phase: 'in' | 'work' | 'out') =>
  tpmRoute(plan, cmd, phase).map((h) => `${h.reverse ? '<' : ''}${h.link.id}`);

describe('the way a command goes through the module', () => {
  it('comes in over the link to the registers and the sequencer, whatever the command', () => {
    for (const cmd of [0, 1, 2, 3, 4, 5, 6, 9]) {
      expect(ids(cmd, 'in')).toStrictEqual(['lpc-regs', 'regs-seq']);
    }
  });
  it('works in the engine of its kind; a measure reads RAM through the bus master', () => {
    expect(ids(TpmCmd.Measure, 'work')).toStrictEqual(['seq-hash', 'hash-ram']);
    expect(ids(TpmCmd.Attest, 'work')).toStrictEqual(['seq-quote']);
    expect(ids(TpmCmd.Seal, 'work')).toStrictEqual(['seq-vault']);
    expect(ids(TpmCmd.Unseal, 'work')).toStrictEqual(['seq-vault']);
    expect(ids(TpmCmd.Protect, 'work')).toStrictEqual(['seq-guard']);
    expect(ids(TpmCmd.Unprotect, 'work')).toStrictEqual(['seq-guard']);
  });
  it('answers back along the registers; the guard answers through the sequencer', () => {
    expect(ids(TpmCmd.Measure, 'out')).toStrictEqual(['<regs-hash', '<lpc-regs']);
    expect(ids(TpmCmd.Protect, 'out')).toStrictEqual(['<seq-guard', '<regs-seq', '<lpc-regs']);
  });
  it('a refused command has no work and goes straight back out', () => {
    expect(ids(0, 'work')).toStrictEqual([]);
    expect(ids(0, 'out')).toStrictEqual(['<lpc-regs']);
  });
});
