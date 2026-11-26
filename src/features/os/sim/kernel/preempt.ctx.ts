// The options of the preemptive kernel (OS 3 and up) and the code helpers that depend on them. See preempt.ts.

import { INTC_BASE, INTC_REG, IRQ, KSLOT, PCH_RESULT_WORDS } from '@/core/sim/memmap';
import { CURP, JOB_ROW_ADDR, KSCR, KSCR_SMP, LOCK3, NIC_EV, PCB, PCORE, PC_CURP, PFSB } from './layout';
import { copy } from './shared';
import type { PreemptCtx, PreemptOpts } from './types';

/** `curp`: on the multicore kernel, the PCB is in the core's block; else it is at a fixed place. */
const curpOf = (smp: boolean, rd: string, tmp: string): string[] =>
  smp
    ? [
        `  li ${tmp}, ${INTC_BASE}`,
        `  lw ${tmp}, ${INTC_REG.CORE_ID}(${tmp})`,
        `  slli ${tmp}, ${tmp}, 6`,
        `  lw ${rd}, ${PCORE + PC_CURP}(${tmp})`,
      ]
    : [`  lw ${rd}, ${CURP}(zero)`];
/** The big kernel lock taken inline (clobbers a, b, c): the multicore frame allocator is called with interrupts off. */
const lockOf = (smp: boolean, tag: string, [a, b, c]: readonly [string, string, string]): string[] =>
  smp
    ? [
        `  li ${a}, ${LOCK3}`,
        `  li ${b}, 1`,
        `${tag}:`,
        `  lw ${c}, 0(${a})`,
        `  bne ${c}, zero, ${tag}`,
        `  amoswap ${c}, ${b}, (${a})`,
        `  bne ${c}, zero, ${tag}`,
      ]
    : []; // read first: a spinner on the shared L2 port would starve the holder
/** A job's slot (a0) has been marked done: when it is a network job, its result is for the NIC (clobbers t0). The flag is set after the state, so that the driver finds the result. */
const nicKick = (tag: string): string[] => [
  `  lw t0, ${KSLOT.KEY}(a0)`,
  `  bge t0, zero, ${tag}`,
  '  li t0, 1',
  `  sw t0, ${NIC_EV}(zero)`,
  `${tag}:`,
];
const rowSave: readonly string[] = [
  `  li t1, ${JOB_ROW_ADDR}`,
  `  addi t2, t0, ${PCB.ROW}`,
  `  addi t3, t1, ${4 * PCH_RESULT_WORDS}`,
  ...copy('ksr', ['t1', 't2', 't3', 't4']),
];

/** The options of `preemptive` and the code helpers that depend on them. */
/** `pf` is in the core's block (s3 points at it) or at its fixed place. */
export const preemptCtx = (o: PreemptOpts): PreemptCtx => {
  const { smp } = o;
  return {
    ...o,
    K: smp ? KSCR_SMP : KSCR,
    curp: (rd: string, tmp: string): string[] => curpOf(smp, rd, tmp),
    pf: (off: number): string => (smp ? `${off}(s3)` : `${PFSB + off}(zero)`),
    lockIn: (tag: string, regs: readonly [string, string, string]): string[] => lockOf(smp, tag, regs),
    unlockIn: (a: string): string[] => (smp ? [`  li ${a}, ${LOCK3}`, `  sw zero, 0(${a})`] : []),
    ackBits: (1 << IRQ.TIMER) | (smp ? 1 << IRQ.IPI : 0),
    nicKick,
    rowSave,
  };
};
