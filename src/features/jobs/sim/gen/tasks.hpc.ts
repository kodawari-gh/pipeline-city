// The high-performance compute jobs (docs/MULTICORE.md section 7, docs/JOBS.md): one program for T threads that split the work by their number k (a0) and meet
// at barriers. Each prints `#NN hpc.<kind>=NNNN OK`. Every program is race free (a word is written by one thread or with an atomic, and read by others only after
// a barrier), so the text is the same under any timing. The thread count T is read from a1 at run time, and a program started without it (a1 = 0: the generic
// tests, the plain reference) runs as one thread that does all of it, which gives the same text.
//
// Registers: a0 = k, a1 = T (1 if none), a2 = log2 T stay as they are; the rest is free until the print. Shared words: the barrier counter (THREAD_SYNC) counts
// arrivals and never goes back, so barrier number n is passed when it reaches n x T; the total (THREAD_TOTAL) is the sum of the threads' partial results.

import { THREAD_SYNC } from "./build";
import { Builder, blankRows, emitStatic, layoutLine, pad2, renderLine, rowAddr, type Seg, type TemplateFn } from "./build";
import * as K from "./kernels";
import { THREAD_TOTAL } from "./threadtest";

const imul = Math.imul;
const mask = (v: number): number => v & 1023;
const words = (label: string, ws: number[]): string[] => [`${label}:`, ...ws.map((w) => `  .word ${w >>> 0}`)];

/** The program's start: its line on the display, and a1 = T (at least 1), a2 = log2 T. */
function open(b: Builder, p: { jobId: number }, label: string) {
  const segs: Seg[] = [`#${pad2(p.jobId)} ${label}=`, { dyn: 4 }, " OK"];
  const line = layoutLine(segs);
  b.emit(
    "bne a1, zero, hpc_t",
    "li a1, 1", // no thread count: all of it, alone
    "hpc_t:",
    "li a2, 0",
    "mv t0, a1",
    "hpc_lg:",
    "li t1, 1",
    "bge t1, t0, hpc_lg_done",
    "srli t0, t0, 1",
    "addi a2, a2, 1",
    "j hpc_lg",
    "hpc_lg_done:",
  );
  return { segs, line };
}

/** Wait until `phase` (a register) x T threads have arrived at the barrier; this thread arrives first. Clobbers t0 to t2. */
function barrier(id: string, phase: string): string[] {
  return [
    `mul t0, ${phase}, a1`, `li t1, ${THREAD_SYNC}`, "li t2, 1", "amoadd zero, t2, (t1)",
    `${id}:`, "lw t2, 0(t1)", `blt t2, t0, ${id}`,
  ];
}

/** The last barrier: the threads other than 0 are done once they have arrived; thread 0 waits for them all (`phases` barriers so far, this one included). */
function join(phases: number): string[] {
  return [
    `li t0, ${phases}`, "mul t0, t0, a1", `li t1, ${THREAD_SYNC}`, "li t2, 1", "amoadd zero, t2, (t1)",
    "bne a0, zero, thread_end",
    "hpc_join:", "lw t2, 0(t1)", "blt t2, t0, hpc_join",
  ];
}

/** Add the partial in `reg` (not t1) to the shared total. */
const addTotal = (reg: string): string[] => [`li t1, ${THREAD_TOTAL}`, `amoadd zero, ${reg}, (t1)`];

/** Thread 0 prints the value in a1 (or the shared total when `fromTotal`), the way every line is made. */
function show(b: Builder, p: { row: number }, o: ReturnType<typeof open>, header: string, value: number, fromTotal: boolean) {
  b.emit(`li s0, ${rowAddr(p.row)}`);
  emitStatic(b, o.line, 0);
  if (fromTotal) b.emit(`li t1, ${THREAD_TOTAL}`, "lw a1, 0(t1)");
  b.emit("andi a1, a1, 1023", `addi a0, s0, ${o.line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), 4))}`);
  return b.finish(header, blankRows(p.row) + renderLine(o.segs, [mask(value)]), THREADS_OF[header]!);
}

/** The thread counts of the kinds, by header. */
const THREADS_OF: Record<string, number> = {
  "hpc.reduce request": 2, "hpc.matmul request": 2, "hpc.nbody request": 2, "hpc.montecarlo request": 4, "hpc.sort request": 4, "hpc.bfs request": 8, "hpc.fft request": 8,
};

/** This thread's share of `n` items (a power of two times T): `first` (an index) and `end`, into the registers given. Clobbers nothing else. */
const slice = (n: number, first: string, end: string): string[] => [`li ${end}, ${n}`, `srl ${end}, ${end}, a2`, `mul ${first}, ${end}, a0`, `add ${end}, ${end}, ${first}`];

// ---------- reduce: fold a long array into one number ----------

/** Sum of f(a) = a x a + a / 8 over 64 x scale words: the fold of a column of data. */
const hpcReduce: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = 64 * p.scale, vals = Array.from({ length: n }, () => rng.nextInt(1000));
  let total = 0;
  for (const a of vals) total = (total + imul(a, a) + (a >>> 3)) | 0;
  const data = b.ns("data");
  const o = open(b, p, "hpc.reduce");
  b.emit(
    ...slice(n, "t3", "t2"), // t3 = first, t2 = end
    `la s1, ${data}`, "slli t0, t3, 2", "add s1, s1, t0",
    "sub t2, t2, t3", "li s2, 0",
    "hpc_loop:", "lw t3, 0(s1)", "mul t4, t3, t3", "srli t0, t3, 3", "add t4, t4, t0", "add s2, s2, t4", "addi s1, s1, 4", "addi t2, t2, -1", "bne t2, zero, hpc_loop",
    ...addTotal("s2"), ...join(1),
  );
  b.addData(words(data, vals));
  return show(b, p, o, "hpc.reduce request", total, true);
};

// ---------- matmul: C = A x B, the rows of C split between the threads ----------

/** An 8 x K by K x 8 product (K = 8 x scale), the rows of A split between the threads; the answer is the sum of C. */
const hpcMatmul: TemplateFn = (rng, p) => {
  const b = new Builder();
  const R = 8, C = 8, Kd = 8 * p.scale;
  const A = Array.from({ length: R * Kd }, () => rng.nextInt(16)), B = Array.from({ length: Kd * C }, () => rng.nextInt(16));
  let total = 0;
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) for (let k = 0; k < Kd; k++) total = (total + imul(A[i * Kd + k]!, B[k * C + j]!)) | 0;
  const da = b.ns("a"), db = b.ns("b");
  const o = open(b, p, "hpc.matmul");
  b.emit(
    ...slice(R, "t0", "a3"), "sub a3, a3, t0", // a3 = rows for this thread
    `li t1, ${Kd * 4}`, "mul t1, t1, t0", `la s1, ${da}`, "add s1, s1, t1", "li s2, 0",
    "hpc_row:",
    "li s3, 0", `la s0, ${db}`,
    "hpc_col:",
    "mv t0, s1", "mv t1, s0", `li t2, ${Kd}`, "li t3, 0",
    "hpc_k:", "lw t4, 0(t0)", "lw ra, 0(t1)", "mul t4, t4, ra", "add t3, t3, t4", "addi t0, t0, 4", `addi t1, t1, ${C * 4}`, "addi t2, t2, -1", "bne t2, zero, hpc_k",
    "add s2, s2, t3", "addi s0, s0, 4", "addi s3, s3, 1", `li t4, ${C}`, "bne s3, t4, hpc_col",
    `addi s1, s1, ${Kd * 4}`, "addi a3, a3, -1", "bne a3, zero, hpc_row",
    ...addTotal("s2"), ...join(1),
  );
  b.addData([...words(da, A), ...words(db, B)]);
  return show(b, p, o, "hpc.matmul request", total, true);
};

// ---------- nbody: bodies pulling on each other, a step at a time ----------

/** 16 bodies on a line, `scale` steps: each step every body moves by (sum of (p_j - p_i) x m_j) / 256, from the positions of the step before (two buffers, a barrier between steps). */
const hpcNbody: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = 16, steps = p.scale;
  const pos = Array.from({ length: n }, () => rng.nextInt(1000)), mass = Array.from({ length: n }, () => 1 + rng.nextInt(4));
  let cur = pos.slice();
  for (let s = 0; s < steps; s++) {
    cur = cur.map((pi) => (pi + (cur.reduce((acc, pj, j) => (acc + imul(pj - pi, mass[j]!)) | 0, 0) >> 8)) | 0);
  }
  const total = cur.reduce((a, v) => (a + v) | 0, 0);
  const b0 = b.ns("b0"), b1 = b.ns("b1");
  const o = open(b, p, "hpc.nbody");
  b.emit(
    "li a3, 0",
    "hpc_step:",
    `la s1, ${b0}`, `la s3, ${b1}`, "andi t0, a3, 1", "beq t0, zero, hpc_even", "mv t0, s1", "mv s1, s3", "mv s3, t0", "hpc_even:", // s1 = this step's positions, s3 = where they go
    ...slice(n, "t1", "t2"), "slli t1, t1, 3", "slli t2, t2, 3", "add s2, s1, t1", "add s0, s1, t2", // s2 = my first body, s0 = past my last
    "hpc_body:",
    "lw ra, 0(s2)", "mv t0, s1", `li t4, ${n}`, "li t3, 0",
    "hpc_pull:", "lw t1, 0(t0)", "lw t2, 4(t0)", "sub t1, t1, ra", "mul t1, t1, t2", "add t3, t3, t1", "addi t0, t0, 8", "addi t4, t4, -1", "bne t4, zero, hpc_pull",
    "srai t3, t3, 8", "add ra, ra, t3", "sub t0, s2, s1", "add t0, t0, s3", "sw ra, 0(t0)",
    "addi s2, s2, 8", "bne s2, s0, hpc_body",
    "addi a3, a3, 1",
    ...barrier("hpc_bar", "a3"),
    `li t0, ${steps}`, "bne a3, t0, hpc_step",
    ...slice(n, "t1", "t2"), "slli t1, t1, 3", "slli t2, t2, 3", `la s2, ${steps % 2 === 1 ? b1 : b0}`, "add s1, s2, t1", "add s0, s2, t2", "li s2, 0", // the last step's buffer: my bodies
    "hpc_sum:", "lw t0, 0(s1)", "add s2, s2, t0", "addi s1, s1, 8", "bne s1, s0, hpc_sum",
    ...addTotal("s2"), ...join(steps + 1),
  );
  const pairs = (xs: number[]) => xs.flatMap((x, i) => [x, mass[i]!]);
  b.addData([...words(b0, pairs(pos)), ...words(b1, pairs(pos.map(() => 0)))]);
  return show(b, p, o, "hpc.nbody request", total, true);
};

// ---------- montecarlo: how many random points land inside the quarter circle ----------

/** 256 x scale points from a multiplicative hash of their number (so the count does not depend on how many threads split them); the answer is the count inside the circle. */
const hpcMonteCarlo: TemplateFn = (_rng, p) => {
  const b = new Builder();
  const n = 256 * p.scale, MUL = 0x9e3779b1 | 0;
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const h = imul(i + 1, MUL) >>> 0, x = h >>> 24, y = (h >>> 16) & 255;
    if (x * x + y * y < 65536) hits++;
  }
  const o = open(b, p, "hpc.montecarlo");
  b.emit(
    ...slice(n, "t1", "t0"), // t1 = first point, t0 = past the last
    `li t2, ${MUL}`, "li s2, 0",
    "hpc_pt:", "addi t3, t1, 1", "mul t3, t3, t2", "srli t4, t3, 24", "mul t4, t4, t4", "srli t3, t3, 16", "andi t3, t3, 255", "mul t3, t3, t3", "add t4, t4, t3",
    "srli t4, t4, 16", "sltiu t4, t4, 1", "add s2, s2, t4", "addi t1, t1, 1", "bne t1, t0, hpc_pt",
    ...addTotal("s2"), ...join(1),
  );
  return show(b, p, o, "hpc.montecarlo request", hits, true);
};

// ---------- sort: each thread sorts its part, thread 0 merges the runs ----------

/** 16 x scale words, bubble sort of each thread's quarter, then thread 0 merges the runs and adds up value x (position + 1). */
const hpcSort: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = 16 * p.scale, vals = Array.from({ length: n }, () => rng.nextInt(1000));
  const sorted = vals.slice().sort((x, y) => x - y);
  let total = 0;
  sorted.forEach((v, i) => { total = (total + imul(v, i + 1)) | 0; });
  const data = b.ns("data");
  const o = open(b, p, "hpc.sort");
  b.emit(
    ...slice(n, "t1", "t0"), "sub t0, t0, t1", "slli t1, t1, 2", "slli t0, t0, 2", `la s1, ${data}`, "add s1, s1, t1", "add a3, s1, t0", // s1 = my run, a3 = past it
    "addi s2, a3, -4", // s2 = the last element still to place
    "hpc_pass:", "bgeu s1, s2, hpc_sorted", "mv t1, s1",
    "hpc_cmp:", "lw t2, 0(t1)", "lw t3, 4(t1)", "bge t3, t2, hpc_ok", "sw t3, 0(t1)", "sw t2, 4(t1)",
    "hpc_ok:", "addi t1, t1, 4", "bne t1, s2, hpc_cmp",
    "addi s2, s2, -4", "j hpc_pass",
    "hpc_sorted:",
    ...join(1),
    // thread 0: the heads of the runs live in the shared parts words; each output position takes the smallest head
    `li s3, ${n}`, "srl s3, s3, a2", `li a3, ${THREAD_TOTAL + 4}`,
    "li t0, 0",
    "hpc_h:", "slli t4, t0, 2", "add t4, t4, a3", "mul t1, t0, s3", "sw t1, 0(t4)", "addi t0, t0, 1", "bne t0, a1, hpc_h",
    "li s1, 0", "li s2, 1",
    "hpc_out:",
    "li t1, 0x7fffffff", "li t2, -1", "li t0, 0",
    "hpc_scan:", "slli t4, t0, 2", "add t4, t4, a3", "lw t3, 0(t4)", "addi ra, t0, 1", "mul ra, ra, s3", "beq t3, ra, hpc_skip",
    "slli t3, t3, 2", `la t4, ${data}`, "add t3, t3, t4", "lw t3, 0(t3)", "bge t3, t1, hpc_skip", "mv t1, t3", "mv t2, t0",
    "hpc_skip:", "addi t0, t0, 1", "bne t0, a1, hpc_scan",
    "mul t3, t1, s2", "add s1, s1, t3",
    "slli t4, t2, 2", "add t4, t4, a3", "lw t3, 0(t4)", "addi t3, t3, 1", "sw t3, 0(t4)",
    "addi s2, s2, 1", `li t0, ${n + 1}`, "bne s2, t0, hpc_out",
    "mv a1, s1",
  );
  b.addData(words(data, vals));
  return show(b, p, o, "hpc.sort request", total, false);
};

// ---------- bfs: levels of a graph, a barrier after each ----------

/** A graph of 32 x scale vertices, each with two in-edges (the first from a lower vertex, so all are reachable from 0): breadth-first levels, every thread settling its own vertices each level. The answer is the sum of the levels. */
const hpcBfs: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = 32 * p.scale;
  const pred1 = Array.from({ length: n }, (_, v) => (v === 0 ? 0 : rng.nextInt(v))), pred2 = Array.from({ length: n }, () => rng.nextInt(n));
  const dist: number[] = Array.from({ length: n }, (_, v) => (v === 0 ? 0 : -1));
  let depth = 0;
  for (let level = 1; ; level++) {
    const next = dist.slice();
    let any = false;
    for (let v = 0; v < n; v++) if (dist[v]! < 0 && (dist[pred1[v]!] === level - 1 || dist[pred2[v]!] === level - 1)) { next[v] = level; any = true; }
    if (!any) break;
    dist.splice(0, n, ...next);
    depth = level;
  }
  const total = dist.reduce((a, d) => (a + d) | 0, 0);
  const nodes = b.ns("nodes");
  const o = open(b, p, "hpc.bfs");
  b.emit(
    "li a3, 1",
    "hpc_level:",
    ...slice(n, "t1", "t2"), "li t0, 12", "mul t1, t1, t0", "mul t2, t2, t0", `la s1, ${nodes}`, "add s3, s1, t2", "add s1, s1, t1", // s1 = my first vertex's record, s3 = past my last
    "hpc_v:",
    "lw t0, 0(s1)", "bge t0, zero, hpc_next", "addi t4, a3, -1",
    "lw t1, 4(s1)", `la t3, ${nodes}`, "add t1, t1, t3", "lw t1, 0(t1)", "beq t1, t4, hpc_set",
    "lw t1, 8(s1)", "add t1, t1, t3", "lw t1, 0(t1)", "bne t1, t4, hpc_next",
    "hpc_set:", "sw a3, 0(s1)",
    "hpc_next:", "addi s1, s1, 12", "bne s1, s3, hpc_v",
    ...barrier("hpc_bar", "a3"),
    "addi a3, a3, 1", `li t0, ${depth + 1}`, "bne a3, t0, hpc_level",
    ...slice(n, "t1", "t2"), "li t0, 12", "mul t1, t1, t0", "mul t2, t2, t0", `la s1, ${nodes}`, "add s3, s1, t2", "add s1, s1, t1", "li s2, 0",
    "hpc_sum:", "lw t0, 0(s1)", "add s2, s2, t0", "addi s1, s1, 12", "bne s1, s3, hpc_sum",
    ...addTotal("s2"), ...join(depth + 1),
  );
  b.addData(words(nodes, dist.map((_, v) => v).flatMap((v) => [v === 0 ? 0 : -1, pred1[v]! * 12, pred2[v]! * 12])));
  return show(b, p, o, "hpc.bfs request", total, true);
};

// ---------- fft: log n stages of butterflies, a barrier after each ----------

/** The Walsh-Hadamard transform (the butterflies of an FFT without the twiddles, so it stays in integers) of 64 to 256 words, each stage split between the threads; the answer is the sum of x[i] x (i + 1). */
const hpcFft: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = p.scale >= 7 ? 256 : p.scale >= 4 ? 128 : 64, stages = Math.log2(n);
  const x = Array.from({ length: n }, () => rng.nextInt(16));
  const t = x.slice();
  for (let s = 0; s < stages; s++) {
    for (let bf = 0; bf < n / 2; bf++) {
      const i = ((bf >> s) << (s + 1)) | (bf & ((1 << s) - 1)), j = i + (1 << s);
      const u = t[i]!, v = t[j]!;
      t[i] = u + v; t[j] = u - v;
    }
  }
  let total = 0;
  t.forEach((v, i) => { total = (total + imul(v, i + 1)) | 0; });
  const data = b.ns("x");
  const o = open(b, p, "hpc.fft");
  b.emit(
    "li a3, 0",
    "hpc_stage:",
    ...slice(n / 2, "s1", "s3"), // my butterflies: s1 .. s3
    "li s2, 1", "sll s2, s2, a3", "addi s2, s2, -1", // the low bits of the butterfly number
    "hpc_bf:",
    "srl t0, s1, a3", "slli t0, t0, 1", "sll t0, t0, a3", "and t1, s1, s2", "or t0, t0, t1", // i
    "li t1, 1", "sll t1, t1, a3", "add t1, t1, t0", // j = i + 2^stage
    "slli t0, t0, 2", "slli t1, t1, 2", `la t2, ${data}`, "add t0, t0, t2", "add t1, t1, t2",
    "lw t2, 0(t0)", "lw t3, 0(t1)", "add t4, t2, t3", "sub t2, t2, t3", "sw t4, 0(t0)", "sw t2, 0(t1)",
    "addi s1, s1, 1", "bne s1, s3, hpc_bf",
    "addi a3, a3, 1",
    ...barrier("hpc_bar", "a3"),
    `li t0, ${stages}`, "bne a3, t0, hpc_stage",
    ...slice(n, "s1", "s3"), "addi s2, s1, 1", "slli s1, s1, 2", "slli s3, s3, 2", `la t0, ${data}`, "add s1, s1, t0", "add s3, s3, t0", "li a3, 0", // weights i + 1 in s2
    "hpc_sum:", "lw t0, 0(s1)", "mul t0, t0, s2", "add a3, a3, t0", "addi s1, s1, 4", "addi s2, s2, 1", "bne s1, s3, hpc_sum",
    ...addTotal("a3"), ...join(stages + 1),
  );
  b.addData(words(data, x));
  return show(b, p, o, "hpc.fft request", total, true);
};

export const HPC_TEMPLATES: Record<string, TemplateFn> = {
  "hpc.reduce": hpcReduce,
  "hpc.matmul": hpcMatmul,
  "hpc.nbody": hpcNbody,
  "hpc.montecarlo": hpcMonteCarlo,
  "hpc.sort": hpcSort,
  "hpc.bfs": hpcBfs,
  "hpc.fft": hpcFft,
};

/** Threads each kind runs (the OS makes this many contexts). */
export const HPC_THREADS: Readonly<Record<string, number>> = Object.fromEntries(Object.entries(THREADS_OF).map(([h, t]) => [h.replace(" request", ""), t]));
