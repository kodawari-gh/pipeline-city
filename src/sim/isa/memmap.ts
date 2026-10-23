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
