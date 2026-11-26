// The paged kernels (OS 2): the frame allocators, the tables of a job and the page-fault handler.

import { KSLOT, MMU_BASE, MMU_REG, PAGED_TABLES, PAGED_TABLES_BYTES, USER_BASE } from '@/core/sim/memmap';
import { ARENA1_END, ARENA_END, BUMP1, FRAME_END, KBUMP, NFRAMES } from './layout';

/**
 * OS 2's frame allocator, inline (the page-fault handler has no stack to call from): takes the next frame from the bump pointer into t2, zeroes it, and ends the
 * program (kpkill) when the frames are used up. The pointer skips from the tables' frames (0xb0) to 0x100, the first frame above the OS. On the multicore image it
 * also skips core 1's arena (frames 0x100 up to `ARENA_END`, a word that is 0 when there is no second core).
 */
export function bump2(tag: string, smp = false): string[] {
  return [
    `  li t3, ${KBUMP}`,
    '  lw t2, 0(t3)',
    `  li t4, ${PAGED_TABLES >> 8}`,
    `  blt t2, t4, kb1${tag}`,
    '  li t4, 256',
    `  bge t2, t4, kb1${tag}`,
    '  mv t2, t4',
    `kb1${tag}:`,
    ...(smp
      ? [
          `  lw t4, ${ARENA_END}(zero)`,
          `  bge t2, t4, kb3${tag}`,
          '  li t4, 256',
          `  blt t2, t4, kb3${tag}`,
          `  lw t2, ${ARENA_END}(zero)`,
          `kb3${tag}:`,
        ]
      : []),
    `  lw t4, ${NFRAMES}(zero)`,
    '  bge t2, t4, kpkill',
    '  addi t4, t2, 1',
    '  sw t4, 0(t3)',
    '  slli t3, t2, 8',
    '  addi t4, t3, 256',
    `kb2${tag}:`,
    '  sw zero, 0(t3)',
    '  addi t3, t3, 4',
    `  bne t3, t4, kb2${tag}`,
  ];
}

/** Core 1's frame allocator: the next frame of its arena into t2, zeroed; the program is ended (kpkill) when the arena is used up. */
export function bump1(tag: string): string[] {
  return [
    `  li t3, ${BUMP1}`,
    '  lw t2, 0(t3)',
    `  li t4, ${ARENA1_END}`,
    '  bge t2, t4, kpkill',
    '  addi t4, t2, 1',
    '  sw t4, 0(t3)',
    '  slli t3, t2, 8',
    '  addi t4, t3, 256',
    `kb2${tag}:`,
    '  sw zero, 0(t3)',
    '  addi t3, t3, 4',
    `  bne t3, t4, kb2${tag}`,
  ];
}

/** Where `mapTables` builds a job's tables, and its label tag. */
interface MapSpec {
  tag: string;
  tbl: number;
  shift: number;
  cur: number;
  bumpAt: number;
  bumpFrom: number;
  kendPage: number;
}

/** `mapTables`: the code from `kmz<tag>` on. */
const kmzAsm = (ctx: MapSpec): string[] => {
  const { tag, tbl, shift, cur, kendPage } = ctx;
  return [
    `  li t0, ${tbl}`,
    `  li t1, ${tbl + PAGED_TABLES_BYTES}`,
    `kmz${tag}:`,
    '  sw zero, 0(t0)',
    '  addi t0, t0, 4',
    `  bne t0, t1, kmz${tag}`,
    `  li t0, ${tbl}`,
    `  li t1, ${tbl + 0x1_00 + 1}`,
    '  sw t1, 0(t0)', // level 1 entry 0: virtual 0x0000..0x3fff
    `  li t1, ${tbl + 0x2_00 + 1}`,
    '  sw t1, 4(t0)', // entry 1: 0x4000..0x7fff, the heap
    `  li t1, ${tbl + 0x3_00 + 1}`,
    '  sw t1, 12(t0)', // entry 3: 0xc000..0xffff, the OS and the stack
    `  li t0, ${tbl + 0x1_00}`,
    '  li t1, 0',
    `  li t2, ${USER_BASE}`,
    `kmr${tag}:`, // the ROM: identity, read and run
    '  addi t3, t1, 5',
    '  sw t3, 0(t0)',
    '  addi t0, t0, 4',
    '  addi t1, t1, 256',
    `  bne t1, t2, kmr${tag}`,
    `  li t4, ${cur}`,
    '  lw t4, 0(t4)',
    `  lw t4, ${KSLOT.LEN}(t4)`,
    '  slli t4, t4, 2',
    '  addi t4, t4, 255',
    '  srli t4, t4, 8', // the program's pages
    `kmi${tag}:`, // its image: read, write, run
    ...(shift + 7 < 65_536 ? [`  addi t3, t1, ${shift + 7}`] : [`  li t3, ${shift + 7}`, '  add t3, t3, t1']), // the immediate of addi is 17 bits
    '  sw t3, 0(t0)',
    '  addi t0, t0, 4',
    '  addi t1, t1, 256',
    '  addi t4, t4, -1',
    `  bne t4, zero, kmi${tag}`,
    `  li t0, ${tbl + 0x3_00}`,
    '  li t1, 49152',
    `  li t2, ${kendPage}`,
    `kmk${tag}:`, // the OS: identity, read and run
    '  addi t3, t1, 5',
  ];
};

/** `mapTables`: a part of its code. */
const mapTablesEndAsm = (ctx: MapSpec): string[] => {
  const { tag, bumpAt, bumpFrom } = ctx;
  return [
    '  sw t3, 0(t0)',
    '  addi t0, t0, 4',
    '  addi t1, t1, 256',
    `  bne t1, t2, kmk${tag}`,
    `  li t0, ${bumpAt}`,
    `  li t1, ${bumpFrom}`,
    '  sw t1, 0(t0)', // the first frame for the program's own memory
  ];
};

/** The tables of a job just loaded: level 1 at `tbl` with its three level 2 tables, the ROM identity, the image at virtual + `shift`, the OS identity up to `kendPage`, and the frame pointer at `bumpAt` set to `bumpFrom`. `cur` holds the job's slot. Labels get `tag`. */
export function mapTables(ctx: MapSpec): string[] {
  return [...kmzAsm(ctx), ...mapTablesEndAsm(ctx)];
}

/** A core's page-fault handler: its label tag, its tables, its scratch words and its frame allocator. */
interface PageFaultSpec {
  tag: string;
  tbl: number;
  pfs: number;
  bump: (t: string) => string[];
}

/** `pageFault`: the code from `kpf<tag>` on. */
const pageFaultEntryAsm = (ctx: PageFaultSpec): string[] => {
  const { tag, tbl, pfs, bump } = ctx;
  return [
    `kpf${tag}:`,
    `  sw t0, ${pfs}(zero)`,
    `  sw t1, ${pfs + 4}(zero)`,
    `  sw t2, ${pfs + 8}(zero)`,
    `  sw t3, ${pfs + 12}(zero)`,
    `  sw t4, ${pfs + 16}(zero)`,
    `  li t0, ${MMU_BASE}`,
    `  lw t1, ${MMU_REG.FAULT_CAUSE}(t0)`,
    '  li t2, 1',
    '  bne t1, t2, kpkill', // only a missing page can be fixed
    `  lw t1, ${MMU_REG.FAULT_ADDR}(t0)`,
    '  srli t1, t1, 8', // the page number
    '  li t2, 64',
    '  blt t1, t2, kpkill',
    '  li t2, 128',
    `  blt t1, t2, kpok${tag}`, // 0x40..0x7f: the heap
    '  li t2, 240',
    '  blt t1, t2, kpkill',
    '  li t2, 256',
    `  blt t1, t2, kpok${tag}`, // 0xf0..0xff: the stack
    `  li t2, ${FRAME_END}`,
    '  bge t1, t2, kpkill', // 0x100..0xfff: the big heap
    `kpok${tag}:`,
    `  li t0, ${tbl}`,
    '  srli t2, t1, 6',
    '  slli t2, t2, 2',
    '  add t0, t0, t2', // this page's entry in the level 1 table
    '  lw t2, 0(t0)',
    '  andi t2, t2, 1',
    `  bne t2, zero, kphave${tag}`,
    ...bump(`a${tag}`), // a frame for the level 2 table, in t2
    '  slli t3, t2, 8',
    '  addi t4, t3, 1',
    '  sw t4, 0(t0)',
    `kphave${tag}:`,
    '  lw t0, 0(t0)',
    '  srli t0, t0, 8',
    '  slli t0, t0, 8',
    '  andi t2, t1, 63',
    '  slli t2, t2, 2',
  ];
};

/** `pageFault`: a part of its code. */
const pageFaultMapAsm = (ctx: PageFaultSpec): string[] => {
  const { tag, pfs, bump } = ctx;
  return [
    '  add t0, t0, t2', // the page's entry in its level 2 table
    ...bump(`b${tag}`), // the page's frame, in t2
    '  slli t3, t2, 8',
    '  addi t3, t3, 3', // the frame, valid and writable
    '  sw t3, 0(t0)',
    `  lw t0, ${pfs}(zero)`,
    `  lw t1, ${pfs + 4}(zero)`,
    `  lw t2, ${pfs + 8}(zero)`,
    `  lw t3, ${pfs + 12}(zero)`,
    `  lw t4, ${pfs + 16}(zero)`,
    '  iret',
  ];
};

/** The page-fault handler of a core: tables at `tbl`, scratch words at `pfs`, `bump(tag)` the frame allocator (frame into t2). The handler for core 0 is `kpf`, for core 1 `kpf1`. */
export function pageFault(ctx: PageFaultSpec): string[] {
  return [...pageFaultEntryAsm(ctx), ...pageFaultMapAsm(ctx)];
}
