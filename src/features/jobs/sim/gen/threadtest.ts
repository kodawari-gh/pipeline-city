// A small threaded program for the tests of the thread support (reference interleavings, bare cores on every engine, the OS 4 kernel): the sum of an array, each thread adding its
// own slice. The partials meet in a shared word with `amoadd`, the threads arrive at a barrier, and thread 0 prints the total. It is not a job clients send (`tasks.hpc.ts` has those).

import * as K from "./kernels";
import { Builder, blankRows, emitStatic, layoutLine, pad2, renderLine, rowAddr, THREAD_PARTS, THREAD_SYNC, type Seg, type TemplateFn } from "./build";

/** The shared total, one word after the barrier counter. */
export const THREAD_TOTAL = THREAD_SYNC + 4;

/** `par.sum`: `scale` x 32 words per thread (so the slices are line aligned), summed by `threads` threads. `p.scale` picks the size; the thread count is the second argument. */
export const parSum = (threads: number): TemplateFn => (rng, p) => {
  const per = 32 * p.scale, n = per * threads;
  const vals = Array.from({ length: n }, () => rng.nextInt(1000));
  const total = vals.reduce((s, v) => s + v, 0);
  const b = new Builder();
  const data = b.ns("data");
  const segs: Seg[] = [`#${pad2(p.jobId)} par.sum=`, { dyn: 4 }, " OK"];
  const line = layoutLine(segs);
  b.emit(
    `li s0, ${rowAddr(p.row)}`,
    `la s1, ${data}`,
    `li t0, ${per * 4}`,
    "mul t0, t0, a0",
    "add s1, s1, t0", // the start of this thread's slice
    `li t2, ${per}`,
    "li s2, 0",
    "par_sum:",
    "lw t3, 0(s1)",
    "add s2, s2, t3",
    "addi s1, s1, 4",
    "addi t2, t2, -1",
    "bne t2, zero, par_sum",
    "slli t0, a0, 2",
    `li t1, ${THREAD_PARTS}`,
    "add t1, t1, t0",
    "sw s2, 0(t1)", // the partial, for the record
    `li t1, ${THREAD_TOTAL}`,
    "amoadd zero, s2, (t1)", // and into the shared total
    `li t1, ${THREAD_SYNC}`,
    "li t2, 1",
    "amoadd zero, t2, (t1)", // arrived
    "bne a0, zero, thread_end",
    "par_wait:",
    "lw t2, 0(t1)",
    "bne t2, a1, par_wait", // thread 0 waits for the others
  );
  emitStatic(b, line, 0);
  b.emit(`li t1, ${THREAD_TOTAL}`, "lw a1, 0(t1)", "andi a1, a1, 1023", `addi a0, s0, ${line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), 4))}`);
  b.addData([`${data}:`, ...vals.map((w) => `  .word ${w}`)]);
  return b.finish("par.sum request", blankRows(p.row) + renderLine(segs, [total & 1023]), threads);
};
