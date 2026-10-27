// The OS v1 kernel, "single-task resident": a small program in the toy ISA (assembled at import) that the PCH ROM
// loads from the boot disk. It owns a job table in RAM (KDATA_BASE) and loops forever:
//
//   key in the port and enumerated?  known key with a result  -> flash the result onto the key (the client collects it
//                                                                when the key is pulled), free the slot after the flash
//                                    known key, no result yet  -> nothing (the player may pull it, it comes back later)
//                                    unknown key               -> INGEST: copy its program to the spool on disk
//   otherwise run the oldest queued job (one program at a time, `programSlots` is read from the header), by reading
//   its blocks from the spool into RAM at USER_BASE and jumping to it. The job ends with the usual jump to the ROM done
//   vector, whose epilogue hands control to `kdone` here (OS_MODE), which saves the job's output line as the result.
//
// Everything is real loads and stores on the CPU engine and the block device, so ingest, load and boot times depend on
// the CPU and the storage tier. See docs/OS.md for the table layout and the rules.

import { assemble } from "../asm";
import {
  BLOCK_BYTES, DISPLAY_BASE, JOB_ROW, KDATA_BASE, KDATA_SLOTS, KERNEL_BASE, KSLOT, KSLOT_BYTES, OS_HEADER, OS_HEADER_BASE,
  KERNEL_PAGEFAULT, MMU_BASE, MMU_REG, MPU_BASE, MPU_REG, OS_MAGIC, PAGED_HEAP, PAGED_SHIFT, PAGED_TABLES, PAGED_TABLES_BYTES, PCH_BASE, PCH_KEY_WINDOW, PCH_REG, PCH_RESULT_WINDOW, PCH_RESULT_WORDS, PchPhase, USER_BASE,
} from "../isa/memmap";
import { ROW, status } from "./asmtext";
import { BLK_READ, BLK_WRITE } from "./blockasm";

const KD = KDATA_BASE;
const TABLE_END = KD + KDATA_SLOTS * KSLOT_BYTES;
/** Scratch words after the slot table. */
const SEQ = TABLE_END; // job sequence counter
const CUR = TABLE_END + 4; // slot of the running job
const IKEY = TABLE_END + 8; // key id being ingested
const ILEN = TABLE_END + 12; // its length in words
const ILBA = TABLE_END + 16; // its spool block
const ISLOT = TABLE_END + 20; // its slot
export const KBUMP = TABLE_END + 24;
const BUMP = KBUMP; // OS 2: the next free frame for a program's memory
const PFS = TABLE_END + 28; // OS 2: the registers the page-fault handler borrows (five words)
/** Jobs the kernel has killed for touching memory they may not (the game reads it as the fault statistic). */
export const KFAULTS = TABLE_END + 48;
export const KDATA_END = TABLE_END + 52;
const H = (k: keyof typeof OS_HEADER): number => 4 * OS_HEADER[k];

const setPhase = (p: number): string[] => [`  li t0, ${p}`, `  sw t0, ${PCH_REG.PHASE}(s0)`];

/** The kernel's source: `paged` is OS 2, which gives each program an address space (docs/VM.md) instead of guarding the OS with the memory protection unit. */
export function kernelSource(paged: boolean): string {
  const TBL = PAGED_TABLES, KEND_PAGE = (KDATA_END + 255) & ~255;
  return [
  paged ? "# OS v2 kernel (paged: one address space per program)" : "# OS v1 kernel (single-task resident)",
  "k_entry:",
  "  j kmain",
  "k_done_vec:", // KERNEL_DONE = KERNEL_BASE + 4: the ROM epilogue lands here when a job ends
  "  j kdone",
  "k_fault_vec:", // KERNEL_FAULT = KERNEL_BASE + 8: the CPU is sent here when a job wrote to protected memory
  "  j kfault",
  "k_pf_vec:", // KERNEL_PAGEFAULT = KERNEL_BASE + 12: the MMU sends the CPU here on a page fault
  "  j kpf",
  "kmain:",
  "  li sp, 65536",
  `  li s0, ${PCH_BASE}`,
  `  li t0, ${KD}`,
  `  li t1, ${KDATA_END}`,
  "kzero:",
  "  sw zero, 0(t0)",
  "  addi t0, t0, 4",
  "  bne t0, t1, kzero",
  ...(paged ? [
    // the MMU sends page faults to kpf
    `  li t2, ${MMU_BASE}`,
    `  li t0, ${KERNEL_PAGEFAULT}`,
    `  sw t0, ${MMU_REG.VECTOR}(t2)`,
  ] : [
    // memory protection: the boot ROM, and the OS's own header, kernel and job table, are not the jobs' to write
    `  li t2, ${MPU_BASE}`,
    `  li t0, ${USER_BASE}`,
    `  sw zero, ${MPU_REG.R0_LO}(t2)`,
    `  sw t0, ${MPU_REG.R0_HI}(t2)`,
    `  li t0, ${OS_HEADER_BASE}`,
    `  sw t0, ${MPU_REG.R1_LO}(t2)`,
    `  li t0, ${KDATA_END}`,
    `  sw t0, ${MPU_REG.R1_HI}(t2)`,
  ]),
  "kloop:",
  `  li s0, ${PCH_BASE}`,
  `  li s3, ${OS_HEADER_BASE}`,
  `  lw s1, ${PCH_REG.BOOT_DEV}(s0)`,
  `  lw t0, ${PCH_REG.PHASE}(s0)`,
  `  li t1, ${PchPhase.OsIdle}`,
  "  beq t0, t1, kpoll",
  `  sw t1, ${PCH_REG.PHASE}(s0)`,
  `  li a3, ${DISPLAY_BASE}`,
  ...status("OS READY", "a3"),
  "kpoll:",
  `  lw t0, ${PCH_REG.STATUS}(s0)`,
  "  andi t1, t0, 1",
  "  beq t1, zero, krun", // no key in the port
  "  andi t1, t0, 8",
  "  beq t1, zero, krun", // not enumerated yet
  `  lw a0, ${PCH_REG.KEY_ID}(s0)`,
  "  call find_slot",
  `  lw t0, ${PCH_REG.STATUS}(s0)`,
  "  beq a0, zero, knew",
  `  lw t1, ${KSLOT.STATE}(a0)`,
  "  li t2, 4",
  "  bne t1, t2, krun", // queued or running: nothing to do for this key
  "  andi t1, t0, 2",
  "  bne t1, zero, kfree", // the flash landed: the slot is free again
  "  andi t1, t0, 16",
  "  bne t1, zero, krun", // flash in progress
  "  call kflash",
  "  j kloop",
  "kfree:",
  `  sw zero, ${KSLOT.STATE}(a0)`,
  "  j kloop",
  "knew:",
  "  andi t1, t0, 2",
  "  bne t1, zero, krun", // the key already holds a result (not one of ours)
  "  call kingest",
  "  j kloop",

  // ---- run the oldest queued job, if a program slot is free ----
  "krun:",
  `  li t0, ${KD}`,
  "  li t1, 0", // best slot
  "  li t2, 2147483647", // its sequence number
  "  li t3, 0", // jobs running
  `  li t4, ${TABLE_END}`,
  "rscan:",
  `  lw a1, ${KSLOT.STATE}(t0)`,
  "  li a2, 3",
  "  bne a1, a2, rq",
  "  addi t3, t3, 1",
  "  j rnext",
  "rq:",
  "  li a2, 2",
  "  bne a1, a2, rnext",
  `  lw a1, ${KSLOT.SEQ}(t0)`,
  "  bge a1, t2, rnext",
  "  mv t2, a1",
  "  mv t1, t0",
  "rnext:",
  `  addi t0, t0, ${KSLOT_BYTES}`,
  "  bne t0, t4, rscan",
  "  beq t1, zero, kloop", // nothing queued
  `  lw a1, ${H("PROGRAM_SLOTS")}(s3)`,
  "  bge t3, a1, kloop", // every program slot is busy (never the case in v1: a job runs to completion)
  "  mv a0, t1",
  // ---- start the job in slot a0 ----
  `  li t0, ${PchPhase.OsRun}`,
  `  sw t0, ${PCH_REG.PHASE}(s0)`,
  "  li t0, 3",
  `  sw t0, ${KSLOT.STATE}(a0)`,
  `  li t0, ${CUR}`,
  "  sw a0, 0(t0)",
  `  li a3, ${DISPLAY_BASE}`,
  ...status("RUNNING JOB", "a3"),
  `  li t0, ${DISPLAY_BASE + JOB_ROW * ROW}`, // clear the job's output row
  `  addi t1, t0, ${ROW}`,
  "kclr:",
  "  sw zero, 0(t0)",
  "  addi t0, t0, 4",
  "  bne t0, t1, kclr",
  `  lw s2, ${KSLOT.LEN}(a0)`,
  `  lw a1, ${KSLOT.LBA}(a0)`,
  "  slli s2, s2, 2",
  `  addi s2, s2, ${BLOCK_BYTES - 1}`,
  "  srli s2, s2, 8", // blocks to read
  `  li a2, ${paged ? USER_BASE + PAGED_SHIFT : USER_BASE}`, // OS 2: the program is loaded where its page table will map it
  "kload:",
  "  mv a0, s1",
  "  call blk_read",
  "  addi a1, a1, 1",
  `  addi a2, a2, ${BLOCK_BYTES}`,
  "  addi s2, s2, -1",
  "  bne s2, zero, kload",
  ...(paged ? [
    "  call kmap", // the program's address space: tables built, translation switched on
    `  li t0, ${USER_BASE}`,
  ] : [
    `  li t0, ${USER_BASE}`,
    `  li t2, ${MPU_BASE}`,
    "  li t1, 1",
    `  sw t1, ${MPU_REG.ENABLE}(t2)`, // from here until kdone or kfault the job may not write to the OS
  ]),
  "  jalr ra, t0, 0", // the job ends at the ROM done vector, which lands in kdone

  // ---- a job finished: keep its output line as the result ----
  "kdone:",
  ...(paged ? [`  li t2, ${MMU_BASE}`, `  sw zero, ${MMU_REG.CONTROL}(t2)`] : [`  li t2, ${MPU_BASE}`, `  sw zero, ${MPU_REG.ENABLE}(t2)`]), // back in the kernel: addresses are physical again, the tables are ours
  "  li sp, 65536",
  `  li s0, ${PCH_BASE}`,
  `  li t0, ${CUR}`,
  "  lw a0, 0(t0)",
  `  li t0, ${DISPLAY_BASE + JOB_ROW * ROW}`,
  `  addi t1, a0, ${KSLOT.RESULT}`,
  `  addi t2, t0, ${PCH_RESULT_WORDS * 4}`,
  "kres:",
  "  lw t3, 0(t0)",
  "  sw t3, 0(t1)",
  "  addi t0, t0, 4",
  "  addi t1, t1, 4",
  "  bne t0, t2, kres",
  "  li t0, 4",
  `  sw t0, ${KSLOT.STATE}(a0)`,
  "  j kloop",

  // ---- a job wrote to protected memory: the OS ends it, its result is the fault text ----
  "kfault:",
  ...(paged ? [`  li t2, ${MMU_BASE}`, `  sw zero, ${MMU_REG.CONTROL}(t2)`] : [`  li t2, ${MPU_BASE}`, `  sw zero, ${MPU_REG.ENABLE}(t2)`]),
  "  li sp, 65536",
  `  li s0, ${PCH_BASE}`,
  `  li t0, ${KFAULTS}`,
  "  lw t1, 0(t0)",
  "  addi t1, t1, 1",
  "  sw t1, 0(t0)",
  `  li t0, ${CUR}`,
  "  lw a0, 0(t0)",
  `  addi t1, a0, ${KSLOT.RESULT}`,
  `  li t3, ${0x46474553}`, // "SEGF"
  "  sw t3, 0(t1)",
  `  li t3, ${0x544c5541}`, // "AULT"
  "  sw t3, 4(t1)",
  `  addi t2, t1, ${PCH_RESULT_WORDS * 4}`,
  "  addi t1, t1, 8",
  "kfz:",
  "  sw zero, 0(t1)",
  "  addi t1, t1, 4",
  "  bne t1, t2, kfz",
  "  li t0, 4",
  `  sw t0, ${KSLOT.STATE}(a0)`,
  "  j kloop",

  // ---- flash the result of slot a0 onto the plugged key ----
  "kflash:",
  `  li t0, ${PchPhase.OsFlash}`,
  `  sw t0, ${PCH_REG.PHASE}(s0)`,
  `  addi t0, a0, ${KSLOT.RESULT}`,
  `  li t1, ${PCH_BASE + PCH_RESULT_WINDOW}`,
  `  addi t2, t0, ${PCH_RESULT_WORDS * 4}`,
  "kfl:",
  "  lw t3, 0(t0)",
  "  sw t3, 0(t1)",
  "  addi t0, t0, 4",
  "  addi t1, t1, 4",
  "  bne t0, t2, kfl",
  `  li t0, ${PCH_RESULT_WORDS}`,
  `  sw t0, ${PCH_REG.RESULT_LEN}(s0)`,
  "  li t0, 1",
  `  sw t0, ${PCH_REG.DONE}(s0)`,
  "  ret",

  // ---- ingest the plugged key: copy its program to the spool on disk and queue it ----
  "kingest:",
  "  mv s2, ra",
  `  li t0, ${KD}`,
  `  li t4, ${TABLE_END}`,
  "  li a1, 0", // slots in use
  "  li a2, 0", // first free slot
  "kiscan:",
  `  lw t1, ${KSLOT.STATE}(t0)`,
  "  bne t1, zero, kiused",
  "  bne a2, zero, kinext",
  "  mv a2, t0",
  "  j kinext",
  "kiused:",
  "  addi a1, a1, 1",
  "kinext:",
  `  addi t0, t0, ${KSLOT_BYTES}`,
  "  bne t0, t4, kiscan",
  "  beq a2, zero, kiout", // no free slot
  `  lw t1, ${H("QUEUE_SLOTS")}(s3)`,
  "  bge a1, t1, kiout", // the queue is at its bound
  `  lw a3, ${PCH_REG.KEY_LEN}(s0)`,
  "  slli t4, a3, 2",
  `  addi t4, t4, ${BLOCK_BYTES - 1}`,
  "  srli t4, t4, 8", // blocks to copy
  "  beq t4, zero, kiout",
  `  lw t1, ${H("SPOOL_BLOCKS")}(s3)`,
  "  blt t1, t4, kiout", // the program does not fit its spool area
  `  li t0, ${ISLOT}`,
  "  sw a2, 0(t0)",
  `  li t0, ${ILEN}`,
  "  sw a3, 0(t0)",
  `  lw t2, ${PCH_REG.KEY_ID}(s0)`,
  `  li t0, ${IKEY}`,
  "  sw t2, 0(t0)",
  `  li t0, ${KD}`,
  "  sub t0, a2, t0",
  "  srli t0, t0, 6", // slot index
  "  mul t0, t0, t1",
  `  lw t1, ${H("SPOOL_LBA")}(s3)`,
  "  add a1, t0, t1", // first spool block of this slot
  `  li t0, ${ILBA}`,
  "  sw a1, 0(t0)",
  ...setPhase(PchPhase.OsIngest),
  `  li a3, ${DISPLAY_BASE}`,
  ...status("INGESTING", "a3"),
  "  mv s3, t4",
  `  li a2, ${PCH_BASE + PCH_KEY_WINDOW}`,
  "kicopy:",
  "  mv a0, s1",
  "  call blk_write",
  "  addi a1, a1, 1",
  `  addi a2, a2, ${BLOCK_BYTES}`,
  "  addi s3, s3, -1",
  "  bne s3, zero, kicopy",
  `  lw t0, ${PCH_REG.STATUS}(s0)`,
  "  andi t0, t0, 1",
  "  beq t0, zero, kiout", // the key was pulled during the copy: nothing is queued
  `  lw t0, ${PCH_REG.KEY_ID}(s0)`,
  `  li t1, ${IKEY}`,
  "  lw t2, 0(t1)",
  "  bne t0, t2, kiout",
  `  li t1, ${ISLOT}`,
  "  lw a0, 0(t1)",
  `  sw t2, ${KSLOT.KEY}(a0)`,
  `  li t1, ${ILEN}`,
  "  lw t2, 0(t1)",
  `  sw t2, ${KSLOT.LEN}(a0)`,
  `  li t1, ${ILBA}`,
  "  lw t2, 0(t1)",
  `  sw t2, ${KSLOT.LBA}(a0)`,
  `  li t1, ${SEQ}`,
  "  lw t2, 0(t1)",
  "  addi t2, t2, 1",
  "  sw t2, 0(t1)",
  `  sw t2, ${KSLOT.SEQ}(a0)`,
  "  li t2, 2",
  `  sw t2, ${KSLOT.STATE}(a0)`, // queued
  "kiout:",
  "  jalr zero, s2, 0",

  // ---- find_slot: a0 = key id -> a0 = the slot holding it, or 0 ----
  "find_slot:",
  `  li t0, ${KD}`,
  `  li t1, ${TABLE_END}`,
  "fs1:",
  `  lw t2, ${KSLOT.STATE}(t0)`,
  "  beq t2, zero, fs2",
  `  lw t2, ${KSLOT.KEY}(t0)`,
  "  beq t2, a0, fshit",
  "fs2:",
  `  addi t0, t0, ${KSLOT_BYTES}`,
  "  bne t0, t1, fs1",
  "  li a0, 0",
  "  ret",
  "fshit:",
  "  mv a0, t0",
  "  ret",
  "",
  ...(paged ? [
    // ---- kmap: the address space of the job just loaded, and translation on ----
    // Virtual pages 0..15 are the ROM (read, run: the job ends by jumping into it), 16.. the program's image (read, write, run) at physical + PAGED_SHIFT,
    // 0xc0.. the OS (read, run: the job table can be read, never written), and nothing else: the heap (0x4000..0x7fff) and the stack (0xf000..0xffff) are
    // claimed by page faults as the program touches them (kpf). The tables sit at PAGED_TABLES, out of the program's reach.
    "kmap:",
    `  li t0, ${TBL}`,
    `  li t1, ${TBL + PAGED_TABLES_BYTES}`,
    "kmz:",
    "  sw zero, 0(t0)",
    "  addi t0, t0, 4",
    "  bne t0, t1, kmz",
    `  li t0, ${TBL}`,
    `  li t1, ${TBL + 0x100 + 1}`,
    "  sw t1, 0(t0)", // level 1 entry 0: virtual 0x0000..0x3fff
    `  li t1, ${TBL + 0x200 + 1}`,
    "  sw t1, 4(t0)", // entry 1: 0x4000..0x7fff, the heap
    `  li t1, ${TBL + 0x300 + 1}`,
    "  sw t1, 12(t0)", // entry 3: 0xc000..0xffff, the OS and the stack
    `  li t0, ${TBL + 0x100}`,
    "  li t1, 0",
    `  li t2, ${USER_BASE}`,
    "kmr:", // the ROM: identity, read and run
    "  addi t3, t1, 5",
    "  sw t3, 0(t0)",
    "  addi t0, t0, 4",
    "  addi t1, t1, 256",
    "  bne t1, t2, kmr",
    `  li t4, ${CUR}`,
    "  lw t4, 0(t4)",
    `  lw t4, ${KSLOT.LEN}(t4)`,
    "  slli t4, t4, 2",
    "  addi t4, t4, 255",
    "  srli t4, t4, 8", // the program's pages
    "kmi:", // its image: read, write, run
    `  addi t3, t1, ${PAGED_SHIFT + 7}`,
    "  sw t3, 0(t0)",
    "  addi t0, t0, 4",
    "  addi t1, t1, 256",
    "  addi t4, t4, -1",
    "  bne t4, zero, kmi",
    `  li t0, ${TBL + 0x300}`,
    "  li t1, 49152",
    `  li t2, ${KEND_PAGE}`,
    "kmk:", // the OS: identity, read and run
    "  addi t3, t1, 5",
    "  sw t3, 0(t0)",
    "  addi t0, t0, 4",
    "  addi t1, t1, 256",
    "  bne t1, t2, kmk",
    `  li t0, ${BUMP}`,
    `  li t1, ${PAGED_HEAP >> 8}`,
    "  sw t1, 0(t0)", // the first frame for the program's own memory
    `  li t2, ${MMU_BASE}`,
    `  li t1, ${TBL}`,
    `  sw t1, ${MMU_REG.TABLE}(t2)`,
    "  li t1, 1",
    `  sw t1, ${MMU_REG.CONTROL}(t2)`, // translation on: the kernel's own pages are mapped, so the next instruction is still there
    "  ret",

    // ---- kpf: the program touched a page that is not mapped ----
    // The heap and the stack are claimed on demand: a frame from the bump pointer, zeroed, mapped read and write. Anything else (a page the program has no
    // business with, a write to the OS, memory running out) ends the program like a protection fault. The handler runs untranslated and gives the program
    // its registers back, so the faulting instruction simply runs again.
    "kpf:",
    `  sw t0, ${PFS}(zero)`,
    `  sw t1, ${PFS + 4}(zero)`,
    `  sw t2, ${PFS + 8}(zero)`,
    `  sw t3, ${PFS + 12}(zero)`,
    `  sw t4, ${PFS + 16}(zero)`,
    `  li t0, ${MMU_BASE}`,
    `  lw t1, ${MMU_REG.FAULT_CAUSE}(t0)`,
    "  li t2, 1",
    "  bne t1, t2, kpkill", // only a missing page can be fixed
    `  lw t1, ${MMU_REG.FAULT_ADDR}(t0)`,
    "  srli t1, t1, 8", // the page number
    "  li t2, 64",
    "  blt t1, t2, kpkill",
    "  li t2, 128",
    "  blt t1, t2, kpok", // 0x40..0x7f: the heap
    "  li t2, 240",
    "  blt t1, t2, kpkill",
    "  li t2, 256",
    "  bge t1, t2, kpkill", // 0xf0..0xff: the stack
    "kpok:",
    `  li t0, ${BUMP}`,
    "  lw t2, 0(t0)",
    `  li t3, ${TBL >> 8}`,
    "  bge t2, t3, kpkill", // the frames are used up
    "  addi t3, t2, 1",
    "  sw t3, 0(t0)",
    "  slli t3, t2, 8",
    "  addi t0, t3, 256",
    "kpz:", // a new page is zeroed
    "  sw zero, 0(t3)",
    "  addi t3, t3, 4",
    "  bne t3, t0, kpz",
    `  li t0, ${TBL + 0x200}`,
    "  li t4, 192",
    "  blt t1, t4, kpm",
    `  li t0, ${TBL + 0x300}`,
    "kpm:",
    "  andi t4, t1, 63",
    "  slli t4, t4, 2",
    "  add t4, t4, t0", // this page's entry in its level 2 table
    "  slli t3, t2, 8",
    "  addi t3, t3, 3", // the frame, valid and writable
    "  sw t3, 0(t4)",
    `  lw t0, ${PFS}(zero)`,
    `  lw t1, ${PFS + 4}(zero)`,
    `  lw t2, ${PFS + 8}(zero)`,
    `  lw t3, ${PFS + 12}(zero)`,
    `  lw t4, ${PFS + 16}(zero)`,
    "  iret",
    "kpkill:",
    "  j kfault",
  ] : ["kpf:", "  j kfault"]), // OS 1 has no MMU to fault
  BLK_READ,
  "",
  BLK_WRITE,
  "",
  ].join("\n");
}

export const KERNEL_SOURCE = kernelSource(false);
export const KERNEL_SOURCE_PAGED = kernelSource(true);
const assembled = assemble(KERNEL_SOURCE);
const assembledPaged = assemble(KERNEL_SOURCE_PAGED);
/** The kernel image (words); its first word is at KERNEL_BASE. */
export const KERNEL_IMAGE: Uint32Array = assembled.program;
export const KERNEL_IMAGE_PAGED: Uint32Array = assembledPaged.program;
export const KERNEL_SYMBOLS: ReadonlyMap<string, number> = assembled.symbols;
/** The kernel an OS tier boots: OS 1 guards itself with the protection unit, OS 2 and up are paged. */
export const kernelImageFor = (tier: number): Uint32Array => (tier >= 2 ? KERNEL_IMAGE_PAGED : KERNEL_IMAGE);

if (KERNEL_SYMBOLS.get("k_done_vec") !== 4) throw new Error("kernel: k_done_vec must be at KERNEL_BASE + 4");
if (KERNEL_SYMBOLS.get("k_fault_vec") !== 8) throw new Error("kernel: k_fault_vec must be at KERNEL_BASE + 8");
for (const [name, a] of [["", assembled], ["paged ", assembledPaged]] as const) if (a.symbols.get("k_pf_vec") !== 12) throw new Error(`${name}kernel: k_pf_vec must be at KERNEL_BASE + 12`);
if (KERNEL_BASE !== OS_HEADER_BASE + BLOCK_BYTES) throw new Error("kernel must follow the header block");
if (KERNEL_BASE + Math.max(KERNEL_IMAGE.length, KERNEL_IMAGE_PAGED.length) * 4 > KD) throw new Error("kernel overlaps its data");

export interface BootParams {
  /** Jobs the queue may hold (already bounded by the OS tier and the disk space). */
  queueSlots: number;
  /** Programs that may run at once (1 for v1; the kernel checks it before starting a job). */
  programSlots: number;
  /** First block of the job spool and the blocks each queue slot gets. */
  spoolLba: number;
  spoolBlocks: number;
  tier: number;
}

/** Blocks the boot image of an OS tier takes: the header block plus the kernel. */
export const bootBlocksFor = (tier: number): number => 1 + Math.ceil((kernelImageFor(tier).length * 4) / BLOCK_BYTES);
/** Blocks the OS 1 boot image takes. */
export const BOOT_BLOCKS = bootBlocksFor(1);

/** The boot area of the disk: block 0 is the header, then the kernel image (padded to whole blocks). */
export function bootImage(p: BootParams): Uint8Array {
  const image = kernelImageFor(p.tier), blocks = bootBlocksFor(p.tier);
  const out = new Uint8Array(blocks * BLOCK_BYTES);
  const w = new DataView(out.buffer);
  const header: Record<keyof typeof OS_HEADER, number> = {
    MAGIC: OS_MAGIC, TOTAL_BLOCKS: blocks, QUEUE_SLOTS: p.queueSlots, PROGRAM_SLOTS: p.programSlots,
    SPOOL_LBA: p.spoolLba, SPOOL_BLOCKS: p.spoolBlocks, TIER: p.tier,
  };
  for (const k of Object.keys(OS_HEADER) as (keyof typeof OS_HEADER)[]) w.setUint32(4 * OS_HEADER[k], header[k] >>> 0, true);
  image.forEach((word, i) => w.setUint32(BLOCK_BYTES + 4 * i, word, true));
  return out;
}
