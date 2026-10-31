// Toy-ISA subroutines for the block device, shared by the boot ROM (read) and the kernel (read and write).
// Calling convention: a0 = port base, a1 = block number, a2 = RAM (or window) address of the 256-byte data. They keep
// a0-a2, clobber t0-t3 and ra, and return when the device is idle again. Everything is real loads and stores, so the
// time a copy takes is the CPU's, and the time the wait takes is the drive's.

import { BLOCK_BYTES, STORAGE_BUF, STORAGE_REG } from "@/core/sim/memmap";

const copy4 = (n: string, from: string, to: string): string[] => [
  `${n}:`,
  `  lw t3, 0(${from})`, `  sw t3, 0(${to})`,
  `  lw t3, 4(${from})`, `  sw t3, 4(${to})`,
  `  lw t3, 8(${from})`, `  sw t3, 8(${to})`,
  `  lw t3, 12(${from})`, `  sw t3, 12(${to})`,
  `  addi ${from}, ${from}, 16`, `  addi ${to}, ${to}, 16`,
  `  bne ${from}, t2, ${n}`,
];

const wait = (n: string): string[] => [`${n}:`, `  lw t0, ${STORAGE_REG.STATUS}(a0)`, "  andi t0, t0, 1", `  bne t0, zero, ${n}`];

/** `blk_read`: read block a1 of the port at a0 into memory at a2. */
export const BLK_READ = [
  "blk_read:",
  `  sw a1, ${STORAGE_REG.LBA}(a0)`,
  "  li t0, 1",
  `  sw t0, ${STORAGE_REG.CMD}(a0)`,
  ...wait("blk_rwait"),
  `  addi t0, a0, ${STORAGE_BUF}`,
  "  mv t1, a2",
  `  addi t2, t0, ${BLOCK_BYTES}`,
  ...copy4("blk_rcopy", "t0", "t1"),
  "  ret",
].join("\n");

/** `blk_write`: write the 256 bytes at a2 to block a1 of the port at a0. */
export const BLK_WRITE = [
  "blk_write:",
  `  addi t0, a0, ${STORAGE_BUF}`,
  "  mv t1, a2",
  `  addi t2, t1, ${BLOCK_BYTES}`,
  ...copy4("blk_wcopy", "t1", "t0"),
  `  sw a1, ${STORAGE_REG.LBA}(a0)`,
  "  li t0, 2",
  `  sw t0, ${STORAGE_REG.CMD}(a0)`,
  ...wait("blk_wwait"),
  "  ret",
].join("\n");
