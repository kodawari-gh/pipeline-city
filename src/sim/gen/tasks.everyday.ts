// The everyday jobs beyond the first three (log, calc, checksum): small programs that need nothing but the CPU and the display, each leaning on
// something different (a dependency chain, unpredictable branches, a shift loop, loads and stores, the multiplier, bytes written backwards, a bit loop).
// docs/JOBS.md lists them with the level each arrives at. Every one prints `#NN label value OK` and computes its answer in TypeScript independently.

import { DISPLAY_COLS, DISPLAY_ROWS } from "../isa/memmap";
import { Builder, blankRows, emitStatic, layoutLine, pad2, renderLine, rowAddr, BUF_BASE, type Seg, type TemplateFn } from "./build";
import * as K from "./kernels";
import { k as defineKernel, type Kernel } from "./kernels";

/** The static text of a result line, put on the display; the number goes in later. `digits` is 2 (value < 64) or 4 (value < 1024). */
function open(b: Builder, p: { row: number; jobId: number }, label: string, digits: 2 | 4) {
  const segs: Seg[] = [`#${pad2(p.jobId)} ${label}`, { dyn: digits }, " OK"];
  const line = layoutLine(segs);
  b.emit(`li s0, ${rowAddr(p.row)}`);
  emitStatic(b, line, 0);
  return { segs, line, digits };
}

/** The result is in a0: show its low bits and end. */
function close(b: Builder, p: { row: number }, o: ReturnType<typeof open>, header: string, value: number) {
  b.emit(`andi a1, a0, ${o.digits === 2 ? 63 : 1023}`, `addi a0, s0, ${o.line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), o.digits))}`);
  return b.finish(header, blankRows(p.row) + renderLine(o.segs, [value & (o.digits === 2 ? 63 : 1023)]));
}

// ---------- fib: a chain where every step needs the one before ----------

/** a2 steps of (x, y) <- (y, x + y) from x = a0, y = a1; the answer is x in a0. Only additions, each waiting for the last: a wide CPU gains nothing, forwarding does. */
const fibLoop = (ns: string): Kernel => defineKernel("fib_loop", ns, ["alu", "branch"], 0, [
  `${ns}_loop:`, "add t0, a0, a1", "mv a0, a1", "mv a1, t0", "addi a2, a2, -1", `bne a2, zero, ${ns}_loop`, "ret",
]);

const cliFib: TemplateFn = (rng, p) => {
  const b = new Builder();
  const x0 = rng.nextInt(5), y0 = 1 + rng.nextInt(5), steps = 8 * p.scale + rng.nextInt(5);
  let x = x0, y = y0;
  for (let i = 0; i < steps; i++) [x, y] = [y, (x + y) | 0];
  const o = open(b, p, "fib=", 2);
  b.emit(`li a0, ${x0}`, `li a1, ${y0}`, `li a2, ${steps}`, `call ${b.add(fibLoop(b.ns("fib")))}`);
  return close(b, p, o, "cli.fib request", x);
};

// ---------- gcd: subtract the smaller from the larger, the branch goes either way ----------

/** The sum of the greatest common divisors of the a1 pairs of words at a0, by repeated subtraction (no divide): which branch is taken depends on the data. */
const gcdSum = (ns: string): Kernel => defineKernel("gcd_sum", ns, ["alu", "mem", "branch"], 0, [
  "li t0, 0", `${ns}_pair:`, "lw t1, 0(a0)", "lw t2, 4(a0)",
  `${ns}_step:`, `beq t1, t2, ${ns}_found`, `blt t1, t2, ${ns}_less`, "sub t1, t1, t2", `j ${ns}_step`,
  `${ns}_less:`, "sub t2, t2, t1", `j ${ns}_step`,
  `${ns}_found:`, "add t0, t0, t1", "addi a0, a0, 8", "addi a1, a1, -1", `bne a1, zero, ${ns}_pair`, "mv a0, t0", "ret",
]);

const cliGcd: TemplateFn = (rng, p) => {
  const b = new Builder();
  const pairs = 2 * p.scale, vals: number[] = [];
  let sum = 0;
  for (let i = 0; i < pairs; i++) {
    let x = 1 + rng.nextInt(60), y = 1 + rng.nextInt(60);
    vals.push(x, y);
    while (x !== y) { if (x < y) y -= x; else x -= y; }
    sum += x;
  }
  const data = b.ns("data");
  const o = open(b, p, "gcd=", 2);
  b.emit(`la a0, ${data}`, `li a1, ${pairs}`, `call ${b.add(gcdSum(b.ns("gcd")), 8 * pairs)}`);
  b.addData([`${data}:`, ...vals.map((w) => `  .word ${w}`)]);
  return close(b, p, o, "cli.gcd request", sum);
};

// ---------- popcount: shift and test, once per bit ----------

/** Count the set bits of the a1 words at a0: a loop of shifts that ends when the word is empty, so its length follows the data. */
const popCount = (ns: string): Kernel => defineKernel("pop_count", ns, ["alu", "mem", "branch"], 0, [
  "li t0, 0", `${ns}_word:`, "lw t1, 0(a0)",
  `${ns}_bit:`, `beq t1, zero, ${ns}_next`, "andi t2, t1, 1", "add t0, t0, t2", "srli t1, t1, 1", `j ${ns}_bit`,
  `${ns}_next:`, "addi a0, a0, 4", "addi a1, a1, -1", `bne a1, zero, ${ns}_word`, "mv a0, t0", "ret",
]);

const cliPopcount: TemplateFn = (rng, p) => {
  const b = new Builder();
  const words = 2 * p.scale, vals: number[] = [];
  let bits = 0;
  for (let i = 0; i < words; i++) {
    const w = 1 + rng.nextInt(65535);
    vals.push(w);
    for (let v = w; v; v >>>= 1) bits += v & 1;
  }
  const data = b.ns("data");
  const o = open(b, p, "bits=", 2);
  b.emit(`la a0, ${data}`, `li a1, ${words}`, `call ${b.add(popCount(b.ns("pop")), 4 * words)}`);
  b.addData([`${data}:`, ...vals.map((w) => `  .word ${w}`)]);
  return close(b, p, o, "cli.popcount request", bits);
};

// ---------- sort: loads and stores that move data around ----------

/** Copy the a2 words at a1 to a0, insertion-sort them there, and return the sum of (position + 1) times value: it only comes out right if every word is in place. */
const insertSort = (ns: string): Kernel => defineKernel("insert_sort", ns, ["mem", "mul", "alu", "branch"], 0, [
  "mv t0, a0", "mv t1, a1", "mv t2, a2",
  `${ns}_copy:`, "lw t3, 0(t1)", "sw t3, 0(t0)", "addi t0, t0, 4", "addi t1, t1, 4", "addi t2, t2, -1", `bne t2, zero, ${ns}_copy`,
  "li t0, 1",
  `${ns}_outer:`, `bge t0, a2, ${ns}_sum`, "slli t1, t0, 2", "add t1, t1, a0", "lw t2, 0(t1)", "mv t3, t0",
  `${ns}_inner:`, `beq t3, zero, ${ns}_place`, "lw t4, -4(t1)", `bge t2, t4, ${ns}_place`, "sw t4, 0(t1)", "addi t1, t1, -4", "addi t3, t3, -1", `j ${ns}_inner`,
  `${ns}_place:`, "sw t2, 0(t1)", "addi t0, t0, 1", `j ${ns}_outer`,
  `${ns}_sum:`, "li t0, 0", "li t1, 1", "mv t2, a0",
  `${ns}_add:`, "lw t3, 0(t2)", "mul t3, t3, t1", "add t0, t0, t3", "addi t2, t2, 4", "addi t1, t1, 1", "addi a2, a2, -1", `bne a2, zero, ${ns}_add`,
  "mv a0, t0", "ret",
]);

const cliSort: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = 6 + 2 * p.scale, vals = Array.from({ length: n }, () => rng.nextInt(100));
  const sorted = [...vals].sort((x, y) => x - y);
  const check = sorted.reduce((s, v, i) => s + (i + 1) * v, 0);
  const data = b.ns("data");
  const o = open(b, p, "sort ", 4);
  b.emit(`li a0, ${BUF_BASE}`, `la a1, ${data}`, `li a2, ${n}`, `call ${b.add(insertSort(b.ns("sort")), 4 * n)}`);
  b.addData([`${data}:`, ...vals.map((w) => `  .word ${w}`)]);
  return close(b, p, o, "cli.sort request", check);
};

// ---------- matmul: three loops of multiply-and-add ----------

/** The sum of every element of the product of the n x n matrices at a0 and a1 (n in a2), computed element by element. All nine working registers are in use. */
const matMul = (ns: string): Kernel => defineKernel("mat_mul", ns, ["mul", "mem", "alu", "branch"], 0, [
  "li a3, 0", "li t0, 0",
  `${ns}_i:`, "li t1, 0",
  `${ns}_j:`, "li t2, 0",
  `${ns}_k:`,
  "mul t3, t0, a2", "add t3, t3, t2", "slli t3, t3, 2", "add t3, t3, a0", "lw t3, 0(t3)",
  "mul t4, t2, a2", "add t4, t4, t1", "slli t4, t4, 2", "add t4, t4, a1", "lw t4, 0(t4)",
  "mul t3, t3, t4", "add a3, a3, t3", "addi t2, t2, 1", `bne t2, a2, ${ns}_k`,
  "addi t1, t1, 1", `bne t1, a2, ${ns}_j`, "addi t0, t0, 1", `bne t0, a2, ${ns}_i`, "mv a0, a3", "ret",
]);

const cliMatmul: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = Math.min(6, 2 + p.scale);
  const A = Array.from({ length: n * n }, () => rng.nextInt(10)), B = Array.from({ length: n * n }, () => rng.nextInt(10));
  let total = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let kk = 0; kk < n; kk++) total += A[i * n + kk]! * B[kk * n + j]!;
  const dA = b.ns("a"), dB = b.ns("b");
  const o = open(b, p, `mm${n} `, 4);
  b.emit(`la a0, ${dA}`, `la a1, ${dB}`, `li a2, ${n}`, `call ${b.add(matMul(b.ns("mm")), 8 * n * n)}`);
  b.addData([`${dA}:`, ...A.map((w) => `  .word ${w}`), `${dB}:`, ...B.map((w) => `  .word ${w}`)]);
  return close(b, p, o, "cli.matmul request", total);
};

// ---------- reverse: bytes written backwards, straight onto the display ----------

const REVERSE_WORDS = ["pipeline", "registers", "bitstream", "scheduler", "mnemonic", "overflow", "firmware", "backplane", "interrupt", "predictor"];

/** Write the a2 bytes at a1 to the display starting at a0, last byte first. One word per row, a row per unit of scale. */
const reverseCopy = (ns: string): Kernel => defineKernel("reverse_copy", ns, ["mem", "alu", "branch", "io"], 0, [
  "add t0, a0, a2", "addi t0, t0, -1",
  `${ns}_loop:`, "lbu t1, 0(a1)", "sb t1, 0(t0)", "addi a1, a1, 1", "addi t0, t0, -1", "addi a2, a2, -1", `bne a2, zero, ${ns}_loop`, "ret",
]);

const cliReverse: TemplateFn = (rng, p) => {
  if (p.row + p.scale > DISPLAY_ROWS) throw new RangeError("scale does not fit on the display");
  const b = new Builder();
  const first = rng.nextInt(REVERSE_WORDS.length), prefix = `#${pad2(p.jobId)} rev `;
  const kernel = b.add(reverseCopy(b.ns("rev")));
  const rows: string[] = [], data: string[] = [];
  b.emit(`li s0, ${rowAddr(p.row)}`);
  for (let r = 0; r < p.scale; r++) {
    const word = REVERSE_WORDS[(first + r) % REVERSE_WORDS.length]!, label = b.ns("data");
    const bytes = [...word].map((c) => c.charCodeAt(0));
    emitStatic(b, layoutLine([prefix]), r * DISPLAY_COLS);
    b.emit(`addi a0, s0, ${r * DISPLAY_COLS + prefix.length}`, `la a1, ${label}`, `li a2, ${bytes.length}`, `call ${kernel}`);
    const words: number[] = [];
    for (let i = 0; i < bytes.length; i += 4) words.push(((bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8) | ((bytes[i + 2] ?? 0) << 16) | ((bytes[i + 3] ?? 0) << 24)) >>> 0);
    data.push(`${label}:`, ...words.map((w) => `  .word ${w}`));
    rows.push(prefix + [...word].reverse().join(""));
  }
  b.addData(data);
  return b.finish("cli.reverse request", blankRows(p.row) + rows.join("\n"));
};

// ---------- crc: a loop over the bits, a branch on each ----------

/** The CRC-32 (reflected, polynomial 0xEDB88320) of the a1 words at a0, a bit at a time: 32 shifts per word, and whether the polynomial is mixed in follows the bit. */
const crc32 = (ns: string): Kernel => defineKernel("crc32", ns, ["alu", "mem", "branch"], 0, [
  "li t0, -1", "li t1, 3988292384",
  `${ns}_word:`, "lw t2, 0(a0)", "xor t0, t0, t2", "li t3, 32",
  `${ns}_bit:`, "andi t4, t0, 1", "srli t0, t0, 1", `beq t4, zero, ${ns}_skip`, "xor t0, t0, t1",
  `${ns}_skip:`, "addi t3, t3, -1", `bne t3, zero, ${ns}_bit`,
  "addi a0, a0, 4", "addi a1, a1, -1", `bne a1, zero, ${ns}_word`, "xori a0, t0, -1", "ret",
]);

const cliCrc: TemplateFn = (rng, p) => {
  const b = new Builder();
  const words = 2 * p.scale, vals = Array.from({ length: words }, () => rng.nextU32());
  let crc = 0xffffffff;
  for (const w of vals) {
    crc = (crc ^ w) >>> 0;
    for (let i = 0; i < 32; i++) crc = (crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1) >>> 0;
  }
  crc = ~crc >>> 0;
  const data = b.ns("data");
  const o = open(b, p, "crc=", 4);
  b.emit(`la a0, ${data}`, `li a1, ${words}`, `call ${b.add(crc32(b.ns("crc")), 4 * words)}`);
  b.addData([`${data}:`, ...vals.map((w) => `  .word ${w}`)]);
  return close(b, p, o, "cli.crc request", crc);
};

export const EVERYDAY_TEMPLATES: Record<string, TemplateFn> = {
  "cli.fib": cliFib,
  "cli.gcd": cliGcd,
  "cli.popcount": cliPopcount,
  "cli.sort": cliSort,
  "cli.matmul": cliMatmul,
  "cli.reverse": cliReverse,
  "cli.crc": cliCrc,
};
