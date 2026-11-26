import { describe, expect, it } from 'vitest';
import { assemble } from '../asm';
import { generate, TEMPLATES } from '@/features/jobs/sim/gen';
import { BLOCK_BYTES, JOB_ROW, JobState, KERNEL_BASE, KSLOT, KSLOT_BYTES, PCH_RESULT_WORDS } from '@/core/sim/memmap';
import {
  JT_BASE,
  FMAP,
  FRAME_END,
  FRAME_FIRST,
  getOsSpec,
  RESERVED_FRAME,
  SPOOL_BLOCKS_PER_JOB,
} from '@/features/os/sim';
import { ECONOMY } from '@/features/economy/sim/economy';
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

// long compute jobs, so that several are alive together (the generator's calc job with many more rounds)
const calc = must(TEMPLATES['cli.calc']);
TEMPLATES['cli.calc'] = (rng, p) => calc(rng, { ...p, scale: p.scale * 500 });

const until = (g: Game, done: () => boolean, max = 9000): void => {
  for (let t = 0; t < max && !done(); t++) {
    g.advanceBaseTick();
  }
  expect(done()).toBe(true);
};

/** A machine for the preemptive OS: an MMU CPU, 64K of RAM, a drive, the OS installed and powered off. */
function pre(opts: { cpu?: string; keys?: { template: string; scale?: number }[] } = {}): Game {
  const g = rig('ssd1', { cpu: opts.cpu ?? 'cpu2', os: false, keys: opts.keys });
  for (const d of g.board.devices.filter((x) => x.spec.startsWith('ram'))) {
    g.uninstall(d.id);
  }
  const ram = g.purchase('ram4');
  if (!ram.ok) {
    throw new Error(ram.reason);
  }
  g.install(ram.invId);
  const os = g.purchase('os3');
  if (!os.ok) {
    throw new Error(os.reason);
  }
  const r = g.install(os.invId);
  if (!r.ok) {
    throw new Error(r.reason);
  }
  return g;
}

interface Rig {
  g: Game;
  dv: DataView;
  states: () => number[];
}

/** Put programs into the kernel's table as if they had been ingested (the spool is on the drive, the table in RAM). */
function submit(g: Game, programs: Uint32Array[]): Rig {
  const osDevice = must(g.os).deviceId;
  const disk = g.diskFor(must(g.board.devices.find((d) => d.id === osDevice)));
  const spool = Math.ceil(must(getOsSpec('os3')).diskBytes / BLOCK_BYTES);
  const dv = new DataView(g.machine.ram.buffer);
  for (const [k, program] of programs.entries()) {
    const lba = spool + k * SPOOL_BLOCKS_PER_JOB,
      at = JT_BASE + k * KSLOT_BYTES;
    disk.poke(lba, new Uint8Array(program.buffer, program.byteOffset, program.length * 4));
    dv.setUint32(at + KSLOT.KEY, 100 + k, true);
    dv.setUint32(at + KSLOT.LEN, program.length, true);
    dv.setUint32(at + KSLOT.LBA, lba, true);
    dv.setUint32(at + KSLOT.SEQ, k + 1, true);
    dv.setUint32(at + KSLOT.STATE, JobState.Queued, true);
  }
  return { g, dv, states: () => programs.map((_, k) => dv.getUint32(JT_BASE + k * KSLOT_BYTES + KSLOT.STATE, true)) };
}

const resultText = (dv: DataView, k: number): string => {
  const at = JT_BASE + k * KSLOT_BYTES + KSLOT.RESULT;
  return Array.from({ length: PCH_RESULT_WORDS * 4 }, (_, i) => dv.getUint8(at + i))
    .map((c) => (c ? String.fromCodePoint(c) : ' '))
    .join('')
    .trim();
};
const lastLine = (text: string): string => must(text.split('\n').findLast((l) => l.trim() !== '')).trim();
const framesInUse = (dv: DataView): number =>
  Array.from({ length: FRAME_END - FRAME_FIRST }, (_, f) => dv.getUint32(FMAP + 4 * (FRAME_FIRST + f), true)).filter(
    (w) => w !== 0 && w !== RESERVED_FRAME,
  ).length;

/** Has the job on the plugged key run to its end, and the key come back out? */
const jobDone = (g: Game) => (): boolean => g.completed === 1 && g.pluggedKey() === null;
/** How many programs the RAM view shows loaded. */
const appRegions = (g: Game): number => (g.snapshot().ram?.regions ?? []).filter((r) => r.kind === 'app').length;
/** Does a health line say the kernel kept frames it should have freed? */
const namesLeak = (g: Game): boolean =>
  must(g.snapshot().health).some((h) => h.level === 'bad' && h.text.includes('not give them back'));

/** Two jobs on a fresh machine for the preemptive OS, run to their results: the cycle, the timer and the TLB at the end. */
function deterministicRun(): string {
  const g = pre();
  g.powerButton();
  until(g, () => g.currentPhase() === 'idle-os');
  const { states } = submit(
    g,
    [1, 2].map((k) => generate('cli.calc', 30 + k, { row: JOB_ROW, scale: 16, hosted: true }).program),
  );
  until(g, () => states().every((x) => x === JobState.Result), 60_000);
  return [g.snapshot().cycle, g.machine.timer.fired, must(g.snapshot().mmu).hits, must(g.snapshot().mmu).misses].join(
    ',',
  );
}

/** Ticks `g` until every job of `states` has its result, at most `max` times: the levels of the health lines of every tick. */
function healthWhileRunning(g: Game, states: () => number[], max: number): string[] {
  const levels: string[] = [];
  for (let i = 0; i < max && !states().every((x) => x === JobState.Result); i++) {
    g.advanceBaseTick();
    levels.push(...(g.snapshot().health ?? []).map((h) => h.level));
  }
  return levels;
}

/** Runs the plugged job of `g` to its end: the biggest page table its address space had on the way. */
function biggestPageTable(g: Game): number[] {
  let best: number[] = [];
  until(g, () => {
    const sp = g.snapshot().ram?.vm?.spaces[0];
    if (sp && sp.pages.length > best.length) {
      best = sp.pages;
    }
    return jobDone(g)();
  });
  return best;
}

/** Is a heap page (between 0x40 and 0x80) mapped with bits 3? */
const hasHeapPage = (pages: Map<number, [number, number]>): boolean =>
  [...pages.entries()].some(([v, [, bits]]) => v >= 0x40 && v < 0x80 && bits === 3);

describe('the preemptive OS', { timeout: 60_000 }, () => {
  // several long programs on a loaded machine
  it('needs a CPU with an MMU', () => {
    expect(() => pre({ cpu: 'cpu1' })).toThrow(/MMU/u);
  });

  it('boots and runs a job to its result', () => {
    const g = pre({ keys: [{ template: 'cli.scan', scale: 3 }] });
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    g.plugKey(must(g.trayKeyIds()[0]));
    until(g, jobDone(g));
    expect(g.snapshot().faults).toBe(0);
    expect(g.errors).toBe(0);
  });

  it('runs several programs at once, each in its own address space, and every one ends with its own result', () => {
    const g = pre();
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    const gens = [
      generate('cli.calc', 11, { row: JOB_ROW, scale: 16, hosted: true }),
      generate('cli.calc', 12, { row: JOB_ROW, scale: 16, hosted: true }),
      generate('cli.scan', 13, { row: JOB_ROW, scale: 4, hosted: true }),
    ];
    const { dv, states } = submit(
      g,
      gens.map((x) => x.program),
    );
    let most = 0,
      apps = 0;
    until(
      g,
      () => {
        most = Math.max(most, states().filter((x) => x === JobState.Running).length);
        apps = Math.max(apps, appRegions(g));
        return states().every((x) => x === JobState.Result);
      },
      60_000,
    );
    expect(most).toBeGreaterThanOrEqual(2);
    expect(apps).toBeGreaterThanOrEqual(2); // the RAM view shows every program that is loaded
    for (const [k, gen] of gens.entries()) {
      expect(resultText(dv, k)).toBe(lastLine(gen.meta.expectedText));
    }
    expect(g.snapshot().faults).toBe(0);
    expect(g.errors).toBe(0);
    expect(g.machine.timer.fired).toBeGreaterThan(0);
    expect(must(g.snapshot().mmu).faults).toBeGreaterThan(0); // heap and stack frames claimed by faults
    // everything is given back: no frames, and the timer rests when nothing runs
    until(g, () => g.currentPhase() === 'idle-os');
    expect(framesInUse(dv)).toBe(0);
    expect(g.machine.timer.interval).toBe(0);
  });

  it('a program that touches the OS is killed while the others carry on and finish', () => {
    const g = pre();
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    const good = generate('cli.calc', 21, { row: JOB_ROW, scale: 16, hosted: true });
    const bad = assemble(`li s0, ${KERNEL_BASE}
  sw zero, 0(s0)
  li t0, 77
  sw t0, 0x3000(zero)
spin:
  j spin`).program;
    const { dv, states } = submit(g, [good.program, bad, good.program]);
    until(g, () => states().every((x) => x === JobState.Result), 60_000);
    expect(resultText(dv, 0)).toBe(lastLine(good.meta.expectedText));
    expect(resultText(dv, 1)).toBe('SEGFAULT');
    expect(resultText(dv, 2)).toBe(lastLine(good.meta.expectedText));
    expect(g.snapshot().faults).toBe(1);
    expect(g.currentPhase()).not.toBe('error');
    until(g, () => g.currentPhase() === 'idle-os');
    expect(framesInUse(dv)).toBe(0);
  });

  it('is deterministic', () => {
    expect(deterministicRun()).toBe(deterministicRun());
  });

  it('the health lines stay quiet on a healthy machine and name a frame the kernel forgot to free', () => {
    const g = pre();
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    const { dv, states } = submit(g, [generate('cli.calc', 11, { row: JOB_ROW, scale: 16, hosted: true }).program]);
    expect(healthWhileRunning(g, states, 200)).not.toContain('bad');
    until(g, () => states().every((x) => x === JobState.Result), 60_000);
    until(g, () => g.currentPhase() === 'idle-os');
    // a frame owned by job slot 5, which is not running
    dv.setUint32(FMAP + 4 * 1000, 5 + 1, true);
    for (let i = 0; i < 4; i++) {
      g.snapshot();
    }
    expect(namesLeak(g)).toBe(true);
  });

  it("the snapshot carries each running program's page table: the ROM, its image and the pages it claimed, with their bits", () => {
    const g = pre({ keys: [{ template: 'cli.scan', scale: 3 }] });
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    g.plugKey(must(g.trayKeyIds()[0]));
    const best = biggestPageTable(g);
    const pages = new Map<number, [number, number]>();
    for (let i = 0; i < best.length; i += 3) {
      pages.set(must(best[i]), [must(best[i + 1]), must(best[i + 2])]);
    }
    expect(must(pages.get(0))[1]).toBe(5);
    expect(must(pages.get(0x10))[1]).toBe(7);
    expect(hasHeapPage(pages)).toBe(true);
    expect(must(pages.get(0xc1))[1]).toBe(5);
  });
});
