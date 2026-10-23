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
  /** ro: bit0 key plugged, bit1 key already holds a result, bit2 a key was pulled since the last CTRL bit1 acknowledge. */
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
} as const;
/** Read-only window onto the plugged key's program (word reads). */
export const PCH_KEY_WINDOW = 0x1000;
export const PCH_KEY_WINDOW_SIZE = 0x3000;
/** Write window for the result words the ROM copies back to the key. */
export const PCH_RESULT_WINDOW = 0x4000;
export const PCH_RESULT_WORDS = 8;

/** Values of PCH_REG.PHASE. */
export const PchPhase = { Off: 0, Posting: 1, Waiting: 2, Loading: 3, Running: 4, Writing: 5, Done: 6 } as const;
