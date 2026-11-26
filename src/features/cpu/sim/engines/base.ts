// The execute and memory stages shared by the timed engines: EX semantics, the MEM step with its cache freeze, atomics, and retire.
// The end of the class chain `EngineRoot` <- `EngineFetch` <- `EngineBase`, which the engines extend (#133).

/* oxlint-disable typescript/no-non-null-assertion, unicorn/prefer-math-trunc, oxc/bad-bitwise-operator -- reads of typed arrays and tables at indexes that are valid by construction (hot cycle loop); a guard per read is left to the cpu area wave of #115; `x | 0` and `x >>> 0` are the ISA's int32/uint32 wrap, not a truncation or a typo */
/* oxlint-disable eslint/max-lines-per-function -- `memStep` moved unchanged from common.ts (#133); splitting it is left to the cpu area wave of #115 */
import { DEVICE_BASE } from '@/core/sim/memmap';
import { Counter, Fate } from './view';
import { Ev } from './events';
import { F, F_MEM, OPF, OP_AMOADD, OP_ECALL, OP_IRET, OP_LB, OP_LW, OP_SW, alu, branchTaken } from './ops';
import { St } from './pool';
import { EngineFetch } from './fetch';

/** The class the engines extend: execute, memory step, atomics and retire on top of the shared state and fetch. */
export abstract class EngineBase extends EngineFetch {
  protected retire(id: number, op: number): void {
    if (op === OP_IRET) {
      this.core.intc.leave();
      this.events.push(this.cycleNo, Ev.Iret, this.core.intc.epc | 0, 0, 0, 0);
    } // interrupts are on again once the iret has retired
    this.v.counters[Counter.Retired]!++;
    this.v.setFate(id, Fate.Retired);
  }

  /**
   * EX work for a decoded slot whose operands are in pool.a / pool.b: fills res and addr and returns the actual next pc.
   * Throws RangeError for illegal instructions (only non-squashed ones ever get here).
   */
  protected execute(s: number): number {
    const p = this.pool;
    const op = p.op[s]!;
    const pc = p.pc[s]!;
    if (op === 0) {
      throw new RangeError(`illegal instruction 0x${p.word[s]!.toString(16)} at pc=0x${pc.toString(16)}`);
    }
    const f = OPF[op]!;
    const a = p.a[s]!,
      b = p.b[s]!,
      imm = p.imm[s]!;
    if (f & F_MEM) {
      const va = (a + imm) >>> 0;
      p.addr[s] = va;
      if (this.core.mmu.enabled && va < DEVICE_BASE) {
        const fault = this.translate(va, (f & F.Store) !== 0, false);
        if (fault) {
          p.fault[s] = fault;
          p.vaddr[s] = va;
          p.addr[s] = 0xff_ff_ff_fc;
        } // an address no load can use: younger loads wait for this store, which will fault at commit
        else {
          p.addr[s] = this.core.mmu.pa;
        }
      }
      return (pc + 4) >>> 0;
    }
    if (f & F.Branch) {
      this.taken = branchTaken(op, a, b);
      return (this.taken ? pc + imm : pc + 4) >>> 0;
    }
    if (op === OP_IRET) {
      this.core.mmu.leaveKernel();
      return this.core.intc.epc >>> 0;
    }
    if (f & F.Jal) {
      p.res[s] = pc + 4;
      return (pc + imm) >>> 0;
    }
    if (f & F.Jalr) {
      p.res[s] = pc + 4;
      return ((a + imm) & ~3) >>> 0;
    }
    if (op !== OP_ECALL) {
      p.res[s] = alu(op, a, b, imm, pc);
    }
    return (pc + 4) >>> 0;
  }

  /**
   * One processing step of the MEM-stage occupant. Returns true when its memory access is complete, false when it must
   * hold (data cache miss freeze). Counts StallCache for each held step.
   */
  protected memStep(s: number): boolean {
    const p = this.pool;
    const op = p.op[s]!;
    const f = OPF[op]!;
    if (!(f & F_MEM)) {
      return true;
    }
    const c = this.v.counters;
    let st = p.state[s]!;
    const addr = p.addr[s]!;
    if (this.cores.length > 1) {
      const t = this.cores[p.thread[s]!]!;
      this.bus.serve(t.index, t.mpu);
    } // a device access is the thread's own, whoever fetches now
    if (f & F.Amo) {
      return this.amoStep(s);
    }
    if (f & F.Store) {
      if (!(st & St.Started)) {
        p.state[s] = st | St.Started;
        if (op === OP_SW) {
          this.bus.store32(addr, p.b[s]!);
        } else {
          this.bus.store8(addr, p.b[s]!);
        }
        this.logMem(1, addr, p.b[s]!);
      }
      return true;
    }
    if (!(st & St.Started)) {
      st |= St.Started;
      if (addr < this.ramSize) {
        this.logMem(0, addr, this.load(op, addr));
      }
      if (addr < this.ramSize) {
        if (this.dHit(addr)) {
          c[Counter.CacheHits]!++;
          p.res[s] = this.load(op, addr);
        } else {
          c[Counter.CacheMisses]!++;
          st |= St.Missing;
          p.wait[s] = this.missCost(addr);
        }
      } else {
        p.res[s] = this.load(op, addr); // device access: uncached
        this.logMem(0, addr, p.res[s]); // logged with the value read (a device register can have side effects, so it is read once)
      }
      p.state[s] = st;
    }
    if (st & St.Missing) {
      if (p.wait[s]! > 0) {
        p.wait[s]!--;
        c[Counter.StallCache]!++;
        return false;
      }
      this.dFill(addr);
      p.res[s] = this.load(op, addr);
      p.state[s] = st & ~St.Missing;
    }
    return true;
  }

  /**
   * An atomic in MEM (docs/MULTICORE.md section 4): the access always goes to the L2 (never hits the L1, and does not fill it), so it waits the
   * miss cost (the L2's time, or RAM's on an L2 miss), then reads and writes the word in this one step. Cores step one after another, so nothing
   * can come between the read and the write. The write invalidates the line in the other cores like any store.
   */
  protected amoStep(s: number): boolean {
    const p = this.pool,
      st = p.state[s]!;
    if (!(st & St.Started)) {
      this.amoCheck(p.addr[s]!, p.pc[s]!);
      p.state[s] = st | St.Started | St.Missing;
      p.wait[s] = this.missCost(p.addr[s]!);
    }
    if (p.state[s]! & St.Missing) {
      if (p.wait[s]! > 0) {
        p.wait[s]!--;
        this.v.counters[Counter.StallCache]!++;
        return false;
      }
      p.state[s]! &= ~St.Missing;
    }
    this.amoApply(s);
    return true;
  }

  /** An atomic touches only a word-aligned word of RAM; anything else faults like a bad load. */
  protected amoCheck(addr: number, pc: number): void {
    if (addr % 4 !== 0 || addr + 4 > this.ramSize) {
      throw new RangeError(
        `atomic on 0x${addr.toString(16)}, not a word-aligned RAM address, at pc=0x${pc.toString(16)}`,
      );
    }
  }

  /** The read-modify-write itself: res = the old word, memory gets old + rs2 (amoadd) or rs2 (amoswap). */
  protected amoApply(s: number): void {
    const p = this.pool,
      addr = p.addr[s]!;
    const old = this.bus.load32(addr) | 0,
      nw = p.op[s] === OP_AMOADD ? (old + p.b[s]!) | 0 : p.b[s]!;
    this.bus.store32(addr, nw);
    p.res[s] = old;
    this.logMem(0, addr, old);
    this.logMem(1, addr, nw);
  }

  protected load(op: number, addr: number): number {
    if (op === OP_LW) {
      return this.bus.load32(addr) | 0;
    }
    if (op === OP_LB) {
      return (this.bus.load8(addr) << 24) >> 24;
    }
    return this.bus.load8(addr); // lbu
  }
}
