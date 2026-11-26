// The kernel's source: run a queued job (`krun`), start it (`kclr`), its end (`kdone`, `kfault`), and the tail of each tier (`kmap`, `kpf`, the preemptive part).

import {
  BLOCK_BYTES,
  DISPLAY_BASE,
  INTC_BASE,
  INTC_REG,
  JOB_ROW,
  KSLOT,
  KSLOT_BYTES,
  MMU_BASE,
  MMU_REG,
  MPU_BASE,
  MPU_REG,
  PAGED_HEAP,
  PAGED_SHIFT,
  PCH_BASE,
  PCH_REG,
  PCH_RESULT_WORDS,
  PchPhase,
  USER_BASE,
} from '@/core/sim/memmap';
import { ROW, status } from '../asmtext';
import { C1BUSY, CUR, KBUMP, KFAULTS, PFS, SMPON } from './layout';
import { bump2, mapTables, pageFault } from './paging';
import { preemptive } from './preempt';
import { H, jtEnd } from './shared';
import { secondary } from './smp2';
import type { SourceCtx } from './types';

/** `kernelSource`: the code from `kclr` on. */
export const kclrAsm = (ctx: SourceCtx): string[] => {
  const { paged, pre } = ctx;
  return [
    // ---- start the job in slot a0 ----
    `  li t0, ${PchPhase.OsRun}`,
    `  sw t0, ${PCH_REG.PHASE}(s0)`,
    '  li t0, 3',
    `  sw t0, ${KSLOT.STATE}(a0)`,
    `  li t0, ${CUR}`,
    '  sw a0, 0(t0)',
    `  li a3, ${DISPLAY_BASE}`,
    ...status('RUNNING JOB', 'a3'),
    `  li t0, ${DISPLAY_BASE + JOB_ROW * ROW}`, // clear the job's output row
    `  addi t1, t0, ${ROW}`,
    'kclr:',
    '  sw zero, 0(t0)',
    '  addi t0, t0, 4',
    '  bne t0, t1, kclr',
    `  lw s2, ${KSLOT.LEN}(a0)`,
    `  lw a1, ${KSLOT.LBA}(a0)`,
    '  slli s2, s2, 2',
    `  addi s2, s2, ${BLOCK_BYTES - 1}`,
    '  srli s2, s2, 8', // blocks to read
    `  li a2, ${paged ? USER_BASE + PAGED_SHIFT : USER_BASE}`, // OS 2: the program is loaded where its page table will map it
    '  mv a0, s1', // (the drive is the same for every block of the program: blk_read keeps a0)
    ...(paged || pre ? ['  call spool_port'] : []), // (the resident OS spools on its own drive only)
    'kload:',
    '  call blk_read',
    '  addi a1, a1, 1',
    `  addi a2, a2, ${BLOCK_BYTES}`,
    '  addi s2, s2, -1',
    '  bne s2, zero, kload',
    ...(paged
      ? [
          '  call kmap', // the program's address space: tables built, translation switched on
          `  li t0, ${USER_BASE}`,
        ]
      : [
          `  li t0, ${USER_BASE}`,
          `  li t2, ${MPU_BASE}`,
          '  li t1, 1',
          `  sw t1, ${MPU_REG.ENABLE}(t2)`, // from here until kdone or kfault the job may not write to the OS
        ]),
  ];
};

/** `kernelSource`: the code from `kdone` on. */
export const kdoneAsm = (ctx: SourceCtx): string[] => {
  const { paged, smp } = ctx;
  return [
    '  jalr ra, t0, 0', // the job ends at the ROM done vector, which lands in kdone

    // ---- a job finished: keep its output line as the result ----
    'kdone:',
    ...(smp ? [`  li t2, ${INTC_BASE}`, `  lw t2, ${INTC_REG.CORE_ID}(t2)`, '  bne t2, zero, kdone1'] : []), // core 1's jobs end here too
    ...(paged
      ? [`  li t2, ${MMU_BASE}`, `  sw zero, ${MMU_REG.CONTROL}(t2)`]
      : [`  li t2, ${MPU_BASE}`, `  sw zero, ${MPU_REG.ENABLE}(t2)`]), // back in the kernel: addresses are physical again, the tables are ours
    '  li sp, 65536',
    `  li s0, ${PCH_BASE}`,
    `  li t0, ${CUR}`,
    '  lw a0, 0(t0)',
    `  li t0, ${DISPLAY_BASE + JOB_ROW * ROW}`,
    `  addi t1, a0, ${KSLOT.RESULT}`,
    `  addi t2, t0, ${PCH_RESULT_WORDS * 4}`,
    'kres:',
    '  lw t3, 0(t0)',
    '  sw t3, 0(t1)',
    '  addi t0, t0, 4',
    '  addi t1, t1, 4',
    '  bne t0, t2, kres',
    ...(smp ? ['  call klock'] : []),
    '  li t0, 4',
    `  sw t0, ${KSLOT.STATE}(a0)`,
    ...(smp ? ['  call kunlock'] : []),
    '  j kloop',

    // ---- a job wrote to protected memory: the OS ends it, its result is the fault text ----
    'kfault:',
    ...(smp ? [`  li t2, ${INTC_BASE}`, `  lw t2, ${INTC_REG.CORE_ID}(t2)`, '  bne t2, zero, kfault1'] : []),
    ...(paged
      ? [`  li t2, ${MMU_BASE}`, `  sw zero, ${MMU_REG.CONTROL}(t2)`]
      : [`  li t2, ${MPU_BASE}`, `  sw zero, ${MPU_REG.ENABLE}(t2)`]),
    '  li sp, 65536',
    `  li s0, ${PCH_BASE}`,
    `  li t0, ${KFAULTS}`,
    ...(smp ? ['  li t1, 1', '  amoadd t2, t1, (t0)'] : ['  lw t1, 0(t0)', '  addi t1, t1, 1', '  sw t1, 0(t0)']), // both cores count faults
    `  li t0, ${CUR}`,
    '  lw a0, 0(t0)',
    `  addi t1, a0, ${KSLOT.RESULT}`,
  ];
};

/** `kernelSource`: the code from `kfz` on. */
export const kfzAsm = (ctx: SourceCtx): string[] => {
  const { smp } = ctx;
  return [
    `  li t3, 1179075923`, // "SEGF"
    '  sw t3, 0(t1)',
    `  li t3, 1414288705`, // "AULT"
    '  sw t3, 4(t1)',
    `  addi t2, t1, ${PCH_RESULT_WORDS * 4}`,
    '  addi t1, t1, 8',
    'kfz:',
    '  sw zero, 0(t1)',
    '  addi t1, t1, 4',
    '  bne t1, t2, kfz',
    ...(smp ? ['  call klock'] : []),
    '  li t0, 4',
    `  sw t0, ${KSLOT.STATE}(a0)`,
    ...(smp ? ['  call kunlock'] : []),
    '  j kloop',
  ];
};

/** `kernelSource`: the code from `krun` on. */
export const krunAsm = (ctx: SourceCtx): string[] => {
  const { pre, KD, smp2 } = ctx;
  return [
    // ---- run the oldest queued job, if a program slot is free ----
    'krun:',
    `  li t0, ${KD}`,
    '  li t1, 0', // best slot
    '  li t2, 2147483647', // its sequence number
    '  li t3, 0', // jobs running
    ...jtEnd('t4', 't0'),
    'rscan:',
    `  lw a1, ${KSLOT.STATE}(t0)`,
    '  li a2, 3',
    '  bne a1, a2, rq',
    '  addi t3, t3, 1',
    '  j rnext',
    'rq:',
    '  li a2, 2',
    '  bne a1, a2, rnext',
    `  lw a1, ${KSLOT.SEQ}(t0)`,
    '  bge a1, t2, rnext',
    '  mv t2, a1',
    '  mv t1, t0',
    'rnext:',
    `  addi t0, t0, ${KSLOT_BYTES}`,
    '  bne t0, t4, rscan',
    `  beq t1, zero, ${pre ? 'kidle' : 'kloop'}`, // nothing queued
    `  lw a1, ${H('PROGRAM_SLOTS')}(s3)`,
    `  bge t3, a1, ${pre ? 'kidle' : 'kloop'}`, // every program slot is busy (never the case in v1: a job runs to completion)
    '  mv a0, t1',
    // the multicore OS 2: core 0 stays the kernel core (it can ingest and flash while a job runs), so a job goes to core 1 when that is free
    ...(smp2
      ? [
          `  lw t0, ${SMPON}(zero)`,
          '  beq t0, zero, klocal',
          `  lw t0, ${C1BUSY}(zero)`,
          '  bne t0, zero, klocal',
          '  j kdispatch',
          'klocal:',
        ]
      : []),
    ...(pre ? ['  call kstart', '  j kloop'] : []),
  ];
};

/** `kernelSource`: the code from `kmap` on. */
export const tierTailAsm = (ctx: SourceCtx): string[] => {
  const { paged, pre, smp, thr, KD, TBL, KEND_PAGE } = ctx;
  if (pre) {
    return preemptive({ kendPage: KEND_PAGE, smp, thr, KD });
  }
  if (paged) {
    return [
      // ---- kmap: the address space of the job just loaded, and translation on ----
      // Virtual pages 0..15 are the ROM (read, run: the job ends by jumping into it), 16.. the program's image (read, write, run) at physical + PAGED_SHIFT,
      // 0xc0.. the OS (read, run: the job table can be read, never written), and nothing else: the heap (0x4000..0x7fff) and the stack (0xf000..0xffff) are
      // claimed by page faults as the program touches them (kpf). The tables sit at PAGED_TABLES, out of the program's reach.
      'kmap:',
      ...mapTables({
        tag: '',
        tbl: TBL,
        shift: PAGED_SHIFT,
        cur: CUR,
        bumpAt: KBUMP,
        bumpFrom: PAGED_HEAP >> 8,
        kendPage: KEND_PAGE,
      }),
      `  li t2, ${MMU_BASE}`,
      `  li t1, ${TBL}`,
      `  sw t1, ${MMU_REG.TABLE}(t2)`,
      '  li t1, 1',
      `  sw t1, ${MMU_REG.CONTROL}(t2)`, // translation on: the kernel's own pages are mapped, so the next instruction is still there
      '  ret',

      // ---- kpf: the program touched a page that is not mapped ----
      // The heap, the big heap (virtual 0x10000 up) and the stack are claimed on demand: a frame from the bump pointer, zeroed, mapped read and write, and a level 2
      // table first where that part of the space has none. The bump pointer runs over the frames between the program and the tables, then over everything from
      // 0x10000 up. Anything else (a page the program has no business with, a write to the OS, memory running out) ends the program like a protection fault.
      // The handler runs untranslated and gives the program its registers back, so the faulting instruction simply runs again.
      ...pageFault({ tag: '', tbl: TBL, pfs: PFS, bump: (t) => bump2(t, smp) }),
      ...(smp ? secondary(KEND_PAGE) : []),
      'kpkill:',
      '  j kfault',
    ];
  }
  return ['kpf:', '  j kfault'];
};
