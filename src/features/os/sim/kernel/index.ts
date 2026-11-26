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

import { assemble } from '../../../cpu/sim/asm';
import {
  BLOCK_BYTES,
  KDATA_BASE,
  KERNEL_BASE,
  KERNEL_PAGEFAULT1,
  KERNEL_PVEC,
  KERNEL_SECONDARY,
  KERNEL_TVEC,
  OS_HEADER,
  OS_HEADER_BASE,
  OS_MAGIC,
  OS_SPOOL_MAP,
} from '@/core/sim/memmap';
import { JT_SLOTS } from './layout';
import { kernelSource } from './source';

export {
  ARENA1,
  FMAP,
  FRAME_END,
  FRAME_FIRST,
  JT_BASE,
  JT_SLOTS,
  jobTableFor,
  KBUMP,
  kdataEndFor,
  KFAULTS,
  KTBL,
  KTBL_BYTES,
  PCB,
  PCBS,
  RESERVED_FRAME,
} from './layout';

const assembled = assemble(kernelSource({ paged: false, pre: false, smp: false, thr: false }));
const assembledPaged = assemble(kernelSource({ paged: true, pre: false, smp: false, thr: false }));
const assembledPre = assemble(kernelSource({ paged: true, pre: true, smp: false, thr: false }));
const assembledSmp = assemble(kernelSource({ paged: true, pre: false, smp: true, thr: false }));
const assembledPreSmp = assemble(kernelSource({ paged: true, pre: true, smp: true, thr: false }));
const assembledThr = assemble(kernelSource({ paged: true, pre: true, smp: true, thr: true }));
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
export const kernelImageFor = (tier: number, smp = false): Uint32Array => {
  if (tier >= 4) {
    return KERNEL_IMAGE_THR;
  }
  if (tier >= 3) {
    return smp ? KERNEL_IMAGE_PRE_SMP : KERNEL_IMAGE_PRE;
  }
  if (smp && tier === 2) {
    return KERNEL_IMAGE_SMP;
  }
  return tier >= 2 ? KERNEL_IMAGE_PAGED : KERNEL_IMAGE;
};

/** Stops the build when `ok` is false: the boot ROM and the CPU jump to fixed places in the kernel. */
const must = (ok: boolean, message: string): void => {
  if (!ok) {
    throw new Error(message);
  }
};
must(KERNEL_SYMBOLS.get('k_done_vec') === 4, 'kernel: k_done_vec must be at KERNEL_BASE + 4');
must(KERNEL_SYMBOLS.get('k_fault_vec') === 8, 'kernel: k_fault_vec must be at KERNEL_BASE + 8');
for (const [name, a] of [
  ['', assembled],
  ['paged ', assembledPaged],
  ['preemptive ', assembledPre],
  ['multicore preemptive ', assembledPreSmp],
  ['threaded ', assembledThr],
] as const) {
  must(a.symbols.get('k_pf_vec') === 12, `${name}kernel: k_pf_vec must be at KERNEL_BASE + 12`);
}
must(
  assembledSmp.symbols.get('k_sec_vec') === KERNEL_SECONDARY - KERNEL_BASE &&
    assembledSmp.symbols.get('k_pf1_vec') === KERNEL_PAGEFAULT1 - KERNEL_BASE,
  "kernel: the second core's vectors are at KERNEL_BASE + 20 and + 24",
);
must(
  assembledPre.symbols.get('k_timer_vec') === 16 && assembledPreSmp.symbols.get('k_timer_vec') === 16,
  'kernel: k_timer_vec must be at KERNEL_BASE + 16',
);
must(
  assembledPreSmp.symbols.get('k_sec_vec') === KERNEL_SECONDARY - KERNEL_BASE &&
    assembledPreSmp.symbols.get('k_tvec0') === KERNEL_TVEC - KERNEL_BASE &&
    assembledPreSmp.symbols.get('k_pvec0') === KERNEL_PVEC - KERNEL_BASE,
  'kernel: the multicore OS 3 vectors are at KERNEL_SECONDARY, KERNEL_TVEC and KERNEL_PVEC',
);
must(KERNEL_BASE === OS_HEADER_BASE + BLOCK_BYTES, 'kernel must follow the header block');
must(
  KERNEL_BASE +
    Math.max(
      KERNEL_IMAGE.length,
      KERNEL_IMAGE_PAGED.length,
      KERNEL_IMAGE_PRE.length,
      KERNEL_IMAGE_SMP.length,
      KERNEL_IMAGE_PRE_SMP.length,
      KERNEL_IMAGE_THR.length,
    ) *
      4 <=
    KDATA_BASE,
  'kernel overlaps its data',
);

export interface BootParams {
  /** Jobs the queue may hold (already bounded by the OS tier and the disk space). */
  queueSlots: number;
  /** Programs that may run at once (1 for v1; the kernel checks it before starting a job). */
  programSlots: number;
  /** First block of the job spool and the blocks each queue slot gets. */
  spoolLba: number;
  spoolBlocks: number;
  /** The first spool block of each queue slot, drive tag in the top byte (see `OS_SPOOL_MAP`). Absent: the slots follow one another from `spoolLba` on the OS drive. */
  spoolMap?: number[];
  tier: number;
  /** The multicore image: OS 2 hands jobs to core 1, OS 3 schedules programs on every logical core. */
  smp?: boolean;
}

/** Blocks the boot image of an OS tier takes: the header block plus the kernel. */
export const bootBlocksFor = (tier: number, smp = false): number =>
  1 + Math.ceil((kernelImageFor(tier, smp).length * 4) / BLOCK_BYTES);
/** Blocks the OS 1 boot image takes. */
export const BOOT_BLOCKS = bootBlocksFor(1);

const isHeaderKey = (k: string): k is keyof typeof OS_HEADER => k in OS_HEADER;

/** The boot area of the disk: block 0 is the header, then the kernel image (padded to whole blocks). */
export function bootImage(p: BootParams): Uint8Array {
  const image = kernelImageFor(p.tier, p.smp),
    blocks = bootBlocksFor(p.tier, p.smp);
  const out = new Uint8Array(blocks * BLOCK_BYTES);
  const w = new DataView(out.buffer);
  const header: Record<keyof typeof OS_HEADER, number> = {
    MAGIC: OS_MAGIC,
    TOTAL_BLOCKS: blocks,
    QUEUE_SLOTS: p.queueSlots,
    PROGRAM_SLOTS: p.programSlots,
    SPOOL_LBA: p.spoolLba,
    SPOOL_BLOCKS: p.spoolBlocks,
    TIER: p.tier,
  };
  for (const k of Object.keys(OS_HEADER).filter((key) => isHeaderKey(key))) {
    w.setUint32(4 * OS_HEADER[k], header[k] >>> 0, true);
  }
  for (let i = 0; i < JT_SLOTS; i++) {
    w.setUint32(4 * (OS_SPOOL_MAP + i), (p.spoolMap?.[i] ?? p.spoolLba + i * p.spoolBlocks) >>> 0, true);
  }
  for (const [i, word] of image.entries()) {
    w.setUint32(BLOCK_BYTES + 4 * i, word, true);
  }
  return out;
}
