import { assert, describe, expect, it } from 'vitest';
import { assemble } from '../../cpu/sim/asm';
import { KDATA_BASE, KERNEL_BASE, OS_HEADER_BASE, USER_BASE } from '@/core/sim/memmap';
import { KERNEL_IMAGE } from '../../os/sim';
import { ECONOMY } from '../../economy/sim/economy';
import type { Game } from '@/worker/game/game';
import { codeEndOf, protectedPage, ramRegionsOf } from './ramregions';
import type * as ramregionsTypes from './ramregions';
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

const until = (g: Game, done: () => boolean, max = 3000): void => {
  for (let t = 0; t < max && !done(); t++) {
    g.advanceBaseTick();
  }
  expect(done()).toBe(true);
};

type Region = ramregionsTypes.RamRegion;
const regionsOf = (g: Game): Region[] => g.snapshot().ram?.regions ?? [];
/** The machine shows a program's image in its RAM map. */
const appShown = (g: Game) => (): boolean => regionsOf(g).some((r) => r.kind === 'app');
/** Two regions share no byte. */
const apart = (a: Region, b: Region): boolean => a.lo >= b.hi || a.hi <= b.lo;
const isOsRegion = (r: Region): boolean => r.kind === 'rom' || r.kind === 'os' || r.kind === 'osdata';
const isJobRegion = (r: Region): boolean => r.kind === 'work' || r.kind === 'app';
/** The regions of `kind`, of `owner` when given. */
const ofKind = (r: Region[], kind: string, owner?: number): Region[] =>
  r.filter((x) => x.kind === kind && (owner === undefined || x.owner === owner));

/** Runs until the program claims memory it writes to; returns those work regions. */
function waitForWork(g: Game): Region[] {
  let seen: Region[] = [];
  until(
    g,
    () => {
      seen = regionsOf(g).filter((r) => r.kind === 'work');
      return seen.length > 0;
    },
    4000,
  );
  return seen;
}

/** The plugged job is done and its key is out of the port. */
const jobDone = (g: Game) => (): boolean => g.completed === 1 && g.pluggedKey() === null;

describe('what lives where in RAM', () => {
  const ram = new Uint8Array(64 * 1024);

  it('the boot ROM is always there; the OS and a program only when they are', () => {
    expect(ramRegionsOf(ram, { os: null, job: null }).map((r) => r.id)).toStrictEqual(['rom']);
    const r = ramRegionsOf(ram, {
      os: { name: 'Resident OS 1.0' },
      job: { key: 7, label: '#07 calc', type: 'calc', words: 40 },
    });
    expect(r.map((x) => x.id)).toStrictEqual(['rom', 'os-header', 'os-kernel', 'os-table', 'app-7']);
    expect(r.find((x) => x.id === 'os-header')).toMatchObject({ lo: OS_HEADER_BASE, hi: KERNEL_BASE });
    expect(r.find((x) => x.id === 'os-kernel')).toMatchObject({
      lo: KERNEL_BASE,
      hi: KERNEL_BASE + KERNEL_IMAGE.length * 4,
      name: 'Resident OS 1.0',
    });
    const osTableR = r.find((x) => x.id === 'os-table');
    assert.exists(osTableR);
    expect(osTableR.lo).toBe(KDATA_BASE);
    expect(r.find((x) => x.id === 'app-7')).toMatchObject({
      kind: 'app',
      lo: USER_BASE,
      hi: USER_BASE + 160,
      owner: 7,
      type: 'calc',
    });
  });

  it('regions never overlap and stay inside the memory', () => {
    const small = new Uint8Array(0xd0_00);
    const r = ramRegionsOf(small, { os: { name: 'OS' }, job: { key: 1, label: '#01 x', type: 'x', words: 1_000_000 } });
    for (const a of r) {
      expect(a.hi).toBeLessThanOrEqual(small.length);
      expect(a.hi).toBeGreaterThan(a.lo);
    }
    const sorted = [...r].toSorted((a, b) => a.lo - b.lo);
    for (let i = 1; i < sorted.length; i++) {
      const sortedItem = sorted[i];
      assert.exists(sortedItem);
      expect(sortedItem.lo).toBeGreaterThanOrEqual(must(sorted[i - 1]).hi);
    }
  });

  it('the code of a program ends after its last return; what follows is data', () => {
    const { program } = assemble(
      'main:\n  li a0, 1\n  ecall\nf:\n  addi a0, a0, 1\n  ret\ntable:\n  .word 5\n  .word 6',
    );
    const img = new Uint8Array(64);
    new DataView(img.buffer).setUint32(0, 0, true);
    for (const [i, w] of program.entries()) {
      new DataView(img.buffer).setUint32(4 * i, w, true);
    }
    const end = codeEndOf(img, 0, program.length * 4);
    expect(end).toBe(4 * (program.length - 2));
  });

  it("a running machine reports the OS and the program it loaded, with the program's bytes in the image", () => {
    const g = rig('ssd1');
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    let s = g.snapshot();
    assert.exists(s.ram);
    expect(s.ram.regions.map((r) => r.id)).toStrictEqual(['rom', 'os-header', 'os-kernel', 'os-table']);
    expect(s.ram.image).toHaveLength(64 * 1024); // the first 64K at least: the installed sticks here add up to less
    const [id] = g.trayKeyIds();
    assert.exists(id);
    expect(g.plugKey(id).ok).toBe(true);
    until(g, appShown(g));
    // the region is announced when the kernel starts the job; the program arrives a little after (the kernel copies it in from the spool)
    until(g, () => new DataView(g.machine.ram.buffer).getUint32(USER_BASE, true) !== 0);
    s = g.snapshot();
    assert.exists(s.ram);
    const app = s.ram.regions.find((r) => r.kind === 'app');
    assert.exists(app);
    expect(app.owner).toBe(id);
    expect(app.lo).toBe(USER_BASE);
    expect(app.name).toMatch(/^#\d\d /u);
    expect(app.codeEnd).toBeGreaterThan(app.lo);
    expect(app.codeEnd).toBeLessThanOrEqual(app.hi);
    // the image is the memory: the program is in it where the region says
    const dv = new DataView(s.ram.image.buffer, s.ram.image.byteOffset);
    expect(dv.getUint32(app.lo, true)).not.toBe(0);
    expect(dv.getUint32(KERNEL_BASE, true)).toBe(KERNEL_IMAGE[0]);
    // when the job is done the program leaves the map
    until(g, jobDone(g), 4000);
    const ram2 = g.snapshot().ram;
    assert.exists(ram2);
    expect(ram2.regions.some((r) => r.kind === 'app')).toBe(false);
  });

  it("a program claims the memory it writes to, never the OS's, and gives it back when it ends", () => {
    // a scan builds a table in memory it was not given (a log only uses registers and claims nothing)
    const g = rig('ssd1', { keys: [{ template: 'cli.scan', scale: 3 }] });
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    const [firstTrayKeyId] = g.trayKeyIds();
    assert.exists(firstTrayKeyId);
    expect(g.plugKey(firstTrayKeyId).ok).toBe(true);
    const seen = waitForWork(g);
    const snap = g.snapshot().ram;
    assert.exists(snap);
    const app = snap.regions.find((r) => r.kind === 'app');
    assert.exists(app);
    for (const w of seen) {
      expect(w.owner).toBe(app.owner);
      expect(w.name).toBe(`${app.name} data`);
      expect(w.lo % 256).toBe(0);
      expect(apart(w, app)).toBe(true); // outside the program's own image
      for (const o of snap.regions.filter(isOsRegion)) {
        expect(apart(w, o)).toBe(true);
      }
    }
    until(g, jobDone(g), 4000);
    const ram3 = g.snapshot().ram;
    assert.exists(ram3);
    expect(ram3.regions.some(isJobRegion)).toBe(false);
  });

  it("protected pages: the ROM, the OS and the program's own image", () => {
    expect(protectedPage(0, 40)).toBe(true);
    expect(protectedPage(USER_BASE >> 8, 40)).toBe(true);
    expect(protectedPage((USER_BASE >> 8) + 1, 40)).toBe(false);
    expect(protectedPage((USER_BASE >> 8) + 1, 100)).toBe(true);
    expect(protectedPage(KERNEL_BASE >> 8, 40)).toBe(true);
    expect(protectedPage(KDATA_BASE >> 8, 40)).toBe(true);
    expect(protectedPage(0xf0, 40)).toBe(false);
  });

  it("without an OS the key's program is the application, and the OS regions are absent", () => {
    const g = rig('hdd0', { os: false });
    const [firstTrayKeyId2] = g.trayKeyIds();
    assert.exists(firstTrayKeyId2);
    expect(g.plugKey(firstTrayKeyId2).ok).toBe(true);
    g.powerButton();
    until(g, appShown(g), 4000);
    const ram4 = g.snapshot().ram;
    assert.exists(ram4);
    const ids = ram4.regions.map((r) => r.kind);
    expect(ids).toContain('rom');
    expect(ids).toContain('app');
    expect(ids).not.toContain('os');
  });

  it("the preemptive OS: every owned frame is a region of its program (image, data, page tables), by the OS's frame map", () => {
    const frames = Array.from({ length: 176 }, () => 0);
    // job slot 0 (owner 1): tables at 16..19, image at 20..22, data at 40; job slot 2 (owner 3): image at 23..24
    for (let f = 16; f < 20; f++) {
      frames[f] = 0x2_00 | 1;
    }
    for (let f = 20; f < 23; f++) {
      frames[f] = 1;
    }
    frames[40] = 0x1_00 | 1;
    for (let f = 23; f < 25; f++) {
      frames[f] = 3;
    }
    const r = ramRegionsOf(new Uint8Array(1024 * 1024), {
      os: { name: 'Preemptive OS 3.0', tier: 3 },
      job: null,
      frames,
      procs: [{ key: 7, label: '#07 calc', type: 'calc' }, undefined, { key: 9, label: '#09 scan', type: 'scan' }],
    });
    const find = (kind: string, owner?: number) => ofKind(r, kind, owner);
    expect(find('app', 7)).toMatchObject([{ lo: 20 * 256, hi: 23 * 256 }]);
    expect(find('app', 9)).toMatchObject([{ lo: 23 * 256, hi: 25 * 256 }]);
    expect(find('work', 7)).toMatchObject([{ lo: 40 * 256, hi: 41 * 256 }]);
    expect(r.find((x) => x.id.startsWith('ptab-0'))).toMatchObject({ kind: 'osdata', lo: 16 * 256, hi: 20 * 256 });
    expect(r.some((x) => x.id === 'os-ktable')).toBe(true);
    expect(r.find((x) => x.id === 'os-fmap')).toMatchObject({ kind: 'osdata', lo: 0x1_00_00, hi: 0x1_40_00 });
  });
});
