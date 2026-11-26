// The fetch side of the timed engines: whether a fetch is ready (instruction cache, L2 and redirect timing), and the virtual-memory path
// (translation, TLB walks, page faults). The middle of the class chain `EngineRoot` <- `EngineFetch` <- `EngineBase` (#133).

/* oxlint-disable typescript/no-non-null-assertion, unicorn/prefer-math-trunc -- reads of typed arrays and tables at indexes that are valid by construction (hot cycle loop); a guard per read is left to the cpu area wave of #115; `x | 0` and `x >>> 0` are the ISA's int32/uint32 wrap, not a truncation or a typo */
/* oxlint-disable eslint/max-lines-per-function -- `fetchReady` moved unchanged from common.ts (#133); its braces made it longer; splitting it is left to the cpu area wave of #115 */
import { FAULT_CAUSE_LINE } from '@/core/sim/memmap';
import { Counter } from './view';
import type { DataCache } from './cache';
import { Ev, Which } from './events';
import { EngineRoot } from './root';

/** Fetch timing and address translation shared by both engines. */
export abstract class EngineFetch extends EngineRoot {
  /**
   * Whether the instruction at `pc` can be fetched this cycle. Fetch that carries on from the last instruction is a stream and always free
   * (the line it enters is filled into the instruction cache on the way). A jump (a taken branch, a jump, a flush, an interrupt) has to
   * find its target: with an instruction cache a hit is free and a miss waits the miss cost (the L2's if it holds the line, else RAM's);
   * without one it waits `redirectPenalty`. The wait counts in StallIFetch; a redirect during it starts a new lookup at the new pc.
   */
  protected fetchReady(vpc: number): boolean {
    // the instruction cache and the L2 are physical: with translation on, look the address up (no side effects; a missing page is the fetch's fault to take)
    let pc = vpc;
    if (this.core.mmu.enabled) {
      pc = this.core.mmu.peek(vpc);
      if (pc < 0) {
        return true;
      }
    }
    if (pc >= this.ramSize) {
      return true;
    }
    const ic = this.icache,
      c = this.v.counters;
    if (this.iWaitPc !== vpc) {
      let wait = 0;
      if (vpc === this.seqPc) {
        if (ic) {
          this.iFill(ic, pc);
        }
        this.seqPc = (vpc + 4) >>> 0;
        return true;
      }
      if (ic) {
        if (ic.hit(pc)) {
          c[Counter.ICacheHits]!++;
          this.events.push(this.cycleNo, Ev.Hit, Which.I, ic.lastSlot, pc >>> ic.lineShift, 0);
          this.seqPc = (vpc + 4) >>> 0;
          return true;
        }
        c[Counter.ICacheMisses]!++;
        if (this.mem.shared && ic.takeDropped(pc)) {
          c[Counter.CoherenceMisses]!++;
        }
        wait = this.missCost(pc);
      } else if (this.redirectPenalty > 0) {
        wait = this.redirectPenalty;
      } else {
        this.seqPc = (vpc + 4) >>> 0;
        return true;
      }
      this.iWaitPc = vpc;
      this.iWait = wait;
    }
    if (this.iWait > 0) {
      this.iWait--;
      c[Counter.StallIFetch]!++;
      return false;
    }
    if (this.icache) {
      this.iFill(this.icache, pc);
    }
    this.iWaitPc = -1;
    this.seqPc = (vpc + 4) >>> 0;
    return true;
  }

  // ---- virtual memory (docs/VM.md) ----

  /**
   * Fetch the instruction at `pc` into pool slot `s`. With translation off it is the plain read. With it on the address is translated first: a TLB miss
   * pays its table walk, and a page that cannot be fetched from leaves the slot an illegal word that carries the fault (taken only if the instruction
   * turns out to be on the right path: fetch runs ahead of branches).
   */
  protected fetchInto(s: number, pc: number): void {
    const { mmu } = this.core,
      p = this.pool;
    if (!mmu.enabled) {
      p.fetch(this.bus, this.ramSize, s, pc);
      return;
    }
    p.pc[s] = pc;
    p.fault[s] = 0;
    p.state[s] = 0;
    p.wait[s] = 0;
    p.op[s] = 0;
    p.word[s] = 0;
    const f = this.translate(pc, false, true);
    if (f) {
      p.fault[s] = f;
      p.vaddr[s] = pc;
      return;
    }
    const { pa } = mmu;
    p.word[s] = pa % 4 === 0 && pa + 4 <= this.ramSize ? this.bus.load32(pa) : 0;
  }

  /** One translation through the MMU: counts it, logs it for the die and charges the walk (each table read goes through the L2 and DRAM like any miss). Returns the fault code or 0; the physical address is in `machine.mmu.pa`. */
  protected translate(va: number, write: boolean, exec: boolean): number {
    const { mmu } = this.core,
      c = this.v.counters;
    const f = mmu.lookup(va, write, exec);
    if (mmu.hit) {
      c[Counter.TlbHits]!++;
    } else {
      c[Counter.TlbMisses]!++;
      let cycles = 0;
      for (let i = 0; i < mmu.walkN; i++) {
        cycles += this.missCost(mmu.walkAt[i]!);
      }
      this.bus.stallCycles += cycles; // the CPU waits the walk out after this step
    }
    if (mmu.slot >= 0) {
      this.events.push(this.cycleNo, Ev.Tlb, mmu.hit ? 0 : 1, mmu.slot, va >>> 8, mmu.pa >>> 8);
    }
    return f;
  }

  /** The instruction in slot `s` carries a page fault and is on the right path: hand it to the OS. Registers, memory and the pc of everything older are final; this one has done nothing. */
  protected takeFault(s: number): void {
    const p = this.pool,
      m = this.core;
    m.mmu.recordFault(p.fault[s]!, p.vaddr[s]!);
    m.mmu.enterKernel();
    m.intc.enter(FAULT_CAUSE_LINE, p.pc[s]!, 0);
    this.v.counters[Counter.PageFaults]!++;
    this.events.push(this.cycleNo, Ev.Tlb, 2, 0, p.vaddr[s]! >>> 8, p.fault[s]!);
    // oxlint-disable-next-line unicorn/prefer-single-call -- EventLog.push takes one event (six numbers), not a list: two events need two calls
    this.events.push(this.cycleNo, Ev.Irq, FAULT_CAUSE_LINE, p.pc[s]! | 0, m.mmu.vector | 0, 0);
    this.fetchPc = m.mmu.vector >>> 0;
    p.fault[s] = 0;
  }

  private iFill(ic: DataCache, pc: number): void {
    const had = ic.hit(pc); // a line already there is only touched
    if (had) {
      return;
    }
    ic.fill(pc);
    this.events.push(this.cycleNo, Ev.Fill, Which.I, ic.lastSlot, pc >>> ic.lineShift, ic.lastEvicted);
  }
}
