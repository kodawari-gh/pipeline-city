// The fetch side of the timed engines: whether a fetch is ready (instruction cache, L2 and redirect timing), and the virtual-memory path
// (translation, TLB walks, page faults). The middle of the class chain `EngineRoot` <- `EngineFetch` <- `EngineBase` (#133).

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
    if (this.iWaitPc !== vpc && this.startLookup(vpc, pc)) {
      return true;
    }
    if (this.iWait > 0) {
      this.iWait--;
      this.bump(Counter.StallIFetch);
      return false;
    }
    if (this.icache) {
      this.iFill(this.icache, pc);
    }
    this.iWaitPc = -1;
    this.seqPc = (vpc + 4) >>> 0;
    return true;
  }

  /**
   * A new fetch lookup at `vpc` (physical `pc`): true when the instruction can be fetched at once (the sequential stream, an instruction cache
   * hit, or no redirect penalty); otherwise it records the wait (`iWaitPc`, `iWait`) and returns false.
   */
  private startLookup(vpc: number, pc: number): boolean {
    const ic = this.icache;
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
        this.bump(Counter.ICacheHits);
        this.events.record({
          cycle: this.cycleNo,
          kind: Ev.Hit,
          a: Which.I,
          b: ic.lastSlot,
          c: pc >>> ic.lineShift,
          d: 0,
        });
        this.seqPc = (vpc + 4) >>> 0;
        return true;
      }
      this.bump(Counter.ICacheMisses);
      if (this.mem.shared && ic.takeDropped(pc)) {
        this.bump(Counter.CoherenceMisses);
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
    return false;
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
      p.fetch(s, pc, pc % 4 === 0 && pc + 4 <= this.ramSize ? this.bus.load32(pc) : 0);
      return;
    }
    p.fetch(s, pc, 0);
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
    const { mmu } = this.core;
    const f = mmu.lookup(va, write, exec);
    if (mmu.hit) {
      this.bump(Counter.TlbHits);
    } else {
      this.bump(Counter.TlbMisses);
      let cycles = 0;
      for (let i = 0; i < mmu.walkN; i++) {
        cycles += this.missCost(mmu.walkAt[i] ?? 0);
      }
      this.bus.stallCycles += cycles; // the CPU waits the walk out after this step
    }
    if (mmu.slot >= 0) {
      this.events.record({
        cycle: this.cycleNo,
        kind: Ev.Tlb,
        a: mmu.hit ? 0 : 1,
        b: mmu.slot,
        c: va >>> 8,
        d: mmu.pa >>> 8,
      });
    }
    return f;
  }

  /** The instruction in slot `s` carries a page fault and is on the right path: hand it to the OS. Registers, memory and the pc of everything older are final; this one has done nothing. */
  protected takeFault(s: number): void {
    const p = this.pool,
      m = this.core;
    const fault = p.fault[s] ?? 0,
      vaddr = p.vaddr[s] ?? 0,
      pc = p.pc[s] ?? 0;
    m.mmu.recordFault(fault, vaddr);
    m.mmu.enterKernel();
    m.intc.enter(FAULT_CAUSE_LINE, pc, 0);
    this.bump(Counter.PageFaults);
    this.events.record({ cycle: this.cycleNo, kind: Ev.Tlb, a: 2, b: 0, c: vaddr >>> 8, d: fault });
    this.events.record({ cycle: this.cycleNo, kind: Ev.Irq, a: FAULT_CAUSE_LINE, b: pc, c: m.mmu.vector, d: 0 });
    this.fetchPc = m.mmu.vector >>> 0;
    p.fault[s] = 0;
  }

  private iFill(ic: DataCache, pc: number): void {
    const had = ic.hit(pc); // a line already there is only touched
    if (had) {
      return;
    }
    ic.fill(pc);
    this.events.record({
      cycle: this.cycleNo,
      kind: Ev.Fill,
      a: Which.I,
      b: ic.lastSlot,
      c: pc >>> ic.lineShift,
      d: ic.lastEvicted,
    });
  }
}
