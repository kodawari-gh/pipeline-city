// The preemptive kernel: the page-fault handler (`kpf`) and the end of a killed program (`kpkill`).

import { MMU_BASE, MMU_REG } from '@/core/sim/memmap';
import { FRAME_END, PCB, PC_S3, PFSB } from './layout';
import { secondary3 } from './smp3';
import type { PreemptCtx } from './types';

/** `preemptive`: the code from `kpf` on. */
export const kpf3Asm = (ctx: PreemptCtx): string[] => {
  const { smp, thr, KD, curp, pf, lockIn } = ctx;
  return [
    // ---- kpf: a program touched a page that is not mapped: a frame for its heap, its big heap or its stack (and a level 2 table when that part of its space has none), or the end of the program ----
    ...(smp
      ? [
          'kpf:', // t0 = this core's block (the stub saved t0 in it); s3 keeps pointing at it
          `  sw s3, ${PC_S3}(t0)`,
          '  mv s3, t0',
          ...['ra', 'a0', 't1', 't2', 't3', 't4'].map(
            (r) => `  sw ${r}, ${4 * ['ra', 'a0', 't0', 't1', 't2', 't3', 't4'].indexOf(r)}(s3)`,
          ),
        ]
      : ['kpf:', ...['ra', 'a0', 't0', 't1', 't2', 't3', 't4'].map((r, i) => `  sw ${r}, ${PFSB + 4 * i}(zero)`)]),
    `  li t0, ${MMU_BASE}`,
    `  lw t1, ${MMU_REG.FAULT_CAUSE}(t0)`,
    '  li t2, 1',
    '  bne t1, t2, kpkill',
    `  lw t1, ${MMU_REG.FAULT_ADDR}(t0)`,
    '  srli t1, t1, 8',
    '  li t2, 64',
    '  blt t1, t2, kpkill',
    '  li t2, 128',
    '  blt t1, t2, kpok', // 0x40..0x7f: the heap
    '  li t2, 240',
    '  blt t1, t2, kpkill',
    '  li t2, 256',
    '  blt t1, t2, kpok', // 0xf0..0xff: the stack
    `  li t2, ${FRAME_END}`,
    '  bge t1, t2, kpkill', // 0x100..0xfff: the big heap (virtual 0x10000 up)
    'kpok:',
    ...(thr ? lockIn('kpl0', ['t0', 't2', 't3']) : []), // OS 4: the threads of a job share its page tables, so one at a time
    `  sw t1, ${pf(32)}`,
    ...curp('t0', 't3'),
    `  lw t3, ${PCB.SLOT}(t0)`,
    `  li t2, ${KD}`,
    '  sub t3, t3, t2',
    '  srli t3, t3, 6',
    `  sw t3, ${pf(28)}`, // the slot
    `  lw t4, ${PCB.TABLE}(t0)`,
    '  srli t2, t1, 6',
    '  slli t2, t2, 2',
  ];
};

/** `preemptive`: the code from `kpz4` on. */
export const kpz4Asm = (ctx: PreemptCtx): string[] => {
  const { thr, pf } = ctx;
  return [
    '  add t4, t4, t2', // this page's entry in the level 1 table
    `  sw t4, ${pf(36)}`,
    '  lw t2, 0(t4)',
    '  andi t2, t2, 1',
    '  bne t2, zero, kphave',
    '  addi a0, t3, 513', // a level 2 table: owner id, kind 2
    thr ? '  call kalloc_nl' : '  call kalloc',
    thr ? '  beq a0, zero, kpku' : '  beq a0, zero, kpkill',
    '  slli t3, a0, 8',
    '  addi t4, t3, 256',
    'kpz4:',
    '  sw zero, 0(t3)',
    '  addi t3, t3, 4',
    '  bne t3, t4, kpz4',
    `  lw t0, ${pf(36)}`,
    '  slli t3, a0, 8',
    '  addi t3, t3, 1',
    '  sw t3, 0(t0)',
    'kphave:',
    `  lw t0, ${pf(36)}`,
    '  lw t0, 0(t0)',
    '  srli t0, t0, 8',
    '  slli t0, t0, 8',
    `  lw t1, ${pf(32)}`,
    '  andi t1, t1, 63',
    '  slli t1, t1, 2',
    '  add t0, t0, t1', // the page's entry in its level 2 table
    `  sw t0, ${pf(40)}`,
    ...(thr ? ['  lw t3, 0(t0)', '  andi t3, t3, 1', '  bne t3, zero, kpout'] : []), // another thread mapped this page while this one waited for the lock
    `  lw t3, ${pf(28)}`,
    '  addi a0, t3, 257', // the page itself: owner id, kind 1: the program's own memory
    thr ? '  call kalloc_nl' : '  call kalloc',
    thr ? '  beq a0, zero, kpku' : '  beq a0, zero, kpkill',
    '  slli t3, a0, 8',
    '  addi t4, t3, 256',
    'kpz3:',
    '  sw zero, 0(t3)',
    '  addi t3, t3, 4',
    '  bne t3, t4, kpz3',
    `  lw t0, ${pf(40)}`,
  ];
};

/** `preemptive`: the code from `kpkill` on. */
export const kpkillAsm = (ctx: PreemptCtx): string[] => {
  const { smp, thr, unlockIn } = ctx;
  return [
    '  slli t3, a0, 8',
    '  addi t3, t3, 3', // the frame, valid and writable
    '  sw t3, 0(t0)',
    ...(thr ? ['kpout:', ...unlockIn('t0')] : []),
    ...(smp
      ? [
          ...['ra', 'a0', 't0', 't1', 't2', 't3', 't4'].map((r, i) => `  lw ${r}, ${4 * i}(s3)`),
          `  lw s3, ${PC_S3}(s3)`,
        ]
      : ['ra', 'a0', 't0', 't1', 't2', 't3', 't4'].map((r, i) => `  lw ${r}, ${PFSB + 4 * i}(zero)`)),
    '  iret',
    'kpkill:',
    '  j kfault',
    ...(thr ? ['kpku:', ...unlockIn('t0'), '  j kfault'] : []),
    ...(smp ? secondary3(thr) : []),
  ];
};
