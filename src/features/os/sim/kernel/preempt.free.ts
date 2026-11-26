// The preemptive kernel: the frames of a job given back (`kfinish`, `kfreeown`) and the frame allocator (`kalloc`).

import { KSLOT, KSLOT_BYTES, TIMER_BASE, TIMER_REG } from '@/core/sim/memmap';
import { FMAP, FMAP_FIRST, FMAP_LAST, HINT, KERNEL_NAP, PCB, PCBS, SLEEP } from './layout';
import { jobEndAsm, kthrdeadAsm } from './preempt.end';
import { jtEnd } from './shared';
import type { PreemptCtx } from './types';

/** `preemptive`: the code from `kfo0` on. */
const kfo0Asm = (ctx: PreemptCtx): string[] => {
  const { lockIn, unlockIn } = ctx;
  return [
    // OS 4: a chunk of the map at a time under the big lock, so that the threads of a job that end together are not all kept waiting for the whole scan (they would
    // spin in its way: a core's second thread gets a share of the pipeline). The hint goes back to the start with every chunk, which is never wrong.
    `  li t2, ${FMAP_FIRST}`,
    'kfo0:',
    ...lockIn('kfl0', ['t0', 't3', 't4']),
    '  addi t0, t2, 256',
    `  li t3, ${FMAP_LAST}`,
    '  blt t0, t3, kfoe',
    '  mv t0, t3',
    'kfoe:',
    'kfo1:',
    '  lw t4, 0(t2)',
    '  andi t4, t4, 255',
    '  bne t4, t1, kfo2',
    '  sw zero, 0(t2)',
    'kfo2:',
    '  addi t2, t2, 4',
    '  bne t2, t0, kfo1',
    `  li t4, ${FMAP_FIRST}`,
    `  sw t4, ${HINT}(zero)`,
    ...unlockIn('t0'),
    `  li t3, ${FMAP_LAST}`,
    '  bne t2, t3, kfo0',
    '  ret',
  ];
};

/** `preemptive`: the code from `kfo1` on. */
const kfo1Asm = (ctx: PreemptCtx): string[] => {
  const { lockIn, unlockIn } = ctx;
  return [
    ...lockIn('kfl0', ['t2', 't3', 't4']),
    `  li t2, ${FMAP_FIRST}`,
    `  li t3, ${FMAP_LAST}`,
    'kfo1:',
    '  lw t4, 0(t2)',
    '  andi t4, t4, 255',
    '  bne t4, t1, kfo2',
    '  sw zero, 0(t2)',
    'kfo2:',
    '  addi t2, t2, 4',
    '  bne t2, t3, kfo1',
    `  li t2, ${FMAP_FIRST}`,
    `  sw t2, ${HINT}(zero)`,
    ...unlockIn('t2'),
    '  ret',
  ];
};

/** `preemptive`: the code from `kfl1` on. */
export const kfl1Asm = (ctx: PreemptCtx): string[] => {
  const { smp, thr, KD } = ctx;
  return [
    '  bne t1, t2, kfz3',
    ...(thr
      ? [
          `  li t1, ${PCBS}`,
          `  li t2, ${PCBS + 8 * PCB.BYTES}`,
          'kfl1:',
          `  lw t3, ${PCB.SLOT}(t1)`,
          '  bne t3, a0, kfn',
          `  lw t4, ${PCB.CORE}(t1)`,
          '  bne t4, zero, kfn',
          `  sw zero, ${PCB.SLOT}(t1)`,
          `  lw t4, ${KSLOT.LIVE}(a0)`,
          '  addi t4, t4, -1',
          `  sw t4, ${KSLOT.LIVE}(a0)`,
          'kfn:',
          `  addi t1, t1, ${PCB.BYTES}`,
          '  bne t1, t2, kfl1',
          'kfd:',
          '  call kuk',
        ]
      : []),
    ...(smp ? [] : ['  li t0, 4', `  sw t0, ${KSLOT.STATE}(a0)`]),
    // falls into kfinish

    // ---- kfinish: a0 = the slot of the job that ended: give back its frames, stop the timer when nothing else runs, switch ----
    'kfinish:',
    `  sw zero, ${SLEEP}(zero)`,
    ...(thr ? kthrdeadAsm(ctx) : jobEndAsm(ctx)),

    // kfreeown: free every frame owned by job t1 (clobbers t2-t4)
    'kfreeown:',
    ...(thr ? kfo0Asm(ctx) : kfo1Asm(ctx)),

    // kcnt: a0 = jobs running (clobbers t0-t3)
    'kcnt:',
    `  li t0, ${KD}`,
  ];
};

/** `preemptive`: the code from `kc1` on. */
export const kc1Asm = (ctx: PreemptCtx): string[] => {
  const { lockIn, unlockIn } = ctx;
  return [
    ...jtEnd('t1', 't0'),
    '  li a0, 0',
    'kc1:',
    `  lw t2, ${KSLOT.STATE}(t0)`,
    '  li t3, 3',
    '  bne t2, t3, kc2',
    '  addi a0, a0, 1',
    'kc2:',
    `  addi t0, t0, ${KSLOT_BYTES}`,
    '  bne t0, t1, kc1',
    '  ret',

    // kalloc: a0 = the owner word to write -> a0 = a free frame (now owned), or 0 (clobbers t0-t2)
    'kalloc:',
    ...lockIn('kal0', ['t0', 't1', 't2']),
    `  lw t0, ${HINT}(zero)`,
    `  li t1, ${FMAP_LAST}`,
    'ka1:',
    '  lw t2, 0(t0)',
    '  beq t2, zero, ka2',
    '  addi t0, t0, 4',
    '  bne t0, t1, ka1',
    '  li a0, 0',
    ...unlockIn('t0'),
    '  ret',
    'ka2:',
    '  sw a0, 0(t0)',
    '  addi t2, t0, 4',
    `  sw t2, ${HINT}(zero)`,
    `  li t1, ${FMAP}`,
    '  sub t0, t0, t1',
    '  srli a0, t0, 2',
    ...unlockIn('t0'),
    '  ret',
  ];
};

/** `preemptive`: the code from `kalloc_nl` on. */
export const kallocNlAsm = (ctx: PreemptCtx): string[] => {
  const { thr, K } = ctx;
  return [
    ...(thr
      ? [
          // kalloc_nl: the same with the big kernel lock already held (the page-fault handler holds it while it changes the page tables of a job its other threads share)
          'kalloc_nl:',
          `  lw t0, ${HINT}(zero)`,
          `  li t1, ${FMAP_LAST}`,
          'kan1:',
          '  lw t2, 0(t0)',
          '  beq t2, zero, kan2',
          '  addi t0, t0, 4',
          '  bne t0, t1, kan1',
          '  li a0, 0',
          '  ret',
          'kan2:',
          '  sw a0, 0(t0)',
          '  addi t2, t0, 4',
          `  sw t2, ${HINT}(zero)`,
          `  li t1, ${FMAP}`,
          '  sub t0, t0, t1',
          '  srli a0, t0, 2',
          '  ret',
        ]
      : []),

    // kidle: the kernel has nothing to do: while programs run, give the processor to them at once instead of spinning
    'kidle:',
    '  call kcnt',
    '  beq a0, zero, kloop',
    `  li t0, ${KERNEL_NAP}`,
    `  sw t0, ${SLEEP}(zero)`,
    `  li t2, ${TIMER_BASE}`,
    '  li t0, 1',
    `  sw t0, ${TIMER_REG.KICK}(t2)`,
    '  j kloop',

    // ---- kstart: a0 = the slot to run. Tables and image frames come from the frame map, the program is read in, its context is made ----
    'kstart:',
    `  sw ra, ${K}(zero)`,
    `  sw a0, ${K + 4}(zero)`,
  ];
};
