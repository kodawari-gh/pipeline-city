// Memory map. Byte-addressed, little-endian, 32-bit address space.
// RAM starts at 0 and programs are loaded there; PC resets to RAM_BASE.

export const RAM_BASE = 0x0000_0000;
export const RAM_DEFAULT_SIZE = 64 * 1024;

/** Memory-mapped text display: DISPLAY_COLS x DISPLAY_ROWS bytes of ASCII, row-major. */
export const DISPLAY_BASE = 0x4000_0000;
export const DISPLAY_COLS = 64;
export const DISPLAY_ROWS = 16;
export const DISPLAY_SIZE = 0x1000; // reserved window (cols*rows fits inside)

/** Device status/command registers (word-sized, polled by programs). */
export const STATUS_BASE = 0x4001_0000;
export const STATUS_SIZE = 0x1000;

// ---- Interrupt controller (docs/CPU.md "Interrupts"). Word registers, offsets from INTC_BASE.

export const INTC_BASE = 0x4004_0000;
export const INTC_SIZE = 0x100;
export const INTC_REG = {
  /** ro: lines raised and not yet acknowledged (bit n = line n). */
  PENDING: 0x00,
  /** rw: lines allowed to interrupt the CPU. Reset: 0. */
  MASK: 0x04,
  /** wo: write 1 bits to clear them in PENDING. */
  ACK: 0x08,
  /** rw: where the CPU jumps on an interrupt. */
  VECTOR: 0x0c,
  /** rw: where `iret` returns to (set by the CPU on entry: the next instruction the interrupted program would have run). */
  EPC: 0x10,
  /** ro: the line of the interrupt that was taken last. */
  CAUSE: 0x14,
  /** rw: bit0 = interrupts enabled. Cleared by the CPU on entry, set again by `iret`. Reset: 0. */
  CTRL: 0x18,
  /** ro: how many interrupts the CPU has taken. */
  COUNT: 0x1c,
} as const;
/** Interrupt lines. The lowest pending line wins. */
export const IRQ = { TIMER: 0, NIC: 1, DISK: 2, USB: 3 } as const;

// ---- PCH (platform controller hub): boot ROM shadow, USB host controller, display control. See docs/ASSEMBLY.md.

/** The boot ROM image is shadowed into RAM at address 0 at power-on; the CPU starts executing there. */
export const ROM_BASE = 0x0000_0000;
/** Fixed ROM entry a finished job jumps to (hosted programs end with `li t0, ROM_DONE_VECTOR; jalr zero, t0, 0`). */
export const ROM_DONE_VECTOR = 0x10;
/** The loader copies the key's program here and jumps to it. Everything below is ROM. */
export const USER_BASE = 0x1000;
/** Display row where a hosted job writes its output (POST text uses the rows above it). */
export const JOB_ROW = 8;

export const PCH_BASE = 0x4002_0000;
export const PCH_SIZE = 0x5000;
/** Registers (word-sized): offsets from PCH_BASE. */
export const PCH_REG = {
  /**
   * ro: bit0 key plugged, bit1 key already holds a result, bit2 a key was pulled since the last CTRL bit1 acknowledge,
   * bit3 key enumerated (USB ready; only reported once the ROM has handed over to an OS), bit4 result being flashed onto the key.
   */
  STATUS: 0x00,
  /** ro: program length of the plugged key, in words. */
  KEY_LEN: 0x04,
  /** rw: boot phase, written by the ROM (see PchPhase). */
  PHASE: 0x08,
  /** wo: bit0 blank the display, bit1 acknowledge a key removal (clears STATUS bit2). */
  CTRL: 0x0c,
  /** ro: installed RAM in KiB. */
  RAM_KB: 0x10,
  /** ro: CPU tier. */
  CPU_TIER: 0x14,
  /** wo: result length in words (what the ROM copied into the result window). */
  RESULT_LEN: 0x18,
  /** wo: write 1 to tell the key the job is done (it keeps the result). */
  DONE: 0x1c,
  /** rw: POST progress marks written by the ROM. */
  PROGRESS: 0x20,
  /** ro: base address of the storage port holding a bootable OS, or 0 (the ROM then runs the per-job key loader). */
  BOOT_DEV: 0x24,
  /** rw: the ROM sets 1 when it hands over to the kernel (a finished job then jumps to the kernel, not the ROM epilogue). */
  OS_MODE: 0x28,
  /** ro: id of the plugged key (the client's job number). */
  KEY_ID: 0x2c,
} as const;
/** Read-only window onto the plugged key's program (word reads). */
export const PCH_KEY_WINDOW = 0x1000;
export const PCH_KEY_WINDOW_SIZE = 0x3000;
/** Write window for the result words the ROM copies back to the key. */
export const PCH_RESULT_WINDOW = 0x4000;
export const PCH_RESULT_WORDS = 8;

/** Values of PCH_REG.PHASE. */
export const PchPhase = {
  Off: 0, Posting: 1, Waiting: 2, Loading: 3, Running: 4, Writing: 5, Done: 6,
  /** OS mode (the kernel writes these): booting the kernel from disk, idle, ingesting a key, running a job, flashing a result. */
  OsBoot: 7, OsIdle: 8, OsIngest: 9, OsRun: 10, OsFlash: 11,
  /** No-OS flow: the ROM looks for a key once, after POST. Halted = the job is done (result written), NoMedia = no key at boot. Both spin until power-off. */
  Halted: 12, NoMedia: 13,
} as const;

// ---- Storage ports (block devices) and the OS. See docs/BOARD.md (storage) and docs/OS.md.

/** Storage port k (slot ids in STORAGE_PORTS order) sits at STORAGE_BASE + k * STORAGE_STRIDE. */
export const STORAGE_BASE = 0x4003_0000;
export const STORAGE_STRIDE = 0x1000;
/** Slot ids that carry a block device, in port order (the board slot id doubles as the port / clock domain name). The first three keep
 * their addresses from when a board had two SATA ports and one M.2; the bigger boards' extra ports are appended. */
export const STORAGE_PORTS: readonly string[] = ["sata0", "sata1", "m20", "sata2", "sata3", "sata4", "sata5", "m21", "m22", "sata6", "sata7"];
/** A block is 64 words. */
export const BLOCK_BYTES = 256;
export const BLOCK_WORDS = 64;
/** Port registers (word access, offsets from the port base). */
export const STORAGE_REG = {
  /** ro: bit0 busy, bit1 error (bad lba, no media, command while busy), bit2 media present. */
  STATUS: 0x00,
  /** rw: block address for the next command. */
  LBA: 0x04,
  /** wo: 1 = read block LBA into the buffer, 2 = write the buffer to block LBA. Starts when written. */
  CMD: 0x08,
  /** ro: capacity in blocks. */
  BLOCKS: 0x0c,
} as const;
/** The one-block data buffer window. */
export const STORAGE_BUF = 0x100;
export const StorageStatus = { Busy: 1, Error: 2, Present: 4 } as const;

/** Boot disk layout: block 0 is the header, the kernel image follows; both are copied to RAM at OS_HEADER_BASE. */
export const OS_HEADER_BASE = 0xc000;
export const KERNEL_BASE = 0xc100;
/** Kernel entry points: KERNEL_BASE + 0 boots, + 4 is where a finished job lands (the ROM epilogue jumps there in OS mode). */
export const KERNEL_DONE = KERNEL_BASE + 4;
/** + 8 is where the CPU is sent when a job writes to protected memory (the MPU tripped): the kernel ends the job with a fault result. */
export const KERNEL_FAULT = KERNEL_BASE + 8;
/** Header words: magic, total blocks (header + kernel), queue slots, program slots, spool start block, spool blocks per job, OS tier. */
export const OS_MAGIC = 0x3153_564f;
export const OS_HEADER = { MAGIC: 0, TOTAL_BLOCKS: 1, QUEUE_SLOTS: 2, PROGRAM_SLOTS: 3, SPOOL_LBA: 4, SPOOL_BLOCKS: 5, TIER: 6 } as const;
/** Kernel job table in RAM: KDATA_SLOTS slots of KSLOT_BYTES; see docs/OS.md. */
export const KDATA_BASE = 0xe000;
export const KDATA_SLOTS = 8;
export const KSLOT_BYTES = 64;
/** Slot word offsets (bytes). */
export const KSLOT = { STATE: 0, KEY: 4, LEN: 8, LBA: 12, RESULT: 16, SEQ: 48 } as const;
/** Job slot states. */
export const JobState = { Free: 0, Queued: 2, Running: 3, Result: 4 } as const;

// ---- Memory protection unit (docs/OS.md "Memory protection"). Word registers, offsets from MPU_BASE.

export const MPU_BASE = 0x4010_0000;
export const MPU_SIZE = 0x100;
export const MPU_REG = {
  /** rw: 1 = stores into the protected ranges are refused and fault. The kernel sets it just before it jumps to a job. Reset: 0. */
  ENABLE: 0x00,
  /** rw: the two protected ranges [LO, HI) of RAM (the boot ROM; the OS header, kernel and job table). Reset: empty. */
  R0_LO: 0x04, R0_HI: 0x08, R1_LO: 0x0c, R1_HI: 0x10,
  /** ro: faults since power-on, and the address the last refused store aimed at. */
  FAULTS: 0x14, FAULT_ADDR: 0x18,
} as const;
/** The result text of a job the OS killed for writing to protected memory. */
export const FAULT_TEXT = "SEGFAULT";

// ---- Memory management unit (docs/VM.md). Word registers, offsets from MMU_BASE.

export const MMU_BASE = 0x4011_0000;
export const MMU_SIZE = 0x100;
/** Addresses from here up are devices: never translated. */
export const DEVICE_BASE = 0x4000_0000;
export const MMU_REG = {
  /** ro: bit 0 this CPU has an MMU, bit 1 translation is on. */
  STATUS: 0x00,
  /** wo: bit 0 translation on, bit 1 flush the TLB. */
  CONTROL: 0x04,
  /** rw: physical address of the level 1 table (writing it flushes the TLB). */
  TABLE: 0x08,
  /** rw: where the CPU goes on a page fault (the OS's handler; translation is off there). */
  VECTOR: 0x0c,
  /** ro: the faulting virtual address and why (`VmFault`) of the last fault. */
  FAULT_ADDR: 0x10, FAULT_CAUSE: 0x14,
  /** ro: TLB entries, and page faults taken since power-on. */
  TLB_ENTRIES: 0x18, FAULTS: 0x1c,
} as const;
/** Table entry bits (the frame is bits 8 and up). */
export const PteBit = { Valid: 1, Write: 2, Exec: 4 } as const;
/** Why a translation failed (MMU_REG.FAULT_CAUSE). */
export const VmFault = { None: 0, NotPresent: 1, Write: 2, Exec: 3, Range: 4 } as const;
/** The interrupt-controller cause a page fault shows. */
export const FAULT_CAUSE_LINE = 30;

// ---- GPU cards (PCIe slots). See docs/ACCEL.md "GPU".

/** The card in PCIe slot k (ids in GPU_PORTS order) sits at GPU_BASE + k * GPU_STRIDE. */
export const GPU_BASE = 0x4005_0000;
export const GPU_STRIDE = 0x1_0000;
/** Slot ids a GPU can sit in (a board has at most four PCIe slots); the slot id doubles as the port and clock domain name. */
export const GPU_PORTS: readonly string[] = ["pcie0", "pcie1", "pcie2", "pcie3"];
/** Card registers (word access, offsets from the port base). */
export const GPU_REG = {
  /** ro: GpuStatus bits. */
  STATUS: 0x00,
  /** wo: 1 = launch the kernel at KERNEL on LANES lanes. Starts when written. */
  CMD: 0x04,
  /** rw: byte address of the kernel in card memory. */
  KERNEL: 0x08,
  /** rw: lanes to run, 0 = all of the card's lanes. */
  LANES: 0x0c,
  /** ro: lanes the card has. */
  LANES_MAX: 0x10,
  /** ro: card memory in bytes. */
  MEM_BYTES: 0x14,
  /** ro: memory banks. */
  BANKS: 0x18,
  /** ro: cycles the last kernel took on the card (bank conflicts included, the PCIe hops not). */
  CYCLES: 0x1c,
  /** ro: why the last launch failed (GpuFault), 0 = fine. */
  FAULT: 0x20,
} as const;
/** The card memory window: word k of card memory is at GPU_MEM + 4k. Kernel code and data share it. */
export const GPU_MEM = 0x1000;
/** Bits of GPU_REG.STATUS. Done stays set from the end of a launch until the next one. */
export const GpuStatus = { Busy: 1, Error: 2, Present: 4, Done: 8 } as const;
/** Values of GPU_REG.FAULT. */
export const GpuFaultCode = { None: 0, BadLaunch: 1, Kernel: 2 } as const;
/** Ticks the PCIe hop costs each way, in the card's own clock (docs/ACCEL.md "Bus and MMIO"). */
export const GPU_HOP_TICKS = 8;

// ---- TPM (the header slot). See docs/ACCEL.md "TPM".

export const TPM_BASE = 0x400a_0000;
export const TPM_SIZE = 0x1000;
/** Module registers (word access, offsets from TPM_BASE). */
export const TPM_REG = {
  /** ro: TpmStatus bits. */
  STATUS: 0x00,
  /** wo: a TpmCmd. Starts when written. */
  CMD: 0x04,
  /** rw: first argument (address, nonce or key handle). */
  ARG0: 0x08,
  /** rw: second argument (word count, or the value to seal). */
  ARG1: 0x0c,
  /** ro: what the last command returned (hash, quote or unsealed value). */
  RESULT: 0x10,
  /** ro: why the last command or the job failed (TpmFault), 0 = fine. */
  FAULT: 0x14,
} as const;
export const TpmStatus = { Busy: 1, Error: 2, Present: 4, Done: 8, Protected: 16 } as const;
/** Commands. `Protect` starts protected mode over the byte range [ARG0, ARG0 + 4 * ARG1) of RAM; `Unprotect` ends it. */
export const TpmCmd = { Measure: 1, Attest: 2, Seal: 3, Unseal: 4, Protect: 5, Unprotect: 6 } as const;
export const TpmFault = { None: 0, BadCommand: 1, BadRange: 2, NoSuchKey: 3, Violation: 4 } as const;
/** Ticks the header costs each way, in the module's own clock: slow on purpose (docs/ACCEL.md). */
export const TPM_HOP_TICKS = 20;
/** Ticks a seal or unseal takes inside the module. */
export const TPM_SEAL_TICKS = 10;

// ---- NPU cards (PCIe slots). See docs/ACCEL.md "NPU".

/** The NPU in PCIe slot k sits at NPU_BASE + k * NPU_STRIDE; its port and clock domain are named "npu" + k. */
export const NPU_BASE = 0x400b_0000;
export const NPU_STRIDE = 0x1_0000;
export const NPU_PORTS: readonly string[] = ["npu0", "npu1", "npu2", "npu3"];
/** Registers (word access, offsets from the port base). Status bits are GpuStatus, fault codes GpuFaultCode. */
export const NPU_REG = {
  STATUS: 0x00,
  /** wo: 1 = run COUNT descriptors from DESC. Starts when written. */
  CMD: 0x04,
  /** rw: byte address of the descriptor list in card memory. */
  DESC: 0x08,
  /** rw: number of descriptors. */
  COUNT: 0x0c,
  /** ro: the grid size K (K x K multiply-accumulate cells). */
  GRID: 0x10,
  /** ro: card memory in bytes. */
  MEM_BYTES: 0x14,
  /** ro: cycles the last run took on the card (the PCIe hops not included). */
  CYCLES: 0x1c,
  /** ro: GpuFaultCode of the last launch. */
  FAULT: 0x20,
} as const;
/** The card memory window (word k of card memory at NPU_MEM + 4k): descriptors, weights, activations. */
export const NPU_MEM = 0x1000;
/** A descriptor is four words: op, a, b, c. */
export const NPU_DESC_WORDS = 4;
/** Tile registers the NPU holds (a K x K tile each), besides the accumulator. */
export const NPU_TILES = 4;
/**
 * Descriptor ops. Tiles and the accumulator are K x K int32 matrices stored row-major, K words per row.
 *   Load     tile[a] = card memory at byte address b
 *   Matmul   acc = tile[a] x tile[b]
 *   Macc     acc += tile[a] x tile[b]
 *   Bias     acc[i][j] += the word at b + 4 * i (one bias per row)
 *   Relu     acc = max(acc, 0)
 *   Store    card memory at byte address b = acc
 * And one command for a whole dense layer, so a network is a few descriptors, not hundreds (the command processor walks the tiles):
 *   Layer    the block of NPU_LAYER_WORDS words at byte address a: [W, X, OUT, bias, n, relu] -> OUT = relu(W X + bias) for n x n
 *            row-major int32 matrices (n a multiple of K, at most 16), one bias per output row (bias = NPU_NO_BIAS for none), relu if 1
 */
export const NpuOp = { Load: 1, Matmul: 2, Macc: 3, Bias: 4, Relu: 5, Store: 6, Layer: 7 } as const;
export const NPU_LAYER_WORDS = 6;
/** `Layer`'s "no bias" address. */
export const NPU_NO_BIAS = 0xffff_ffff;
