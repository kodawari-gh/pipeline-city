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
  MPU_BASE, MPU_REG, OS_MAGIC, PCH_BASE, PCH_KEY_WINDOW, PCH_REG, PCH_RESULT_WINDOW, PCH_RESULT_WORDS, PchPhase, USER_BASE,
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
const KDATA_END = TABLE_END + 24;
const H = (k: keyof typeof OS_HEADER): number => 4 * OS_HEADER[k];

const setPhase = (p: number): string[] => [`  li t0, ${p}`, `  sw t0, ${PCH_REG.PHASE}(s0)`];

export const KERNEL_SOURCE = [
  "# OS v1 kernel (single-task resident)",
  "k_entry:",
  "  j kmain",
  "k_done_vec:", // KERNEL_DONE = KERNEL_BASE + 4: the ROM epilogue lands here when a job ends
  "  j kdone",
  "k_fault_vec:", // KERNEL_FAULT = KERNEL_BASE + 8: the CPU is sent here when a job wrote to protected memory
  "  j kfault",
  "kmain:",
  "  li sp, 65536",
  `  li s0, ${PCH_BASE}`,
  `  li t0, ${KD}`,
  `  li t1, ${KDATA_END}`,
  "kzero:",
  "  sw zero, 0(t0)",
  "  addi t0, t0, 4",
  "  bne t0, t1, kzero",
  // memory protection: the boot ROM, and the OS's own header, kernel and job table, are not the jobs' to write
  `  li t2, ${MPU_BASE}`,
  `  li t0, ${USER_BASE}`,
  `  sw zero, ${MPU_REG.R0_LO}(t2)`,
  `  sw t0, ${MPU_REG.R0_HI}(t2)`,
  `  li t0, ${OS_HEADER_BASE}`,
  `  sw t0, ${MPU_REG.R1_LO}(t2)`,
  `  li t0, ${KDATA_END}`,
  `  sw t0, ${MPU_REG.R1_HI}(t2)`,
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
  `  li a2, ${USER_BASE}`,
  "kload:",
  "  mv a0, s1",
  "  call blk_read",
  "  addi a1, a1, 1",
  `  addi a2, a2, ${BLOCK_BYTES}`,
  "  addi s2, s2, -1",
  "  bne s2, zero, kload",
  `  li t0, ${USER_BASE}`,
  `  li t2, ${MPU_BASE}`,
  "  li t1, 1",
  `  sw t1, ${MPU_REG.ENABLE}(t2)`, // from here until kdone or kfault the job may not write to the OS
  "  jalr ra, t0, 0", // the job ends at the ROM done vector, which lands in kdone

  // ---- a job finished: keep its output line as the result ----
  "kdone:",
  `  li t2, ${MPU_BASE}`,
  `  sw zero, ${MPU_REG.ENABLE}(t2)`, // back in the kernel: the tables are ours again
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
  `  li t2, ${MPU_BASE}`,
  `  sw zero, ${MPU_REG.ENABLE}(t2)`,
  "  li sp, 65536",
  `  li s0, ${PCH_BASE}`,
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
  BLK_READ,
  "",
  BLK_WRITE,
  "",
].join("\n");

const assembled = assemble(KERNEL_SOURCE);
/** The kernel image (words); its first word is at KERNEL_BASE. */
export const KERNEL_IMAGE: Uint32Array = assembled.program;
export const KERNEL_SYMBOLS: ReadonlyMap<string, number> = assembled.symbols;

if (KERNEL_SYMBOLS.get("k_done_vec") !== 4) throw new Error("kernel: k_done_vec must be at KERNEL_BASE + 4");
if (KERNEL_SYMBOLS.get("k_fault_vec") !== 8) throw new Error("kernel: k_fault_vec must be at KERNEL_BASE + 8");
if (KERNEL_BASE !== OS_HEADER_BASE + BLOCK_BYTES) throw new Error("kernel must follow the header block");
if (KERNEL_BASE + KERNEL_IMAGE.length * 4 > KD) throw new Error("kernel overlaps its data");

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

/** Blocks the boot image takes: the header block plus the kernel. */
export const BOOT_BLOCKS = 1 + Math.ceil((KERNEL_IMAGE.length * 4) / BLOCK_BYTES);

/** The boot area of the disk: block 0 is the header, then the kernel image (padded to whole blocks). */
export function bootImage(p: BootParams): Uint8Array {
  const out = new Uint8Array(BOOT_BLOCKS * BLOCK_BYTES);
  const w = new DataView(out.buffer);
  const header: Record<keyof typeof OS_HEADER, number> = {
    MAGIC: OS_MAGIC, TOTAL_BLOCKS: BOOT_BLOCKS, QUEUE_SLOTS: p.queueSlots, PROGRAM_SLOTS: p.programSlots,
    SPOOL_LBA: p.spoolLba, SPOOL_BLOCKS: p.spoolBlocks, TIER: p.tier,
  };
  for (const k of Object.keys(OS_HEADER) as (keyof typeof OS_HEADER)[]) w.setUint32(4 * OS_HEADER[k], header[k] >>> 0, true);
  KERNEL_IMAGE.forEach((word, i) => w.setUint32(BLOCK_BYTES + 4 * i, word, true));
  return out;
}
