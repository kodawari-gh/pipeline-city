// The kernel's source: the flash of a result (`kflash`), the ingest of a key (`kingest`) and the spool helpers (`spool_port`, `find_slot`).

import {
  BLOCK_BYTES,
  DISPLAY_BASE,
  KSLOT,
  KSLOT_BYTES,
  OS_SPOOL_MAP,
  PCH_BASE,
  PCH_KEY_WINDOW,
  PCH_REG,
  PCH_RESULT_WINDOW,
  PCH_RESULT_WORDS,
  PchPhase,
  SPOOL_PORT_SHIFT,
  STORAGE_BASE,
  STORAGE_STRIDE,
} from '@/core/sim/memmap';
import { status } from '../asmtext';
import { BLK_READ, BLK_WRITE } from '../blockasm';
import { nicPoll } from '../nicdriver';
import { IKEY, ILBA, ILEN, ISLOT, SEQ } from './layout';
import { H, jtEnd, setPhase } from './shared';
import { kclrAsm, kdoneAsm, kfzAsm, tierTailAsm } from './source.run';
import type { SourceCtx } from './types';

/** `kernelSource`: the code from `kflash` on. */
export const kflashAsm = (ctx: SourceCtx): string[] => {
  const { pre, KD } = ctx;
  return [
    ...(pre ? [] : [...kclrAsm(ctx), ...kdoneAsm(ctx), ...kfzAsm(ctx)]),

    // ---- flash the result of slot a0 onto the plugged key ----
    'kflash:',
    `  li t0, ${PchPhase.OsFlash}`,
    `  sw t0, ${PCH_REG.PHASE}(s0)`,
    `  addi t0, a0, ${KSLOT.RESULT}`,
    `  li t1, ${PCH_BASE + PCH_RESULT_WINDOW}`,
    `  addi t2, t0, ${PCH_RESULT_WORDS * 4}`,
    'kfl:',
    '  lw t3, 0(t0)',
    '  sw t3, 0(t1)',
    '  addi t0, t0, 4',
    '  addi t1, t1, 4',
    '  bne t0, t2, kfl',
    `  li t0, ${PCH_RESULT_WORDS}`,
    `  sw t0, ${PCH_REG.RESULT_LEN}(s0)`,
    '  li t0, 1',
    `  sw t0, ${PCH_REG.DONE}(s0)`,
    '  ret',

    // ---- ingest the plugged key: copy its program to the spool on disk and queue it ----
    'kingest:',
    '  mv s2, ra',
    `  li t0, ${KD}`,
    ...jtEnd('t4', 't0'), // only the slots the spool map covers
    '  li a1, 0', // slots in use
    '  li a2, 0', // first free slot
    'kiscan:',
    `  lw t1, ${KSLOT.STATE}(t0)`,
    '  bne t1, zero, kiused',
    '  bne a2, zero, kinext',
    '  mv a2, t0',
    '  j kinext',
    'kiused:',
    '  addi a1, a1, 1',
    'kinext:',
    `  addi t0, t0, ${KSLOT_BYTES}`,
  ];
};

/** `kernelSource`: the code from `kicopy` on. */
export const kicopyAsm = (ctx: SourceCtx): string[] => {
  const { paged, pre, KD } = ctx;
  return [
    '  bne t0, t4, kiscan',
    '  beq a2, zero, kiout', // no free slot
    `  lw t1, ${H('QUEUE_SLOTS')}(s3)`,
    '  bge a1, t1, kiout', // the queue is at its bound
    `  lw a3, ${PCH_REG.KEY_LEN}(s0)`,
    '  slli t4, a3, 2',
    `  addi t4, t4, ${BLOCK_BYTES - 1}`,
    '  srli t4, t4, 8', // blocks to copy
    '  beq t4, zero, kiout',
    `  lw t1, ${H('SPOOL_BLOCKS')}(s3)`,
    '  blt t1, t4, kiout', // the program does not fit its spool area
    `  li t0, ${ISLOT}`,
    '  sw a2, 0(t0)',
    `  li t0, ${ILEN}`,
    '  sw a3, 0(t0)',
    `  lw t2, ${PCH_REG.KEY_ID}(s0)`,
    `  li t0, ${IKEY}`,
    '  sw t2, 0(t0)',
    `  li t0, ${KD}`,
    '  sub t0, a2, t0',
    '  srli t0, t0, 6', // slot index
    '  slli t0, t0, 2',
    '  add t0, t0, s3',
    `  lw a1, ${4 * OS_SPOOL_MAP}(t0)`, // first spool block of this slot (the top byte names its drive)
    `  li t0, ${ILBA}`,
    '  sw a1, 0(t0)',
    ...setPhase(PchPhase.OsIngest),
    `  li a3, ${DISPLAY_BASE}`,
    ...status('INGESTING', 'a3'),
    '  mv s3, t4',
    `  li a2, ${PCH_BASE + PCH_KEY_WINDOW}`,
    '  mv a0, s1', // (the drive is the same for every block of the job: blk_write keeps a0)
    ...(paged || pre ? ['  call spool_port'] : []),
    'kicopy:',
    '  call blk_write',
    '  addi a1, a1, 1',
    `  addi a2, a2, ${BLOCK_BYTES}`,
    '  addi s3, s3, -1',
    '  bne s3, zero, kicopy',
    `  lw t0, ${PCH_REG.STATUS}(s0)`,
  ];
};

/** `kernelSource`: the code from `kiout` on. */
export const kioutAsm = (ctx: SourceCtx): string[] => {
  const { paged, pre } = ctx;
  return [
    '  andi t0, t0, 1',
    '  beq t0, zero, kiout', // the key was pulled during the copy: nothing is queued
    `  lw t0, ${PCH_REG.KEY_ID}(s0)`,
    `  li t1, ${IKEY}`,
    '  lw t2, 0(t1)',
    '  bne t0, t2, kiout',
    `  li t1, ${ISLOT}`,
    '  lw a0, 0(t1)',
    `  sw t2, ${KSLOT.KEY}(a0)`,
    `  li t1, ${ILEN}`,
    '  lw t2, 0(t1)',
    `  sw t2, ${KSLOT.LEN}(a0)`,
    `  li t1, ${ILBA}`,
    '  lw t2, 0(t1)',
    `  sw t2, ${KSLOT.LBA}(a0)`,
    `  li t1, ${SEQ}`,
    '  lw t2, 0(t1)',
    '  addi t2, t2, 1',
    '  sw t2, 0(t1)',
    `  sw t2, ${KSLOT.SEQ}(a0)`,
    '  li t2, 2',
    `  sw t2, ${KSLOT.STATE}(a0)`, // queued
    'kiout:',
    '  jalr zero, s2, 0',

    // ---- spool_port: a0 = the OS drive's port, a1 = a spool block -> a0 = the port of the drive the block's top byte names (0: the OS drive) ----
    ...(paged || pre
      ? [
          'spool_port:',
          `  srli t0, a1, ${SPOOL_PORT_SHIFT}`,
          '  beq t0, zero, spret',
          '  addi t0, t0, -1',
          `  li t1, ${STORAGE_STRIDE}`,
          '  mul t0, t0, t1',
          `  li t1, ${STORAGE_BASE}`,
          '  add a0, t0, t1',
          'spret:',
          '  ret',
        ]
      : []),
  ];
};

/** `kernelSource`: the code from `find_slot` on. */
export const findSlotAsm = (ctx: SourceCtx): string[] => {
  const { paged, pre, KD } = ctx;
  return [
    // ---- find_slot: a0 = key id -> a0 = the slot holding it, or 0 ----
    'find_slot:',
    `  li t0, ${KD}`,
    ...jtEnd('t1', 't0'),
    'fs1:',
    `  lw t2, ${KSLOT.STATE}(t0)`,
    '  beq t2, zero, fs2',
    `  lw t2, ${KSLOT.KEY}(t0)`,
    '  beq t2, a0, fshit',
    'fs2:',
    `  addi t0, t0, ${KSLOT_BYTES}`,
    '  bne t0, t1, fs1',
    '  li a0, 0',
    '  ret',
    'fshit:',
    '  mv a0, t0',
    '  ret',
    '',
    ...nicPoll({ kd: KD, jtEnd, spoolPort: paged || pre, seqAt: SEQ }),
    '',
    ...tierTailAsm(ctx), // OS 1 has no MMU to fault
    BLK_READ,
    '',
    BLK_WRITE,
    '',
  ];
};
