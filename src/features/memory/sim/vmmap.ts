// The page tables as the RAM view shows them (docs/VM.md "Seen"): the mapping of an address space, read straight out of RAM the way the MMU walks it.

import { PteBit } from "@/core/sim/memmap";

/** One mapped page: virtual page number (address >> 8), the frame it is in, and its Valid/Write/Exec bits. */
export interface Mapping { vpn: number; frame: number; flags: number }

const word = (ram: Uint8Array, a: number): number => (a + 4 <= ram.length ? (ram[a]! | (ram[a + 1]! << 8) | (ram[a + 2]! << 16) | (ram[a + 3]! << 24)) >>> 0 : 0);

/** Every valid page of the address space whose level 1 table is at physical `table`, in virtual order, and the frames of its tables. */
export function walkTable(ram: Uint8Array, table: number): { pages: Mapping[]; tables: number[] } {
  const pages: Mapping[] = [], tables: number[] = [table >>> 8];
  if (table <= 0 || table + 256 > ram.length) return { pages, tables: [] };
  for (let i = 0; i < 64; i++) {
    const e1 = word(ram, table + 4 * i);
    if (!(e1 & PteBit.Valid)) continue;
    const l2 = (e1 >>> 8) * 256;
    if (l2 + 256 > ram.length) continue;
    tables.push(e1 >>> 8);
    for (let j = 0; j < 64; j++) {
      const e2 = word(ram, l2 + 4 * j);
      if (e2 & PteBit.Valid) pages.push({ vpn: (i << 6) | j, frame: e2 >>> 8, flags: e2 & 7 });
    }
  }
  return { pages, tables };
}

/** "RWX" with a dash for each bit that is off. */
export const flagText = (flags: number): string => `${flags & PteBit.Valid ? "R" : "-"}${flags & PteBit.Write ? "W" : "-"}${flags & PteBit.Exec ? "X" : "-"}`;
