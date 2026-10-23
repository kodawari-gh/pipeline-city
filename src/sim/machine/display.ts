import { DISPLAY_BASE, DISPLAY_COLS, DISPLAY_ROWS, DISPLAY_SIZE } from "../isa/memmap";
import type { Rate } from "./clock";
import type { Device } from "./device";

/**
 * Memory-mapped text framebuffer: cols x rows ASCII bytes, row-major.
 * With writeLatency > 0 each write takes that many display ticks to land, one at a time, in order.
 * Reads return what has landed so far.
 */
export class Display implements Device {
  readonly name = "display";
  readonly base = DISPLAY_BASE;
  readonly size = DISPLAY_SIZE;
  readonly cells = new Uint8Array(DISPLAY_SIZE);
  private readonly queue: { addr: number; val: number }[] = [];
  private countdown = 0;

  constructor(
    readonly clock: Rate = { mul: 1, div: 1 },
    readonly writeLatency = 0,
    readonly cols = DISPLAY_COLS,
    readonly rows = DISPLAY_ROWS,
  ) {}

  read(addr: number): number {
    return this.cells[addr]!;
  }

  write(addr: number, val: number): void {
    if (this.writeLatency <= 0) this.cells[addr] = val & 0xff;
    else this.queue.push({ addr, val: val & 0xff });
  }

  /** Writes accepted but not yet landed. */
  get pending(): number {
    return this.queue.length;
  }

  /** Blank the screen and drop queued writes (the game does this when a request starts or restarts). */
  clear(): void {
    this.cells.fill(0);
    this.queue.length = 0;
    this.countdown = 0;
  }

  tick(): void {
    if (this.queue.length === 0) return;
    if (++this.countdown >= this.writeLatency) {
      this.countdown = 0;
      const w = this.queue.shift()!;
      this.cells[w.addr] = w.val;
    }
  }

  /** Rows of text (NUL shown as space, trailing spaces trimmed, trailing empty rows dropped). */
  text(): string {
    const rows: string[] = [];
    for (let y = 0; y < this.rows; y++) {
      let s = "";
      for (let x = 0; x < this.cols; x++) {
        const b = this.cells[y * this.cols + x]!;
        s += b === 0 ? " " : String.fromCharCode(b);
      }
      rows.push(s.trimEnd());
    }
    while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
    return rows.join("\n");
  }
}
