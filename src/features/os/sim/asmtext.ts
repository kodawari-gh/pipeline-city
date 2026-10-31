// Asm text helpers for the boot ROM and the kernel: packed word stores to the text display.

import { DISPLAY_COLS } from "@/core/sim/memmap";

export const ROW = DISPLAY_COLS;
/** Display row of the status line (the ROM and the kernel both write it). */
export const STATUS_ROW = 5;

/**
 * Packed word stores of `text` at byte offset `off` from the register `base` (the display base). NUL bytes are
 * skipped placeholders. Clobbers t0.
 */
export function textStores(off: number, text: string, base = "s0"): string[] {
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
    if (any) out.push(`  li t0, ${val >>> 0}`, `  sw t0, ${off + 4 * w}(${base})`);
  }
  return out;
}

/** Status line, always 12 characters so each text fully replaces the last. */
export function status(text: string, base = "s0"): string[] {
  return textStores(STATUS_ROW * ROW, text.padEnd(12), base);
}
