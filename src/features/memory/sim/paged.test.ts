import { assert, describe, expect, it } from 'vitest';
import { assemble } from '../../cpu/sim/asm';
import { KDATA_BASE, KERNEL_BASE, PAGED_SHIFT, PAGED_TABLES, USER_BASE } from '@/core/sim/memmap';
import { ECONOMY } from '../../economy/sim/economy';
import type { Game } from '@/worker/game/game';
import { rig } from '@/worker/game/testkit';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const until = (g: Game, done: () => boolean, max = 6000): void => {
  for (let t = 0; t < max && !done(); t++) {
    g.advanceBaseTick();
  }
  expect(done()).toBe(true);
};

/** The plugged job is done and its key is out of the port. */
const jobDone = (g: Game) => (): boolean => g.completed === 1 && g.pluggedKey() === null;

type Region = NonNullable<ReturnType<Game['snapshot']>['ram']>['regions'][number];
interface Space {
  pages: number[];
  tables: number[];
  table: number;
}
const regionsOf = (g: Game): Region[] => g.snapshot().ram?.regions ?? [];
/** The machine shows a program's image in its RAM map. */
const appShown = (g: Game) => (): boolean => regionsOf(g).some((r) => r.kind === 'app');
const isJobRegion = (r: Region): boolean => r.kind === 'app' || r.kind === 'work';
/** The pages of memory the running program has claimed for its work. */
function workPages(g: Game): number {
  let n = 0;
  for (const r of regionsOf(g).filter((x) => x.kind === 'work')) {
    n += (r.hi - r.lo) / 256;
  }
  return n;
}
/** The job is running under the OS and its program has arrived in its image. */
const programIn = (g: Game) => (): boolean =>
  g.currentPhase() === 'running-os' &&
  new DataView(g.machine.ram.buffer).getUint32(USER_BASE + PAGED_SHIFT, true) !== 0;
/** The machine has had exactly one job fault. */
const oneFault = (g: Game) => (): boolean => (g.snapshot().faults ?? 0) === 1;
/** The plugged job is neither waiting nor running any more. */
const jobStopped = (g: Game) => (): boolean => {
  const stage = g.snapshot().plugged?.stage;
  return stage !== 'running' && stage !== 'queued';
};
/** The larger of two address spaces by pages mapped, keeping the one already held on a tie. */
const biggerSpace = (held: Space | undefined, x: Space | undefined): Space | undefined =>
  x !== undefined && (held === undefined || x.pages.length > held.pages.length) ? x : held;

/** A machine for the paged OS: an MMU CPU, 64K of RAM, a drive, the OS installed and powered off. */
function paged(opts: { cpu?: string; keys?: { template: string; scale?: number }[]; install?: boolean } = {}): Game {
  const g = rig('ssd1', { cpu: opts.cpu ?? 'cpu2', os: false, keys: opts.keys });
  for (const d of g.board.devices.filter((x) => x.spec.startsWith('ram'))) {
    g.uninstall(d.id);
  }
  const ram = g.purchase('ram2');
  if (!ram.ok) {
    throw new Error(ram.reason);
  }
  g.install(ram.invId);
  if (opts.install !== false) {
    const os = g.purchase('os2');
    if (!os.ok) {
      throw new Error(os.reason);
    }
    const r = g.install(os.invId);
    if (!r.ok) {
      throw new Error(r.reason);
    }
  }
  return g;
}

/** Runs a scan on the paged OS to the end; the cycle count and the MMU's counters, as one line. */
function scanRun(): string {
  const g = paged({ keys: [{ template: 'cli.scan', scale: 3 }] });
  g.powerButton();
  until(g, () => g.currentPhase() === 'idle-os');
  const [firstTrayKeyId5] = g.trayKeyIds();
  assert.exists(firstTrayKeyId5);
  g.plugKey(firstTrayKeyId5);
  until(g, jobDone(g));
  const mmu = must(g.snapshot().mmu);
  return [g.snapshot().cycle, mmu.faults, mmu.hits, mmu.misses].join(',');
}

describe('the paged OS', () => {
  it('needs a CPU with an MMU: refused on one without, accepted on one with', () => {
    const g = paged({ cpu: 'cpu1', install: false });
    const os = g.purchase('os2');
    expect(os.ok).toBe(true);
    assert(os.ok);
    const refused = g.install(os.invId);
    expect(refused.ok).toBe(false);
    assert(!refused.ok);
    expect(refused.reason).toMatch(/MMU/u);
    expect(g.cpuHasMmu()).toBe(false);
    expect(paged({ cpu: 'cpu2' }).snapshot().os).toMatchObject({ spec: 'os2', tier: 2 });
  });

  it('boots, runs a job in its own address space and delivers the result', () => {
    const g = paged();
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    expect(g.snapshot().display).toMatch(/OS READY|/u);
    const [firstTrayKeyId] = g.trayKeyIds();
    assert.exists(firstTrayKeyId);
    expect(g.plugKey(firstTrayKeyId).ok).toBe(true);
    until(g, jobDone(g));
    expect(g.snapshot().faults).toBe(0);
    expect(g.errors).toBe(0);
  });

  it('the program claims its heap by touching it: the kernel maps a frame for each new page, and gives them back at the end', () => {
    const g = paged({ keys: [{ template: 'cli.scan', scale: 3 }] });
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    const [firstTrayKeyId2] = g.trayKeyIds();
    assert.exists(firstTrayKeyId2);
    g.plugKey(firstTrayKeyId2);
    let claimed = 0;
    until(g, () => {
      claimed = Math.max(claimed, workPages(g));
      return jobDone(g)();
    });
    expect(claimed).toBeGreaterThanOrEqual(5); // the scan's buffer, about 1.5K
    expect(g.snapshot().mmu).toMatchObject({ tlb: 4 });
    const mmu2 = g.snapshot().mmu;
    assert.exists(mmu2);
    expect(mmu2.faults).toBeGreaterThanOrEqual(5);
    const mmu3 = g.snapshot().mmu;
    assert.exists(mmu3);
    expect(mmu3.misses).toBeGreaterThan(0);
    expect(g.snapshot().faults).toBe(0); // page faults the kernel fixed are not job faults
    const ram2 = g.snapshot().ram;
    assert.exists(ram2);
    expect(ram2.regions.some(isJobRegion)).toBe(false);
  });

  it('shows the program where its page table puts it: the image at physical + PAGED_SHIFT, and the tables as OS memory', () => {
    const g = paged();
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    const [firstTrayKeyId3] = g.trayKeyIds();
    assert.exists(firstTrayKeyId3);
    g.plugKey(firstTrayKeyId3);
    until(g, appShown(g));
    const ram3 = g.snapshot().ram;
    assert.exists(ram3);
    const { regions } = ram3;
    const appRegion = regions.find((r) => r.kind === 'app');
    assert.exists(appRegion);
    expect(appRegion.lo).toBe(USER_BASE + PAGED_SHIFT);
    expect(regions.find((r) => r.id === 'os-tables')).toMatchObject({ lo: PAGED_TABLES, kind: 'osdata' });
  });

  it('a job that writes to the OS, or reaches for memory it has no right to, is killed', () => {
    for (const body of [
      `li s0, ${KERNEL_BASE}\n  sw zero, 0(s0)`, // the kernel: mapped read-only
      `li s0, ${KDATA_BASE}\n  sw zero, 0(s0)`, // the job table
      `li s0, 36864\n  lw a0, 0(s0)`, // 0x9000: nothing of the program's
      `li s0, 0\n  sw zero, 0(s0)`, // the ROM
    ]) {
      const g = paged();
      g.powerButton();
      until(g, () => g.currentPhase() === 'idle-os');
      const dv = () => new DataView(g.machine.ram.buffer);
      const [firstTrayKeyId4] = g.trayKeyIds();
      assert.exists(firstTrayKeyId4);
      g.plugKey(firstTrayKeyId4);
      until(g, programIn(g));
      const { program } = assemble(`${body}\n  li t0, 77\n  sw t0, 0x3000(zero)\nspin:\n  j spin`);
      for (const [i, w] of program.entries()) {
        dv().setUint32(USER_BASE + PAGED_SHIFT + 4 * i, w, true);
      }
      until(g, oneFault(g));
      expect(g.currentPhase()).not.toBe('error');
      // the kernel carries on: it ends the job and goes back to waiting for work
      until(g, jobStopped(g));
    }
  });

  it('is deterministic', () => {
    expect(scanRun()).toBe(scanRun());
  });

  it("the snapshot carries the program's page table, and the frames its tables are in", () => {
    const g = paged({ keys: [{ template: 'cli.scan', scale: 3 }] });
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    const [firstTrayKeyId6] = g.trayKeyIds();
    assert.exists(firstTrayKeyId6);
    g.plugKey(firstTrayKeyId6);
    let sp: Space | undefined;
    until(g, () => {
      sp = biggerSpace(sp, g.snapshot().ram?.vm?.spaces[0]);
      return jobDone(g)();
    });
    assert.exists(sp);
    expect(sp.table).toBe(PAGED_TABLES);
    expect(sp.tables[0]).toBe(PAGED_TABLES >> 8);
    expect(sp.pages.length / 3).toBeGreaterThan(20);
  });
});
