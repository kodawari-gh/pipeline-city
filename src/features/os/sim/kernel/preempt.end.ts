// The preemptive kernel: the end of a job (`kdone`, `kthrdead`) and a killed job (`kfault`).

import {
  INTC_BASE,
  INTC_REG,
  KSLOT,
  MMU_BASE,
  MMU_REG,
  PCH_RESULT_WORDS,
  TIMER_BASE,
  TIMER_REG,
} from '@/core/sim/memmap';
import { CURP, JOB_ROW_ADDR, KFAULTS, KSTK, KTBL, PCB, PCORE, PC_CURP } from './layout';
import { copy } from './shared';
import type { PreemptCtx } from './types';

/** `preemptive`: the code from `kthrdead` on. */
export const kthrdeadAsm = (ctx: PreemptCtx): string[] => {
  const { KD, curp, nicKick } = ctx;
  return [
    // OS 4: the context ends (it is free for another job); the last thread of the job gives the frames back and marks the slot done
    ...curp('t0', 't1'),
    '  call klk',
    `  sw zero, ${PCB.SLOT}(t0)`,
    `  sw zero, ${PCB.CORE}(t0)`,
    `  lw t1, ${KSLOT.LIVE}(a0)`,
    '  addi t1, t1, -1',
    `  sw t1, ${KSLOT.LIVE}(a0)`,
    '  call kuk',
    '  bne t1, zero, kpick',
    `  li t1, ${KD}`,
    '  sub t1, a0, t1',
    '  srli t1, t1, 6',
    '  addi t1, t1, 1',
    '  call kfreeown',
    '  li t0, 4',
    `  sw t0, ${KSLOT.STATE}(a0)`,
    ...nicKick('knk3'),
    '  j kpick',
    'kthrdead:', // a thread of a killed job found out at its interrupt: t1 = the job's slot
    '  mv a0, t1',
    '  j kfinish',
  ];
};

/** `preemptive`: a part of its code. */
export const jobEndAsm = (ctx: PreemptCtx): string[] => {
  const { smp, KD, curp, nicKick } = ctx;
  return [
    `  li t1, ${KD}`,
    '  sub t1, a0, t1',
    '  srli t1, t1, 6',
    '  addi t1, t1, 1',
    '  call kfreeown',
    ...(smp
      ? [
          // the frames are back before the slot can be reused; the job lets go of its core's claim
          ...curp('t0', 't1'),
          `  sw zero, ${PCB.CORE}(t0)`,
          '  li t0, 4',
          `  sw t0, ${KSLOT.STATE}(a0)`,
          ...nicKick('knk2'),
          '  j kpick',
        ]
      : [
          ...nicKick('knk1'), // the slot was marked done before kfinish
          '  call kcnt',
          '  bne a0, zero, kpick',
          `  li t2, ${TIMER_BASE}`,
          `  sw zero, ${TIMER_REG.INTERVAL}(t2)`,
          '  j kpick',
        ]),
  ];
};

/** `preemptive`: the code from `kdone` on. */
export const kdone3Asm = (ctx: PreemptCtx): string[] => {
  const { smp, thr } = ctx;
  return [
    // ---- a job finished (it jumped to the ROM done vector, which lands here) ----
    'kdone:',
    `  li t2, ${INTC_BASE}`,
    `  sw zero, ${INTC_REG.CTRL}(t2)`, // nothing interrupts the end of a job
    ...(smp
      ? [
          `  lw t0, ${INTC_REG.CORE_ID}(t2)`,
          '  slli t1, t0, 8',
          `  li sp, ${KSTK}`,
          '  sub sp, sp, t1', // this core's end-of-job stack
          '  slli t0, t0, 6',
          `  lw t0, ${PCORE + PC_CURP}(t0)`,
          `  li t2, ${MMU_BASE}`,
          `  li t1, ${KTBL}`,
          `  sw t1, ${MMU_REG.TABLE}(t2)`, // the kernel's address space: the job table can be written again
        ]
      : [
          `  li t2, ${MMU_BASE}`,
          `  li t0, ${KTBL}`,
          `  sw t0, ${MMU_REG.TABLE}(t2)`, // the kernel's address space: the job table can be written again
          `  li sp, ${KSTK}`,
          `  lw t0, ${CURP}(zero)`,
        ]),
    `  lw a0, ${PCB.SLOT}(t0)`,
    ...(thr
      ? [
          `  lw t4, ${PCB.TIDX}(t0)`,
          '  bne t4, zero, kdn',
          '  call klk',
          `  lw t1, ${KSLOT.DEAD}(a0)`,
          '  bne t1, zero, kdu',
        ]
      : []), // thread 0 writes the job's result, under the lock so that a fault cannot write at the same time
    `  li t0, ${JOB_ROW_ADDR}`,
    `  addi t1, a0, ${KSLOT.RESULT}`,
    `  addi t2, t0, ${4 * PCH_RESULT_WORDS}`,
    ...copy('kres3', ['t0', 't1', 't2', 't3']),
    ...(thr ? ['kdu:', '  call kuk', 'kdn:'] : []),
    ...(smp ? [] : ['  li t0, 4', `  sw t0, ${KSLOT.STATE}(a0)`]), // multicore: kfinish marks the slot done once the frames are back
  ];
};

/** `preemptive`: the code from `kfault` on. */
export const kfault3Asm = (ctx: PreemptCtx): string[] => {
  const { smp, thr, curp } = ctx;
  return [
    '  j kfinish',

    // ---- a job touched memory it may not (or the frames ran out): it is killed, its result is the fault text ----
    'kfault:',
    ...(smp
      ? [
          `  li t2, ${INTC_BASE}`,
          `  lw t0, ${INTC_REG.CORE_ID}(t2)`,
          '  slli t1, t0, 8',
          `  li sp, ${KSTK}`,
          '  sub sp, sp, t1',
          ...(thr ? [] : [`  li t0, ${KFAULTS}`, '  li t1, 1', '  amoadd t2, t1, (t0)']), // every core counts faults (OS 4: the thread that kills the job does)
        ]
      : [`  li sp, ${KSTK}`, `  li t0, ${KFAULTS}`, '  lw t1, 0(t0)', '  addi t1, t1, 1', '  sw t1, 0(t0)']),
    ...curp('t0', 't1'),
    `  lw a0, ${PCB.SLOT}(t0)`,
    ...(thr
      ? [
          // one thread kills the job: it marks it, counts the fault and writes the text; the contexts of the job that no core holds end here, the others at their next interrupt
          '  call klk',
          `  lw t1, ${KSLOT.DEAD}(a0)`,
          '  bne t1, zero, kfd',
          '  li t1, 1',
          `  sw t1, ${KSLOT.DEAD}(a0)`,
          `  li t1, ${KFAULTS}`,
          '  lw t2, 0(t1)',
          '  addi t2, t2, 1',
          '  sw t2, 0(t1)',
        ]
      : []),
    `  addi t1, a0, ${KSLOT.RESULT}`,
    `  li t3, 1179075923`, // "SEGF"
    '  sw t3, 0(t1)',
    `  li t3, 1414288705`, // "AULT"
    '  sw t3, 4(t1)',
    `  addi t2, t1, ${4 * PCH_RESULT_WORDS}`,
    '  addi t1, t1, 8',
    'kfz3:',
    '  sw zero, 0(t1)',
    '  addi t1, t1, 4',
  ];
};
