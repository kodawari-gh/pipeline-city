// The preemptive kernel: the contexts of a job just started, and the switch to it.

import {
  DISPLAY_BASE,
  INTC_BASE,
  INTC_REG,
  KSLOT,
  MAX_THREADS_PER_JOB,
  PCH_REG,
  PchPhase,
  TIMER_BASE,
  TIMER_REG,
  USER_BASE,
} from '@/core/sim/memmap';
import { status } from '../asmtext';
import { PCB, PCBS, SLICE_CYCLES, SLICE_CYCLES_THR } from './layout';
import { ADDI_OP, roff } from './shared';
import type { PreemptCtx } from './types';

/** `preemptive`: the code from `kst_t1` on. */
const kstT1Asm = (ctx: PreemptCtx): string[] => {
  const { K } = ctx;
  return [
    // T from the program's first word (the nop addi zero, zero, T), one context per thread: free ones, all sharing the address space
    `  lw t1, ${K + 20}(zero)`,
    '  slli t1, t1, 8',
    '  addi t1, t1, 64',
    '  lw t1, 0(t1)',
    '  srli t1, t1, 8',
    '  slli t1, t1, 8',
    '  lw t1, 0(t1)',
    '  andi t2, t1, 32767',
    `  li t3, ${ADDI_OP}`,
    '  li s2, 1',
    '  bne t2, t3, kst_t1',
    '  srli t2, t1, 15',
    '  beq t2, zero, kst_t1',
    `  li t3, ${MAX_THREADS_PER_JOB + 1}`,
    '  bge t2, t3, kst_t1',
    '  mv s2, t2',
    'kst_t1:',
    `  sw s2, ${K + 32}(zero)`,
    '  li t0, 0',
    `  li t1, ${PCBS}`,
    `  li t4, ${PCBS + 8 * PCB.BYTES}`,
    'kst_cf:',
    `  lw t2, ${PCB.SLOT}(t1)`,
    '  bne t2, zero, kst_cn',
    `  lw t2, ${PCB.CORE}(t1)`,
    '  bne t2, zero, kst_cn',
    '  addi t0, t0, 1',
    'kst_cn:',
    `  addi t1, t1, ${PCB.BYTES}`,
    '  bne t1, t4, kst_cf',
    '  blt t0, s2, kst_fail', // not enough free contexts: the job waits
    `  lw t0, ${K + 4}(zero)`,
    `  sw s2, ${KSLOT.THREADS}(t0)`,
    `  sw s2, ${KSLOT.LIVE}(t0)`,
    `  sw zero, ${KSLOT.DEAD}(t0)`,
    `  li t1, ${PCBS}`,
    `  sw t1, ${K + 36}(zero)`,
    '  li s2, 0',
    'kst_c:',
  ];
};

/** `preemptive`: the code from `kst_cf2` on. */
const kstCf2Asm = (ctx: PreemptCtx): string[] => {
  const { K } = ctx;
  return [
    `  lw t1, ${K + 36}(zero)`,
    'kst_cf2:',
    `  lw t2, ${PCB.SLOT}(t1)`,
    '  bne t2, zero, kst_cx',
    `  lw t2, ${PCB.CORE}(t1)`,
    '  beq t2, zero, kst_cok',
    'kst_cx:',
    `  addi t1, t1, ${PCB.BYTES}`,
    '  j kst_cf2',
    'kst_cok:',
    `  addi t2, t1, ${PCB.BYTES}`,
    `  sw t2, ${K + 36}(zero)`,
    '  mv t2, t1',
    `  addi t3, t1, ${PCB.BYTES}`,
    'kst_pz:',
    '  sw zero, 0(t2)',
    '  addi t2, t2, 4',
    '  bne t2, t3, kst_pz',
    '  li t2, 65536',
    '  beq s2, zero, kst_s0',
    '  slli t2, s2, 12',
    '  li t3, 524288',
    '  add t2, t2, t3', // thread k > 0: its stack is above the heap, 0x80000 + k x 4K (threadStackTop)
    'kst_s0:',
    `  sw t2, ${roff('sp')}(t1)`,
    `  sw s2, ${PCB.TIDX}(t1)`,
    `  sw s2, ${roff('a0')}(t1)`,
    `  lw t2, ${K + 32}(zero)`,
    `  sw t2, ${roff('a1')}(t1)`,
    `  li t2, ${USER_BASE}`,
    `  sw t2, ${PCB.PC}(t1)`,
    `  lw t2, ${K + 16}(zero)`,
    '  slli t2, t2, 8',
    `  sw t2, ${PCB.TABLE}(t1)`,
    `  lw t2, ${K + 20}(zero)`,
    `  sw t2, ${PCB.L2_IMAGE}(t1)`,
    `  lw t2, ${K + 24}(zero)`,
    `  sw t2, ${PCB.L2_HEAP}(t1)`,
    `  lw t2, ${K + 28}(zero)`,
    `  sw t2, ${PCB.L2_STACK}(t1)`,
  ];
};

/** `preemptive`: a part of its code. */
const kstT1ThrAsm = (ctx: PreemptCtx): string[] => {
  const { K } = ctx;
  return [
    `  lw t0, ${K + 4}(zero)`,
    `  sw t0, ${PCB.SLOT}(t1)`, // last: now the scheduler may take it
    '  addi s2, s2, 1',
    `  lw t2, ${K + 32}(zero)`,
    '  bne s2, t2, kst_c',
  ];
};

/** `preemptive`: the code from `kst_p` on. */
const kstPAsm = (ctx: PreemptCtx): string[] => {
  const { KD, K } = ctx;
  return [
    `  lw t0, ${K + 4}(zero)`,
    `  li t1, ${KD}`,
    '  sub t1, t0, t1',
    '  slli t1, t1, 1',
    `  li t2, ${PCBS}`,
    '  add t1, t1, t2',
    '  mv t2, t1',
    `  addi t3, t1, ${PCB.BYTES}`,
    'kst_p:',
    '  sw zero, 0(t2)',
    '  addi t2, t2, 4',
    '  bne t2, t3, kst_p',
    '  li t2, 65536',
    `  sw t2, ${roff('sp')}(t1)`,
    `  li t2, ${USER_BASE}`,
    `  sw t2, ${PCB.PC}(t1)`,
    `  lw t2, ${K + 16}(zero)`,
    '  slli t2, t2, 8',
    `  sw t2, ${PCB.TABLE}(t1)`,
    `  lw t2, ${K + 20}(zero)`,
    `  sw t2, ${PCB.L2_IMAGE}(t1)`,
    `  lw t2, ${K + 24}(zero)`,
    `  sw t2, ${PCB.L2_HEAP}(t1)`,
    `  lw t2, ${K + 28}(zero)`,
    `  sw t2, ${PCB.L2_STACK}(t1)`,
    `  sw t0, ${PCB.SLOT}(t1)`,
  ];
};

/** `preemptive`: a part of its code. */
export const kstRunAsm = (ctx: PreemptCtx): string[] => {
  const { smp, thr, K } = ctx;
  return [
    // its context(s)
    ...(thr ? [...kstT1Asm(ctx), ...kstCf2Asm(ctx), ...kstT1ThrAsm(ctx)] : kstPAsm(ctx)),
    `  li t2, ${PchPhase.OsRun}`,
    `  sw t2, ${PCH_REG.PHASE}(s0)`,
    `  li a3, ${DISPLAY_BASE}`,
    ...status('RUNNING JOB', 'a3'),
    `  lw t0, ${K + 4}(zero)`, // the status text used t0
    '  li t2, 3',
    `  sw t2, ${KSLOT.STATE}(t0)`, // it can run now
    `  li t2, ${TIMER_BASE}`,
    `  li t3, ${thr ? SLICE_CYCLES_THR : SLICE_CYCLES}`,
    `  sw t3, ${TIMER_REG.INTERVAL}(t2)`,
    ...(smp
      ? [
          // wake the other cores: the job is theirs to run too
          `  li t2, ${INTC_BASE}`,
          `  lw t3, ${INTC_REG.CORES}(t2)`,
          '  li t4, 1',
          '  sll t4, t4, t3',
          '  addi t4, t4, -1',
          `  lw t3, ${INTC_REG.CORE_ID}(t2)`,
          '  li t0, 1',
          '  sll t0, t0, t3',
          '  sub t4, t4, t0', // every core but this one
          `  sw t4, ${INTC_REG.IPI}(t2)`,
        ]
      : []),
    `  lw ra, ${K}(zero)`,
    '  ret',
  ];
};
