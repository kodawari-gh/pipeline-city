// A race checker for GPU kernels (docs/GPU.md section 4, T133). On the `warp` and `multi` engines the warps of a launch run independently,
// so a kernel is only correct if no lane reads a word another lane wrote earlier in the same launch without a `bar` in between (and, on a
// multi-SM card, no lane reads a word another SM's lane wrote, which `bar` cannot order). This runs a kernel on the reference interpreter
// and reports every such read; the kernel tests assert that the real kernels have none.

import { GpuRef } from "./ref";

export interface Race {
  pc: number;
  /** The lane that read, and the lane that wrote the word first. */
  reader: number;
  writer: number;
  /** Byte address of the word. */
  addr: number;
}

/** Run the kernel already loaded in `ref` (pc 0 unless reset) and return its races. A `bar` forgets earlier writes. */
export function findRaces(ref: GpuRef, max = 5_000_000): Race[] {
  const races: Race[] = [];
  const writer = new Map<number, number>();
  while (!ref.halted) {
    if (ref.instructions >= max) throw new Error("kernel never halted");
    ref.step();
    const s = ref.lastStep!;
    if (s.name === "bar") { writer.clear(); continue; }
    if (s.name !== "vld" && s.name !== "vst") continue;
    const lanes: number[] = [];
    for (let l = 0; l < ref.lanes; l++) if ((s.mask >>> l) & 1) lanes.push(l);
    ref.lastAddrs.forEach((addr, n) => {
      const lane = lanes[n]!, w = writer.get(addr);
      if (s.name === "vld") {
        if (w !== undefined && w !== lane) races.push({ pc: s.pc, reader: lane, writer: w, addr });
      } else if (!writer.has(addr)) writer.set(addr, lane);
      else if (writer.get(addr) !== lane) races.push({ pc: s.pc, reader: lane, writer: writer.get(addr)!, addr }); // two lanes write one word
    });
  }
  return races;
}
