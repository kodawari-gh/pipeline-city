import { assert, describe, expect, it } from 'vitest';
import { KERNEL_BASE, STORAGE_REG } from '@/core/sim/memmap';
import { BOOT_BLOCKS, KERNEL_IMAGE } from '.';
import { Game } from '@/worker/game/game';
import type * as gameTypes from '@/worker/game/game';
import { Operator } from '../../economy/sim/operator';

import { econ, rig } from '@/worker/game/testkit';
import type * as testkitTypes from '@/worker/game/testkit';
import { ECONOMY } from '../../economy/sim/economy';

/** The plugged job is done and its key is out of the port. */
const jobDone = (g: Game) => (): boolean => g.completed === 1 && g.pluggedKey() === null;

// These tests are about hardware, not player levels: every item is buyable (levels have their own tests in levels.test.ts).
ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const ticks = (g: Game, n: number): void => {
  for (let i = 0; i < n; i++) {
    g.advanceBaseTick();
  }
};

function runUntil(g: Game, phase: gameTypes.Phase, max = 3000): number {
  let t = 0;
  while (g.currentPhase() !== phase && t < max) {
    g.advanceBaseTick();
    t++;
  }
  expect(g.currentPhase()).toBe(phase);
  return t;
}

/** Tick until `done()` holds, at most `max` ticks; returns the ticks taken. */
function until(g: Game, done: () => boolean, max = 3000): number {
  let t = 0;
  while (!done() && t < max) {
    g.advanceBaseTick();
    t++;
  }
  expect(done()).toBe(true);
  return t;
}

const stageOfPlugged = (g: Game) => g.snapshot().plugged?.stage;

/** Plug `keyId` and wait until the OS has ingested it (queued or beyond). The key stays in: the OS works on it. */
function ingest(g: Game, keyId: number): number {
  expect(g.plugKey(keyId).ok).toBe(true);
  return until(g, () => ['queued', 'running', 'result', 'flashing', 'done'].includes(stageOfPlugged(g) ?? ''));
}

/** Plug `keyId` and wait until the key has popped out by itself and paid. Returns the payout. */
function serve(g: Game, keyId: number): number {
  const before = g.completed;
  expect(g.plugKey(keyId).ok).toBe(true);
  until(g, () => g.completed === before + 1 && g.pluggedKey() === null, 4000);
  assert.exists(g.lastCompleted);
  return g.lastCompleted.payout;
}

/** Buys `id` and returns the inventory id of the spare. */
function bought(g: Game, id: string): string {
  const r = g.purchase(id);
  if (!r.ok) {
    throw new Error(`${id}: ${r.reason}`);
  }
  return r.invId;
}

/** An action that was refused, for a reason that matches `why`. */
function expectRefused(r: { ok: boolean; reason?: string }, why: RegExp): void {
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(why);
}

const powerOff = (g: Game): void => {
  if (g.powered) {
    g.powerButton();
  }
};

/** A free run of the spool area. */
const isEmptySpool = (r: { kind: string; filled: boolean }): boolean => r.kind === 'spool' && !r.filled;

/** The OS has the plugged job: queued, running or writing its result. */
const osHasJob = (g: Game): boolean => {
  const stage = stageOfPlugged(g);
  return stage === 'queued' || stage === 'running' || stage === 'result';
};

/** Ticks to the OS prompt on a drive, with the firmware and OS boot boosts off (raw drive speed). */
function rawBootTicks(s: 'hdd0' | 'ssd1' | 'nvme2'): number {
  const g = rig(s, { economy: { osBootBoost: 1, firmwareBoost: 1 } });
  g.powerButton();
  return runUntil(g, 'idle-os');
}
/** Ticks to the OS prompt on an SSD with this CPU. */
function bootTicksOn(cpu: string): number {
  const g = rig('ssd1', { cpu });
  g.powerButton();
  return runUntil(g, 'idle-os');
}
/** Ticks to the OS prompt on a drive, as a player gets it. */
function bootTicks(s: 'hdd0' | 'ssd1' | 'nvme2'): number {
  const g = rig(s);
  g.powerButton();
  return runUntil(g, 'idle-os');
}

/** Ingests a key on a drive: the ticks it took, the cost of the spool write and the bytes written to the drive. */
function ingestOn(s: 'hdd0' | 'nvme2') {
  const g = rig(s);
  g.powerButton();
  runUntil(g, 'idle-os');
  const [id] = g.trayKeyIds();
  assert.exists(id);
  g.plugKey(id);
  const start = g.baseTick;
  until(g, () => osHasJob(g));
  const [st] = g.snapshot().storage;
  assert.exists(st);
  const w = st.cmds.find((c) => c.op === 'w');
  assert.exists(w); // (the ingest takes a few base ticks, too few to tell the tiers apart by the clock alone)
  return { took: g.baseTick - start, cost: w.seek + w.xfer, written: st.bytesWritten };
}

interface RunLog {
  maxRunning: number;
  order: number[];
}
/** Notes the jobs running in the OS queue (the most at once, and the keys in the order they ran); true once the plugged key is out. */
function noteRunning(g: Game, log: RunLog): boolean {
  const os5 = g.snapshot().os;
  assert.exists(os5);
  const q = os5.queue;
  log.maxRunning = Math.max(log.maxRunning, q.filter((j) => j.state === 'running').length);
  const r = q.find((j) => j.state === 'running');
  if (r && log.order.at(-1) !== r.keyId) {
    log.order.push(r.keyId);
  }
  return g.pluggedKey() === null;
}

/** The same scripted game every time: two keys served on an SSD; its snapshot and save as text. */
function scriptedRun(): string {
  const g = rig('ssd1', { seed: 11, keys: [{ template: 'cli.log' }, { template: 'cli.checksum' }] });
  g.powerButton();
  runUntil(g, 'idle-os');
  for (const id of g.trayKeyIds()) {
    serve(g, id);
  }
  ticks(g, 30);
  return JSON.stringify([g.snapshot(), g.toSave()]);
}

/** A save as the plain JSON data a file holds, before any parsing. */
const jsonData = (save: unknown): unknown => {
  const text = JSON.stringify(save);
  return JSON.parse(text);
};
/** JSON data that must be an object, to spread a changed field over. */
function asObject(v: unknown): object {
  if (typeof v !== 'object' || v === null) {
    throw new TypeError('expected a JSON object');
  }
  return v;
}
/** The field `key` of JSON object `node`. */
const fieldOf = (node: unknown, key: string): unknown => Object.entries(asObject(node)).find(([k]) => k === key)?.[1];

const diskOf = (g: Game) => {
  const [firstValue] = [...g.disks.values()];
  assert.exists(firstValue);
  return firstValue;
};
const devId = (g: Game) => {
  const [firstValue2] = [...g.disks.keys()];
  assert.exists(firstValue2);
  return firstValue2;
};
/** Starts a write to block 300 on the drive (cut short by a power cut, it tears). */
const tornWrite = (g: Game): void => {
  const port = g.ports.find((p) => p.media);
  assert.exists(port);
  port.write(STORAGE_REG.LBA, 300);
  port.write(STORAGE_REG.CMD, 2);
};

/** The phases the machine passes through on its way to the OS prompt, at most `max` ticks. */
function phasesToIdle(g: Game, max: number): Set<gameTypes.Phase> {
  const seen = new Set<gameTypes.Phase>();
  for (let i = 0; i < max && g.currentPhase() !== 'idle-os'; i++) {
    g.advanceBaseTick();
    seen.add(g.currentPhase());
  }
  return seen;
}

/** An HDD machine, off, whose OS has filesystem tier `fsTier`, with a blank SSD installed beside it. */
function withSecond(fsTier: number): Game {
  const g = rig('hdd0');
  powerOff(g);
  assert.exists(g.os);
  g.os.spec = { ...g.os.spec, fsTier };
  expect(g.install(bought(g, 'ssd1')).ok).toBe(true);
  return g;
}
/** The drive that does not hold the OS. */
const second = (g: Game): string => {
  const foundStorage = g.snapshot().storage.find((s) => !s.hasOs);
  assert.exists(foundStorage);
  return foundStorage.deviceId;
};

/** Ticks of the boot scan of a dirty, part-full HDD under a filesystem of tier `fsTier`. */
function dirtyMountTicks(fsTier: number): number {
  const g = rig('hdd0');
  assert.exists(g.os);
  g.os.spec = { ...g.os.spec, fsTier };
  diskOf(g).reserve(120, 200);
  diskOf(g).mount = 'dirty';
  g.powerButton();
  return g.mountTicksLeft();
}

describe('buying and installing storage and the OS', () => {
  it('storage is bought and installed into typed SATA / M.2 slots', () => {
    const g = new Game({ seed: 1, preassembled: true, economy: econ() });
    g.money = 100_000;
    const by = (id: string) => {
      const foundPurchase = g.snapshot().purchases.find((p) => p.id === id);
      assert.exists(foundPurchase);
      return foundPurchase;
    };
    expect(by('hdd0')).toMatchObject({ kind: 'storage', price: 40 });
    expect(by('hdd0').blocked).toBeUndefined();
    // the shop sells an M.2 drive to a board without the slot; the spare says it has nowhere to go
    expect(by('nvme2').blocked).toBeUndefined();
    const nv = bought(g, 'nvme2');
    const nvSpare = g.snapshot().inventory.find((i) => i.id === nv);
    assert.exists(nvSpare);
    expect(nvSpare.installable).toBe(false);
    expect(nvSpare.reason).toMatch(/m2/u);
    const b = g.purchase('hdd0');
    expect(b.ok).toBe(true);
    // and a drive you own stays on sale: as many as you like, whatever the slots
    expect(g.purchase('hdd0').ok).toBe(true);
    expect(g.snapshot().inventory.filter((i) => i.spec === 'hdd0')).toHaveLength(2);
    const inv = g.snapshot().inventory.find((i) => i.spec === 'hdd0');
    assert.exists(inv);
    expect(inv).toMatchObject({ kind: 'storage', freeSlots: ['sata0', 'sata1'], installable: true }); // the machine is on: swapInstall cycles the power
    g.powerButton();
    expect(g.install(inv.id)).toMatchObject({ ok: true, slot: 'sata0' });
    expect(g.progress.storageInstalled).toBe(true);
    expect(g.snapshot().storage).toMatchObject([
      { slot: 'sata0', spec: 'hdd0', capacityBytes: 96 * 1024, usedBytes: 0, hasOs: false },
    ]);
    // the SATA power rule is the PSU budget: the drive's load counts against the rated load
    expect(g.powered).toBe(false);
    expect(g.snapshot().devices.find((d) => d.kind === 'storage')).toBeDefined();
  });

  it('the M.2 slot comes with the ATX+ board, and only an NVMe drive fits it', () => {
    const g = new Game({ seed: 1, preassembled: true, economy: econ() });
    g.money = 100_000;
    g.powerButton();
    for (const id of ['board1', 'board2']) {
      g.install(bought(g, id));
    }
    expect(g.snapshot().slots.filter((s) => s.type === 'm2')).toHaveLength(2);
    const nv = bought(g, 'nvme2');
    const ssd = bought(g, 'ssd1');
    const snap = g.snapshot().inventory;
    const foundSnap = snap.find((i) => i.id === nv);
    assert.exists(foundSnap);
    expect(foundSnap.freeSlots).toStrictEqual(['m20', 'm21']);
    const foundSnap2 = snap.find((i) => i.id === ssd);
    assert.exists(foundSnap2);
    expect(foundSnap2.freeSlots).toStrictEqual(['sata0', 'sata1', 'sata2', 'sata3']);
    expect(g.install(nv, 'sata0')).toMatchObject({ ok: false });
    expect(g.install(nv)).toMatchObject({ ok: true, slot: 'm20' });
  });

  it('an OS needs a drive, enough RAM and free space; later tiers are locked entries', () => {
    const g = new Game({ seed: 1, preassembled: true, economy: econ() });
    g.money = 100_000;
    const by = (id: string) => {
      const foundPurchase2 = g.snapshot().purchases.find((p) => p.id === id);
      assert.exists(foundPurchase2);
      return foundPurchase2;
    };
    const spare = (id: string) => {
      const foundInventory = g.snapshot().inventory.find((i) => i.id === id);
      assert.exists(foundInventory);
      return foundInventory;
    };
    expect(by('os1').blocked).toBeUndefined(); // for sale; the spare says what it still needs
    const os = { invId: bought(g, 'os1') };
    expect(spare(os.invId).installable).toBe(false);
    expect(spare(os.invId).reason).toMatch(/storage/u);
    expect(by('os2').later).toBeUndefined(); // the paged OS is for sale (it needs a CPU with an MMU to install)
    expect(by('os3').later).toBeUndefined(); // the preemptive OS is for sale too
    expect(by('os4').later).toBeUndefined(); // and so is the multicore one
    g.powerButton();
    g.install(bought(g, 'hdd0'));
    expect(spare(os.invId).reason).toMatch(/RAM/u); // 16K installed, the OS wants 32K
    const ram0Device = g.board.devices.find((d) => d.spec === 'ram0');
    assert.exists(ram0Device);
    g.uninstall(ram0Device.id);
    g.install(bought(g, 'ram1'));
    expect(spare(os.invId).reason).toBeUndefined();
    const item = spare(os.invId);
    expect(item).toMatchObject({ kind: 'os', freeSlots: ['sata0'], installable: true });
    expectRefused(g.install(os.invId, 'dimm0'), /no storage drive/u);
    expect(g.install(os.invId, 'sata0')).toMatchObject({ ok: true, slot: 'sata0' });
    const s = g.snapshot();
    expect(s.os).toMatchObject({ spec: 'os1', slot: 'sata0', programSlots: 1, queueSlots: 4, up: false, queue: [] });
    expect(s.progress).toMatchObject({ storageInstalled: true, osInstalled: true });
    expect(s.storage[0]).toMatchObject({ hasOs: true, usedBytes: 12 * 1024, bytesWritten: 12 * 1024 });
    expect(s.inventory.some((i) => i.kind === 'os')).toBe(false); // the OS item was consumed
  });

  it('refuses to remove the drive that holds the OS; uninstallOs gives the OS back and wipes the drive', () => {
    const g = rig('hdd0');
    const drive = g.board.devices.find((d) => d.spec === 'hdd0');
    assert.exists(drive);
    expectRefused(g.uninstall(drive.id), /uninstall the OS first/u);
    expect(g.uninstallOs()).toMatchObject({ ok: true });
    expect(g.snapshot().os).toBeNull();
    expect(
      g
        .snapshot()
        .inventory.filter((i) => i.kind === 'os')
        .map((i) => i.spec),
    ).toStrictEqual(['os1']);
    expect(g.snapshot().storage[0]).toMatchObject({ usedBytes: 0, hasOs: false });
    expect(g.uninstall(drive.id).ok).toBe(true);
  });

  it('the filesystem ledger shows the boot image and the spool area, and uninstall clears it', () => {
    const g = rig('hdd0');
    const [firstStorage] = g.snapshot().storage;
    assert.exists(firstStorage);
    const { fs } = firstStorage;
    expect(fs.runs[0]).toMatchObject({ start: 0, kind: 'os', filled: true });
    expect(fs.runs.some((r) => isEmptySpool(r))).toBe(true);
    expect(fs.byKind.os).toBe(12 * 4); // 12 KiB in 256-byte blocks
    g.uninstallOs();
    const [firstStorage2] = g.snapshot().storage;
    assert.exists(firstStorage2);
    expect(firstStorage2.fs.runs).toStrictEqual([{ start: 0, len: 96 * 4, kind: 'free', file: 0, filled: false }]);
  });

  it('OS install and removal only happen while the machine is off', () => {
    const g = rig('hdd0', { os: false });
    const os = { invId: bought(g, 'os1') };
    g.powerButton();
    expect(g.install(os.invId)).toMatchObject({ ok: false, reason: 'power the machine off first' });
    g.powerButton();
    expect(g.install(os.invId).ok).toBe(true);
    g.powerButton();
    expect(g.uninstallOs()).toMatchObject({ ok: false });
  });
});

describe('booting the OS from storage', () => {
  it('the ROM loads the kernel from the drive with real reads, then the kernel idles', () => {
    const g = rig('ssd1');
    g.powerButton();
    expect(g.pch.bootDev).not.toBe(0);
    runUntil(g, 'idle-os');
    const words = [...KERNEL_IMAGE];
    const { ram } = g.machine;
    const dv = new DataView(ram.buffer);
    expect(words.every((w, i) => dv.getUint32(KERNEL_BASE + 4 * i, true) === w)).toBe(true);
    const [st] = g.snapshot().storage;
    assert.exists(st);
    expect(st.bytesRead).toBe(BOOT_BLOCKS * 256);
    const os2 = g.snapshot().os;
    assert.exists(os2);
    expect(os2.up).toBe(true);
    ticks(g, 5); // let the slow monitor catch up
    expect(g.snapshot().display).toMatch(/OS READY/u);
  });

  it('boot time depends on the storage tier: NVMe < SATA SSD < HDD (same CPU, same RAM)', () => {
    // raw drive speed: the firmware boost would squeeze all three into a few seconds, so it is off for this comparison
    const boot = rawBootTicks;
    const [hdd, ssd, nvme] = [boot('hdd0'), boot('ssd1'), boot('nvme2')];
    expect(nvme).toBeLessThan(ssd);
    expect(ssd).toBeLessThan(hdd);
    expect(hdd - nvme).toBeGreaterThanOrEqual(10); // the HDD's seek and slow blocks are visible in seconds
  });

  it('boot time also depends on the CPU', () => {
    const boot = bootTicksOn;
    expect(boot('cpu2')).toBeLessThan(boot('cpu1'));
  });

  it('an installed drive without an OS changes nothing: the manual boot-per-key flow still runs', () => {
    const g = rig('hdd0', { os: false });
    const [firstTrayKeyId] = g.trayKeyIds();
    assert.exists(firstTrayKeyId);
    expect(g.plugKey(firstTrayKeyId).ok).toBe(true);
    g.powerButton();
    expect(g.pch.bootDev).toBe(0);
    runUntil(g, 'halted', 4000);
    expect(g.snapshot().haltReason).toBe('job-done');
    expect(g.ejectKey()).toMatchObject({ ok: true, done: true });
    expect(g.currentPhase()).toBe('halted'); // no auto-reboot
    expect(g.progress.firstOsJob).toBe(false);
  });

  it('an OS machine powered on with a key already plugged notices it at idle and serves it', () => {
    const g = rig('ssd1');
    const [id] = g.trayKeyIds();
    assert.exists(id);
    expect(g.plugKey(id).ok).toBe(true); // machine is off
    g.powerButton();
    runUntil(g, 'idle-os');
    until(g, jobDone(g), 4000);
    expect(g.snapshot().progress.firstOsJob).toBe(true);
  });
});

describe('the OS takes keys, queues, runs and delivers', () => {
  it('ingest, run, flash, deliver: the key stays in, then pops out by itself and pays', () => {
    const g = rig('ssd1');
    g.powerButton();
    runUntil(g, 'idle-os');
    const [id] = g.trayKeyIds();
    assert.exists(id);
    const money0 = g.money;
    expect(g.plugKey(id).ok).toBe(true);
    // USB latency: the key first enumerates, then the kernel ingests it (key LED activity)
    expect(g.snapshot().keyActivity).toBe('enumerating');
    const seen = new Set<string>();
    until(g, () => {
      seen.add(g.snapshot().keyActivity);
      return osHasJob(g);
    });
    expect(seen).toContain('enumerating');
    expect(seen).toContain('ingesting');
    // the OS has the job: the key cannot be pulled and is not held; it is still the plugged key
    expectRefused(g.ejectKey(), /OS is working/u);
    let s = g.snapshot();
    expect(s.tray).toHaveLength(0);
    expect(s.plugged?.id).toBe(id);
    assert.exists(s.os);
    expect(s.os.queue).toHaveLength(1);
    until(g, jobDone(g), 4000);
    s = g.snapshot();
    assert.exists(s.lastCompleted);
    const { payout } = s.lastCompleted;
    expect(payout).toBeGreaterThan(0);
    expect(g.money).toBe(money0 + payout);
    expect(s).toMatchObject({ completed: 1, plugged: null });
    assert.exists(s.os);
    expect(s.os.queue).toStrictEqual([]); // the slot was freed by the delivery
    expect(s.lastCompleted).toMatchObject({ id, payout });
    expect(s.progress.firstOsJob).toBe(true);
    expect(g.powered).toBe(true); // an OS machine stays on
  });

  it('the machine boots once: no POST between jobs', () => {
    const g = new Game({
      seed: 3,
      preassembled: true,
      economy: econ([{ template: 'cli.log' }, { template: 'cli.log' }, { template: 'cli.checksum' }]),
    });
    const h = rig('ssd1', { keys: [{ template: 'cli.log' }, { template: 'cli.log' }, { template: 'cli.checksum' }] });
    expect(g.powered).toBe(true);
    h.powerButton();
    runUntil(h, 'idle-os');
    const phases = new Set<gameTypes.Phase>();
    for (const id of h.trayKeyIds()) {
      serve(h, id);
      for (let i = 0; i < 20; i++) {
        h.advanceBaseTick();
        phases.add(h.currentPhase());
      }
    }
    expect(h.completed).toBe(3);
    expect(phases.has('posting')).toBe(false);
    expect(phases.has('booting-os')).toBe(false);
    expect(phases.has('waiting-for-key')).toBe(false);
    expect(h.powered).toBe(true);
  });

  it('ingest time depends on the storage tier (the job is written to the spool)', () => {
    const t = ingestOn;
    const hdd = t('hdd0');
    const nvme = t('nvme2');
    expect(nvme.took).toBeLessThanOrEqual(hdd.took);
    expect(nvme.cost).toBeLessThan(hdd.cost);
    expect(hdd.written).toBeGreaterThan(12 * 1024); // the OS install plus the spooled job
  });

  it('a key pulled while the machine is off goes back to the tray; nothing is queued or held, and it can be served later', () => {
    const g = rig('hdd0');
    g.powerButton();
    runUntil(g, 'idle-os');
    const [id] = g.trayKeyIds();
    assert.exists(id);
    g.plugKey(id);
    until(g, () => g.snapshot().phase === 'ingesting');
    g.powerButton(); // the plug is pulled with the power: the OS and its table are gone
    expect(g.ejectKey()).toMatchObject({ ok: true, done: false });
    expect(g.snapshot().tray.map((k) => k.id)).toStrictEqual([id]); // back in the tray, not held
    g.powerButton();
    runUntil(g, 'idle-os');
    ticks(g, 60);
    const os3 = g.snapshot().os;
    assert.exists(os3);
    expect(os3.queue).toStrictEqual([]);
    expect(serve(g, id)).toBeGreaterThan(0);
  });

  it('runs one program at a time, in the order the keys are plugged', () => {
    const keys: testkitTypes.Keys = Array.from({ length: 4 }, () => ({ template: 'cli.log' }));
    const g = rig('hdd0', { cpu: 'cpu2', keys });
    g.powerButton();
    runUntil(g, 'idle-os');
    const ids = g.trayKeyIds();
    const os4 = g.snapshot().os;
    assert.exists(os4);
    expect(os4.programSlots).toBe(1);
    const log: RunLog = { maxRunning: 0, order: [] };
    for (const id of ids) {
      g.plugKey(id);
      until(g, () => noteRunning(g, log), 4000);
    }
    expect(g.completed).toBe(4);
    expect(log.maxRunning).toBe(1);
    expect(log.order).toStrictEqual(ids);
  });

  it('power loss while the OS has the key: the key is pulled with the plug, goes back to the tray and the job runs again later', () => {
    const g = rig('ssd1');
    g.powerButton();
    runUntil(g, 'idle-os');
    const [id] = g.trayKeyIds();
    assert.exists(id);
    ingest(g, id);
    g.powerButton();
    expect(g.ejectKey()).toMatchObject({ ok: true, done: false });
    const s = g.snapshot();
    expect(s.tray.map((k) => k.id)).toContain(id);
    g.powerButton();
    runUntil(g, 'idle-os');
    expect(serve(g, id)).toBeGreaterThan(0);
  });

  it('is deterministic: the same seed and the same script give the same game', () => {
    expect(scriptedRun()).toBe(scriptedRun());
  });
});

describe('save v3 with an OS', () => {
  it('round-trips the installed OS; the loaded machine boots it again', () => {
    const g = rig('ssd1');
    const save = jsonData(g.toSave());
    expect(save).toMatchObject({ version: 5, os: { spec: 'os1' } });
    const l = Game.fromSave(save, econ());
    expect(l.snapshot().os).toMatchObject({ spec: 'os1', slot: 'sata0' });
    expect(l.snapshot().storage[0]).toMatchObject({ hasOs: true, usedBytes: 12 * 1024 });
    expect(jsonData(l.toSave())).toStrictEqual(save);
    l.powerButton();
    runUntil(l, 'idle-os');
    const [firstTrayKeyId2] = l.trayKeyIds();
    assert.exists(firstTrayKeyId2);
    expect(serve(l, firstTrayKeyId2)).toBeGreaterThan(0);
  });

  it('rejects a save whose OS names a missing drive or an unknown OS', () => {
    const save = asObject(jsonData(rig('ssd1').toSave()));
    const deviceId = fieldOf(fieldOf(save, 'os'), 'deviceId');
    expect(() => Game.fromSave({ ...save, os: { spec: 'os1', deviceId: 'nope' } })).toThrow(/storage device/u);
    expect(() => Game.fromSave({ ...save, os: { spec: 'os9', deviceId: 'dev1' } })).toThrow(/unknown OS/u);
    expect(() => Game.fromSave({ ...save, os: { spec: 'os4', deviceId } })).toThrow(/does not fit/u); // the OS 4 image needs more room than this rig's drive has
  });

  it('a key the OS is working on is saved as the plugged key', () => {
    const g = rig('ssd1');
    g.powerButton();
    runUntil(g, 'idle-os');
    const [id] = g.trayKeyIds();
    assert.exists(id);
    ingest(g, id);
    const save = g.toSave();
    expect(save.plugged?.id).toBe(id);
    expect(save.tray.map((k) => k.id)).not.toContain(id);
  });
});

describe('the bot still plays the legacy flow with a drive installed', () => {
  it('earns money with a drive and no OS', () => {
    const g = rig('ssd1', { os: false, keys: [{ template: 'cli.log' }] });
    g.powerButton();
    const op = new Operator(g, 1);
    for (let t = 0; t < 200; t++) {
      g.advanceBaseTick();
      op.step();
    }
    expect(g.completed).toBeGreaterThanOrEqual(1);
  });
});

describe('the boot scan and mount states', () => {
  it('the scan delay grows with the used blocks', () => {
    const empty = rig('hdd0');
    empty.powerButton();
    const base = empty.mountTicksLeft();
    const full = rig('hdd0');
    diskOf(full).reserve(120, 200);
    full.powerButton();
    expect(full.mountTicksLeft()).toBeGreaterThan(base);
    runUntil(full, 'idle-os', 3000);
    const [firstStorage3] = full.snapshot().storage;
    assert.exists(firstStorage3);
    expect(firstStorage3.mount).toMatchObject({ state: 'clean', phase: 'mounted', progress: 1 });
  });

  it('a power cut during a write leaves the drive dirty; the boot repair pass clears it', () => {
    const g = rig('hdd0');
    g.powerButton();
    runUntil(g, 'idle-os');
    expect(diskOf(g).mount).toBe('clean');
    tornWrite(g);
    g.powerButton();
    expect(diskOf(g).mount).toBe('dirty');
    const [firstStorage4] = g.snapshot().storage;
    assert.exists(firstStorage4);
    expect(firstStorage4.mount).toMatchObject({ state: 'dirty', phase: 'unmounted' });
    const clean = rig('hdd0');
    clean.powerButton();
    g.powerButton();
    expect(g.mountTicksLeft()).toBeGreaterThan(clean.mountTicksLeft());
    ticks(g, 1);
    const [firstStorage5] = g.snapshot().storage;
    assert.exists(firstStorage5);
    expect(firstStorage5.mount.phase).toMatch(/scanning|repairing/u);
    expect(g.driveCanHold(devId(g), 'program')).toBe(false);
    runUntil(g, 'idle-os');
    expect(diskOf(g).mount).toBe('clean');
    const [firstStorage6] = g.snapshot().storage;
    assert.exists(firstStorage6);
    expect(firstStorage6.mount.phase).toBe('mounted');
  });

  it('a power cut while the drive repairs keeps it dirty', () => {
    const g = rig('hdd0');
    diskOf(g).mount = 'dirty';
    g.powerButton();
    expect(g.mountTicksLeft()).toBeGreaterThan(1);
    ticks(g, 2);
    g.powerButton();
    expect(diskOf(g).mount).toBe('dirty');
  });

  it('without an OS no drive is mounted', () => {
    const g = rig('hdd0', { os: false });
    g.powerButton();
    ticks(g, 30);
    const [firstStorage7] = g.snapshot().storage;
    assert.exists(firstStorage7);
    expect(firstStorage7.mount).toMatchObject({ state: 'unformatted', phase: 'unmounted' });
    expect(g.driveCanHold(devId(g), 'dataset')).toBe(false);
  });

  it('datasets need a mounted clean drive and a tier-2 filesystem; unformatted drives stay unmounted', () => {
    const g = rig('hdd0');
    g.powerButton();
    runUntil(g, 'idle-os');
    expect(g.driveCanHold(devId(g), 'spool')).toBe(true);
    expect(g.driveCanHold(devId(g), 'dataset')).toBe(false); // os1: fixed boot and spool only
    assert.exists(g.os);
    expect(g.os.spec.fsTier).toBe(1);
    g.os.spec = { ...g.os.spec, fsTier: 2 };
    expect(g.driveCanHold(devId(g), 'dataset')).toBe(true);
    diskOf(g).mount = 'damaged';
    expect(g.driveCanHold(devId(g), 'dataset')).toBe(false);
    g.powerButton();
    expect(g.driveCanHold(devId(g), 'spool')).toBe(false); // off: nothing is mounted
  });

  it('the machine is in the mounting phase while the OS probes the drives, then boots', () => {
    const g = rig('hdd0');
    diskOf(g).reserve(120, 200);
    g.powerButton();
    const seen = phasesToIdle(g, 3000);
    expect(seen.has('mounting')).toBe(true);
    expect(g.currentPhase()).toBe('idle-os');
  });

  describe('formatting a data drive', () => {
    it('a blank second drive is unformatted and stays unmounted; formatting makes it clean and mounted at the next boot', () => {
      const g = withSecond(2);
      const id = second(g);
      const foundStorage2 = g.snapshot().storage.find((s) => s.deviceId === id);
      assert.exists(foundStorage2);
      expect(foundStorage2.mount.state).toBe('unformatted');
      g.powerButton();
      runUntil(g, 'idle-os');
      const foundStorage3 = g.snapshot().storage.find((s) => s.deviceId === id);
      assert.exists(foundStorage3);
      expect(foundStorage3.mount.phase).toBe('unmounted');
      expect(g.formatDrive(id)).toMatchObject({ ok: false, reason: 'power the machine off first' });
      g.powerButton();
      expect(g.formatDrive(id)).toMatchObject({ ok: true, wiped: 0 });
      g.powerButton();
      runUntil(g, 'idle-os');
      const foundStorage4 = g.snapshot().storage.find((s) => s.deviceId === id);
      assert.exists(foundStorage4);
      expect(foundStorage4.mount).toMatchObject({
        state: 'clean',
        phase: 'mounted',
      });
      expect(g.driveCanHold(id, 'dataset')).toBe(true);
    });

    it('needs an OS with filesystem tier 2, and never formats the OS drive', () => {
      const g = withSecond(1);
      expect(g.formatDrive(second(g)).ok).toBe(false);
      const foundStorage5 = g.snapshot().storage.find((s) => !s.hasOs);
      assert.exists(foundStorage5);
      expect(foundStorage5.format.why).toMatch(/Paged OS 2.0/u);
      const g2 = withSecond(2);
      assert.exists(g2.os);
      expect(g2.formatDrive(g2.os.deviceId)).toMatchObject({ ok: false });
      const none = rig('hdd0', { os: false });
      powerOff(none);
      const [noneDisk = 'x'] = none.disks.keys();
      expect(none.formatDrive(noneDisk).ok).toBe(false);
    });

    it('datasets on the drive need a confirm, then they are lost', () => {
      const g = withSecond(2);
      const id = second(g);
      g.formatDrive(id);
      const diskValue = g.disks.get(id);
      assert.exists(diskValue);
      expect(diskValue.fs.create('c1', 'dataset', 8)).not.toBeNull();
      const foundStorage6 = g.snapshot().storage.find((s) => s.deviceId === id);
      assert.exists(foundStorage6);
      expect(foundStorage6.format.datasets).toBe(1);
      expect(g.formatDrive(id)).toMatchObject({ ok: false });
      const diskValue2 = g.disks.get(id);
      assert.exists(diskValue2);
      expect(diskValue2.fs.list('dataset')).toHaveLength(1);
      expect(g.formatDrive(id, true)).toMatchObject({ ok: true, wiped: 1 });
      const diskValue3 = g.disks.get(id);
      assert.exists(diskValue3);
      expect(diskValue3.fs.list('dataset')).toHaveLength(0);
    });
  });

  it('a tier-3 filesystem replays a journal; a lower tier passes over every used block', () => {
    const boot = dirtyMountTicks;
    expect(boot(3)).toBeLessThan(boot(2));
  });
});

describe('quick OS boot', () => {
  it('the OS is up within about 10 s of the power button on every drive tier, and a faster drive is never slower', () => {
    const boot = bootTicks;
    const [hdd, ssd, nvme] = [boot('hdd0'), boot('ssd1'), boot('nvme2')];
    expect(hdd).toBeLessThanOrEqual(10);
    expect(nvme).toBeLessThanOrEqual(hdd);
    expect(nvme).toBeLessThanOrEqual(ssd);
    expect(ssd).toBeLessThanOrEqual(hdd);
  });
});
