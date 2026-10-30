import { describe, expect, it } from 'vitest';
import { TpmCmd } from '../../sim/isa/memmap';
import { tpmPlan } from './tpmplans';
import { tpmRoute } from './tpmroute';

const plan = tpmPlan({ hashStages: 4, quoteRounds: 3, keys: 8 });
const ids = (cmd: number, phase: 'in' | 'work' | 'out') => tpmRoute(plan, cmd, phase).map((h) => `${h.reverse ? '<' : ''}${h.link.id}`);

describe('the way a command goes through the module', () => {
  it('comes in over the link to the registers and the sequencer, whatever the command', () => {
    for (const cmd of [0, 1, 2, 3, 4, 5, 6, 9]) expect(ids(cmd, 'in')).toEqual(['lpc-regs', 'regs-seq']);
  });
  it('works in the engine of its kind; a measure reads RAM through the bus master', () => {
    expect(ids(TpmCmd.Measure, 'work')).toEqual(['seq-hash', 'hash-ram']);
    expect(ids(TpmCmd.Attest, 'work')).toEqual(['seq-quote']);
    expect(ids(TpmCmd.Seal, 'work')).toEqual(['seq-vault']);
    expect(ids(TpmCmd.Unseal, 'work')).toEqual(['seq-vault']);
    expect(ids(TpmCmd.Protect, 'work')).toEqual(['seq-guard']);
    expect(ids(TpmCmd.Unprotect, 'work')).toEqual(['seq-guard']);
  });
  it('answers back along the registers; the guard answers through the sequencer', () => {
    expect(ids(TpmCmd.Measure, 'out')).toEqual(['<regs-hash', '<lpc-regs']);
    expect(ids(TpmCmd.Protect, 'out')).toEqual(['<seq-guard', '<regs-seq', '<lpc-regs']);
  });
  it('a refused command has no work and goes straight back out', () => {
    expect(ids(0, 'work')).toEqual([]);
    expect(ids(0, 'out')).toEqual(['<lpc-regs']);
  });
});
