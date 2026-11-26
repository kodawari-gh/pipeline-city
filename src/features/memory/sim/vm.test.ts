// Virtual memory (docs/VM.md): the MMU and the engines' precise page faults. Programs run translated and must give exactly what the reference gives,
// with pages mapped up front or claimed by a fault handler while they run (the fault can strike at any point of the pipeline, in a fetch, a load or a
// store: the restart must lose nothing and repeat nothing).
import { describe, expect, it } from 'vitest';
import { assemble } from '../../cpu/sim/asm';
import { DEVICE_BASE, MMU_BASE, MMU_REG, PteBit, VmFault } from '@/core/sim/memmap';
import { Machine } from '@/core/sim';
import { createEngine, Counter, InOrderEngine, OooEngine, UnpipelinedEngine } from '../../cpu/sim/engines/index';
import type * as enginesTypes from '../../cpu/sim/engines/index';
import { DATA_BASE, genData, genProgram } from '../../cpu/sim/engines/testgen';
import { runRef } from '../../cpu/sim/engines/testutil';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const SHIFT = 0x20_00; // a program's virtual address v lives at physical v + SHIFT
const L1 = 0x50_00,
  L2 = 0x51_00,
  SCRATCH = 0x52_00,
  HANDLER = 0x54_00;

/** The OS's page-fault handler: it maps the faulting page (v -> v + SHIFT) and goes back to the instruction. It saves what it uses. */
const HANDLER_SRC = `
  sw t0, ${SCRATCH}(zero)
  sw t1, ${SCRATCH + 4}(zero)
  sw t2, ${SCRATCH + 8}(zero)
  li t0, ${MMU_BASE}
  lw t1, ${MMU_REG.FAULT_ADDR}(t0)
  srli t1, t1, 8
  addi t2, t1, ${SHIFT >> 8}
  slli t2, t2, 8
  addi t2, t2, 7
  andi t1, t1, 63
  slli t1, t1, 2
  addi t1, t1, ${L2}
  sw t2, 0(t1)
  lw t0, ${SCRATCH}(zero)
  lw t1, ${SCRATCH + 4}(zero)
  lw t2, ${SCRATCH + 8}(zero)
  iret`;

const ENGINES: { name: string; cfg: enginesTypes.EngineConfig }[] = [
  { name: 'unpipelined', cfg: { kind: 'unpipelined' } },
  { name: 'inorder', cfg: { kind: 'inorder', forwarding: true, cacheLines: 8 } },
  { name: 'inorder nofwd shared port', cfg: { kind: 'inorder', forwarding: false, sharedPort: true, cacheLines: 8 } },
  {
    name: 'inorder2 + caches',
    cfg: { kind: 'inorder2', forwarding: true, cacheLines: 16, ways: 2, icacheLines: 8, l2Lines: 32, missPenalty: 6 },
  },
  {
    name: 'ooo',
    cfg: { kind: 'ooo', width: 2, robSize: 16, schedSize: 8, fetchQueue: 8, cacheLines: 16, missPenalty: 6 },
  },
  {
    name: 'ooo wide + dram',
    cfg: {
      kind: 'ooo',
      width: 4,
      robSize: 32,
      schedSize: 16,
      fetchQueue: 8,
      cacheLines: 32,
      icacheLines: 16,
      l2Lines: 64,
      dram: {
        channels: 2,
        banks: 4,
        bankGroups: 2,
        rowBytes: 256,
        tCL: 2,
        tRCD: 3,
        tRP: 3,
        burst: 1,
        ccdS: 1,
        ccdL: 2,
        refreshEvery: 500,
        tRFC: 5,
        policy: 'adaptive',
      },
    },
  },
];

const pte = (frame: number, flags: number): number => (frame << 8) | flags;
const put = (m: Machine, pa: number, v: number): void => {
  m.bus.store32(pa, v);
};

/** The engine `cfg` builds, which must be a timed one (with counters and a cycle count). */
function pipelineEngine(cfg: enginesTypes.EngineConfig): enginesTypes.PipelineEngine {
  const e = createEngine(cfg);
  if (e instanceof UnpipelinedEngine || e instanceof InOrderEngine || e instanceof OooEngine) {
    return e;
  }
  throw new TypeError(`${cfg.kind} is not a timed engine`);
}

/** A machine with a four-entry MMU, switched off. */
function mmuMachine(): Machine {
  const m = new Machine();
  m.mmu.configure(4);
  return m;
}

interface Run {
  m: Machine;
  e: enginesTypes.PipelineEngine;
  steps: number;
}

/**
 * Run `src` (assembled for virtual address 0, data at virtual DATA_BASE) translated by an MMU with `tlb` entries. Its code pages are mapped up front;
 * its data pages are mapped up front (`mapData`) or by the fault handler as the program touches them.
 */
function runVm(
  cfg: enginesTypes.EngineConfig,
  { src, data }: { src: string; data: Uint8Array },
  o: { tlb?: number; mapData?: boolean; dataPages?: number; ro?: boolean } = {},
): Run {
  const m = new Machine();
  const e = pipelineEngine(cfg);
  const { program } = assemble(src);
  m.attach(e, program);
  // relocate: the program and its data move to physical v + SHIFT
  m.ram.fill(0, 0, program.length * 4);
  for (const [i, w] of program.entries()) {
    put(m, SHIFT + 4 * i, w);
  }
  for (const [i, b] of data.entries()) {
    m.ram[SHIFT + DATA_BASE + i] = b;
  }
  for (const [i, w] of assemble(HANDLER_SRC).program.entries()) {
    put(m, HANDLER + 4 * i, w);
  }
  m.mmu.configure(o.tlb ?? 8);
  put(m, L1, pte(L2 >> 8, PteBit.Valid));
  const codePages = Math.ceil((program.length * 4) / 256);
  for (let p = 0; p < codePages; p++) {
    put(m, L2 + 4 * p, pte((p * 256 + SHIFT) >> 8, PteBit.Valid | PteBit.Exec));
  }
  if (o.mapData === true) {
    for (let p = 0; p < (o.dataPages ?? 1); p++) {
      put(
        m,
        L2 + 4 * ((DATA_BASE >> 8) + p),
        pte((DATA_BASE >> 8) + p + (SHIFT >> 8), PteBit.Valid | PteBit.Write | (o.ro === true ? 0 : 0)),
      );
    }
  }
  m.bus.store32(MMU_BASE + MMU_REG.TABLE, L1);
  m.bus.store32(MMU_BASE + MMU_REG.VECTOR, HANDLER);
  m.mmu.enabled = true;
  let steps = 0;
  // the handler's code pages are physical: translation is off while it runs; give it execute permission through the identity of the OS (it runs untranslated)
  while (!e.halted) {
    if (steps++ > 400_000) {
      throw new Error('did not halt');
    }
    m.stepCpu();
  }
  return { m, e, steps };
}

const SCAN = `
  li s3, ${DATA_BASE}
  li t0, 0
  li t1, 0
  li t2, 8
loop:
  lw a0, 0(s3)
  add a1, a1, a0
  sw a1, 4(s3)
  addi s3, s3, 256
  addi t0, t0, 1
  bne t0, t2, loop
  ecall`;

describe.each(ENGINES)('translated programs match the reference: $name', ({ cfg }) => {
  it('random programs, every page mapped up front', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const src = genProgram(seed, 40),
        data = genData(seed),
        ref = runRef(src, data);
      const r = runVm(cfg, { src, data }, { mapData: true });
      expect([...r.m.regs], `seed ${seed}`).toStrictEqual(ref.regs);
      expect(r.m.ram.slice(SHIFT + DATA_BASE, SHIFT + DATA_BASE + 256), `seed ${seed} data`).toStrictEqual(
        ref.mem.slice(DATA_BASE, DATA_BASE + 256),
      );
      expect(r.m.mmu.faults).toBe(0);
    }
  });

  it('random programs, the data page claimed by a fault the program must not notice', () => {
    for (let seed = 30; seed <= 41; seed++) {
      const src = genProgram(seed, 40),
        data = genData(seed),
        ref = runRef(src, data);
      const r = runVm(cfg, { src, data });
      expect([...r.m.regs], `seed ${seed}`).toStrictEqual(ref.regs);
      expect(r.m.ram.slice(SHIFT + DATA_BASE, SHIFT + DATA_BASE + 256), `seed ${seed} data`).toStrictEqual(
        ref.mem.slice(DATA_BASE, DATA_BASE + 256),
      );
      // the program touches its data page: at most one fault, and the handler's work is the only extra thing that happened
      expect(r.m.mmu.faults).toBeLessThanOrEqual(1);
      expect(r.e.view.counters[Counter.PageFaults]).toBe(r.m.mmu.faults);
    }
  });

  it("a scan over eight pages faults once on each, restarts every time and gets the reference's answer", () => {
    const data = genData(5),
      ref = runRef(SCAN, data);
    const r = runVm(cfg, { src: SCAN, data });
    expect([...r.m.regs]).toStrictEqual(ref.regs);
    expect(r.m.mmu.faults).toBe(8);
    expect(r.m.mmu.enabled).toBe(true); // iret turned translation back on
    expect(r.e.view.counters[Counter.TlbMisses]).toBeGreaterThanOrEqual(8);
  });
});

describe('the TLB and the table walk', () => {
  const cfg: enginesTypes.EngineConfig = { kind: 'inorder', forwarding: true, cacheLines: 8, missPenalty: 6 };
  const data = genData(9);

  it('a bigger TLB misses less and finishes sooner (a walk is two reads the CPU waits for)', () => {
    const small = runVm(cfg, { src: SCAN, data }, { tlb: 1, mapData: true, dataPages: 8 });
    const big = runVm(cfg, { src: SCAN, data }, { tlb: 16, mapData: true, dataPages: 8 });
    const sm = must(small.e.view.counters[Counter.TlbMisses]),
      bm = must(big.e.view.counters[Counter.TlbMisses]);
    expect(sm).toBeGreaterThan(bm);
    expect(small.steps).toBeGreaterThan(big.steps);
    expect([...small.m.regs]).toStrictEqual([...big.m.regs]);
  });

  it('is deterministic', () => {
    const a = runVm(cfg, { src: SCAN, data }),
      b = runVm(cfg, { src: SCAN, data });
    expect(a.steps).toBe(b.steps);
    expect([...a.e.view.counters]).toStrictEqual([...b.e.view.counters]);
  });

  it('translation changes nothing while it is off: the same program runs the same cycles', () => {
    const plain = (() => {
      const m = new Machine();
      const e = pipelineEngine(cfg);
      m.attach(e, assemble(SCAN).program);
      for (const [i, b] of data.entries()) {
        m.ram[DATA_BASE + i] = b;
      }
      while (!e.halted) {
        m.stepCpu();
      }
      return e.cycle;
    })();
    const again = (() => {
      const m = new Machine();
      const e = pipelineEngine(cfg);
      m.attach(e, assemble(SCAN).program);
      m.mmu.configure(8); // present but never switched on
      for (const [i, b] of data.entries()) {
        m.ram[DATA_BASE + i] = b;
      }
      while (!e.halted) {
        m.stepCpu();
      }
      return e.cycle;
    })();
    expect(again).toBe(plain);
  });
});

describe('the MMU device', () => {
  const mk = mmuMachine;

  it('a CPU without an MMU cannot switch it on', () => {
    const m = new Machine();
    m.bus.store32(MMU_BASE + MMU_REG.CONTROL, 1);
    expect(m.mmu.enabled).toBe(false);
    expect(m.bus.load32(MMU_BASE + MMU_REG.STATUS)).toBe(0);
    m.mmu.configure(4);
    m.bus.store32(MMU_BASE + MMU_REG.CONTROL, 1);
    expect(m.mmu.enabled).toBe(true);
    expect(m.bus.load32(MMU_BASE + MMU_REG.STATUS)).toBe(3);
    expect(m.bus.load32(MMU_BASE + MMU_REG.TLB_ENTRIES)).toBe(4);
  });

  it('translates through two levels, checks permissions and leaves devices alone', () => {
    const m = mk();
    put(m, L1 + 4 * 2, pte(L2 >> 8, PteBit.Valid)); // level 1 index 2: virtual 0x8000..0xbfff
    put(m, L2 + 4 * 5, pte(0x31, PteBit.Valid | PteBit.Write)); // virtual 0x8500 -> physical 0x3100, read and write
    put(m, L2 + 4 * 6, pte(0x32, PteBit.Valid | PteBit.Exec)); // virtual 0x8600 -> 0x3200, read and execute
    m.bus.store32(MMU_BASE + MMU_REG.TABLE, L1);
    const { mmu } = m;
    expect(mmu.lookup(0x85_34, false, false)).toBe(0);
    expect(mmu.pa).toBe(0x31_34);
    expect(mmu.hit).toBe(false);
    expect(mmu.walkN).toBe(2);
    expect(mmu.lookup(0x85_34, true, false)).toBe(0);
    expect(mmu.hit).toBe(true);
    expect(mmu.lookup(0x86_34, true, false)).toBe(VmFault.Write);
    expect(mmu.lookup(0x86_34, false, true)).toBe(0);
    expect(mmu.lookup(0x85_34, false, true)).toBe(VmFault.Exec);
    expect(mmu.lookup(0x87_34, false, false)).toBe(VmFault.NotPresent);
    expect(mmu.lookup(0xc0_00, false, false)).toBe(VmFault.NotPresent); // level 1 entry 3 is empty
    expect(mmu.lookup(0x10_00_00, false, false)).toBe(VmFault.Range);
    expect(mmu.lookup(DEVICE_BASE + 0x40, true, false)).toBe(0);
    expect(mmu.pa).toBe(DEVICE_BASE + 0x40);
    expect(mmu.peek(0x85_34)).toBe(0x31_34);
    expect(mmu.peek(0x87_34)).toBe(-1);
  });

  it('the TLB replaces the least recently used entry, and a new table or a flush empties it', () => {
    const m = mk();
    put(m, L1, pte(L2 >> 8, PteBit.Valid));
    for (let p = 0; p < 8; p++) {
      put(m, L2 + 4 * p, pte(0x40 + p, PteBit.Valid | PteBit.Write));
    }
    m.bus.store32(MMU_BASE + MMU_REG.TABLE, L1);
    const { mmu } = m;
    for (let p = 0; p < 4; p++) {
      mmu.lookup(p * 256, false, false);
    } // fills the four entries
    mmu.lookup(0, false, false); // page 0 is the most recent
    mmu.lookup(4 * 256, false, false); // evicts page 1 (the least recently used)
    expect(mmu.lookup(0, false, false)).toBe(0);
    expect(mmu.hit).toBe(true);
    mmu.lookup(256, false, false);
    expect(mmu.hit).toBe(false);
    expect(mmu.dump().vpn.filter((v) => v >= 0)).toHaveLength(4);
    m.bus.store32(MMU_BASE + MMU_REG.CONTROL, 2);
    expect(mmu.dump().vpn.every((v) => v < 0)).toBe(true);
    mmu.lookup(0, false, false);
    m.bus.store32(MMU_BASE + MMU_REG.TABLE, L1);
    expect(mmu.dump().vpn.every((v) => v < 0)).toBe(true);
  });

  it('a trap switches translation off for the OS, and iret switches it back on', () => {
    const m = mk();
    m.mmu.enabled = true;
    m.mmu.enterKernel();
    expect(m.mmu.enabled).toBe(false);
    m.mmu.leaveKernel();
    expect(m.mmu.enabled).toBe(true);
    m.mmu.leaveKernel(); // nothing saved: stays as it is
    expect(m.mmu.enabled).toBe(true);
    const off = mk();
    off.mmu.enterKernel();
    off.mmu.leaveKernel();
    expect(off.mmu.enabled).toBe(false); // it was never on
  });
});

describe('faults the OS does not fix', () => {
  const STOP = `
    li t0, ${MMU_BASE}
    lw a2, ${MMU_REG.FAULT_CAUSE}(t0)
    lw a3, ${MMU_REG.FAULT_ADDR}(t0)
    ecall`;
  const run = (cfg: enginesTypes.EngineConfig, src: string, map: (m: Machine) => void): Machine => {
    const m = new Machine();
    const e = pipelineEngine(cfg);
    const { program } = assemble(src);
    m.attach(e, program);
    m.ram.fill(0, 0, program.length * 4);
    for (const [i, w] of program.entries()) {
      put(m, SHIFT + 4 * i, w);
    }
    for (const [i, w] of assemble(STOP).program.entries()) {
      put(m, HANDLER + 4 * i, w);
    }
    m.mmu.configure(4);
    put(m, L1, pte(L2 >> 8, PteBit.Valid));
    put(m, L2, pte(SHIFT >> 8, PteBit.Valid | PteBit.Exec)); // the program's page: execute only
    put(m, L2 + 4 * 16, pte(0x30, PteBit.Valid)); // a read-only data page at virtual 0x1000
    m.bus.store32(MMU_BASE + MMU_REG.TABLE, L1);
    m.bus.store32(MMU_BASE + MMU_REG.VECTOR, HANDLER);
    map(m);
    m.mmu.enabled = true;
    for (let i = 0; i < 100_000 && !e.halted; i++) {
      m.stepCpu();
    }
    expect(e.halted).toBe(true);
    return m;
  };

  it.each(ENGINES)(
    '$name: a store to a read-only page faults, the stores before it landed and the ones after it never do',
    ({ cfg }) => {
      const m = run(
        cfg,
        `
      li s3, 0x1000
      li a0, 11
      sw a0, 0(s3)
      li a1, 22
      sw a1, 8(s3)
      sw a1, 0x300(zero)
      ecall`,
        (mm) => {
          put(mm, L2 + 4 * 16, pte(0x30, PteBit.Valid | PteBit.Write));
          put(mm, L2 + 4 * 17, pte(0x31, PteBit.Valid));
        },
      );
      // 0x1000 is writable here and 0x1100 is not; the program only touches 0x1000 and the unmapped 0x300
      expect(m.bus.load32(0x30_00)).toBe(11);
      expect(m.bus.load32(0x30_08)).toBe(22);
      expect(m.mmu.cause).toBe(VmFault.NotPresent); // 0x300 is on a page nobody mapped
      expect(m.regs[5]).toBe(VmFault.NotPresent);
      expect(m.regs[6]).toBe(0x3_00);
      expect(m.mmu.faults).toBe(1);
    },
  );

  it.each(ENGINES)('$name: writing a read-only page and running data are both refused with their cause', ({ cfg }) => {
    const ro = run(
      cfg,
      `
      li s3, 0x1000
      li a0, 5
      sw a0, 0(s3)
      ecall`,
      () => {
        // nothing mapped beyond the program's own pages
      },
    );
    expect(ro.mmu.cause).toBe(VmFault.Write);
    expect(ro.regs[6]).toBe(0x10_00);
    expect(ro.bus.load32(0x30_00)).toBe(0); // the store did nothing
    const nx = run(
      cfg,
      `
      li s3, 0x1000
      jalr zero, s3, 0
      ecall`,
      () => {
        // nothing mapped beyond the program's own pages
      },
    );
    expect(nx.mmu.cause).toBe(VmFault.Exec);
    expect(nx.regs[6]).toBe(0x10_00);
  });

  // Crash 2026-11-01: a bit flip turned a jump in a job into a jump to 0xffff0010. Device space passed the MMU unchanged, the fetch read zeros and the
  // illegal instruction threw RangeError, which ended the game instead of killing the job.
  it.each(ENGINES)('$name: a jump into device space is an execute fault, not a crash', ({ cfg }) => {
    const m = run(
      cfg,
      `
      li s3, 0xffff0010
      jalr zero, s3, 0
      ecall`,
      () => {
        // nothing mapped beyond the program's own pages
      },
    );
    expect(m.mmu.cause).toBe(VmFault.Exec);
    expect(m.regs[6]).toBe(0xff_ff_00_10 - 2 ** 32); // the word as a signed register
    expect(m.mmu.faults).toBe(1);
  });
});
