// Reading a crashed machine's RAM as text (crash.ts): the address an error names and words in hex.

export const hex = (n: number, w = 0): string => (n >>> 0).toString(16).padStart(w, '0');
export const h = (n: number): string => `0x${hex(n)}`;

/** The address in an error message ("... at pc=0xd310"), if it names one. */
export function pcOf(message: string): number | null {
  const pc = /pc=0x(?<pc>[0-9a-f]+)/iu.exec(message)?.groups?.['pc'];
  return pc === undefined ? null : Number.parseInt(pc, 16);
}

/** `n` words of RAM from `base`, eight to a line; stops at the end of RAM. */
export function wordsHex(ram: Uint8Array, base: number, n: number): string {
  const dv = new DataView(ram.buffer, ram.byteOffset, ram.byteLength);
  const lines: string[] = [];
  for (let i = 0; i < n; i += 8) {
    const at = base + i * 4;
    if (at + 4 > ram.length) {
      break;
    }
    const row: string[] = [];
    for (let j = i; j < Math.min(n, i + 8) && base + j * 4 + 4 <= ram.length; j++) {
      row.push(hex(dv.getUint32(base + j * 4, true), 8));
    }
    lines.push(`${hex(at, 4)}: ${row.join(' ')}`);
  }
  return lines.join('\n');
}
