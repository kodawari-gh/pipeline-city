// The preemptive kernel: the start of a job, its tables and its image (`kstart`).

import { INTC_BASE, INTC_REG, KSLOT } from '@/core/sim/memmap';
import type { PreemptCtx } from './types';

/** `preemptive`: the code from `kst_t` on. */
export const kstTAsm = (ctx: PreemptCtx): string[] => {
  const { KD, K } = ctx;
  return [
    `  lw t0, ${KSLOT.LEN}(a0)`,
    '  slli t0, t0, 2',
    '  addi t0, t0, 255',
    '  srli t0, t0, 8', // image pages
    `  sw t0, ${K + 8}(zero)`,
    `  li t1, ${KD}`,
    '  sub t1, a0, t1',
    '  srli t1, t1, 6',
    '  addi t1, t1, 1',
    `  sw t1, ${K + 12}(zero)`, // the owner
    `  li t2, ${INTC_BASE}`,
    `  sw zero, ${INTC_REG.CTRL}(t2)`, // the frame map is taken without interruption (a page fault would take frames too)
    '  li s2, 0',
    'kst_t:',
    `  lw a0, ${K + 12}(zero)`,
    '  addi a0, a0, 512',
    '  call kalloc',
    '  beq a0, zero, kst_fail',
    '  slli t0, s2, 2',
    `  sw a0, ${K + 16}(t0)`,
    '  addi s2, s2, 1',
    '  li t0, 4',
    '  bne s2, t0, kst_t',
    '  li s2, 0',
    'kst_z:',
    '  slli t0, s2, 2',
    `  lw t0, ${K + 16}(t0)`,
    '  slli t0, t0, 8',
    '  addi t1, t0, 256',
    'kst_zz:',
    '  sw zero, 0(t0)',
    '  addi t0, t0, 4',
    '  bne t0, t1, kst_zz',
    '  addi s2, s2, 1',
    '  li t0, 4',
    '  bne s2, t0, kst_z',
    '  li s2, 0',
    'kst_i:',
    `  lw t0, ${K + 8}(zero)`,
    '  beq s2, t0, kst_id',
  ];
};

/** `preemptive`: the code from `kst_fail` on. */
export const kstFailAsm = (ctx: PreemptCtx): string[] => {
  const { K } = ctx;
  return [
    `  lw a0, ${K + 12}(zero)`,
    '  call kalloc',
    '  beq a0, zero, kst_fail',
    '  slli t0, a0, 8',
    '  addi t0, t0, 7', // the image: read, write, run
    `  lw t1, ${K + 20}(zero)`,
    '  slli t1, t1, 8',
    '  addi t2, s2, 16',
    '  slli t2, t2, 2',
    '  add t1, t1, t2',
    '  sw t0, 0(t1)',
    '  addi s2, s2, 1',
    '  j kst_i',
    'kst_fail:', // not enough frames: give back what was taken, the job stays queued
    `  lw t1, ${K + 12}(zero)`,
    '  call kfreeown',
    `  li t2, ${INTC_BASE}`,
    '  li t0, 1',
    `  sw t0, ${INTC_REG.CTRL}(t2)`,
    `  lw ra, ${K}(zero)`,
    '  ret',
    'kst_id:',
    // the first-level table: the ROM and image, the heap, and the OS with the stack
    `  lw t0, ${K + 16}(zero)`,
    '  slli t0, t0, 8',
    ...(
      [
        [0, 20],
        [4, 24],
        [12, 28],
      ] as [number, number][]
    ).flatMap(([entry, k]) => [
      `  lw t1, ${K + k}(zero)`,
      '  slli t1, t1, 8',
      '  addi t1, t1, 1',
      `  sw t1, ${entry}(t0)`,
    ]),
    `  lw t0, ${K + 20}(zero)`,
    '  slli t0, t0, 8',
    '  li t1, 5',
  ];
};

/** `preemptive`: the code from `kst_r` on. */
export const kstRAsm = (ctx: PreemptCtx): string[] => {
  const { kendPage, K } = ctx;
  return [
    '  addi t2, t0, 64',
    'kst_r:', // the ROM: read, run
    '  sw t1, 0(t0)',
    '  addi t0, t0, 4',
    '  addi t1, t1, 256',
    '  bne t0, t2, kst_r',
    `  lw t0, ${K + 28}(zero)`,
    '  slli t0, t0, 8',
    `  li t1, ${192 * 256 + 5}`,
    `  addi t2, t0, ${4 * ((kendPage >> 8) - 192)}`,
    'kst_o:', // the OS: read, run
    '  sw t1, 0(t0)',
    '  addi t0, t0, 4',
    '  addi t1, t1, 256',
    '  bne t0, t2, kst_o',
    `  li t2, ${INTC_BASE}`,
    '  li t0, 1',
    `  sw t0, ${INTC_REG.CTRL}(t2)`, // reading from the drive may be interrupted
    '  li s2, 0',
    'kst_l:', // read the image from the spool, page by page, into its frames
    `  lw t1, ${K + 20}(zero)`,
    '  slli t1, t1, 8',
    '  addi t2, s2, 16',
    '  slli t2, t2, 2',
    '  add t1, t1, t2',
    '  lw a2, 0(t1)',
    '  srli a2, a2, 8',
    '  slli a2, a2, 8',
    `  lw t0, ${K + 4}(zero)`,
    `  lw a1, ${KSLOT.LBA}(t0)`,
    '  add a1, a1, s2',
    '  mv a0, s1',
    '  call spool_port',
    '  call blk_read',
    '  addi s2, s2, 1',
    `  lw t0, ${K + 8}(zero)`,
    '  bne s2, t0, kst_l',
  ];
};
