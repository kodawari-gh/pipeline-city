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
  BLOCK_BYTES, DISPLAY_BASE, JOB_ROW, KDATA_BASE, KDATA_SLOTS, KERNEL_BASE, KSLOT, KSLOT_BYTES, MAX_THREADS_PER_JOB, OS_HEADER, OS_HEADER_BASE,
  INTC_BASE, INTC_REG, IRQ, KERNEL_PAGEFAULT, KERNEL_PAGEFAULT1, KERNEL_PVEC, KERNEL_SECONDARY, KERNEL_TIMER, KERNEL_TVEC, KERNEL_VEC_CORES, MMU_BASE, TIMER_BASE, TIMER_REG, MMU_REG, MPU_BASE, MPU_REG, OS_MAGIC, PAGED_HEAP, PAGED_SHIFT, PAGED_TABLES, PAGED_TABLES_BYTES, PCH_BASE, PCH_KEY_WINDOW, PCH_REG, PCH_RESULT_WINDOW, PCH_RESULT_WORDS, PchPhase, USER_BASE,
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
/** OS 2 and 3: the number of 256-byte frames the machine has (up to MAX_FRAMES), read from the PCH at boot. */
export const NFRAMES = TABLE_END + 52;
export const KDATA_END = TABLE_END + 56;
// OS 2 on a multicore CPU (docs/MULTICORE.md section 6): core 0 is the kernel core (ingest, flash, queue) and hands a job to core 1 when that is free, else runs it itself.
// Core 1 has its own arena of RAM (tables, image, heap frames), its own page-fault handler and its own display row; the shared words below are the mailbox,
// the "core 1 is busy" flag and the big kernel lock, which guards every update of the job table made by either core.
const LOCK = KDATA_END; // the big kernel lock (0 free, 1 held: taken with amoswap)
const MBOX = LOCK + 4; // the slot core 0 wants core 1 to run (0: nothing)
const C1BUSY = LOCK + 8; // 1 from the hand-over until core 1 has stored the job's result
const CUR1 = LOCK + 12; // the slot running on core 1
const ARENA_END = LOCK + 16; // core 0's frame allocator skips frames up to here (0: no arena, a single-core kernel)
const BUMP1 = LOCK + 20; // core 1's next free frame
const PFS1 = LOCK + 24; // core 1's page-fault scratch (five words)
const SMPON = LOCK + 44; // 1 when the machine has a second core and RAM for its arena
/** The end of the kernel's data for the multicore os2 image. */
export const KDATA_END_SMP = LOCK + 48;
/** Core 1's arena: its page tables at the start, its kernel stack below the image, the image at virtual + `ARENA1_SHIFT`, heap frames from `ARENA1_HEAP` up to `ARENA1_END`. Needs 128K of RAM. */
export const ARENA1 = 0x10000;
export const ARENA1_SHIFT = 0x10000;
export const ARENA1_HEAP = 0x120;
export const ARENA1_END = 0x180;
/** RAM frames the multicore os2 needs before it hands jobs to core 1 (128K). */
export const SMP_MIN_FRAMES = 0x200;
/** The kernel stack of core 1 (below its image, above its tables). */
const KSTK1 = ARENA1 + 0x1000;
/** The frames a paged OS manages: the virtual space is 20 bits, so RAM above 1 MiB is not used. */
export const MAX_FRAMES = 4096;
// The preemptive kernel (OS 3) keeps more: a process control block per slot (plus one for the kernel itself), the map of RAM frames, and scratch words.
/** A process control block: the 15 registers (ra, sp, a0..a3, t0..t4, s0..s3), the pc, its page table (physical), the frames of its three second-level tables, its job slot and a copy of its output row. */
export const PCB = { PC: 60, TABLE: 64, L2_IMAGE: 68, L2_HEAP: 72, L2_STACK: 76, SLOT: 80, ROW: 84, TIDX: 116, CORE: 120, LAST: 124, BYTES: 128 } as const;
/** The nop that marks a threaded program (`addi zero, zero, T`) without its immediate: the kernel of OS 4 reads T from the program's first word. */
const ADDI_OP = assemble("addi zero, zero, 0").program[0]!;
/** PCBs: one per job slot (indexed like the slot), the kernel's is the ninth. */
export const PCBS = TABLE_END + 72;
const CURP = TABLE_END + 56; // OS 3: the PCB of the context that is running
const SCR = TABLE_END + 60; // OS 3: the timer handler's scratch
const SLEEP = TABLE_END + 64;
const HINT = TABLE_END + 68; // OS 3: where the frame allocator looks next (nothing below it is free: frames are only freed by kfreeown, which resets it) // OS 3: rounds the idle kernel is skipped for
/** Rounds of the scheduler an idle kernel sits out while programs run. */
const KERNEL_NAP = 3;
const PFSB = PCBS + 9 * PCB.BYTES; // OS 3: registers the page-fault handler borrows (seven saved, then the slot, the page, the level 1 entry and the PTE)
const KSCR = PFSB + 48; // OS 3: kstart's scratch: ra, slot, image pages, owner, the four table frames
export const KDATA_END_PRE = KSCR + 32;
// The multicore OS 3 (docs/MULTICORE.md section 7, docs/OS.md "Preemption on every core") keeps more: an idle PCB per logical core (where an interrupt on an idle core saves its registers),
// a block of scratch words per core (the page-fault handler's borrowed registers, the PCB of the context running there), and the big kernel lock. `PCB.CORE` of a context is the
// number of the core running it plus one, 0 when none does.
/** Logical cores the multicore OS 3 manages. */
export const MAX_LCORES = 8;
const IDLEP = PCBS + 9 * PCB.BYTES;
const PCORE = IDLEP + MAX_LCORES * PCB.BYTES;
const PCORE_BYTES = 64;
/** In a core's block: the borrowed registers (ra, a0, t0..t4: 28 bytes), then the page-fault handler's slot, page, level 1 entry and PTE entry words, its saved s3, the PCB of the running context and the timer stub's scratch. */
const PC_S3 = 44, PC_CURP = 48, PC_SCR = 52;
const KSCR_SMP = PCORE + MAX_LCORES * PCORE_BYTES;
const LOCK3 = KSCR_SMP + 64;
/** OS 4: how many times a core took a context that another core had run last (the affinity pass found none of its own). */
export const KMIGR = LOCK3 + 4;
export const KDATA_END_PRE_SMP = KMIGR + 4;
/**
 * Frame map (OS 3): one word per physical frame, 0 = free, else (kind << 4) | (job slot + 1): kind 0 a program's image, 1 its own memory, 2 its page tables;
 * `RESERVED_FRAME` is the OS's own (the tables, the map itself, frames beyond the installed RAM). It sits above 64K, so OS 3 needs RAM that reaches `OS3_MIN_BYTES`.
 */
export const FMAP = 0x10000;
export const RESERVED_FRAME = 0xf0;
export const FRAME_FIRST = 16;
export const FRAME_END = MAX_FRAMES;
/** The kernel's own address space (identity, all of RAM: a level 1 table and up to 64 level 2 tables) follows the frame map. */
export const KTBL = FMAP + 4 * MAX_FRAMES;
export const KTBL_BYTES = 0x100 + 0x100 * 64;
/** Frames 0xb0 up to here belong to the OS (its tables, the frame map and the kernel table). */
export const OS_FRAMES_END = (KTBL + KTBL_BYTES + 255) >> 8;
/** The RAM OS 3 needs so that its tables fit and programs have room. */
export const OS3_MIN_BYTES = 256 * 1024;
/** Interrupt-free stack of the code that ends a job. */
const KSTK = 0xfc00;
/** CPU cycles one program runs before the scheduler looks again. */
export const SLICE_CYCLES = 5000;
/** Where the end of the kernel's data is, by OS tier. */
export const kdataEndFor = (tier: number, smp = false): number => (tier >= 3 ? (smp ? KDATA_END_PRE_SMP : KDATA_END_PRE) : smp && tier === 2 ? KDATA_END_SMP : KDATA_END);
const H = (k: keyof typeof OS_HEADER): number => 4 * OS_HEADER[k];

const setPhase = (p: number): string[] => [`  li t0, ${p}`, `  sw t0, ${PCH_REG.PHASE}(s0)`];

// ---- OS 3: the preemptive part ----
const REGS = ["ra", "sp", "a0", "a1", "a2", "a3", "t0", "t1", "t2", "t3", "t4", "s0", "s1", "s2", "s3"] as const;
const roff = (r: string): number => 4 * REGS.indexOf(r as (typeof REGS)[number]);
const JOB_ROW_ADDR = DISPLAY_BASE + JOB_ROW * ROW;
const FMAP_FIRST = FMAP + 4 * FRAME_FIRST, FMAP_LAST = FMAP + 4 * FRAME_END;
/** A word copy loop from `from` to `to` that ends when `from` reaches `end` (clobbers `tmp`, advances both). */
const copy = (label: string, from: string, to: string, end: string, tmp: string): string[] => [
  `${label}:`, `  lw ${tmp}, 0(${from})`, `  sw ${tmp}, 0(${to})`, `  addi ${from}, ${from}, 4`, `  addi ${to}, ${to}, 4`, `  bne ${from}, ${end}, ${label}`,
];

/**
 * The timer handler and scheduler, the page-fault handler that hands out frames, the job start that builds an address space, and the ends of a job. Contexts are
 * the job slots plus the kernel's own (index 8); the timer rotates through the ones that can run. See docs/OS.md "Preemption".
 */
function preemptive(kendPage: number, smp = false, thr = false): string[] {
  const K = smp ? KSCR_SMP : KSCR;
  /** The PCB of the context running on this core, into `rd` (`tmp` is clobbered; they may be the same register). */
  const curp = (rd: string, tmp: string): string[] => smp
    ? [`  li ${tmp}, ${INTC_BASE}`, `  lw ${tmp}, ${INTC_REG.CORE_ID}(${tmp})`, `  slli ${tmp}, ${tmp}, 6`, `  lw ${rd}, ${PCORE + PC_CURP}(${tmp})`]
    : [`  lw ${rd}, ${CURP}(zero)`];
  /** The page-fault handler's scratch word `off`: in the core's block (s3 points at it) or at its fixed place. */
  const pf = (off: number): string => (smp ? `${off}(s3)` : `${PFSB + off}(zero)`);
  /** The big kernel lock taken inline (clobbers a, b, c), and given back (clobbers a): the multicore frame allocator is called with interrupts off. */
  const lockIn = (tag: string, a: string, b: string, c: string): string[] => smp ? [`  li ${a}, ${LOCK3}`, `  li ${b}, 1`, `${tag}:`, `  lw ${c}, 0(${a})`, `  bne ${c}, zero, ${tag}`, `  amoswap ${c}, ${b}, (${a})`, `  bne ${c}, zero, ${tag}`] : []; // read first: a spinner on the shared L2 port would starve the holder
  const unlockIn = (a: string): string[] => smp ? [`  li ${a}, ${LOCK3}`, `  sw zero, 0(${a})`] : [];
  const ackBits = (1 << IRQ.TIMER) | (smp ? 1 << IRQ.IPI : 0);
  const rowSave = [
    `  li t1, ${JOB_ROW_ADDR}`,
    `  addi t2, t0, ${PCB.ROW}`,
    `  addi t3, t1, ${4 * PCH_RESULT_WORDS}`,
    ...copy("ksr", "t1", "t2", "t3", "t4"),
  ];
  return [
    // ---- the timer: save the running context, then pick the next ----
    "ktimer:",
    ...(smp ? [] : [`  sw t0, ${SCR}(zero)`, `  lw t0, ${CURP}(zero)`]), // multicore: the core's own stub has saved t0 and t1 and loaded t0 with the PCB
    ...REGS.filter((r) => r !== "t0" && (!smp || r !== "t1")).map((r) => `  sw ${r}, ${roff(r)}(t0)`),
    ...(smp ? [] : [`  lw t1, ${SCR}(zero)`, `  sw t1, ${roff("t0")}(t0)`]),
    `  li t1, ${INTC_BASE}`,
    `  lw t2, ${INTC_REG.EPC}(t1)`,
    `  sw t2, ${PCB.PC}(t0)`,
    `  li t2, ${ackBits}`,
    `  sw t2, ${INTC_REG.ACK}(t1)`,
    `  lw t1, ${PCB.SLOT}(t0)`,
    "  beq t1, zero, kpick", // the kernel (and an idle core) has no output row
    ...(thr ? [`  lw t2, ${KSLOT.DEAD}(t1)`, "  bne t2, zero, kthrdead"] : []), // a thread of a job that was killed ends here
    ...rowSave,
    // falls into kpick

    // ---- kpick: run the next context after the current one that can run (single core: the kernel always can) ----
    ...(smp ? [
      // Several cores: the scan runs under the big lock. A context belongs to one core at a time (PCB.CORE, the core number + 1), so a core only takes one that is
      // free; the one that just ran is looked at last. Nothing to run (the kernel is asleep or on another core): the core idles until its timer or an IPI.
      "kpick:",
      `  li t1, ${INTC_BASE}`,
      `  lw s0, ${INTC_REG.CORE_ID}(t1)`,
      "  slli s1, s0, 6", // s1 + PCORE = this core's block
      "  call klk",
      `  lw t0, ${PCORE + PC_CURP}(s1)`,
      `  li t1, ${PCBS}`,
      "  sub t0, t0, t1",
      "  srli t0, t0, 7",
      "  li t1, 9",
      "  blt t0, t1, kpr",
      "  li t0, 8", // an idle core scans from context 0
      "  j kps",
      "kpr:", // the context that ran gives up its claim (a finished job has already)
      "  slli t2, t0, 7",
      `  li t3, ${PCBS}`,
      "  add t2, t2, t3",
      `  lw t3, ${PCB.CORE}(t2)`,
      "  addi t4, s0, 1",
      "  bne t3, t4, kps",
      `  sw zero, ${PCB.CORE}(t2)`,
      "kps:",
      `  li s2, ${thr ? 18 : 9}`, // OS 4: two rounds, the first only takes a context this core ran last (or none has run)
      "kpn:",
      "  addi t0, t0, 1",
      "  li t1, 9",
      "  bne t0, t1, kpa",
      "  li t0, 0",
      "kpa:",
      "  addi s2, s2, -1",
      "  blt s2, zero, kpnone",
      "  slli t2, t0, 7",
      `  li t1, ${PCBS}`,
      "  add t2, t2, t1", // t2 = its PCB
      `  lw t3, ${PCB.CORE}(t2)`,
      "  bne t3, zero, kpn", // another core has it
      "  li t1, 8",
      "  bne t0, t1, kpj",
      `  lw t3, ${SLEEP}(zero)`, // the kernel found nothing to do: it is skipped for a few rounds, so the programs get the processors
      "  beq t3, zero, kpgo",
      ...(thr ? ["  li t4, 9", "  bge s2, t4, kpn"] : []), // the sleep counts rounds of the scan, not passes
      "  addi t3, t3, -1",
      `  sw t3, ${SLEEP}(zero)`,
      "  j kpn",
      "kpj:",
      ...(thr ? [
        `  lw t3, ${PCB.SLOT}(t2)`, // a context belongs to a job, or is free
        "  beq t3, zero, kpn",
        `  lw t3, ${KSLOT.STATE}(t3)`,
        "  li t4, 3",
        "  bne t3, t4, kpn",
        "  li t4, 9",
        "  blt s2, t4, kpgo", // second round: any
        `  lw t3, ${PCB.LAST}(t2)`,
        "  beq t3, zero, kpgo",
        "  addi t4, s0, 1",
        "  bne t3, t4, kpn", // another core ran it last: it waits for its turn in the second round
      ] : [
        "  slli t3, t0, 6",
        `  li t1, ${KD}`,
        "  add t3, t3, t1",
        `  lw t3, ${KSLOT.STATE}(t3)`,
        "  li t4, 3",
        "  bne t3, t4, kpn",
      ]),
      "kpgo:",
      "  addi t3, s0, 1",
      `  sw t3, ${PCB.CORE}(t2)`, // claimed
      `  sw t2, ${PCORE + PC_CURP}(s1)`,
      ...(thr ? [
        "  li t4, 8",
        "  beq t0, t4, kpg2", // the kernel's context has no affinity
        `  lw t4, ${PCB.LAST}(t2)`,
        "  beq t4, zero, kpg1",
        "  beq t4, t3, kpg1",
        `  li t4, ${KMIGR}`, // a migration: another core ran it last
        "  lw a0, 0(t4)",
        "  addi a0, a0, 1",
        "  sw a0, 0(t4)",
        "kpg1:",
        `  sw t3, ${PCB.LAST}(t2)`,
        "kpg2:",
      ] : []),
      "  call kuk",
      "  mv t1, t2", // t1 = its PCB
      `  li t3, ${INTC_BASE}`,
      "  li t4, 8",
      "  bne t0, t4, kpq",
      `  sw zero, ${INTC_REG.ROW_BASE}(t3)`, // the kernel writes the status line at the top of the display
      "  j kpd",
      "kpq:",
      `  sw s0, ${INTC_REG.ROW_BASE}(t3)`, // a program's output row is its core's
      `  li t2, ${JOB_ROW_ADDR}`, // the program finds its output row as it left it
      `  addi t3, t1, ${PCB.ROW}`,
      `  addi t4, t3, ${4 * PCH_RESULT_WORDS}`,
      ...copy("ksl", "t3", "t2", "t4", "a0"),
      "kpd:",
    ] : [
      "kpick:",
      `  lw t0, ${CURP}(zero)`,
      `  li t1, ${PCBS}`,
      "  sub t0, t0, t1",
      "  srli t0, t0, 7",
      "kpn:",
      "  addi t0, t0, 1",
      "  li t1, 9",
      "  bne t0, t1, kpa",
      "  li t0, 0",
      "kpa:",
      "  li t1, 8",
      "  bne t0, t1, kpj",
      `  lw t2, ${SLEEP}(zero)`, // the kernel found nothing to do: it is skipped for a few rounds, so the programs get the processor
      "  beq t2, zero, kpgo",
      "  addi t2, t2, -1",
      `  sw t2, ${SLEEP}(zero)`,
      "  j kpn",
      "kpj:",
      "  slli t2, t0, 6",
      `  li t1, ${KD}`,
      "  add t2, t2, t1",
      `  lw t3, ${KSLOT.STATE}(t2)`,
      "  li t4, 3",
      "  bne t3, t4, kpn",
      "kpgo:",
      "  slli t1, t0, 7",
      `  li t2, ${PCBS}`,
      "  add t1, t1, t2", // t1 = its PCB
      "  li t2, 8",
      "  beq t0, t2, kpd",
      `  li t2, ${JOB_ROW_ADDR}`, // the program finds its output row as it left it
      `  addi t3, t1, ${PCB.ROW}`,
      `  addi t4, t3, ${4 * PCH_RESULT_WORDS}`,
      ...copy("ksl", "t3", "t2", "t4", "a0"),
      "kpd:",
      `  sw t1, ${CURP}(zero)`,
    ]),
    `  li t2, ${MMU_BASE}`,
    `  lw t3, ${PCB.TABLE}(t1)`,
    `  sw t3, ${MMU_REG.TABLE}(t2)`, // its address space (the TLB is emptied)
    `  li t2, ${INTC_BASE}`,
    `  lw t3, ${PCB.PC}(t1)`,
    `  sw t3, ${INTC_REG.EPC}(t2)`,
    ...REGS.filter((r) => r !== "t1").map((r) => `  lw ${r}, ${roff(r)}(t1)`),
    `  lw t1, ${roff("t1")}(t1)`,
    "  iret",

    // ---- a job finished (it jumped to the ROM done vector, which lands here) ----
    "kdone:",
    `  li t2, ${INTC_BASE}`,
    `  sw zero, ${INTC_REG.CTRL}(t2)`, // nothing interrupts the end of a job
    ...(smp ? [
      `  lw t0, ${INTC_REG.CORE_ID}(t2)`,
      "  slli t1, t0, 8",
      `  li sp, ${KSTK}`,
      "  sub sp, sp, t1", // this core's end-of-job stack
      "  slli t0, t0, 6",
      `  lw t0, ${PCORE + PC_CURP}(t0)`,
      `  li t2, ${MMU_BASE}`,
      `  li t1, ${KTBL}`,
      `  sw t1, ${MMU_REG.TABLE}(t2)`, // the kernel's address space: the job table can be written again
    ] : [
      `  li t2, ${MMU_BASE}`,
      `  li t0, ${KTBL}`,
      `  sw t0, ${MMU_REG.TABLE}(t2)`, // the kernel's address space: the job table can be written again
      `  li sp, ${KSTK}`,
      `  lw t0, ${CURP}(zero)`,
    ]),
    `  lw a0, ${PCB.SLOT}(t0)`,
    ...(thr ? [`  lw t4, ${PCB.TIDX}(t0)`, "  bne t4, zero, kdn", "  call klk", `  lw t1, ${KSLOT.DEAD}(a0)`, "  bne t1, zero, kdu"] : []), // thread 0 writes the job's result, under the lock so that a fault cannot write at the same time
    `  li t0, ${JOB_ROW_ADDR}`,
    `  addi t1, a0, ${KSLOT.RESULT}`,
    `  addi t2, t0, ${4 * PCH_RESULT_WORDS}`,
    ...copy("kres3", "t0", "t1", "t2", "t3"),
    ...(thr ? ["kdu:", "  call kuk", "kdn:"] : []),
    ...(smp ? [] : ["  li t0, 4", `  sw t0, ${KSLOT.STATE}(a0)`]), // multicore: kfinish marks the slot done once the frames are back
    "  j kfinish",

    // ---- a job touched memory it may not (or the frames ran out): it is killed, its result is the fault text ----
    "kfault:",
    ...(smp ? [
      `  li t2, ${INTC_BASE}`,
      `  lw t0, ${INTC_REG.CORE_ID}(t2)`,
      "  slli t1, t0, 8",
      `  li sp, ${KSTK}`,
      "  sub sp, sp, t1",
      ...(thr ? [] : [`  li t0, ${KFAULTS}`, "  li t1, 1", "  amoadd t2, t1, (t0)"]), // every core counts faults (OS 4: the thread that kills the job does)
    ] : [
      `  li sp, ${KSTK}`,
      `  li t0, ${KFAULTS}`,
      "  lw t1, 0(t0)",
      "  addi t1, t1, 1",
      "  sw t1, 0(t0)",
    ]),
    ...curp("t0", "t1"),
    `  lw a0, ${PCB.SLOT}(t0)`,
    ...(thr ? [
      // one thread kills the job: it marks it, counts the fault and writes the text; the contexts of the job that no core holds end here, the others at their next interrupt
      "  call klk",
      `  lw t1, ${KSLOT.DEAD}(a0)`,
      "  bne t1, zero, kfd",
      "  li t1, 1",
      `  sw t1, ${KSLOT.DEAD}(a0)`,
      `  li t1, ${KFAULTS}`,
      "  lw t2, 0(t1)",
      "  addi t2, t2, 1",
      "  sw t2, 0(t1)",
    ] : []),
    `  addi t1, a0, ${KSLOT.RESULT}`,
    `  li t3, ${0x46474553}`, // "SEGF"
    "  sw t3, 0(t1)",
    `  li t3, ${0x544c5541}`, // "AULT"
    "  sw t3, 4(t1)",
    `  addi t2, t1, ${4 * PCH_RESULT_WORDS}`,
    "  addi t1, t1, 8",
    "kfz3:",
    "  sw zero, 0(t1)",
    "  addi t1, t1, 4",
    "  bne t1, t2, kfz3",
    ...(thr ? [
      `  li t1, ${PCBS}`,
      `  li t2, ${PCBS + 8 * PCB.BYTES}`,
      "kfl1:",
      `  lw t3, ${PCB.SLOT}(t1)`,
      "  bne t3, a0, kfn",
      `  lw t4, ${PCB.CORE}(t1)`,
      "  bne t4, zero, kfn",
      `  sw zero, ${PCB.SLOT}(t1)`,
      `  lw t4, ${KSLOT.LIVE}(a0)`,
      "  addi t4, t4, -1",
      `  sw t4, ${KSLOT.LIVE}(a0)`,
      "kfn:",
      `  addi t1, t1, ${PCB.BYTES}`,
      "  bne t1, t2, kfl1",
      "kfd:",
      "  call kuk",
    ] : []),
    ...(smp ? [] : ["  li t0, 4", `  sw t0, ${KSLOT.STATE}(a0)`]),
    // falls into kfinish

    // ---- kfinish: a0 = the slot of the job that ended: give back its frames, stop the timer when nothing else runs, switch ----
    "kfinish:",
    `  sw zero, ${SLEEP}(zero)`,
    ...(thr ? [
      // OS 4: the context ends (it is free for another job); the last thread of the job gives the frames back and marks the slot done
      ...curp("t0", "t1"),
      "  call klk",
      `  sw zero, ${PCB.SLOT}(t0)`,
      `  sw zero, ${PCB.CORE}(t0)`,
      `  lw t1, ${KSLOT.LIVE}(a0)`,
      "  addi t1, t1, -1",
      `  sw t1, ${KSLOT.LIVE}(a0)`,
      "  call kuk",
      "  bne t1, zero, kpick",
      `  li t1, ${KD}`,
      "  sub t1, a0, t1",
      "  srli t1, t1, 6",
      "  addi t1, t1, 1",
      "  call kfreeown",
      "  li t0, 4",
      `  sw t0, ${KSLOT.STATE}(a0)`,
      "  j kpick",
      "kthrdead:", // a thread of a killed job found out at its interrupt: t1 = the job's slot
      "  mv a0, t1",
      "  j kfinish",
    ] : [
    `  li t1, ${KD}`,
    "  sub t1, a0, t1",
    "  srli t1, t1, 6",
    "  addi t1, t1, 1",
    "  call kfreeown",
    ...(smp ? [
      // the frames are back before the slot can be reused; the job lets go of its core's claim
      ...curp("t0", "t1"),
      `  sw zero, ${PCB.CORE}(t0)`,
      "  li t0, 4",
      `  sw t0, ${KSLOT.STATE}(a0)`,
      "  j kpick",
    ] : [
      "  call kcnt",
      "  bne a0, zero, kpick",
      `  li t2, ${TIMER_BASE}`,
      `  sw zero, ${TIMER_REG.INTERVAL}(t2)`,
      "  j kpick",
    ]),
    ]),

    // kfreeown: free every frame owned by job t1 (clobbers t2-t4)
    "kfreeown:",
    ...lockIn("kfl0", "t2", "t3", "t4"),
    `  li t2, ${FMAP_FIRST}`,
    `  li t3, ${FMAP_LAST}`,
    "kfo1:",
    "  lw t4, 0(t2)",
    "  andi t4, t4, 15",
    "  bne t4, t1, kfo2",
    "  sw zero, 0(t2)",
    "kfo2:",
    "  addi t2, t2, 4",
    "  bne t2, t3, kfo1",
    `  li t2, ${FMAP_FIRST}`,
    `  sw t2, ${HINT}(zero)`,
    ...unlockIn("t2"),
    "  ret",

    // kcnt: a0 = jobs running (clobbers t0-t3)
    "kcnt:",
    `  li t0, ${KD}`,
    `  li t1, ${TABLE_END}`,
    "  li a0, 0",
    "kc1:",
    `  lw t2, ${KSLOT.STATE}(t0)`,
    "  li t3, 3",
    "  bne t2, t3, kc2",
    "  addi a0, a0, 1",
    "kc2:",
    `  addi t0, t0, ${KSLOT_BYTES}`,
    "  bne t0, t1, kc1",
    "  ret",

    // kalloc: a0 = the owner word to write -> a0 = a free frame (now owned), or 0 (clobbers t0-t2)
    "kalloc:",
    ...lockIn("kal0", "t0", "t1", "t2"),
    `  lw t0, ${HINT}(zero)`,
    `  li t1, ${FMAP_LAST}`,
    "ka1:",
    "  lw t2, 0(t0)",
    "  beq t2, zero, ka2",
    "  addi t0, t0, 4",
    "  bne t0, t1, ka1",
    "  li a0, 0",
    ...unlockIn("t0"),
    "  ret",
    "ka2:",
    "  sw a0, 0(t0)",
    "  addi t2, t0, 4",
    `  sw t2, ${HINT}(zero)`,
    `  li t1, ${FMAP}`,
    "  sub t0, t0, t1",
    "  srli a0, t0, 2",
    ...unlockIn("t0"),
    "  ret",

    ...(thr ? [
      // kalloc_nl: the same with the big kernel lock already held (the page-fault handler holds it while it changes the page tables of a job its other threads share)
      "kalloc_nl:",
      `  lw t0, ${HINT}(zero)`,
      `  li t1, ${FMAP_LAST}`,
      "kan1:",
      "  lw t2, 0(t0)",
      "  beq t2, zero, kan2",
      "  addi t0, t0, 4",
      "  bne t0, t1, kan1",
      "  li a0, 0",
      "  ret",
      "kan2:",
      "  sw a0, 0(t0)",
      "  addi t2, t0, 4",
      `  sw t2, ${HINT}(zero)`,
      `  li t1, ${FMAP}`,
      "  sub t0, t0, t1",
      "  srli a0, t0, 2",
      "  ret",
    ] : []),

    // kidle: the kernel has nothing to do: while programs run, give the processor to them at once instead of spinning
    "kidle:",
    "  call kcnt",
    "  beq a0, zero, kloop",
    `  li t0, ${KERNEL_NAP}`,
    `  sw t0, ${SLEEP}(zero)`,
    `  li t2, ${TIMER_BASE}`,
    "  li t0, 1",
    `  sw t0, ${TIMER_REG.KICK}(t2)`,
    "  j kloop",

    // ---- kstart: a0 = the slot to run. Tables and image frames come from the frame map, the program is read in, its context is made ----
    "kstart:",
    `  sw ra, ${K}(zero)`,
    `  sw a0, ${K + 4}(zero)`,
    `  lw t0, ${KSLOT.LEN}(a0)`,
    "  slli t0, t0, 2",
    "  addi t0, t0, 255",
    "  srli t0, t0, 8", // image pages
    `  sw t0, ${K + 8}(zero)`,
    `  li t1, ${KD}`,
    "  sub t1, a0, t1",
    "  srli t1, t1, 6",
    "  addi t1, t1, 1",
    `  sw t1, ${K + 12}(zero)`, // the owner
    `  li t2, ${INTC_BASE}`,
    `  sw zero, ${INTC_REG.CTRL}(t2)`, // the frame map is taken without interruption (a page fault would take frames too)
    "  li s2, 0",
    "kst_t:",
    `  lw a0, ${K + 12}(zero)`,
    "  addi a0, a0, 32",
    "  call kalloc",
    "  beq a0, zero, kst_fail",
    "  slli t0, s2, 2",
    `  sw a0, ${K + 16}(t0)`,
    "  addi s2, s2, 1",
    "  li t0, 4",
    "  bne s2, t0, kst_t",
    "  li s2, 0",
    "kst_z:",
    "  slli t0, s2, 2",
    `  lw t0, ${K + 16}(t0)`,
    "  slli t0, t0, 8",
    "  addi t1, t0, 256",
    "kst_zz:",
    "  sw zero, 0(t0)",
    "  addi t0, t0, 4",
    "  bne t0, t1, kst_zz",
    "  addi s2, s2, 1",
    "  li t0, 4",
    "  bne s2, t0, kst_z",
    "  li s2, 0",
    "kst_i:",
    `  lw t0, ${K + 8}(zero)`,
    "  beq s2, t0, kst_id",
    `  lw a0, ${K + 12}(zero)`,
    "  call kalloc",
    "  beq a0, zero, kst_fail",
    "  slli t0, a0, 8",
    "  addi t0, t0, 7", // the image: read, write, run
    `  lw t1, ${K + 20}(zero)`,
    "  slli t1, t1, 8",
    "  addi t2, s2, 16",
    "  slli t2, t2, 2",
    "  add t1, t1, t2",
    "  sw t0, 0(t1)",
    "  addi s2, s2, 1",
    "  j kst_i",
    "kst_fail:", // not enough frames: give back what was taken, the job stays queued
    `  lw t1, ${K + 12}(zero)`,
    "  call kfreeown",
    `  li t2, ${INTC_BASE}`,
    "  li t0, 1",
    `  sw t0, ${INTC_REG.CTRL}(t2)`,
    `  lw ra, ${K}(zero)`,
    "  ret",
    "kst_id:",
    // the first-level table: the ROM and image, the heap, and the OS with the stack
    `  lw t0, ${K + 16}(zero)`,
    "  slli t0, t0, 8",
    ...([[0, 20], [4, 24], [12, 28]] as [number, number][]).flatMap(([entry, k]) => [`  lw t1, ${K + k}(zero)`, "  slli t1, t1, 8", "  addi t1, t1, 1", `  sw t1, ${entry}(t0)`]),
    `  lw t0, ${K + 20}(zero)`,
    "  slli t0, t0, 8",
    "  li t1, 5",
    "  addi t2, t0, 64",
    "kst_r:", // the ROM: read, run
    "  sw t1, 0(t0)",
    "  addi t0, t0, 4",
    "  addi t1, t1, 256",
    "  bne t0, t2, kst_r",
    `  lw t0, ${K + 28}(zero)`,
    "  slli t0, t0, 8",
    `  li t1, ${192 * 256 + 5}`,
    `  addi t2, t0, ${4 * ((kendPage >> 8) - 192)}`,
    "kst_o:", // the OS: read, run
    "  sw t1, 0(t0)",
    "  addi t0, t0, 4",
    "  addi t1, t1, 256",
    "  bne t0, t2, kst_o",
    `  li t2, ${INTC_BASE}`,
    "  li t0, 1",
    `  sw t0, ${INTC_REG.CTRL}(t2)`, // reading from the drive may be interrupted
    "  li s2, 0",
    "kst_l:", // read the image from the spool, page by page, into its frames
    `  lw t1, ${K + 20}(zero)`,
    "  slli t1, t1, 8",
    "  addi t2, s2, 16",
    "  slli t2, t2, 2",
    "  add t1, t1, t2",
    "  lw a2, 0(t1)",
    "  srli a2, a2, 8",
    "  slli a2, a2, 8",
    `  lw t0, ${K + 4}(zero)`,
    `  lw a1, ${KSLOT.LBA}(t0)`,
    "  add a1, a1, s2",
    "  mv a0, s1",
    "  call blk_read",
    "  addi s2, s2, 1",
    `  lw t0, ${K + 8}(zero)`,
    "  bne s2, t0, kst_l",
    // its context(s)
    ...(thr ? [
      // T from the program's first word (the nop addi zero, zero, T), one context per thread: free ones, all sharing the address space
      `  lw t1, ${K + 20}(zero)`,
      "  slli t1, t1, 8",
      "  addi t1, t1, 64",
      "  lw t1, 0(t1)",
      "  srli t1, t1, 8",
      "  slli t1, t1, 8",
      "  lw t1, 0(t1)",
      "  andi t2, t1, 32767",
      `  li t3, ${ADDI_OP}`,
      "  li s2, 1",
      "  bne t2, t3, kst_t1",
      "  srli t2, t1, 15",
      "  beq t2, zero, kst_t1",
      `  li t3, ${MAX_THREADS_PER_JOB + 1}`,
      "  bge t2, t3, kst_t1",
      "  mv s2, t2",
      "kst_t1:",
      `  sw s2, ${K + 32}(zero)`,
      "  li t0, 0",
      `  li t1, ${PCBS}`,
      `  li t4, ${PCBS + 8 * PCB.BYTES}`,
      "kst_cf:",
      `  lw t2, ${PCB.SLOT}(t1)`,
      "  bne t2, zero, kst_cn",
      `  lw t2, ${PCB.CORE}(t1)`,
      "  bne t2, zero, kst_cn",
      "  addi t0, t0, 1",
      "kst_cn:",
      `  addi t1, t1, ${PCB.BYTES}`,
      "  bne t1, t4, kst_cf",
      "  blt t0, s2, kst_fail", // not enough free contexts: the job waits
      `  lw t0, ${K + 4}(zero)`,
      `  sw s2, ${KSLOT.THREADS}(t0)`,
      `  sw s2, ${KSLOT.LIVE}(t0)`,
      `  sw zero, ${KSLOT.DEAD}(t0)`,
      `  li t1, ${PCBS}`,
      `  sw t1, ${K + 36}(zero)`,
      "  li s2, 0",
      "kst_c:",
      `  lw t1, ${K + 36}(zero)`,
      "kst_cf2:",
      `  lw t2, ${PCB.SLOT}(t1)`,
      "  bne t2, zero, kst_cx",
      `  lw t2, ${PCB.CORE}(t1)`,
      "  beq t2, zero, kst_cok",
      "kst_cx:",
      `  addi t1, t1, ${PCB.BYTES}`,
      "  j kst_cf2",
      "kst_cok:",
      `  addi t2, t1, ${PCB.BYTES}`,
      `  sw t2, ${K + 36}(zero)`,
      "  mv t2, t1",
      `  addi t3, t1, ${PCB.BYTES}`,
      "kst_pz:",
      "  sw zero, 0(t2)",
      "  addi t2, t2, 4",
      "  bne t2, t3, kst_pz",
      "  li t2, 65536",
      "  beq s2, zero, kst_s0",
      "  slli t2, s2, 12",
      "  li t3, 524288",
      "  add t2, t2, t3", // thread k > 0: its stack is above the heap, 0x80000 + k x 4K (threadStackTop)
      "kst_s0:",
      `  sw t2, ${roff("sp")}(t1)`,
      `  sw s2, ${PCB.TIDX}(t1)`,
      `  sw s2, ${roff("a0")}(t1)`,
      `  lw t2, ${K + 32}(zero)`,
      `  sw t2, ${roff("a1")}(t1)`,
      `  li t2, ${USER_BASE}`,
      `  sw t2, ${PCB.PC}(t1)`,
      `  lw t2, ${K + 16}(zero)`,
      "  slli t2, t2, 8",
      `  sw t2, ${PCB.TABLE}(t1)`,
      `  lw t2, ${K + 20}(zero)`,
      `  sw t2, ${PCB.L2_IMAGE}(t1)`,
      `  lw t2, ${K + 24}(zero)`,
      `  sw t2, ${PCB.L2_HEAP}(t1)`,
      `  lw t2, ${K + 28}(zero)`,
      `  sw t2, ${PCB.L2_STACK}(t1)`,
      `  lw t0, ${K + 4}(zero)`,
      `  sw t0, ${PCB.SLOT}(t1)`, // last: now the scheduler may take it
      "  addi s2, s2, 1",
      `  lw t2, ${K + 32}(zero)`,
      "  bne s2, t2, kst_c",
    ] : [
    `  lw t0, ${K + 4}(zero)`,
    `  li t1, ${KD}`,
    "  sub t1, t0, t1",
    "  slli t1, t1, 1",
    `  li t2, ${PCBS}`,
    "  add t1, t1, t2",
    "  mv t2, t1",
    `  addi t3, t1, ${PCB.BYTES}`,
    "kst_p:",
    "  sw zero, 0(t2)",
    "  addi t2, t2, 4",
    "  bne t2, t3, kst_p",
    "  li t2, 65536",
    `  sw t2, ${roff("sp")}(t1)`,
    `  li t2, ${USER_BASE}`,
    `  sw t2, ${PCB.PC}(t1)`,
    `  lw t2, ${K + 16}(zero)`,
    "  slli t2, t2, 8",
    `  sw t2, ${PCB.TABLE}(t1)`,
    `  lw t2, ${K + 20}(zero)`,
    `  sw t2, ${PCB.L2_IMAGE}(t1)`,
    `  lw t2, ${K + 24}(zero)`,
    `  sw t2, ${PCB.L2_HEAP}(t1)`,
    `  lw t2, ${K + 28}(zero)`,
    `  sw t2, ${PCB.L2_STACK}(t1)`,
    `  sw t0, ${PCB.SLOT}(t1)`,
    ]),
    `  li t2, ${PchPhase.OsRun}`,
    `  sw t2, ${PCH_REG.PHASE}(s0)`,
    `  li a3, ${DISPLAY_BASE}`,
    ...status("RUNNING JOB", "a3"),
    `  lw t0, ${K + 4}(zero)`, // the status text used t0
    "  li t2, 3",
    `  sw t2, ${KSLOT.STATE}(t0)`, // it can run now
    `  li t2, ${TIMER_BASE}`,
    `  li t3, ${SLICE_CYCLES}`,
    `  sw t3, ${TIMER_REG.INTERVAL}(t2)`,
    ...(smp ? [
      // wake the other cores: the job is theirs to run too
      `  li t2, ${INTC_BASE}`,
      `  lw t3, ${INTC_REG.CORES}(t2)`,
      "  li t4, 1",
      "  sll t4, t4, t3",
      "  addi t4, t4, -1",
      `  lw t3, ${INTC_REG.CORE_ID}(t2)`,
      "  li t0, 1",
      "  sll t0, t0, t3",
      "  sub t4, t4, t0", // every core but this one
      `  sw t4, ${INTC_REG.IPI}(t2)`,
    ] : []),
    `  lw ra, ${K}(zero)`,
    "  ret",

    // ---- kpf: a program touched a page that is not mapped: a frame for its heap, its big heap or its stack (and a level 2 table when that part of its space has none), or the end of the program ----
    ...(smp ? [
      "kpf:", // t0 = this core's block (the stub saved t0 in it); s3 keeps pointing at it
      `  sw s3, ${PC_S3}(t0)`,
      "  mv s3, t0",
      ...["ra", "a0", "t1", "t2", "t3", "t4"].map((r) => `  sw ${r}, ${4 * ["ra", "a0", "t0", "t1", "t2", "t3", "t4"].indexOf(r)}(s3)`),
    ] : [
      "kpf:",
      ...["ra", "a0", "t0", "t1", "t2", "t3", "t4"].map((r, i) => `  sw ${r}, ${PFSB + 4 * i}(zero)`),
    ]),
    `  li t0, ${MMU_BASE}`,
    `  lw t1, ${MMU_REG.FAULT_CAUSE}(t0)`,
    "  li t2, 1",
    "  bne t1, t2, kpkill",
    `  lw t1, ${MMU_REG.FAULT_ADDR}(t0)`,
    "  srli t1, t1, 8",
    "  li t2, 64",
    "  blt t1, t2, kpkill",
    "  li t2, 128",
    "  blt t1, t2, kpok", // 0x40..0x7f: the heap
    "  li t2, 240",
    "  blt t1, t2, kpkill",
    "  li t2, 256",
    "  blt t1, t2, kpok", // 0xf0..0xff: the stack
    `  li t2, ${MAX_FRAMES}`,
    "  bge t1, t2, kpkill", // 0x100..0xfff: the big heap (virtual 0x10000 up)
    "kpok:",
    ...(thr ? lockIn("kpl0", "t0", "t2", "t3") : []), // OS 4: the threads of a job share its page tables, so one at a time
    `  sw t1, ${pf(32)}`,
    ...curp("t0", "t3"),
    `  lw t3, ${PCB.SLOT}(t0)`,
    `  li t2, ${KD}`,
    "  sub t3, t3, t2",
    "  srli t3, t3, 6",
    `  sw t3, ${pf(28)}`, // the slot
    `  lw t4, ${PCB.TABLE}(t0)`,
    "  srli t2, t1, 6",
    "  slli t2, t2, 2",
    "  add t4, t4, t2", // this page's entry in the level 1 table
    `  sw t4, ${pf(36)}`,
    "  lw t2, 0(t4)",
    "  andi t2, t2, 1",
    "  bne t2, zero, kphave",
    "  addi a0, t3, 33", // a level 2 table: owner id, kind 2
    thr ? "  call kalloc_nl" : "  call kalloc",
    thr ? "  beq a0, zero, kpku" : "  beq a0, zero, kpkill",
    "  slli t3, a0, 8",
    "  addi t4, t3, 256",
    "kpz4:",
    "  sw zero, 0(t3)",
    "  addi t3, t3, 4",
    "  bne t3, t4, kpz4",
    `  lw t0, ${pf(36)}`,
    "  slli t3, a0, 8",
    "  addi t3, t3, 1",
    "  sw t3, 0(t0)",
    "kphave:",
    `  lw t0, ${pf(36)}`,
    "  lw t0, 0(t0)",
    "  srli t0, t0, 8",
    "  slli t0, t0, 8",
    `  lw t1, ${pf(32)}`,
    "  andi t1, t1, 63",
    "  slli t1, t1, 2",
    "  add t0, t0, t1", // the page's entry in its level 2 table
    `  sw t0, ${pf(40)}`,
    ...(thr ? ["  lw t3, 0(t0)", "  andi t3, t3, 1", "  bne t3, zero, kpout"] : []), // another thread mapped this page while this one waited for the lock
    `  lw t3, ${pf(28)}`,
    "  addi a0, t3, 17", // the page itself: owner id, kind 1: the program's own memory
    thr ? "  call kalloc_nl" : "  call kalloc",
    thr ? "  beq a0, zero, kpku" : "  beq a0, zero, kpkill",
    "  slli t3, a0, 8",
    "  addi t4, t3, 256",
    "kpz3:",
    "  sw zero, 0(t3)",
    "  addi t3, t3, 4",
    "  bne t3, t4, kpz3",
    `  lw t0, ${pf(40)}`,
    "  slli t3, a0, 8",
    "  addi t3, t3, 3", // the frame, valid and writable
    "  sw t3, 0(t0)",
    ...(thr ? ["kpout:", ...unlockIn("t0")] : []),
    ...(smp ? [
      ...["ra", "a0", "t0", "t1", "t2", "t3", "t4"].map((r, i) => `  lw ${r}, ${4 * i}(s3)`),
      `  lw s3, ${PC_S3}(s3)`,
    ] : ["ra", "a0", "t0", "t1", "t2", "t3", "t4"].map((r, i) => `  lw ${r}, ${PFSB + 4 * i}(zero)`)),
    "  iret",
    "kpkill:",
    "  j kfault",
    ...(thr ? ["kpku:", ...unlockIn("t0"), "  j kfault"] : []),
    ...(smp ? secondary3() : []),
  ];
}

/**
 * The multicore OS 3 (docs/OS.md "Preemption on every core"): what the other logical cores run. Each core has its own timer, vectors and block of scratch words (`PCORE`);
 * the entry stubs below load the block's addresses, because an interrupt handler has no register to spare. A core without a context to run sits in `kidlec` parked and wakes
 * for its timer or an IPI to look again.
 */
function secondary3(): string[] {
  const ack = (1 << IRQ.TIMER) | (1 << IRQ.IPI);
  const stubs: string[] = [];
  for (let c = 0; c < MAX_LCORES; c++) {
    const blk = PCORE + c * PCORE_BYTES;
    stubs.push(
      `ktimer_c${c}:`, // save t0 and t1 in the running context's PCB, then the common handler
      `  sw t0, ${blk + PC_SCR}(zero)`,
      `  lw t0, ${blk + PC_CURP}(zero)`,
      `  sw t1, ${roff("t1")}(t0)`,
      `  lw t1, ${blk + PC_SCR}(zero)`,
      `  sw t1, ${roff("t0")}(t0)`,
      "  j ktimer",
      `kpf_c${c}:`, // the page-fault handler's block starts with the registers it borrows (t0 is the third)
      `  sw t0, ${blk + 8}(zero)`,
      `  li t0, ${blk}`,
      "  j kpf",
    );
  }
  return [
    // the big kernel lock for the scheduler: klk clobbers t1-t3, kuk t4
    "klk:",
    `  li t1, ${LOCK3}`,
    "  li t2, 1",
    "klks:",
    "  lw t3, 0(t1)", // read first: spinning with amoswap would flood the shared L2 port and starve the holder
    "  bne t3, zero, klks",
    "  amoswap t3, t2, (t1)",
    "  bne t3, zero, klks",
    "  ret",
    "kuk:",
    `  li t4, ${LOCK3}`,
    "  sw zero, 0(t4)",
    "  ret",
    // no context to run: back to the idle loop of this core
    "kpnone:",
    "  call kuk",
    `  slli t0, s0, 7`,
    `  addi t0, t0, ${IDLEP}`,
    `  sw t0, ${PCORE + PC_CURP}(s1)`,
    `  li t2, ${MMU_BASE}`,
    `  li t0, ${KTBL}`,
    `  sw t0, ${MMU_REG.TABLE}(t2)`,
    "  slli t0, s0, 8",
    `  li sp, ${KSTK}`,
    "  sub sp, sp, t0",
    `  li t2, ${INTC_BASE}`,
    "  la t0, kidlec",
    `  sw t0, ${INTC_REG.EPC}(t2)`,
    "  iret",
    // a woken core: its vectors, row, timer and translation (the kernel's own address space), then idle
    "k3entry:",
    `  li t1, ${INTC_BASE}`,
    `  lw s0, ${INTC_REG.CORE_ID}(t1)`,
    "  slli t0, s0, 8",
    `  li sp, ${KSTK}`,
    "  sub sp, sp, t0",
    `  sw s0, ${INTC_REG.ROW_BASE}(t1)`,
    "  slli t0, s0, 2",
    `  addi t2, t0, ${KERNEL_TVEC}`,
    `  sw t2, ${INTC_REG.VECTOR}(t1)`,
    `  li t3, ${MMU_BASE}`,
    `  addi t2, t0, ${KERNEL_PVEC}`,
    `  sw t2, ${MMU_REG.VECTOR}(t3)`,
    `  li t2, ${ack}`,
    `  sw t2, ${INTC_REG.MASK}(t1)`,
    "  slli t2, s0, 6",
    "  slli t0, s0, 7",
    `  addi t0, t0, ${IDLEP}`,
    `  sw t0, ${PCORE + PC_CURP}(t2)`,
    `  li t2, ${TIMER_BASE}`,
    `  li t0, ${SLICE_CYCLES}`,
    `  sw t0, ${TIMER_REG.INTERVAL}(t2)`,
    `  li t0, ${KTBL}`,
    `  sw t0, ${MMU_REG.TABLE}(t3)`,
    "  li t0, 1",
    `  sw t0, ${MMU_REG.CONTROL}(t3)`,
    `  li t0, ${1 << IRQ.IPI}`,
    `  sw t0, ${INTC_REG.ACK}(t1)`,
    "  li t0, 1",
    `  sw t0, ${INTC_REG.CTRL}(t1)`,
    "kidlec:",
    `  li t2, ${INTC_BASE}`,
    "  li t0, 1",
    `  sw t0, ${INTC_REG.PARK}(t2)`,
    "  j kidlec",
    ...stubs,
  ];
}

/**
 * OS 2's frame allocator, inline (the page-fault handler has no stack to call from): takes the next frame from the bump pointer into t2, zeroes it, and ends the
 * program (kpkill) when the frames are used up. The pointer skips from the tables' frames (0xb0) to 0x100, the first frame above the OS. On the multicore image it
 * also skips core 1's arena (frames 0x100 up to `ARENA_END`, a word that is 0 when there is no second core).
 */
function bump2(tag: string, smp = false): string[] {
  return [
    `  li t3, ${BUMP}`,
    "  lw t2, 0(t3)",
    `  li t4, ${PAGED_TABLES >> 8}`,
    `  blt t2, t4, kb1${tag}`,
    "  li t4, 256",
    `  bge t2, t4, kb1${tag}`,
    "  mv t2, t4",
    `kb1${tag}:`,
    ...(smp ? [
      `  lw t4, ${ARENA_END}(zero)`,
      `  bge t2, t4, kb3${tag}`,
      "  li t4, 256",
      `  blt t2, t4, kb3${tag}`,
      `  lw t2, ${ARENA_END}(zero)`,
      `kb3${tag}:`,
    ] : []),
    `  lw t4, ${NFRAMES}(zero)`,
    "  bge t2, t4, kpkill",
    "  addi t4, t2, 1",
    "  sw t4, 0(t3)",
    "  slli t3, t2, 8",
    "  addi t4, t3, 256",
    `kb2${tag}:`,
    "  sw zero, 0(t3)",
    "  addi t3, t3, 4",
    `  bne t3, t4, kb2${tag}`,
  ];
}

/** Core 1's frame allocator: the next frame of its arena into t2, zeroed; the program is ended (kpkill) when the arena is used up. */
function bump1(tag: string): string[] {
  return [
    `  li t3, ${BUMP1}`,
    "  lw t2, 0(t3)",
    `  li t4, ${ARENA1_END}`,
    "  bge t2, t4, kpkill",
    "  addi t4, t2, 1",
    "  sw t4, 0(t3)",
    "  slli t3, t2, 8",
    "  addi t4, t3, 256",
    `kb2${tag}:`,
    "  sw zero, 0(t3)",
    "  addi t3, t3, 4",
    `  bne t3, t4, kb2${tag}`,
  ];
}

/** The tables of a job just loaded: level 1 at `tbl` with its three level 2 tables, the ROM identity, the image at virtual + `shift`, the OS identity up to `kendPage`, and the frame pointer at `bumpAt` set to `bumpFrom`. `cur` holds the job's slot. Labels get `tag`. */
function mapTables(tag: string, tbl: number, shift: number, cur: number, bumpAt: number, bumpFrom: number, kendPage: number): string[] {
  return [
    `  li t0, ${tbl}`,
    `  li t1, ${tbl + PAGED_TABLES_BYTES}`,
    `kmz${tag}:`,
    "  sw zero, 0(t0)",
    "  addi t0, t0, 4",
    `  bne t0, t1, kmz${tag}`,
    `  li t0, ${tbl}`,
    `  li t1, ${tbl + 0x100 + 1}`,
    "  sw t1, 0(t0)", // level 1 entry 0: virtual 0x0000..0x3fff
    `  li t1, ${tbl + 0x200 + 1}`,
    "  sw t1, 4(t0)", // entry 1: 0x4000..0x7fff, the heap
    `  li t1, ${tbl + 0x300 + 1}`,
    "  sw t1, 12(t0)", // entry 3: 0xc000..0xffff, the OS and the stack
    `  li t0, ${tbl + 0x100}`,
    "  li t1, 0",
    `  li t2, ${USER_BASE}`,
    `kmr${tag}:`, // the ROM: identity, read and run
    "  addi t3, t1, 5",
    "  sw t3, 0(t0)",
    "  addi t0, t0, 4",
    "  addi t1, t1, 256",
    `  bne t1, t2, kmr${tag}`,
    `  li t4, ${cur}`,
    "  lw t4, 0(t4)",
    `  lw t4, ${KSLOT.LEN}(t4)`,
    "  slli t4, t4, 2",
    "  addi t4, t4, 255",
    "  srli t4, t4, 8", // the program's pages
    `kmi${tag}:`, // its image: read, write, run
    ...(shift + 7 < 65536 ? [`  addi t3, t1, ${shift + 7}`] : [`  li t3, ${shift + 7}`, "  add t3, t3, t1"]), // the immediate of addi is 17 bits
    "  sw t3, 0(t0)",
    "  addi t0, t0, 4",
    "  addi t1, t1, 256",
    "  addi t4, t4, -1",
    `  bne t4, zero, kmi${tag}`,
    `  li t0, ${tbl + 0x300}`,
    "  li t1, 49152",
    `  li t2, ${kendPage}`,
    `kmk${tag}:`, // the OS: identity, read and run
    "  addi t3, t1, 5",
    "  sw t3, 0(t0)",
    "  addi t0, t0, 4",
    "  addi t1, t1, 256",
    `  bne t1, t2, kmk${tag}`,
    `  li t0, ${bumpAt}`,
    `  li t1, ${bumpFrom}`,
    "  sw t1, 0(t0)", // the first frame for the program's own memory
  ];
}

/** The page-fault handler of a core: tables at `tbl`, scratch words at `pfs`, `bump(tag)` the frame allocator (frame into t2). The handler for core 0 is `kpf`, for core 1 `kpf1`. */
function pageFault(tag: string, tbl: number, pfs: number, bump: (t: string) => string[]): string[] {
  return [
    `kpf${tag}:`,
    `  sw t0, ${pfs}(zero)`,
    `  sw t1, ${pfs + 4}(zero)`,
    `  sw t2, ${pfs + 8}(zero)`,
    `  sw t3, ${pfs + 12}(zero)`,
    `  sw t4, ${pfs + 16}(zero)`,
    `  li t0, ${MMU_BASE}`,
    `  lw t1, ${MMU_REG.FAULT_CAUSE}(t0)`,
    "  li t2, 1",
    "  bne t1, t2, kpkill", // only a missing page can be fixed
    `  lw t1, ${MMU_REG.FAULT_ADDR}(t0)`,
    "  srli t1, t1, 8", // the page number
    "  li t2, 64",
    "  blt t1, t2, kpkill",
    "  li t2, 128",
    `  blt t1, t2, kpok${tag}`, // 0x40..0x7f: the heap
    "  li t2, 240",
    "  blt t1, t2, kpkill",
    "  li t2, 256",
    `  blt t1, t2, kpok${tag}`, // 0xf0..0xff: the stack
    `  li t2, ${MAX_FRAMES}`,
    "  bge t1, t2, kpkill", // 0x100..0xfff: the big heap
    `kpok${tag}:`,
    `  li t0, ${tbl}`,
    "  srli t2, t1, 6",
    "  slli t2, t2, 2",
    "  add t0, t0, t2", // this page's entry in the level 1 table
    "  lw t2, 0(t0)",
    "  andi t2, t2, 1",
    `  bne t2, zero, kphave${tag}`,
    ...bump(`a${tag}`), // a frame for the level 2 table, in t2
    "  slli t3, t2, 8",
    "  addi t4, t3, 1",
    "  sw t4, 0(t0)",
    `kphave${tag}:`,
    "  lw t0, 0(t0)",
    "  srli t0, t0, 8",
    "  slli t0, t0, 8",
    "  andi t2, t1, 63",
    "  slli t2, t2, 2",
    "  add t0, t0, t2", // the page's entry in its level 2 table
    ...bump(`b${tag}`), // the page's frame, in t2
    "  slli t3, t2, 8",
    "  addi t3, t3, 3", // the frame, valid and writable
    "  sw t3, 0(t0)",
    `  lw t0, ${pfs}(zero)`,
    `  lw t1, ${pfs + 4}(zero)`,
    `  lw t2, ${pfs + 8}(zero)`,
    `  lw t3, ${pfs + 12}(zero)`,
    `  lw t4, ${pfs + 16}(zero)`,
    "  iret",
  ];
}

/**
 * Core 1 of the multicore OS 2. Core 0 (`kdispatch`) loads a job from the spool into core 1's arena, builds its tables (`kmap1`), writes the mailbox and sends an IPI;
 * core 1 wakes in `k2entry`, turns its translation on and runs the job. The job ends in `kdone`/`kfault`, which branch to `kdone1`/`kfault1` on core 1: they store the
 * result under the big lock and park the core again (`k2idle`: acknowledge, look in the mailbox, park). Core 1 never touches a drive or the display's status line.
 */
function secondary(kendPage: number): string[] {
  const rowAddr = DISPLAY_BASE + (JOB_ROW + 1) * ROW, ownRow = DISPLAY_BASE + JOB_ROW * ROW; // core 1's output row; core 1 itself reaches it as JOB_ROW (its row base is 1)
  return [
    "kmap1:",
    ...mapTables("1", ARENA1, ARENA1_SHIFT, CUR1, BUMP1, ARENA1_HEAP, kendPage),
    "  ret",
    ...pageFault("1", ARENA1, PFS1, bump1),

    // ---- kdispatch: core 0 hands the job in slot a0 to core 1 ----
    "kdispatch:",
    `  li t0, ${PchPhase.OsRun}`,
    `  sw t0, ${PCH_REG.PHASE}(s0)`,
    "  li t0, 3",
    `  sw t0, ${KSLOT.STATE}(a0)`,
    `  li t0, ${CUR1}`,
    "  sw a0, 0(t0)",
    `  li a3, ${DISPLAY_BASE}`,
    ...status("RUNNING JOB", "a3"),
    `  li t0, ${rowAddr}`, // clear core 1's output row
    `  addi t1, t0, ${ROW}`,
    "kclr1:",
    "  sw zero, 0(t0)",
    "  addi t0, t0, 4",
    "  bne t0, t1, kclr1",
    `  lw s2, ${KSLOT.LEN}(a0)`,
    `  lw a1, ${KSLOT.LBA}(a0)`,
    "  slli s2, s2, 2",
    `  addi s2, s2, ${BLOCK_BYTES - 1}`,
    "  srli s2, s2, 8",
    `  li a2, ${USER_BASE + ARENA1_SHIFT}`, // the program is loaded where core 1's table will map it
    "kload1:",
    "  mv a0, s1",
    "  call blk_read",
    "  addi a1, a1, 1",
    `  addi a2, a2, ${BLOCK_BYTES}`,
    "  addi s2, s2, -1",
    "  bne s2, zero, kload1",
    "  call kmap1",
    "  li t0, 1",
    `  sw t0, ${C1BUSY}(zero)`,
    `  lw t1, ${CUR1}(zero)`,
    `  sw t1, ${MBOX}(zero)`,
    `  li t0, ${INTC_BASE}`,
    "  li t1, 2", // core 1
    `  sw t1, ${INTC_REG.IPI}(t0)`,
    "  j kloop",

    // ---- the big kernel lock: spin on amoswap (clobbers t0-t2) ----
    "klock:",
    `  li t0, ${LOCK}`,
    "  li t1, 1",
    "kls:",
    "  amoswap t2, t1, (t0)",
    "  bne t2, zero, kls",
    "  ret",
    "kunlock:",
    `  li t0, ${LOCK}`,
    "  sw zero, 0(t0)",
    "  ret",

    // ---- core 1: woken by the first IPI (its vector), or by the park instruction returning ----
    "k2entry:",
    `  li sp, ${KSTK1}`,
    `  li s0, ${PCH_BASE}`,
    `  li t2, ${MMU_BASE}`,
    `  li t0, ${KERNEL_PAGEFAULT1}`,
    `  sw t0, ${MMU_REG.VECTOR}(t2)`,
    `  li t2, ${INTC_BASE}`,
    "  li t0, 1",
    `  sw t0, ${INTC_REG.ROW_BASE}(t2)`,
    "k2idle:",
    `  li t2, ${INTC_BASE}`,
    `  li t0, ${1 << IRQ.IPI}`,
    `  sw t0, ${INTC_REG.ACK}(t2)`,
    `  lw t1, ${MBOX}(zero)`,
    "  bne t1, zero, k2run",
    "  li t0, 1",
    `  sw t0, ${INTC_REG.PARK}(t2)`,
    "  j k2idle",
    "k2run:",
    `  sw zero, ${MBOX}(zero)`,
    `  li t2, ${MMU_BASE}`,
    `  li t0, ${ARENA1}`,
    `  sw t0, ${MMU_REG.TABLE}(t2)`,
    "  li t0, 1",
    `  sw t0, ${MMU_REG.CONTROL}(t2)`,
    "  li sp, 65536",
    `  li t0, ${USER_BASE}`,
    "  jalr ra, t0, 0", // the job ends at the ROM done vector, which lands in kdone

    // ---- core 1's job finished: keep its output row as the result ----
    "kdone1:",
    `  li t2, ${MMU_BASE}`,
    `  sw zero, ${MMU_REG.CONTROL}(t2)`,
    `  li sp, ${KSTK1}`,
    `  li s0, ${PCH_BASE}`,
    `  lw a0, ${CUR1}(zero)`,
    `  li t0, ${ownRow}`,
    `  addi t1, a0, ${KSLOT.RESULT}`,
    `  addi t2, t0, ${PCH_RESULT_WORDS * 4}`,
    "kres1:",
    "  lw t3, 0(t0)",
    "  sw t3, 0(t1)",
    "  addi t0, t0, 4",
    "  addi t1, t1, 4",
    "  bne t0, t2, kres1",
    "  j kend1",

    // ---- core 1's job touched what it may not ----
    "kfault1:",
    `  li t2, ${MMU_BASE}`,
    `  sw zero, ${MMU_REG.CONTROL}(t2)`,
    `  li sp, ${KSTK1}`,
    `  li s0, ${PCH_BASE}`,
    `  li t0, ${KFAULTS}`,
    "  li t1, 1",
    "  amoadd t2, t1, (t0)",
    `  lw a0, ${CUR1}(zero)`,
    `  addi t1, a0, ${KSLOT.RESULT}`,
    `  li t3, ${0x46474553}`, // "SEGF"
    "  sw t3, 0(t1)",
    `  li t3, ${0x544c5541}`, // "AULT"
    "  sw t3, 4(t1)",
    `  addi t2, t1, ${PCH_RESULT_WORDS * 4}`,
    "  addi t1, t1, 8",
    "kfz1:",
    "  sw zero, 0(t1)",
    "  addi t1, t1, 4",
    "  bne t1, t2, kfz1",
    // falls into kend1
    "kend1:",
    "  call klock",
    "  li t0, 4",
    `  sw t0, ${KSLOT.STATE}(a0)`,
    `  sw zero, ${C1BUSY}(zero)`,
    "  call kunlock",
    "  j k2idle",
  ];
}

/** The kernel's source: `paged` is OS 2, which gives each program an address space (docs/VM.md) instead of guarding the OS with the memory protection unit. */
export function kernelSource(paged: boolean, pre = false, smp = false, thr = false): string {
  const TBL = PAGED_TABLES, KEND = pre ? (smp ? KDATA_END_PRE_SMP : KDATA_END_PRE) : smp ? KDATA_END_SMP : KDATA_END, KEND_PAGE = (KEND + 255) & ~255;
  const smp2 = smp && !pre; // core 1 of the multicore OS 2
  return [
  pre ? (thr ? "# OS v4 kernel (preemptive on every core, threaded jobs)" : smp ? "# OS v3 kernel (preemptive on every core)" : "# OS v3 kernel (preemptive: several programs, each in its own address space)") : smp ? "# OS v2 kernel (paged, two cores: one program per core)" : paged ? "# OS v2 kernel (paged: one address space per program)" : "# OS v1 kernel (single-task resident)",
  "k_entry:",
  "  j kmain",
  "k_done_vec:", // KERNEL_DONE = KERNEL_BASE + 4: the ROM epilogue lands here when a job ends
  "  j kdone",
  "k_fault_vec:", // KERNEL_FAULT = KERNEL_BASE + 8: the CPU is sent here when a job wrote to protected memory
  "  j kfault",
  "k_pf_vec:", // KERNEL_PAGEFAULT = KERNEL_BASE + 12: the MMU sends the CPU here on a page fault
  smp && pre ? "  j kpf_c0" : "  j kpf",
  ...(pre ? ["k_timer_vec:", smp ? "  j ktimer_c0" : "  j ktimer"] : []), // KERNEL_TIMER = KERNEL_BASE + 16
  ...(smp2 ? ["k_spare_vec:", "  j kfault", "k_sec_vec:", "  j k2entry", "k_pf1_vec:", "  j kpf1"] : []), // + 16 unused, KERNEL_SECONDARY = + 20, KERNEL_PAGEFAULT1 = + 24
  ...(smp && pre ? ["k_sec_vec:", "  j k3entry", "k_spare_vec:", "  j kfault", ...Array.from({ length: KERNEL_VEC_CORES }, (_, c) => [`k_tvec${c}:`, `  j ktimer_c${c}`]).flat(), ...Array.from({ length: KERNEL_VEC_CORES }, (_, c) => [`k_pvec${c}:`, `  j kpf_c${c}`]).flat()] : []), // KERNEL_SECONDARY = + 20, then each core's timer and page-fault entries
  "kmain:",
  "  li sp, 65536",
  `  li s0, ${PCH_BASE}`,
  `  li t0, ${KD}`,
  `  li t1, ${KEND}`,
  "kzero:",
  "  sw zero, 0(t0)",
  "  addi t0, t0, 4",
  "  bne t0, t1, kzero",
  ...(pre ? [
    // how many frames the machine has (the PCH knows the installed RAM), at most the 20-bit virtual space
    `  lw t0, ${PCH_REG.RAM_KB}(s0)`,
    "  slli t0, t0, 2",
    `  li t1, ${MAX_FRAMES}`,
    "  blt t0, t1, knf",
    "  mv t0, t1",
    "knf:",
    `  sw t0, ${NFRAMES}(zero)`,
    `  li t1, ${FMAP_FIRST}`,
    `  sw t1, ${HINT}(zero)`,
    // the frame map: zero, then reserve the OS's frames and everything beyond the RAM
    `  li t0, ${FMAP}`,
    `  li t1, ${FMAP + 4 * MAX_FRAMES}`,
    "kmz0:",
    "  sw zero, 0(t0)",
    "  addi t0, t0, 4",
    "  bne t0, t1, kmz0",
    `  li t3, ${RESERVED_FRAME}`,
    `  li t0, ${FMAP + 4 * (PAGED_TABLES >> 8)}`,
    `  li t1, ${FMAP + 4 * OS_FRAMES_END}`,
    "kmr0:",
    "  sw t3, 0(t0)",
    "  addi t0, t0, 4",
    "  bne t0, t1, kmr0",
    `  lw t2, ${NFRAMES}(zero)`,
    "  slli t0, t2, 2",
    `  li t4, ${FMAP}`,
    "  add t0, t0, t4",
    `  li t1, ${FMAP + 4 * MAX_FRAMES}`,
    "  bge t0, t1, kmr1",
    "kmr2:",
    "  sw t3, 0(t0)",
    "  addi t0, t0, 4",
    "  bne t0, t1, kmr2",
    "kmr1:",
    // the kernel's own address space: all of RAM, identity, read write run. The kernel runs translated like every program, as one more context the timer switches to.
    `  li t0, ${KTBL}`,
    `  li t1, ${KTBL + KTBL_BYTES}`,
    "kz3:",
    "  sw zero, 0(t0)",
    "  addi t0, t0, 4",
    "  bne t0, t1, kz3",
    `  li t0, ${KTBL + 0x100}`,
    "  li t1, 7",
    "  li t3, 0",
    "kt3:",
    "  sw t1, 0(t0)",
    "  addi t0, t0, 4",
    "  addi t1, t1, 256",
    "  addi t3, t3, 1",
    "  bne t3, t2, kt3",
    "  addi t3, t2, 63",
    "  srli t3, t3, 6",
    `  li t0, ${KTBL}`,
    `  li t1, ${KTBL + 0x100 + 1}`,
    "kl3:",
    "  sw t1, 0(t0)",
    "  addi t0, t0, 4",
    "  addi t1, t1, 256",
    "  addi t3, t3, -1",
    "  bne t3, zero, kl3",
    `  li t0, ${PCBS + 8 * PCB.BYTES}`,
    `  sw t0, ${smp ? PCORE + PC_CURP : CURP}(zero)`,
    `  li t1, ${KTBL}`,
    `  sw t1, ${PCB.TABLE}(t0)`,
    ...(smp ? ["  li t3, 1", `  sw t3, ${PCB.CORE}(t0)`] : []), // core 0 runs the kernel's context
    `  li t2, ${MMU_BASE}`,
    `  li t0, ${KERNEL_PAGEFAULT}`,
    `  sw t0, ${MMU_REG.VECTOR}(t2)`,
    `  sw t1, ${MMU_REG.TABLE}(t2)`,
    "  li t1, 1",
    `  sw t1, ${MMU_REG.CONTROL}(t2)`,
    `  li t2, ${INTC_BASE}`,
    `  li t0, ${KERNEL_TIMER}`,
    `  sw t0, ${INTC_REG.VECTOR}(t2)`,
    `  sw t1, ${INTC_REG.MASK}(t2)`,
    `  sw t1, ${INTC_REG.CTRL}(t2)`, // interrupts on: the timer only fires while a program runs
    ...(smp ? [`  lw t3, ${INTC_REG.CORES}(t2)`, "  li t4, 1", "  sll t4, t4, t3", "  addi t4, t4, -2", `  sw t4, ${INTC_REG.IPI}(t2)`] : []), // wake the other cores: each sets itself up and idles (k3entry)
  ] : paged ? [
    `  lw t0, ${PCH_REG.RAM_KB}(s0)`,
    "  slli t0, t0, 2",
    `  li t1, ${MAX_FRAMES}`,
    "  blt t0, t1, knf",
    "  mv t0, t1",
    "knf:",
    `  sw t0, ${NFRAMES}(zero)`,
    ...(smp ? [
      // a second core and the RAM for its arena: jobs go to core 1 when it is free
      `  li t2, ${INTC_BASE}`,
      `  lw t1, ${INTC_REG.CORES}(t2)`,
      "  li t2, 2",
      "  blt t1, t2, ksm",
      `  li t2, ${SMP_MIN_FRAMES}`,
      "  blt t0, t2, ksm",
      "  li t1, 1",
      `  sw t1, ${SMPON}(zero)`,
      `  li t1, ${ARENA1_END}`,
      `  sw t1, ${ARENA_END}(zero)`,
      "ksm:",
    ] : []),
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
  ...(pre ? ["  call kcnt", "  li t1, " + PchPhase.OsIdle, "  bne a0, zero, kpoll"] : []), // programs still running: the phase stays "running"
  ...(smp2 ? [`  lw t2, ${C1BUSY}(zero)`, "  bne t2, zero, kpoll"] : []), // core 1 still runs a job
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
  `  beq t1, zero, ${pre ? "kidle" : "kloop"}`, // nothing queued
  `  lw a1, ${H("PROGRAM_SLOTS")}(s3)`,
  `  bge t3, a1, ${pre ? "kidle" : "kloop"}`, // every program slot is busy (never the case in v1: a job runs to completion)
  "  mv a0, t1",
  // the multicore OS 2: core 0 stays the kernel core (it can ingest and flash while a job runs), so a job goes to core 1 when that is free
  ...(smp2 ? [`  lw t0, ${SMPON}(zero)`, "  beq t0, zero, klocal", `  lw t0, ${C1BUSY}(zero)`, "  bne t0, zero, klocal", "  j kdispatch", "klocal:"] : []),
  ...(pre ? ["  call kstart", "  j kloop"] : []),
  ...(pre ? [] : [
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
  ...(smp ? [`  li t2, ${INTC_BASE}`, `  lw t2, ${INTC_REG.CORE_ID}(t2)`, "  bne t2, zero, kdone1"] : []), // core 1's jobs end here too
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
  ...(smp ? ["  call klock"] : []),
  "  li t0, 4",
  `  sw t0, ${KSLOT.STATE}(a0)`,
  ...(smp ? ["  call kunlock"] : []),
  "  j kloop",

  // ---- a job wrote to protected memory: the OS ends it, its result is the fault text ----
  "kfault:",
  ...(smp ? [`  li t2, ${INTC_BASE}`, `  lw t2, ${INTC_REG.CORE_ID}(t2)`, "  bne t2, zero, kfault1"] : []),
  ...(paged ? [`  li t2, ${MMU_BASE}`, `  sw zero, ${MMU_REG.CONTROL}(t2)`] : [`  li t2, ${MPU_BASE}`, `  sw zero, ${MPU_REG.ENABLE}(t2)`]),
  "  li sp, 65536",
  `  li s0, ${PCH_BASE}`,
  `  li t0, ${KFAULTS}`,
  ...(smp ? ["  li t1, 1", "  amoadd t2, t1, (t0)"] : ["  lw t1, 0(t0)", "  addi t1, t1, 1", "  sw t1, 0(t0)"]), // both cores count faults
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
  ...(smp ? ["  call klock"] : []),
  "  li t0, 4",
  `  sw t0, ${KSLOT.STATE}(a0)`,
  ...(smp ? ["  call kunlock"] : []),
  "  j kloop",

  ]),

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
  ...(pre ? preemptive(KEND_PAGE, smp, thr) : paged ? [
    // ---- kmap: the address space of the job just loaded, and translation on ----
    // Virtual pages 0..15 are the ROM (read, run: the job ends by jumping into it), 16.. the program's image (read, write, run) at physical + PAGED_SHIFT,
    // 0xc0.. the OS (read, run: the job table can be read, never written), and nothing else: the heap (0x4000..0x7fff) and the stack (0xf000..0xffff) are
    // claimed by page faults as the program touches them (kpf). The tables sit at PAGED_TABLES, out of the program's reach.
    "kmap:",
    ...mapTables("", TBL, PAGED_SHIFT, CUR, BUMP, PAGED_HEAP >> 8, KEND_PAGE),
    `  li t2, ${MMU_BASE}`,
    `  li t1, ${TBL}`,
    `  sw t1, ${MMU_REG.TABLE}(t2)`,
    "  li t1, 1",
    `  sw t1, ${MMU_REG.CONTROL}(t2)`, // translation on: the kernel's own pages are mapped, so the next instruction is still there
    "  ret",

    // ---- kpf: the program touched a page that is not mapped ----
    // The heap, the big heap (virtual 0x10000 up) and the stack are claimed on demand: a frame from the bump pointer, zeroed, mapped read and write, and a level 2
    // table first where that part of the space has none. The bump pointer runs over the frames between the program and the tables, then over everything from
    // 0x10000 up. Anything else (a page the program has no business with, a write to the OS, memory running out) ends the program like a protection fault.
    // The handler runs untranslated and gives the program its registers back, so the faulting instruction simply runs again.
    ...pageFault("", TBL, PFS, (t) => bump2(t, smp)),
    ...(smp ? secondary(KEND_PAGE) : []),
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
export const KERNEL_SOURCE_PRE = kernelSource(true, true);
export const KERNEL_SOURCE_SMP = kernelSource(true, false, true);
export const KERNEL_SOURCE_PRE_SMP = kernelSource(true, true, true);
export const KERNEL_SOURCE_THR = kernelSource(true, true, true, true);
const assembled = assemble(KERNEL_SOURCE);
const assembledPaged = assemble(KERNEL_SOURCE_PAGED);
const assembledPre = assemble(KERNEL_SOURCE_PRE);
const assembledSmp = assemble(KERNEL_SOURCE_SMP);
const assembledPreSmp = assemble(KERNEL_SOURCE_PRE_SMP);
const assembledThr = assemble(KERNEL_SOURCE_THR);
/** The kernel image (words); its first word is at KERNEL_BASE. */
export const KERNEL_IMAGE: Uint32Array = assembled.program;
export const KERNEL_IMAGE_PAGED: Uint32Array = assembledPaged.program;
export const KERNEL_IMAGE_PRE: Uint32Array = assembledPre.program;
/** The OS 2 kernel for a multicore CPU: the paged kernel plus core 1's part. */
export const KERNEL_IMAGE_SMP: Uint32Array = assembledSmp.program;
/** The OS 3 kernel for a CPU with several logical cores: every core runs programs. */
export const KERNEL_IMAGE_PRE_SMP: Uint32Array = assembledPreSmp.program;
/** The OS 4 kernel: the multicore OS 3 plus threaded jobs (several contexts of one job in one address space). */
export const KERNEL_IMAGE_THR: Uint32Array = assembledThr.program;
export const KERNEL_SYMBOLS: ReadonlyMap<string, number> = assembled.symbols;
/** The kernel an OS tier boots: OS 1 guards itself with the protection unit, OS 2 and up are paged. */
export const kernelImageFor = (tier: number, smp = false): Uint32Array => (tier >= 4 ? KERNEL_IMAGE_THR : tier >= 3 ? (smp ? KERNEL_IMAGE_PRE_SMP : KERNEL_IMAGE_PRE) : smp && tier === 2 ? KERNEL_IMAGE_SMP : tier >= 2 ? KERNEL_IMAGE_PAGED : KERNEL_IMAGE);

if (KERNEL_SYMBOLS.get("k_done_vec") !== 4) throw new Error("kernel: k_done_vec must be at KERNEL_BASE + 4");
if (KERNEL_SYMBOLS.get("k_fault_vec") !== 8) throw new Error("kernel: k_fault_vec must be at KERNEL_BASE + 8");
for (const [name, a] of [["", assembled], ["paged ", assembledPaged], ["preemptive ", assembledPre], ["multicore preemptive ", assembledPreSmp], ["threaded ", assembledThr]] as const) if (a.symbols.get("k_pf_vec") !== 12) throw new Error(`${name}kernel: k_pf_vec must be at KERNEL_BASE + 12`);
if (assembledSmp.symbols.get("k_sec_vec") !== KERNEL_SECONDARY - KERNEL_BASE || assembledSmp.symbols.get("k_pf1_vec") !== KERNEL_PAGEFAULT1 - KERNEL_BASE) throw new Error("kernel: the second core's vectors are at KERNEL_BASE + 20 and + 24");
if (assembledPre.symbols.get("k_timer_vec") !== 16 || assembledPreSmp.symbols.get("k_timer_vec") !== 16) throw new Error("kernel: k_timer_vec must be at KERNEL_BASE + 16");
if (assembledPreSmp.symbols.get("k_sec_vec") !== KERNEL_SECONDARY - KERNEL_BASE || assembledPreSmp.symbols.get("k_tvec0") !== KERNEL_TVEC - KERNEL_BASE || assembledPreSmp.symbols.get("k_pvec0") !== KERNEL_PVEC - KERNEL_BASE) throw new Error("kernel: the multicore OS 3 vectors are at KERNEL_SECONDARY, KERNEL_TVEC and KERNEL_PVEC");
if (KERNEL_BASE !== OS_HEADER_BASE + BLOCK_BYTES) throw new Error("kernel must follow the header block");
if (KERNEL_BASE + Math.max(KERNEL_IMAGE.length, KERNEL_IMAGE_PAGED.length, KERNEL_IMAGE_PRE.length, KERNEL_IMAGE_SMP.length, KERNEL_IMAGE_PRE_SMP.length, KERNEL_IMAGE_THR.length) * 4 > KD) throw new Error("kernel overlaps its data");

export interface BootParams {
  /** Jobs the queue may hold (already bounded by the OS tier and the disk space). */
  queueSlots: number;
  /** Programs that may run at once (1 for v1; the kernel checks it before starting a job). */
  programSlots: number;
  /** First block of the job spool and the blocks each queue slot gets. */
  spoolLba: number;
  spoolBlocks: number;
  tier: number;
  /** The multicore image: OS 2 hands jobs to core 1, OS 3 schedules programs on every logical core. */
  smp?: boolean;
}

/** Blocks the boot image of an OS tier takes: the header block plus the kernel. */
export const bootBlocksFor = (tier: number, smp = false): number => 1 + Math.ceil((kernelImageFor(tier, smp).length * 4) / BLOCK_BYTES);
/** Blocks the OS 1 boot image takes. */
export const BOOT_BLOCKS = bootBlocksFor(1);

/** The boot area of the disk: block 0 is the header, then the kernel image (padded to whole blocks). */
export function bootImage(p: BootParams): Uint8Array {
  const image = kernelImageFor(p.tier, p.smp), blocks = bootBlocksFor(p.tier, p.smp);
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
