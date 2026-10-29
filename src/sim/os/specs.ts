// The OS ladder, as data. An OS is a purchasable item that is INSTALLED onto a storage device (not into a board slot):
// it occupies capacity there and needs a minimum amount of RAM. Only 'single-task resident' (os1) is implemented; the
// later tiers are listed so the shop can show them locked, and so the kernel's seam (`programSlots`, always 1 for v1)
// is a data field rather than a constant. All numbers are placeholders.

export interface OsSpec {
  /** Item id, also what a save stores (`os1`...). */
  id: string;
  tier: number;
  name: string;
  /** One-line summary for the shop and tooltips. */
  description: string;
  price: number;
  /** Installed RAM needed (bytes). */
  minRamBytes: number;
  /** Capacity the install occupies on the storage device (bytes): the boot image plus system files. */
  diskBytes: number;
  /** Programs the kernel may run at once. The v1 kernel respects this field; it is always 1 there. */
  programSlots: number;
  /** Jobs the ingest queue can hold (further bounded by free disk space, see `queueSlotsFor`). */
  queueSlots: number;
  /** Needs a CPU with an MMU (docs/VM.md): every program gets its own address space. */
  needsMmu?: boolean;
  /** Not implemented yet: shown locked, cannot be bought or installed. */
  later?: boolean;
  visual: string;
}

export const OS_SPECS: readonly OsSpec[] = [
  { id: "os1", tier: 1, name: "Resident OS 1.0", price: 150, minRamBytes: 32 * 1024, diskBytes: 12 * 1024,
    programSlots: 1, queueSlots: 4, visual: "os-resident",
    description: "Single-task resident: boots once and stays running. Ingests client keys into a job queue and runs one program at a time." },
  { id: "os2", tier: 2, name: "Paged OS 2.0", price: 600, minRamBytes: 64 * 1024, diskBytes: 24 * 1024,
    programSlots: 1, queueSlots: 8, needsMmu: true, visual: "os-coop",
    description: "Virtual memory: every program runs in its own address space, claims memory as it touches it and cannot reach the OS. Needs a CPU with an MMU. Programs run one at a time." },
  { id: "os3", tier: 3, name: "Preemptive OS 3.0", price: 2000, minRamBytes: 256 * 1024, diskBytes: 48 * 1024,
    programSlots: 4, queueSlots: 8, needsMmu: true, visual: "os-preempt",
    description: "Preemptive scheduling: a timer interrupt shares the CPU between up to four programs, each in its own address space. Needs a CPU with an MMU and 256K of RAM." },
  { id: "os4", tier: 4, name: "Multicore OS 4.0", price: 6000, minRamBytes: 256 * 1024, diskBytes: 96 * 1024,
    programSlots: 8, queueSlots: 8, needsMmu: true, visual: "os-smp",
    description: "Preemptive scheduling on every logical core, and threaded programs: one program on several cores at once, with the threads kept on the cores they ran on. Needs a CPU with an MMU and 256K of RAM." },
];

export function getOsSpec(id: string): OsSpec | undefined {
  return OS_SPECS.find((o) => o.id === id);
}

/** Blocks reserved for each queued job's program on disk (4 KiB; generated programs are far smaller). */
export const SPOOL_BLOCKS_PER_JOB = 16;
/** The kernel's job table has this many slots, so no queue is longer. */
export { KDATA_SLOTS as MAX_QUEUE_SLOTS } from "../isa/memmap";

/** The queue bound: the OS tier's field, further limited by the spool space left on the storage device. */
export function queueSlotsFor(os: OsSpec, freeBytesAfterInstall: number, blockBytes: number): number {
  const byDisk = Math.floor(freeBytesAfterInstall / (SPOOL_BLOCKS_PER_JOB * blockBytes));
  return Math.max(0, Math.min(os.queueSlots, byDisk, 8));
}
