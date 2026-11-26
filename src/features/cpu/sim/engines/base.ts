// The execute and memory stages shared by the timed engines: EX semantics, the MEM step with its cache freeze, atomics, and retire.
// The end of the class chain `EngineRoot` <- `EngineFetch` <- `EngineBase`, which the engines extend (#133).

import { DEVICE_BASE } from '@/core/sim/memmap';
import { Counter, Fate } from './view';
import { Ev } from './events';
import { F, F_MEM, OPF, OP_AMOADD, OP_ECALL, OP_IRET, OP_LB, OP_LW, OP_SW, alu, branchTaken, toInt32 } from './ops';
import { St } from './pool';
import { EngineFetch } from './fetch';

/** The class the engines extend: execute, memory step, atomics and retire on top of the shared state and fetch. */
export abstract class EngineBase extends EngineFetch {
  protected retire(id: number, op: number): void {
    if (op === OP_IRET) {
      this.core.intc.leave();
      this.events.record({ cycle: this.cycleNo, kind: Ev.Iret, a: this.core.intc.epc, b: 0, c: 0, d: 0 });
    } // interrupts are on again once the iret has retired
    this.bump(Counter.Retired);
    this.v.setFate(id, Fate.Retired);
  }

  /**
   * EX work for a decoded slot whose operands are in pool.a / pool.b: fills res and addr and returns the actual next pc.
   * Throws RangeError for illegal instructions (only non-squashed ones ever get here).
   */
  protected execute(s: number): number {
    const p = this.pool;
    const op = p.op[s] ?? 0;
    const pc = p.pc[s] ?? 0;
    if (op === 0) {
      throw new RangeError(`illegal instruction 0x${(p.word[s] ?? 0).toString(16)} at pc=0x${pc.toString(16)}`);
    }
    const f = OPF[op] ?? 0;
    const a = p.a[s] ?? 0,
      b = p.b[s] ?? 0,
      imm = p.imm[s] ?? 0;
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
      p.res[s] = alu(p, s);
    }
    return (pc + 4) >>> 0;
  }

  /**
   * One processing step of the MEM-stage occupant. Returns true when its memory access is complete, false when it must
   * hold (data cache miss freeze). Counts StallCache for each held step.
   */
  protected memStep(s: number): boolean {
    const p = this.pool;
    const op = p.op[s] ?? 0;
    const f = OPF[op] ?? 0;
    if (!(f & F_MEM)) {
      return true;
    }
    if (this.cores.length > 1) {
      this.serveThread(p.thread[s] ?? 0);
    } // a device access is the thread's own, whoever fetches now
    if (f & F.Amo) {
      return this.amoStep(s);
    }
    if (f & F.Store) {
      this.storeStep(s, op);
      return true;
    }
    return this.loadStep(s, op);
  }

  /** Make the bus serve thread `t`'s core (its index and protection) for a device access. */
  private serveThread(t: number): void {
    const c = this.cores[t];
    if (c === undefined) {
      throw new RangeError(`no thread ${String(t)} on this core`);
    }
    this.bus.serve(c.index, c.mpu);
  }

  /** A store in MEM: it writes once, in its first step, and never holds. */
  private storeStep(s: number, op: number): void {
    const p = this.pool;
    const st = p.state[s] ?? 0;
    if (st & St.Started) {
      return;
    }
    const addr = p.addr[s] ?? 0,
      value = p.b[s] ?? 0;
    p.state[s] = St.Started | st;
    if (op === OP_SW) {
      this.bus.store32(addr, value);
    } else {
      this.bus.store8(addr, value);
    }
    this.logMem(1, addr, value);
  }

  /** A load in MEM: started in its first step, then it holds while its cache miss is paid. */
  private loadStep(s: number, op: number): boolean {
    const p = this.pool;
    const addr = p.addr[s] ?? 0;
    let st = p.state[s] ?? 0;
    if (!(st & St.Started)) {
      st = this.startLoad(s, op);
    }
    if (st & St.Missing) {
      const wait = p.wait[s] ?? 0;
      if (wait > 0) {
        p.wait[s] = wait - 1;
        this.bump(Counter.StallCache);
        return false;
      }
      this.dFill(addr);
      p.res[s] = this.load(op, addr);
      p.state[s] = st & ~St.Missing;
    }
    return true;
  }

  /** The first step of a load: the cache lookup (or the uncached device read). Returns the slot's new state. */
  private startLoad(s: number, op: number): number {
    const p = this.pool;
    const addr = p.addr[s] ?? 0;
    let missing = 0;
    if (addr < this.ramSize) {
      this.logMem(0, addr, this.load(op, addr));
    }
    if (addr < this.ramSize) {
      if (this.dHit(addr)) {
        this.bump(Counter.CacheHits);
        p.res[s] = this.load(op, addr);
      } else {
        this.bump(Counter.CacheMisses);
        missing = St.Missing;
        p.wait[s] = this.missCost(addr);
      }
    } else {
      p.res[s] = this.load(op, addr); // device access: uncached
      this.logMem(0, addr, p.res[s] ?? 0); // logged with the value read (a device register can have side effects, so it is read once)
    }
    const st = St.Started | (p.state[s] ?? 0) | missing;
    p.state[s] = st;
    return st;
  }

  /**
   * An atomic in MEM (docs/MULTICORE.md section 4): the access always goes to the L2 (never hits the L1, and does not fill it), so it waits the
   * miss cost (the L2's time, or RAM's on an L2 miss), then reads and writes the word in this one step. Cores step one after another, so nothing
   * can come between the read and the write. The write invalidates the line in the other cores like any store.
   */
  protected amoStep(s: number): boolean {
    const p = this.pool,
      st = p.state[s] ?? 0;
    if (!(st & St.Started)) {
      this.amoCheck(p.addr[s] ?? 0, p.pc[s] ?? 0);
      p.state[s] = St.Started | St.Missing | st;
      p.wait[s] = this.missCost(p.addr[s] ?? 0);
    }
    const now = p.state[s] ?? 0;
    if (now & St.Missing) {
      const wait = p.wait[s] ?? 0;
      if (wait > 0) {
        p.wait[s] = wait - 1;
        this.bump(Counter.StallCache);
        return false;
      }
      p.state[s] = now & ~St.Missing;
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
      addr = p.addr[s] ?? 0,
      b = p.b[s] ?? 0;
    const old = toInt32(this.bus.load32(addr)),
      nw = p.op[s] === OP_AMOADD ? toInt32(old + b) : b;
    this.bus.store32(addr, nw);
    p.res[s] = old;
    this.logMem(0, addr, old);
    this.logMem(1, addr, nw);
  }

  protected load(op: number, addr: number): number {
    if (op === OP_LW) {
      return toInt32(this.bus.load32(addr));
    }
    if (op === OP_LB) {
      return (this.bus.load8(addr) << 24) >> 24;
    }
    return this.bus.load8(addr); // lbu
  }
}
