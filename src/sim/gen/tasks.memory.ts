// The memory-bound jobs beyond the scan and the in-memory index: each walks memory in a different pattern (a chain of dependent loads, a straight copy, loads
// that overlap, a column write, flags in bytes, scattered probes), so each is limited by a different part of the memory system. They work in the scratch
// buffer at BUF_BASE, except the hash table, which lives in the big heap at HEAP_BASE like the index does. docs/JOBS.md lists them with their levels.

import { Builder, BUF_BASE, BUF_LIMIT, blankRows, emitStatic, layoutLine, pad2, renderLine, rowAddr, type Seg, type TemplateFn } from "./build";
import * as K from "./kernels";
import { k as defineKernel, type Kernel } from "./kernels";

/** The largest power of two not above `scale`: sizes that mask their index step in powers of two. */
const pow2 = (scale: number): number => 2 ** Math.floor(Math.log2(Math.max(1, scale)));

/** The heap the big jobs use: virtual 0x10000 up (the same value as templates.ts HEAP_BASE, kept here so the task files do not import the registry). */
const HEAP = 0x10000;

function open(b: Builder, p: { row: number; jobId: number }, label: string, digits: 2 | 4) {
  const segs: Seg[] = [`#${pad2(p.jobId)} ${label}`, { dyn: digits }, " OK"];
  const line = layoutLine(segs);
  b.emit(`li s0, ${rowAddr(p.row)}`);
  emitStatic(b, line, 0);
  return { segs, line, digits };
}

function close(b: Builder, p: { row: number }, o: ReturnType<typeof open>, header: string, value: number) {
  b.emit(`andi a1, a0, ${o.digits === 2 ? 63 : 1023}`, `addi a0, s0, ${o.line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), o.digits))}`);
  return b.finish(header, blankRows(p.row) + renderLine(o.segs, [value & (o.digits === 2 ? 63 : 1023)]));
}

function fits(bytes: number): void {
  if (BUF_BASE + bytes > BUF_LIMIT) throw new RangeError("scale too large for this job's buffer");
}

const hash5 = (h: number, w: number): number => (((h + (h << 5)) ^ w) >>> 0) | 0;

// ---------- chase: every load needs the one before ----------

/** Link the a1 nodes (a power of two) of 64 bytes each from a0 into a ring: node i holds the address of node (5i + 1) mod a1. */
const chaseBuild = (ns: string): Kernel => defineKernel("chase_build", ns, ["mem", "alu", "branch"], 0, [
  "li t0, 0", "addi t3, a1, -1",
  `${ns}_loop:`, "slli t1, t0, 2", "add t1, t1, t0", "addi t1, t1, 1", "and t1, t1, t3", "slli t2, t1, 6", "add t2, t2, a0",
  "slli t4, t0, 6", "add t4, t4, a0", "sw t2, 0(t4)", "addi t0, t0, 1", `bne t0, a1, ${ns}_loop`, "ret",
]);

/** Follow the ring from a0 for a1 steps; the address it ends on is the answer. The next address is the thing just loaded: nothing can run ahead. */
const chaseWalk = (ns: string): Kernel => defineKernel("chase_walk", ns, ["mem", "branch"], 0, [
  `${ns}_loop:`, "lw a0, 0(a0)", "addi a1, a1, -1", `bne a1, zero, ${ns}_loop`, "ret",
]);

const memChase: TemplateFn = (_rng, p) => {
  const b = new Builder();
  const nodes = 32 * pow2(p.scale), steps = 2 * nodes + 1;
  fits(nodes * 64);
  let at = 0;
  for (let i = 0; i < steps; i++) at = (5 * at + 1) & (nodes - 1);
  const o = open(b, p, "chase ", 4);
  b.emit(`li a0, ${BUF_BASE}`, `li a1, ${nodes}`, `call ${b.add(chaseBuild(b.ns("build")), nodes * 64)}`);
  b.emit(`li a0, ${BUF_BASE}`, `li a1, ${steps}`, `call ${b.add(chaseWalk(b.ns("walk")), nodes * 64)}`);
  b.emit(`li t0, ${BUF_BASE}`, "sub a0, a0, t0", "srli a0, a0, 6");
  return close(b, p, o, "mem.chase request", at);
};

// ---------- stream: a straight copy, then a hash of the copy ----------

/** Copy a2 words from a1 to a0, one after the other: every address is the next one, so memory can stream. */
export const copyBlock = (ns: string): Kernel => defineKernel("copy_block", ns, ["mem", "alu", "branch"], 0, [
  `${ns}_loop:`, "lw t0, 0(a1)", "sw t0, 0(a0)", "addi a1, a1, 4", "addi a0, a0, 4", "addi a2, a2, -1", `bne a2, zero, ${ns}_loop`, "ret",
]);

const memStream: TemplateFn = (rng, p) => {
  const b = new Builder();
  const words = 32 * p.scale, start = 1 + rng.nextInt(9);
  fits(8 * words);
  const dst = BUF_BASE + 4 * words;
  let h = 5381;
  for (let i = 0; i < words; i++) h = hash5(h, start + 3 * i);
  const o = open(b, p, "stream ", 4);
  b.emit(`li a0, ${BUF_BASE}`, `li a1, ${words}`, `li a2, ${start}`, `call ${b.add(K.fillStride(b.ns("fill"), 4), 4 * words)}`);
  b.emit(`li a0, ${dst}`, `li a1, ${BUF_BASE}`, `li a2, ${words}`, `call ${b.add(copyBlock(b.ns("copy")), 8 * words)}`);
  b.emit(`li a1, ${dst}`, `li a2, ${words}`, `call ${b.add(K.checksum(b.ns("checksum")), 4 * words)}`);
  return close(b, p, o, "mem.stream request", h);
};

// ---------- stencil: three loads for every output, most of them seen before ----------

/** out[i] = a[i-1] + a[i] + a[i+1] for i = 1 .. n-2 (a0 = a, a1 = out, a2 = n); returns the sum of the outputs. */
const stencil3 = (ns: string): Kernel => defineKernel("stencil3", ns, ["mem", "alu", "branch"], 0, [
  "addi a0, a0, 4", "addi a1, a1, 4", "addi a2, a2, -2", "li t0, 0",
  `${ns}_loop:`, "lw t1, -4(a0)", "lw t2, 0(a0)", "lw t3, 4(a0)", "add t1, t1, t2", "add t1, t1, t3", "sw t1, 0(a1)", "add t0, t0, t1",
  "addi a0, a0, 4", "addi a1, a1, 4", "addi a2, a2, -1", `bne a2, zero, ${ns}_loop`, "mv a0, t0", "ret",
]);

const memStencil: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = 32 * p.scale, start = 1 + rng.nextInt(9);
  fits(8 * n);
  let sum = 0;
  for (let i = 1; i < n - 1; i++) sum += 3 * (start + 3 * i);
  const o = open(b, p, "stencil ", 4);
  b.emit(`li a0, ${BUF_BASE}`, `li a1, ${n}`, `li a2, ${start}`, `call ${b.add(K.fillStride(b.ns("fill"), 4), 4 * n)}`);
  b.emit(`li a0, ${BUF_BASE}`, `li a1, ${BUF_BASE + 4 * n}`, `li a2, ${n}`, `call ${b.add(stencil3(b.ns("stencil")), 8 * n)}`);
  return close(b, p, o, "mem.stencil request", sum);
};

// ---------- transpose: read along a row, write down a column ----------

/** dst[j * n + i] = src[i * n + j] for an n x n matrix (a0 = src, a1 = dst, a2 = n): the reads go in order, the writes jump a whole row each time. */
const transposeK = (ns: string): Kernel => defineKernel("transpose", ns, ["mem", "alu", "branch"], 0, [
  "slli t4, a2, 2", "li t0, 0",
  `${ns}_i:`, "slli t1, t0, 2", "add t1, t1, a1", "li t2, 0",
  `${ns}_j:`, "lw t3, 0(a0)", "sw t3, 0(t1)", "addi a0, a0, 4", "add t1, t1, t4", "addi t2, t2, 1", `bne t2, a2, ${ns}_j`,
  "addi t0, t0, 1", `bne t0, a2, ${ns}_i`, "ret",
]);

/** The sum of a1 words from a0, each times (its index mod 8, plus 1): it only comes out right if every word is where it belongs. */
const weightedSum = (ns: string): Kernel => defineKernel("weighted_sum", ns, ["mem", "mul", "alu", "branch"], 0, [
  "li t0, 0", "li t1, 0",
  `${ns}_loop:`, "lw t2, 0(a0)", "andi t3, t1, 7", "addi t3, t3, 1", "mul t2, t2, t3", "add t0, t0, t2", "addi a0, a0, 4", "addi t1, t1, 1", `bne t1, a1, ${ns}_loop`, "mv a0, t0", "ret",
]);

const memTranspose: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = 8 * pow2(p.scale), cells = n * n, start = 1 + rng.nextInt(9);
  fits(8 * cells);
  const dst = BUF_BASE + 4 * cells;
  let sum = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) sum += (start + 3 * (i * n + j)) * (((j * n + i) & 7) + 1);
  const o = open(b, p, "transpose ", 4);
  b.emit(`li a0, ${BUF_BASE}`, `li a1, ${cells}`, `li a2, ${start}`, `call ${b.add(K.fillStride(b.ns("fill"), 4), 4 * cells)}`);
  b.emit(`li a0, ${BUF_BASE}`, `li a1, ${dst}`, `li a2, ${n}`, `call ${b.add(transposeK(b.ns("transpose")), 8 * cells)}`);
  b.emit(`li a0, ${dst}`, `li a1, ${cells}`, `call ${b.add(weightedSum(b.ns("weighted")), 4 * cells)}`);
  return close(b, p, o, "mem.transpose request", sum);
};

// ---------- sieve: flags in bytes, crossed off in strides ----------

/** Count the primes below a1 (a0 = a byte per number): clear the flags, then for each prime cross off its multiples from its square up. */
const sieveCount = (ns: string): Kernel => defineKernel("sieve_count", ns, ["mem", "mul", "alu", "branch"], 0, [
  "mv t0, a0", "mv t1, a1",
  `${ns}_clear:`, "sb zero, 0(t0)", "addi t0, t0, 1", "addi t1, t1, -1", `bne t1, zero, ${ns}_clear`,
  "li t0, 2", "li a2, 0", "li t2, 1",
  `${ns}_outer:`, `bge t0, a1, ${ns}_done`, "add t1, a0, t0", "lbu t4, 0(t1)", `bne t4, zero, ${ns}_next`,
  "addi a2, a2, 1", "mul t3, t0, t0",
  `${ns}_cross:`, `bge t3, a1, ${ns}_next`, "add t4, a0, t3", "sb t2, 0(t4)", "add t3, t3, t0", `j ${ns}_cross`,
  `${ns}_next:`, "addi t0, t0, 1", `j ${ns}_outer`,
  `${ns}_done:`, "mv a0, a2", "ret",
]);

const memSieve: TemplateFn = (_rng, p) => {
  const b = new Builder();
  const n = 64 * p.scale;
  fits(n);
  const flags = new Uint8Array(n);
  let primes = 0;
  for (let i = 2; i < n; i++) if (!flags[i]) { primes++; for (let j = i * i; j < n; j += i) flags[j] = 1; }
  const o = open(b, p, "sieve ", 4);
  b.emit(`li a0, ${BUF_BASE}`, `li a1, ${n}`, `call ${b.add(sieveCount(b.ns("sieve")), n)}`);
  return close(b, p, o, "mem.sieve request", primes);
};

// ---------- hashtab: keys scattered over a table in the big heap ----------

const TABLE_WORDS = 256;
const PHI = 2654435761;

/** Zero a1 words from a0. */
const zeroWords = (ns: string): Kernel => defineKernel("zero_words", ns, ["mem", "alu", "branch"], 0, [
  `${ns}_loop:`, "sw zero, 0(a0)", "addi a0, a0, 4", "addi a1, a1, -1", `bne a1, zero, ${ns}_loop`, "ret",
]);

/** Insert the a2 non-zero keys at a1 into the 256-word table at a0 (open addressing, step to the next slot on a clash). */
const hashInsert = (ns: string): Kernel => defineKernel("hash_insert", ns, ["mem", "mul", "alu", "branch"], 0, [
  `li t4, ${PHI}`,
  `${ns}_key:`, "lw t0, 0(a1)", "mul t1, t0, t4", "srli t1, t1, 24",
  `${ns}_probe:`, "slli t2, t1, 2", "add t2, t2, a0", "lw t3, 0(t2)", `beq t3, zero, ${ns}_put`, "addi t1, t1, 1", `andi t1, t1, ${TABLE_WORDS - 1}`, `j ${ns}_probe`,
  `${ns}_put:`, "sw t0, 0(t2)", "addi a1, a1, 4", "addi a2, a2, -1", `bne a2, zero, ${ns}_key`, "ret",
]);

/** Look the a2 keys at a1 up in the table at a0; returns the number of slots it looked at in all (a clash costs another). */
const hashFind = (ns: string): Kernel => defineKernel("hash_find", ns, ["mem", "mul", "alu", "branch"], 0, [
  "li a3, 0", `li t4, ${PHI}`,
  `${ns}_key:`, "lw t0, 0(a1)", "mul t1, t0, t4", "srli t1, t1, 24",
  `${ns}_probe:`, "addi a3, a3, 1", "slli t2, t1, 2", "add t2, t2, a0", "lw t3, 0(t2)", `beq t3, t0, ${ns}_found`, "addi t1, t1, 1", `andi t1, t1, ${TABLE_WORDS - 1}`, `j ${ns}_probe`,
  `${ns}_found:`, "addi a1, a1, 4", "addi a2, a2, -1", `bne a2, zero, ${ns}_key`, "mv a0, a3", "ret",
]);

const memHashtab: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = Math.min(64, 16 * pow2(p.scale)), keys = new Set<number>();
  while (keys.size < n) keys.add(1 + rng.nextInt(65535));
  const list = [...keys];
  const table = new Array<number>(TABLE_WORDS).fill(0);
  const slot = (key: number) => Math.imul(key, PHI) >>> 24;
  for (const key of list) { let s = slot(key); while (table[s]) s = (s + 1) & (TABLE_WORDS - 1); table[s] = key; }
  let looked = 0;
  for (const key of list) { let s = slot(key); looked++; while (table[s] !== key) { s = (s + 1) & (TABLE_WORDS - 1); looked++; } }
  const data = b.ns("keys");
  const o = open(b, p, "hash ", 4);
  b.emit(`li a0, ${HEAP}`, `li a1, ${TABLE_WORDS}`, `call ${b.add(zeroWords(b.ns("zero")), 4 * TABLE_WORDS)}`);
  b.emit(`li a0, ${HEAP}`, `la a1, ${data}`, `li a2, ${n}`, `call ${b.add(hashInsert(b.ns("insert")), 4 * TABLE_WORDS)}`);
  b.emit(`li a0, ${HEAP}`, `la a1, ${data}`, `li a2, ${n}`, `call ${b.add(hashFind(b.ns("find")), 4 * TABLE_WORDS)}`);
  b.addData([`${data}:`, ...list.map((w) => `  .word ${w}`)]);
  return close(b, p, o, "mem.hashtab request", looked);
};

/** The bytes the hash table job keeps in the heap (for the RAM it needs). */
export const HASH_BYTES = 4 * TABLE_WORDS;

export const MEMORY_TEMPLATES: Record<string, TemplateFn> = {
  "mem.chase": memChase,
  "mem.stream": memStream,
  "mem.stencil": memStencil,
  "mem.transpose": memTranspose,
  "mem.sieve": memSieve,
  "mem.hashtab": memHashtab,
};
