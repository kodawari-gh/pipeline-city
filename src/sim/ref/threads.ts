// The reference for threaded jobs (docs/MULTICORE.md section 7): T threads run one program on one memory, a few instructions each in turn.
// The programs are race free (every shared word is written by one thread or with an atomic), so the text is the same under any interleaving; a test runs several.

import { REG_NAMES } from "../isa/isa";
import { threadStackTop } from "../isa/memmap";
import { Prng } from "../machine/prng";
import { RefCpu, RefFault, RefMemory } from "./ref";

/** Which thread runs next, and for how many instructions: `round-robin` one each, `burst` n each, `random` a seeded draw of the thread and 1 to `max` instructions. */
export type Interleaving = { kind: "round-robin" } | { kind: "burst"; n: number } | { kind: "random"; seed: number; max?: number };

const A0 = REG_NAMES.indexOf("a0"), A1 = REG_NAMES.indexOf("a1");

export class RefThreads {
  readonly mem: RefMemory;
  readonly cpus: RefCpu[] = [];
  steps = 0;

  constructor(program: Uint32Array, readonly threads: number, memBytes = 1024 * 1024) {
    this.mem = new RefMemory(memBytes);
    this.mem.loadWords(0x1000, program);
    for (let k = 0; k < threads; k++) {
      const cpu = new RefCpu(this.mem);
      cpu.pc = 0x1000;
      cpu.regs[A0] = k;
      cpu.regs[A1] = threads;
      cpu.regs[2] = threadStackTop(k);
      this.cpus.push(cpu);
    }
  }

  get halted(): boolean { return this.cpus.every((c) => c.halted); }

  /** Run every thread to its `ecall` under `how`; throws RefFault past `maxSteps` instructions in all (a thread that waits for the others spins, so a deadlock ends here). */
  run(how: Interleaving = { kind: "round-robin" }, maxSteps = 5_000_000): string {
    const rng = how.kind === "random" ? new Prng(how.seed) : null;
    let k = 0, left = 0;
    while (!this.halted) {
      if (this.steps >= maxSteps) throw new RefFault(this.cpus[k]!.pc, `exceeded ${maxSteps} steps`);
      if (left <= 0) {
        if (how.kind === "random") { k = rng!.nextInt(this.threads); left = 1 + rng!.nextInt(how.max ?? 7); }
        else { k = (k + 1) % this.threads; left = how.kind === "burst" ? how.n : 1; }
      }
      const cpu = this.cpus[k]!;
      if (cpu.halted) { left = 0; continue; }
      cpu.step();
      left--;
      this.steps++;
    }
    return this.mem.displayText();
  }
}
