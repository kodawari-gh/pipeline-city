// Scenario templates: kernels + seeded parameters -> one assembly program.
//
// A template is `(rng, params) => Built`. Milestone 1 has the "CLI request" family (log / calc / checksum / scan,
// plus "cli" which picks a family from the seed). To add a scenario (web request, GPU render, secure execution, ...):
// write a TemplateFn, add it to TEMPLATES below, and document it in docs/GEN.md. Nothing else needs to change.

import { DISPLAY_BASE, DISPLAY_COLS, DISPLAY_ROWS } from "../isa/memmap";
import { Prng } from "../machine/prng";
import * as K from "./kernels";
import type { Kernel } from "./kernels";

export interface GenParams {
  /** Work multiplier (default 1): more log lines, more hash words, more scan elements, more multiply rounds. */
  scale?: number;
  /** Display row where the request's output starts (default 0). */
  row?: number;
  /** Job id shown on the display, 0..99 (default: from the seed). */
  jobId?: number;
}

export interface ResolvedParams {
  scale: number;
  row: number;
  jobId: number;
}

/** What a template returns. */
export interface Built {
  /** Assembly for the whole program (code, kernels, data). */
  asm: string;
  /** Kernels instantiated in the program, with the footprint the template knows about added. */
  kernels: Kernel[];
  /** Display text the program should produce, computed in TypeScript independently of the interpreter. */
  expectedText: string;
}

export type TemplateFn = (rng: Prng, p: ResolvedParams) => Built;

/** Scratch RAM for templates that need a data buffer (well above any generated code, well below the stack). */
export const BUF_BASE = 0x4000;
export const MAX_CODE_BYTES = BUF_BASE;
const BUF_LIMIT = 0xc000;

// ---------- program builder ----------

class Builder {
  private n = 0;
  private readonly kernels: Kernel[] = [];
  private readonly body: string[] = [];
  private readonly data: string[] = [];

  /** A fresh label namespace for a kernel or data block. */
  ns(name: string): string {
    return `k${this.n++}_${name}`;
  }
  /** Register a kernel (its function text is appended after main) and return its entry label. `extraFootprint` is the runtime-sized region it touches. */
  add(kernel: Kernel, extraFootprint = 0): string {
    this.kernels.push({ ...kernel, footprintBytes: kernel.footprintBytes + extraFootprint });
    return kernel.ns;
  }
  emit(...lines: string[]): void {
    for (const l of lines) this.body.push(`  ${l}`);
  }
  addData(lines: string[]): void {
    this.data.push(...lines);
  }
  finish(header: string, expectedText: string): Built {
    const asm = [
      `# ${header}`,
      "main:",
      ...this.body,
      "  ecall",
      "",
      ...this.kernels.map((k) => k.asm + "\n"),
      ...this.data,
      "",
    ].join("\n");
    return { asm, kernels: this.kernels, expectedText };
  }
}

// ---------- display lines ----------

/** A line is static text plus numeric fields filled in by print_dec at run time. */
type Seg = string | { dyn: number };

interface Line {
  bytes: (number | null)[]; // null = filled at run time
  fields: { off: number; width: number }[];
}

function layoutLine(segs: Seg[]): Line {
  const bytes: (number | null)[] = [];
  const fields: Line["fields"] = [];
  for (const s of segs) {
    if (typeof s === "string") for (const ch of s) bytes.push(ch.charCodeAt(0));
    else {
      fields.push({ off: bytes.length, width: s.dyn });
      for (let i = 0; i < s.dyn; i++) bytes.push(null);
    }
  }
  if (bytes.length > DISPLAY_COLS) throw new RangeError("line too long");
  return { bytes, fields };
}

/** Text of a line with dynamic fields replaced by the given numbers (zero padded). */
function renderLine(segs: Seg[], values: number[]): string {
  let v = 0;
  return segs.map((s) => (typeof s === "string" ? s : String(values[v++]!).padStart(s.dyn, "0"))).join("");
}

/** Static text goes out as packed word stores (about 3 instructions per 4 characters). Dynamic fields stay 0. */
function emitStatic(b: Builder, line: Line, rowOff: number): void {
  for (let w = 0; w * 4 < line.bytes.length; w++) {
    let val = 0;
    let any = false;
    for (let i = 0; i < 4; i++) {
      const c = line.bytes[w * 4 + i];
      if (c !== undefined && c !== null) {
        val |= c << (8 * i);
        any = true;
      }
    }
    if (!any) continue;
    b.emit(`li t0, ${val >>> 0}`, `sw t0, ${rowOff + 4 * w}(s0)`);
  }
}

function rowAddr(row: number): number {
  if (row < 0 || row >= DISPLAY_ROWS) throw new RangeError(`row ${row}`);
  return DISPLAY_BASE + row * DISPLAY_COLS;
}

function blankRows(row: number): string {
  return "\n".repeat(row);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// ---------- CLI request family ----------

const LOG_MESSAGES = ["user login", "disk sync", "cache warm", "mail queued", "backup done", "config reload", "index built", "queue drained"];

/** Log line request: wait for the display to be idle, then write status lines (one per unit of scale). */
const cliLog: TemplateFn = (rng, p) => {
  if (p.row + p.scale > DISPLAY_ROWS) throw new RangeError("scale does not fit on the display");
  const b = new Builder();
  const first = rng.nextInt(LOG_MESSAGES.length);
  b.emit(`li s0, ${rowAddr(p.row)}`);
  b.emit(`call ${b.add(K.pollIdle(b.ns("poll_idle")))}`);
  const lines: string[] = [];
  for (let i = 0; i < p.scale; i++) {
    const msg = LOG_MESSAGES[(first + i) % LOG_MESSAGES.length]!;
    const text = `#${pad2(p.jobId)} ${msg} OK`;
    lines.push(text);
    emitStatic(b, layoutLine([text]), i * DISPLAY_COLS);
  }
  return b.finish("cli.log request", blankRows(p.row) + lines.join("\n"));
};

/** Compute request: a few rounds of x = x*m + a, shown as a two-digit result (low 6 bits). */
const cliCalc: TemplateFn = (rng, p) => {
  const b = new Builder();
  const x = 2 + rng.nextInt(8);
  const mulBy = [3, 5, 7, 9, 11][rng.nextInt(5)]!;
  const addBy = 1 + rng.nextInt(9);
  const rounds = (1 + rng.nextInt(2)) * p.scale;
  let v = x;
  for (let i = 0; i < rounds; i++) v = (Math.imul(v, mulBy) + addBy) | 0;
  const result = v & 63;
  const segs: Seg[] = [`#${pad2(p.jobId)} mul=`, { dyn: 2 }, " OK"];
  const line = layoutLine(segs);
  b.emit(`li s0, ${rowAddr(p.row)}`);
  emitStatic(b, line, 0);
  b.emit(`li a0, ${x}`, `li a1, ${rounds}`, `call ${b.add(K.mulLoop(b.ns("mul_loop"), mulBy, addBy))}`, "andi a1, a0, 63");
  b.emit(`addi a0, s0, ${line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), 2))}`);
  return b.finish("cli.calc request", blankRows(p.row) + renderLine(segs, [result]));
};

/** Tiny checksum job: hash `scale` data words embedded in the program, show the low 6 bits. */
const cliChecksum: TemplateFn = (rng, p) => {
  const b = new Builder();
  const words = p.scale;
  const vals: number[] = [];
  let h = 5381;
  for (let i = 0; i < words; i++) {
    const w = rng.nextU32();
    vals.push(w);
    h = (((h + (h << 5)) ^ w) >>> 0) | 0;
  }
  const result = h & 63;
  const segs: Seg[] = [`#${pad2(p.jobId)} sum=`, { dyn: 2 }, " OK"];
  const line = layoutLine(segs);
  const data = b.ns("data");
  b.emit(`li s0, ${rowAddr(p.row)}`);
  emitStatic(b, line, 0);
  b.emit(`la a1, ${data}`, `li a2, ${words}`, `call ${b.add(K.checksum(b.ns("checksum")), 4 * words)}`, "andi a1, a0, 63");
  b.emit(`addi a0, s0, ${line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), 2))}`);
  b.addData([`${data}:`, ...vals.map((w) => `  .word ${w}`)]);
  return b.finish("cli.checksum request", blankRows(p.row) + renderLine(segs, [result]));
};

/**
 * Scan job (heavier than the others, not part of the "cli" family; the economy mixes it in): fill a RAM table then sum it.
 * The stride is seeded, 64 B or 128 B: both are cache-hostile (every load of the sum loop misses the default 128 B
 * direct-mapped cache), so scan time is dominated by RAM latency, which is what makes RAM worth buying.
 */
const cliScan: TemplateFn = (rng, p) => {
  const b = new Builder();
  const stride = [64, 128][rng.nextInt(2)]!;
  const count = 4 * p.scale;
  const start = 1 + rng.nextInt(9);
  if (BUF_BASE + count * stride > BUF_LIMIT) throw new RangeError("scale too large for scan");
  let sum = 0;
  for (let i = 0; i < count; i++) sum += start + 3 * i;
  const result = sum & 1023;
  const segs: Seg[] = [`#${pad2(p.jobId)} scan ${count}x${stride}B `, { dyn: 4 }, " OK"];
  const line = layoutLine(segs);
  const region = count * stride;
  b.emit(`li s0, ${rowAddr(p.row)}`);
  emitStatic(b, line, 0);
  b.emit(`li s1, ${BUF_BASE}`, "mv a0, s1", `li a1, ${count}`, `li a2, ${start}`, `call ${b.add(K.fillStride(b.ns("fill"), stride), region)}`);
  b.emit("mv a0, s1", `li a1, ${count}`, `call ${b.add(K.arraySum(b.ns("array_sum"), stride), region)}`, "andi a1, a0, 1023");
  b.emit(`addi a0, s0, ${line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), 4))}`);
  return b.finish("cli.scan request", blankRows(p.row) + renderLine(segs, [result]));
};

const CLI_FAMILIES = [cliLog, cliCalc, cliChecksum];

/** Default CLI request: family picked from the seed. */
const cli: TemplateFn = (rng, p) => CLI_FAMILIES[rng.nextInt(CLI_FAMILIES.length)]!(rng, p);

/** Template registry. Add new scenarios here. */
export const TEMPLATES: Record<string, TemplateFn> = {
  cli,
  "cli.log": cliLog,
  "cli.calc": cliCalc,
  "cli.checksum": cliChecksum,
  "cli.scan": cliScan,
  // Later: "web", "gpu.render", "secure" (see docs/GEN.md "Adding a template").
};
