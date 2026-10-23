// The PCH boot ROM: a small loader written in the toy ISA, assembled from the asm below. The PCH shadows the image
// into RAM at address 0 at power-on and the CPU runs it on the real engine, so boot time depends on CPU speed.
//
//   boot: blank screen -> POST lines (CPU tier and RAM size are read from PCH registers) -> wait for a USB key
//         -> copy the key's program into RAM at USER_BASE through the PCH key window (lw/sw) -> jump to it.
//   done (ROM_DONE_VECTOR): a finished job jumps here -> copy the result line into the PCH result window,
//         write DONE -> show REMOVE KEY -> poll until the key is gone -> `j reset` (reboot, next job).
//
// See docs/ASSEMBLY.md for the sequence and the register map (src/sim/isa/memmap.ts).

import { assemble } from "../asm";
import { printDec } from "../gen/kernels";
import {
  DISPLAY_BASE, DISPLAY_COLS, JOB_ROW, PCH_BASE, PCH_KEY_WINDOW, PCH_REG, PCH_RESULT_WINDOW, PCH_RESULT_WORDS,
  PchPhase, ROM_DONE_VECTOR, USER_BASE,
} from "../isa/memmap";

const ROW = DISPLAY_COLS;

/** Rows of the monitor used by the ROM (the job writes from JOB_ROW). */
export const POST_ROWS = { bios: 0, cpu: 1, ram: 2, usb: 3, status: 5 } as const;

/** Packed word stores for a text at byte offset `off` from s0 (display base). NUL bytes are skipped placeholders. */
function textStores(off: number, text: string): string[] {
  if (off % 4 !== 0) throw new RangeError("text must start on a word boundary");
  const out: string[] = [];
  for (let w = 0; w * 4 < text.length; w++) {
    let val = 0;
    let any = false;
    for (let i = 0; i < 4; i++) {
      const c = text.charCodeAt(w * 4 + i);
      if (!Number.isNaN(c) && c !== 0) {
        val |= c << (8 * i);
        any = true;
      }
    }
    if (any) out.push(`  li t0, ${val >>> 0}`, `  sw t0, ${off + 4 * w}(s0)`);
  }
  return out;
}

/** Status line (row 5), always 12 characters so each text fully replaces the last. */
function status(text: string): string[] {
  return textStores(POST_ROWS.status * ROW, text.padEnd(12));
}

const setPhase = (p: number): string[] => [`  li t0, ${p}`, `  sw t0, ${PCH_REG.PHASE}(s3)`];
const mark = (n: number): string[] => [`  li t0, ${n}`, `  sw t0, ${PCH_REG.PROGRESS}(s3)`];

export const ROM_SOURCE = [
  "# PCH boot ROM v1",
  "reset:",
  "  j boot",
  "  nop",
  "  nop",
  "  nop",
  "done:", // must sit at ROM_DONE_VECTOR (checked by a test)
  "  j epilogue",
  "boot:",
  "  li sp, 65536",
  `  li s3, ${PCH_BASE}`,
  `  li s0, ${DISPLAY_BASE}`,
  "  li t0, 3",
  `  sw t0, ${PCH_REG.CTRL}(s3)`, // blank the screen (bit 0) and acknowledge an earlier key removal (bit 1)
  ...setPhase(PchPhase.Posting),
  // --- POST ---
  ...textStores(POST_ROWS.bios * ROW, "PCH BIOS 1.0"),
  ...mark(1),
  ...textStores(POST_ROWS.cpu * ROW, "CPU T\0 OK"),
  `  lw t1, ${PCH_REG.CPU_TIER}(s3)`,
  "  addi t1, t1, 48",
  `  sb t1, ${POST_ROWS.cpu * ROW + 5}(s0)`,
  ...mark(2),
  ...textStores(POST_ROWS.ram * ROW, "RAM \0\0K OK"),
  `  addi a0, s0, ${POST_ROWS.ram * ROW + 4}`,
  `  lw a1, ${PCH_REG.RAM_KB}(s3)`,
  "  call print_dec",
  ...mark(3),
  ...textStores(POST_ROWS.usb * ROW, "USB OK"),
  ...mark(4),
  // --- wait for a key ---
  ...setPhase(PchPhase.Waiting),
  ...status("INSERT KEY"),
  "wait:",
  `  lw t0, ${PCH_REG.STATUS}(s3)`,
  "  andi t1, t0, 1",
  "  beq t1, zero, wait",
  "  andi t1, t0, 2", // the key already holds a result (power was cycled before it was removed)
  "  bne t1, zero, finished",
  // --- load the key's program ---
  ...setPhase(PchPhase.Loading),
  ...status("LOADING JOB"),
  `  lw t2, ${PCH_REG.KEY_LEN}(s3)`,
  "  beq t2, zero, wait",
  "  slli t2, t2, 2",
  `  li t0, ${PCH_BASE + PCH_KEY_WINDOW}`,
  `  li t1, ${USER_BASE}`,
  "  add t3, t0, t2",
  "copy:",
  "  lw t4, 0(t0)",
  "  sw t4, 0(t1)",
  "  addi t0, t0, 4",
  "  addi t1, t1, 4",
  "  bne t0, t3, copy",
  ...setPhase(PchPhase.Running),
  ...status("RUNNING JOB"),
  `  li t0, ${USER_BASE}`,
  "  jalr ra, t0, 0", // the job ends by jumping to `done`
  // --- epilogue: results back to the key ---
  "epilogue:",
  `  li s3, ${PCH_BASE}`,
  `  li s0, ${DISPLAY_BASE}`,
  ...setPhase(PchPhase.Writing),
  ...status("WRITING"),
  `  li t0, ${DISPLAY_BASE + JOB_ROW * ROW}`,
  `  li t1, ${PCH_BASE + PCH_RESULT_WINDOW}`,
  `  addi t2, t0, ${PCH_RESULT_WORDS * 4}`,
  "rcopy:",
  "  lw t4, 0(t0)",
  "  sw t4, 0(t1)",
  "  addi t0, t0, 4",
  "  addi t1, t1, 4",
  "  bne t0, t2, rcopy",
  `  li t0, ${PCH_RESULT_WORDS}`,
  `  sw t0, ${PCH_REG.RESULT_LEN}(s3)`,
  "  li t0, 1",
  `  sw t0, ${PCH_REG.DONE}(s3)`,
  "finished:",
  `  li s3, ${PCH_BASE}`,
  `  li s0, ${DISPLAY_BASE}`,
  ...setPhase(PchPhase.Done),
  ...status("REMOVE KEY"),
  "remove:", // wait for the key to leave; the removed latch catches a pull and replug between two polls
  `  lw t0, ${PCH_REG.STATUS}(s3)`,
  "  andi t1, t0, 1",
  "  beq t1, zero, gone",
  "  andi t1, t0, 4",
  "  beq t1, zero, remove",
  "gone:",
  "  j reset",
  "",
  printDec("print_dec", 2).asm,
  "",
].join("\n");

const assembled = assemble(ROM_SOURCE);

/** The ROM image (words), shadowed to RAM address 0 at power-on. */
export const ROM_IMAGE: Uint32Array = assembled.program;
export const ROM_SYMBOLS: ReadonlyMap<string, number> = assembled.symbols;

if (ROM_SYMBOLS.get("done") !== ROM_DONE_VECTOR) throw new Error("boot ROM: `done` is not at ROM_DONE_VECTOR");
if (ROM_IMAGE.length * 4 > USER_BASE) throw new Error("boot ROM does not fit below USER_BASE");
