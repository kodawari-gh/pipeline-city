import type { BusKind } from './features';

export const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
/** The PSU panel is a dark LCD, so its text uses fixed light inks. */
export const LCD_INK = '#dbe5ff',
  LCD_MUTE = '#8d9bc4';
/** OS status screen: row count, font size and line height in world units (readable at overview zoom). */
export const OS_INK = '#7dffb0',
  OS_DIM = '#52a981',
  OS_RULE = '#2f5a46',
  OS_AMBER = '#ffc247',
  OS_CYAN = '#4fe3ff';
export const OS_ROWS = 10,
  OS_FONT = 118,
  OS_LINE = 150,
  OS_COLS = 42;

/** Game ms between packets on a bus that streams (a boot phase, a busy drive), and the least between two one-off messages on a bus. */
export const STREAM_GAP = 240;
export const MIN_GAP = 100;
/** Game ms between two pings of POST. */
export const PROBE_MS = 600;
/** The buses that end on the chipset: a message on one of them makes the chipset glow. */
export const CHIPSET_BUSES: ReadonlySet<BusKind> = new Set<BusKind>(['dmi', 'sata', 'spi', 'lpc', 'dbg']);
