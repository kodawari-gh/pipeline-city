// The multicore OS 2: core 1's part of the kernel.

import {
  BLOCK_BYTES,
  DISPLAY_BASE,
  INTC_BASE,
  INTC_REG,
  IRQ,
  JOB_ROW,
  KERNEL_PAGEFAULT1,
  KSLOT,
  MMU_BASE,
  MMU_REG,
  PCH_BASE,
  PCH_REG,
  PCH_RESULT_WORDS,
  PchPhase,
  USER_BASE,
} from '@/core/sim/memmap';
import { ROW, status } from '../asmtext';
import { ARENA1, ARENA1_HEAP, ARENA1_SHIFT, BUMP1, C1BUSY, CUR1, KFAULTS, KSTK1, LOCK, MBOX, PFS1 } from './layout';
import { bump1, mapTables, pageFault } from './paging';

/** Where core 1 of the multicore OS 2 builds and keeps things. */
const smp2Ctx = (kendPage: number) => {
  const rowAddr = DISPLAY_BASE + (JOB_ROW + 1) * ROW,
    ownRow = DISPLAY_BASE + JOB_ROW * ROW; // core 1's output row; core 1 itself reaches it as JOB_ROW (its row base is 1)
  return { kendPage, rowAddr, ownRow };
};
type Smp2Ctx = ReturnType<typeof smp2Ctx>;

/** `secondary`: the code from `kmap1` on. */
const kmap1Asm = (ctx: Smp2Ctx): string[] => {
  const { kendPage, rowAddr } = ctx;
  return [
    'kmap1:',
    ...mapTables({
      tag: '1',
      tbl: ARENA1,
      shift: ARENA1_SHIFT,
      cur: CUR1,
      bumpAt: BUMP1,
      bumpFrom: ARENA1_HEAP,
      kendPage,
    }),
    '  ret',
    ...pageFault({ tag: '1', tbl: ARENA1, pfs: PFS1, bump: bump1 }),

    // ---- kdispatch: core 0 hands the job in slot a0 to core 1 ----
    'kdispatch:',
    `  li t0, ${PchPhase.OsRun}`,
    `  sw t0, ${PCH_REG.PHASE}(s0)`,
    '  li t0, 3',
    `  sw t0, ${KSLOT.STATE}(a0)`,
    `  li t0, ${CUR1}`,
    '  sw a0, 0(t0)',
    `  li a3, ${DISPLAY_BASE}`,
    ...status('RUNNING JOB', 'a3'),
    `  li t0, ${rowAddr}`, // clear core 1's output row
    `  addi t1, t0, ${ROW}`,
    'kclr1:',
    '  sw zero, 0(t0)',
    '  addi t0, t0, 4',
    '  bne t0, t1, kclr1',
    `  lw s2, ${KSLOT.LEN}(a0)`,
    `  lw a1, ${KSLOT.LBA}(a0)`,
    '  slli s2, s2, 2',
    `  addi s2, s2, ${BLOCK_BYTES - 1}`,
    '  srli s2, s2, 8',
    `  li a2, ${USER_BASE + ARENA1_SHIFT}`, // the program is loaded where core 1's table will map it
    '  mv a0, s1', // (the drive is the same for every block of the program: blk_read keeps a0)
    '  call spool_port',
    'kload1:',
    '  call blk_read',
    '  addi a1, a1, 1',
    `  addi a2, a2, ${BLOCK_BYTES}`,
    '  addi s2, s2, -1',
    '  bne s2, zero, kload1',
    '  call kmap1',
  ];
};

/** `secondary`: the code from `klock` on. */
const klockAsm = (): string[] => [
  '  li t0, 1',
  `  sw t0, ${C1BUSY}(zero)`,
  `  lw t1, ${CUR1}(zero)`,
  `  sw t1, ${MBOX}(zero)`,
  `  li t0, ${INTC_BASE}`,
  '  li t1, 2', // core 1
  `  sw t1, ${INTC_REG.IPI}(t0)`,
  '  j kloop',

  // ---- the big kernel lock: spin on amoswap (clobbers t0-t2) ----
  'klock:',
  `  li t0, ${LOCK}`,
  '  li t1, 1',
  'kls:',
  '  amoswap t2, t1, (t0)',
  '  bne t2, zero, kls',
  '  ret',
  'kunlock:',
  `  li t0, ${LOCK}`,
  '  sw zero, 0(t0)',
  '  ret',

  // ---- core 1: woken by the first IPI (its vector), or by the park instruction returning ----
  'k2entry:',
  `  li sp, ${KSTK1}`,
  `  li s0, ${PCH_BASE}`,
  `  li t2, ${MMU_BASE}`,
  `  li t0, ${KERNEL_PAGEFAULT1}`,
  `  sw t0, ${MMU_REG.VECTOR}(t2)`,
  `  li t2, ${INTC_BASE}`,
  '  li t0, 1',
  `  sw t0, ${INTC_REG.ROW_BASE}(t2)`,
  'k2idle:',
  `  li t2, ${INTC_BASE}`,
  `  li t0, ${1 << IRQ.IPI}`,
  `  sw t0, ${INTC_REG.ACK}(t2)`,
];

/** `secondary`: the code from `k2run` on. */
const k2runAsm = (ctx: Smp2Ctx): string[] => {
  const { ownRow } = ctx;
  return [
    `  lw t1, ${MBOX}(zero)`,
    '  bne t1, zero, k2run',
    '  li t0, 1',
    `  sw t0, ${INTC_REG.PARK}(t2)`,
    '  j k2idle',
    'k2run:',
    `  sw zero, ${MBOX}(zero)`,
    `  li t2, ${MMU_BASE}`,
    `  li t0, ${ARENA1}`,
    `  sw t0, ${MMU_REG.TABLE}(t2)`,
    '  li t0, 1',
    `  sw t0, ${MMU_REG.CONTROL}(t2)`,
    '  li sp, 65536',
    `  li t0, ${USER_BASE}`,
    '  jalr ra, t0, 0', // the job ends at the ROM done vector, which lands in kdone

    // ---- core 1's job finished: keep its output row as the result ----
    'kdone1:',
    `  li t2, ${MMU_BASE}`,
    `  sw zero, ${MMU_REG.CONTROL}(t2)`,
    `  li sp, ${KSTK1}`,
    `  li s0, ${PCH_BASE}`,
    `  lw a0, ${CUR1}(zero)`,
    `  li t0, ${ownRow}`,
    `  addi t1, a0, ${KSLOT.RESULT}`,
    `  addi t2, t0, ${PCH_RESULT_WORDS * 4}`,
    'kres1:',
    '  lw t3, 0(t0)',
    '  sw t3, 0(t1)',
    '  addi t0, t0, 4',
    '  addi t1, t1, 4',
    '  bne t0, t2, kres1',
    '  j kend1',

    // ---- core 1's job touched what it may not ----
    'kfault1:',
  ];
};

/** `secondary`: the code from `kfz1` on. */
const kfz1Asm = (): string[] => [
  `  li t2, ${MMU_BASE}`,
  `  sw zero, ${MMU_REG.CONTROL}(t2)`,
  `  li sp, ${KSTK1}`,
  `  li s0, ${PCH_BASE}`,
  `  li t0, ${KFAULTS}`,
  '  li t1, 1',
  '  amoadd t2, t1, (t0)',
  `  lw a0, ${CUR1}(zero)`,
  `  addi t1, a0, ${KSLOT.RESULT}`,
  `  li t3, 1179075923`, // "SEGF"
  '  sw t3, 0(t1)',
  `  li t3, 1414288705`, // "AULT"
  '  sw t3, 4(t1)',
  `  addi t2, t1, ${PCH_RESULT_WORDS * 4}`,
  '  addi t1, t1, 8',
  'kfz1:',
  '  sw zero, 0(t1)',
  '  addi t1, t1, 4',
  '  bne t1, t2, kfz1',
  // falls into kend1
  'kend1:',
  '  call klock',
  '  li t0, 4',
  `  sw t0, ${KSLOT.STATE}(a0)`,
  `  sw zero, ${C1BUSY}(zero)`,
  '  call kunlock',
  '  j k2idle',
];

/**
 * Core 1 of the multicore OS 2. Core 0 (`kdispatch`) loads a job from the spool into core 1's arena, builds its tables (`kmap1`), writes the mailbox and sends an IPI;
 * core 1 wakes in `k2entry`, turns its translation on and runs the job. The job ends in `kdone`/`kfault`, which branch to `kdone1`/`kfault1` on core 1: they store the
 * result under the big lock and park the core again (`k2idle`: acknowledge, look in the mailbox, park). Core 1 never touches a drive or the display's status line.
 */
export function secondary(kendPage: number): string[] {
  const ctx = smp2Ctx(kendPage);
  return [...kmap1Asm(ctx), ...klockAsm(), ...k2runAsm(ctx), ...kfz1Asm()];
}
