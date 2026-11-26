// Where the kernel keeps its data in RAM: the scratch words, the multicore words, the PCBs, the frame map, the kernel's own tables and the job table, by OS tier.

import { DISPLAY_BASE, JOB_ROW, KDATA_BASE, KDATA_SLOTS, KSLOT_BYTES, NICA, NICK } from '@/core/sim/memmap';
import { ROW } from '../asmtext';

/** The kernel's scratch words follow the 16-slot block at `KDATA_BASE` on every tier, whatever the table's own place. */
const TABLE_END = KDATA_BASE + KDATA_SLOTS * KSLOT_BYTES;
/** Scratch words after the slot table. */
export const SEQ = TABLE_END; // job sequence counter
export const CUR = TABLE_END + 4; // slot of the running job
export const IKEY = TABLE_END + 8; // key id being ingested
export const ILEN = TABLE_END + 12; // its length in words
export const ILBA = TABLE_END + 16; // its spool block
export const ISLOT = TABLE_END + 20; // its slot
/** OS 2: the next free frame for a program's memory. */
export const KBUMP = TABLE_END + 24;
export const PFS = TABLE_END + 28; // OS 2: the registers the page-fault handler borrows (five words)
/** Jobs the kernel has killed for touching memory they may not (the game reads it as the fault statistic). */
export const KFAULTS = TABLE_END + 48;
/** OS 2 and 3: the number of 256-byte frames the machine has (up to MAX_FRAMES), read from the PCH at boot. */
export const NFRAMES = TABLE_END + 52;
const KDATA_END = TABLE_END + 56;
// OS 2 on a multicore CPU (docs/MULTICORE.md section 6): core 0 is the kernel core (ingest, flash, queue) and hands a job to core 1 when that is free, else runs it itself.
// Core 1 has its own arena of RAM (tables, image, heap frames), its own page-fault handler and its own display row; the shared words below are the mailbox,
// the "core 1 is busy" flag and the big kernel lock, which guards every update of the job table made by either core.
export const LOCK = KDATA_END; // the big kernel lock (0 free, 1 held: taken with amoswap)
export const MBOX = LOCK + 4; // the slot core 0 wants core 1 to run (0: nothing)
export const C1BUSY = LOCK + 8; // 1 from the hand-over until core 1 has stored the job's result
export const CUR1 = LOCK + 12; // the slot running on core 1
export const ARENA_END = LOCK + 16; // core 0's frame allocator skips frames up to here (0: no arena, a single-core kernel)
export const BUMP1 = LOCK + 20; // core 1's next free frame
export const PFS1 = LOCK + 24; // core 1's page-fault scratch (five words)
export const SMPON = LOCK + 44; // 1 when the machine has a second core and RAM for its arena
/** The end of the kernel's data for the multicore os2 image. */
const KDATA_END_SMP = LOCK + 48;
/** Core 1's arena: its page tables at the start, its kernel stack below the image, the image at virtual + `ARENA1_SHIFT`, heap frames from `ARENA1_HEAP` up to `ARENA1_END`. Needs 128K of RAM. */
export const ARENA1 = 0x1_00_00;
export const ARENA1_SHIFT = 0x1_00_00;
export const ARENA1_HEAP = 0x1_20;
export const ARENA1_END = 0x1_80;
/** RAM frames the multicore os2 needs before it hands jobs to core 1 (128K). */
export const SMP_MIN_FRAMES = 0x2_00;
/** The kernel stack of core 1 (below its image, above its tables). */
export const KSTK1 = ARENA1 + 0x10_00;
/** The frames a paged OS manages: the virtual space is 20 bits, so RAM above 1 MiB is not used. */
const MAX_FRAMES = 4096;
// The preemptive kernel (OS 3) keeps more: a process control block per slot (plus one for the kernel itself), the map of RAM frames, and scratch words.
/** A process control block: the 15 registers (ra, sp, a0..a3, t0..t4, s0..s3), the pc, its page table (physical), the frames of its three second-level tables, its job slot and a copy of its output row. */
export const PCB = {
  PC: 60,
  TABLE: 64,
  L2_IMAGE: 68,
  L2_HEAP: 72,
  L2_STACK: 76,
  SLOT: 80,
  ROW: 84,
  TIDX: 116,
  CORE: 120,
  LAST: 124,
  BYTES: 128,
} as const;
/** PCBs: one per job slot (indexed like the slot), the kernel's is the ninth. */
export const PCBS = TABLE_END + 72;
export const CURP = TABLE_END + 56; // OS 3: the PCB of the context that is running
export const SCR = TABLE_END + 60; // OS 3: the timer handler's scratch
export const SLEEP = TABLE_END + 64;
export const HINT = TABLE_END + 68; // OS 3: where the frame allocator looks next (nothing below it is free: frames are only freed by kfreeown, which resets it) // OS 3: rounds the idle kernel is skipped for
/** Rounds of the scheduler an idle kernel sits out while programs run. */
export const KERNEL_NAP = 3;
/** OS 3 and up: the NIC driver's event flag (`NICK.EV`). The interrupt handler and the end of a network job set it; the kernel's loop clears it and runs the driver. */
export const NIC_EV = NICA + NICK.EV;
export const PFSB = PCBS + 9 * PCB.BYTES; // OS 3: registers the page-fault handler borrows (seven saved, then the slot, the page, the level 1 entry and the PTE)
export const KSCR = PFSB + 48; // OS 3: kstart's scratch: ra, slot, image pages, owner, the four table frames
const KDATA_END_PRE = KSCR + 32;
// The multicore OS 3 (docs/MULTICORE.md section 7, docs/OS.md "Preemption on every core") keeps more: an idle PCB per logical core (where an interrupt on an idle core saves its registers),
// a block of scratch words per core (the page-fault handler's borrowed registers, the PCB of the context running there), and the big kernel lock. `PCB.CORE` of a context is the
// number of the core running it plus one, 0 when none does.
/** Logical cores the multicore OS 3 manages. */
export const MAX_LCORES = 8;
export const IDLEP = PCBS + 9 * PCB.BYTES;
export const PCORE = IDLEP + MAX_LCORES * PCB.BYTES;
export const PCORE_BYTES = 64;
/** In a core's block: the borrowed registers (ra, a0, t0..t4: 28 bytes), then the page-fault handler's slot, page, level 1 entry and PTE entry words, its saved s3, the PCB of the running context and the timer stub's scratch. */
export const PC_S3 = 44,
  PC_CURP = 48,
  PC_SCR = 52;
export const KSCR_SMP = PCORE + MAX_LCORES * PCORE_BYTES;
export const LOCK3 = KSCR_SMP + 64;
/** OS 4: how many times a core took a context that another core had run last (the affinity pass found none of its own). */
export const KMIGR = LOCK3 + 4;
const KDATA_END_PRE_SMP = KMIGR + 4;
/**
 * Frame map (OS 3): one word per physical frame, 0 = free, else (kind << 8) | (job slot + 1): kind 0 a program's image, 1 its own memory, 2 its page tables;
 * `RESERVED_FRAME` is the OS's own (the tables, the map itself, frames beyond the installed RAM). It sits above 64K, so OS 3 needs RAM that reaches `OS3_MIN_BYTES`.
 */
export const FMAP = 0x1_00_00;
export const RESERVED_FRAME = 0xf_00;
export const FRAME_FIRST = 16;
export const FRAME_END = MAX_FRAMES;
/** The kernel's own address space (identity, all of RAM: a level 1 table and up to 64 level 2 tables) follows the frame map. */
export const KTBL = FMAP + 4 * MAX_FRAMES;
export const KTBL_BYTES = 0x1_00 + 0x1_00 * 64;
/**
 * The job table of the OS tiers with a frame map (OS 3 and up) sits above the kernel's address space, with room for the most slots the boot header's spool map holds:
 * `JT_SLOTS` x `KSLOT_BYTES` of RAM, 64 bytes a slot, so the queue is limited by the drives' room and by this RAM, not by the OS tier. The queue length (header) says how many are used.
 */
export const JT_BASE = KTBL + KTBL_BYTES;
export const JT_SLOTS = 56;
/** Frames 0xb0 up to here belong to the OS (its tables, the frame map, the kernel table and the job table). */
export const OS_FRAMES_END = (JT_BASE + JT_SLOTS * KSLOT_BYTES + 255) >> 8;
/** Where the job table is and how many slots it has, by OS tier. */
export const jobTableFor = (tier: number): { base: number; slots: number } =>
  tier >= 3 ? { base: JT_BASE, slots: JT_SLOTS } : { base: KDATA_BASE, slots: KDATA_SLOTS };
/** The RAM OS 3 needs so that its tables fit and programs have room. */

/** Interrupt-free stack of the code that ends a job. */
export const KSTK = 0xfc_00;
/** CPU cycles one program runs before the scheduler looks again. */
export const SLICE_CYCLES = 5000;
/** The threaded kernel's slice: with up to eight cores asking for the one big lock every slice, 5000 cycles keeps the lock busy most of the time. */
export const SLICE_CYCLES_THR = 20_000;
/** Where the end of the kernel's data is, by OS tier. */
export const kdataEndFor = (tier: number, smp = false): number => {
  if (tier >= 3) {
    return smp ? KDATA_END_PRE_SMP : KDATA_END_PRE;
  }
  return smp && tier === 2 ? KDATA_END_SMP : KDATA_END;
};
export const JOB_ROW_ADDR = DISPLAY_BASE + JOB_ROW * ROW;
export const FMAP_FIRST = FMAP + 4 * FRAME_FIRST,
  FMAP_LAST = FMAP + 4 * FRAME_END;
