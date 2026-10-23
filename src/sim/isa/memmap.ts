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
/** Slot ids that carry a block device, in port order (the board slot id doubles as the port / clock domain name). */
export const STORAGE_PORTS: readonly string[] = ["sata0", "sata1", "m20"];
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
