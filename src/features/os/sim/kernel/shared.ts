// Small pieces of kernel assembly that several parts of the kernel share.

import { assemble } from '../../../cpu/sim/asm';
import { OS_HEADER, OS_HEADER_BASE, PCH_REG } from '@/core/sim/memmap';

/** The end of the job table in use: `base` (holding the table's start) + the queue length of the header x 64 bytes. Only the slots the spool map covers are ever used. */
export const jtEnd = (end: string, base: string): string[] => [
  `  li ${end}, ${OS_HEADER_BASE + 4 * OS_HEADER.QUEUE_SLOTS}`,
  `  lw ${end}, 0(${end})`,
  `  slli ${end}, ${end}, 6`,
  `  add ${end}, ${end}, ${base}`,
];
export const H = (k: keyof typeof OS_HEADER): number => 4 * OS_HEADER[k];

export const setPhase = (p: number): string[] => [`  li t0, ${p}`, `  sw t0, ${PCH_REG.PHASE}(s0)`];

/** The registers a context saves, in PCB order. */
export const REGS: readonly string[] = [
  'ra',
  'sp',
  'a0',
  'a1',
  'a2',
  'a3',
  't0',
  't1',
  't2',
  't3',
  't4',
  's0',
  's1',
  's2',
  's3',
];
/** The offset of register `r` in a PCB. */
export const roff = (r: string): number => 4 * REGS.indexOf(r);

/** The registers of a word copy loop: it copies from `from` to `to` and ends when `from` reaches `end`; `tmp` is clobbered. */
type CopyRegs = readonly [from: string, to: string, end: string, tmp: string];
/** A word copy loop (advances `from` and `to`). */
export const copy = (label: string, [from, to, end, tmp]: CopyRegs): string[] => [
  `${label}:`,
  `  lw ${tmp}, 0(${from})`,
  `  sw ${tmp}, 0(${to})`,
  `  addi ${from}, ${from}, 4`,
  `  addi ${to}, ${to}, 4`,
  `  bne ${from}, ${end}, ${label}`,
];

/** The first word of an assembled program. */
const firstWord = (program: Uint32Array): number => {
  const [word] = program;
  if (word === undefined) {
    throw new Error('kernel: the program is empty');
  }
  return word;
};
/** The nop that marks a threaded program (`addi zero, zero, T`) without its immediate: the kernel of OS 4 reads T from the program's first word. */
export const ADDI_OP = firstWord(assemble('addi zero, zero, 0').program);
