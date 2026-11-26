import { assert, describe, expect, it } from 'vitest';
import type { Game, Phase } from '@/worker/game/game';
import { ECONOMY } from '../../economy/sim/economy';
import { rig } from '@/worker/game/testkit';

/** Switches the machine off if it is on. */
function powerOff(g: Game): void {
  if (g.powered) {
    g.powerButton();
  }
}

/** Buys `id` (free in the test economy), or fails the test with the reason. */
function bought(g: Game, id: string): { invId: string } {
  const b = g.purchase(id);
  if (!b.ok) {
    throw new Error(b.reason);
  }
  return b;
}

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

// Hardware tests, not level tests.
ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

function runUntil(g: Game, phase: Phase, max = 4000): void {
  let t = 0;
  while (g.currentPhase() !== phase && t++ < max) {
    g.advanceBaseTick();
  }
  expect(g.currentPhase()).toBe(phase);
}

/** An OS rig (HDD holds the OS) plus a second drive `spec`, formatted by the OS at `fsTier`, booted to idle. */
function withData(spec: 'ssd1' | 'nvme2' | 'raid2', fsTier = 4): { g: Game; id: string } {
  const g = rig('hdd0');
  powerOff(g);
  assert.exists(g.os);
  g.os.spec = { ...g.os.spec, fsTier };
  const b = bought(g, spec);
  expect(g.install(b.invId).ok).toBe(true);
  const foundDevice = g.board.devices.find((d) => d.spec === spec);
  assert.exists(foundDevice);
  const { id } = foundDevice;
  expect(g.formatDrive(id)).toMatchObject({ ok: true });
  g.powerButton();
  runUntil(g, 'idle-os');
  return { g, id };
}

describe('canServe', () => {
  it('serves an intact dataset on a mounted drive with the OS up', () => {
    const { g, id } = withData('ssd1');
    const diskValue = g.disks.get(id);
    assert.exists(diskValue);
    const f = diskValue.fs.create('c1', 'dataset', 8);
    assert.exists(f);
    expect(g.canServe(id, f.id)).toBe(true);
    expect(g.canServe(id, 999)).toBe(false);
  });

  it('is false when the OS is down (machine off)', () => {
    const { g, id } = withData('ssd1');
    const diskValue2 = g.disks.get(id);
    assert.exists(diskValue2);
    const f = diskValue2.fs.create('c1', 'dataset', 8);
    assert.exists(f);
    g.powerButton();
    expect(g.canServe(id, f.id)).toBe(false);
  });

  it('is false while the drive is not mounted', () => {
    const g = rig('hdd0');
    powerOff(g);
    assert.exists(g.os);
    g.os.spec = { ...g.os.spec, fsTier: 2 };
    const b = bought(g, 'ssd1');
    g.install(b.invId);
    const ssd1Device = g.board.devices.find((d) => d.spec === 'ssd1');
    assert.exists(ssd1Device);
    const { id } = ssd1Device;
    g.powerButton();
    runUntil(g, 'idle-os');
    expect(g.canServe(id, 1)).toBe(false); // unformatted: unmounted, nothing to serve
  });

  it('is false when the drive is burnt, and the burn loses every dataset on it', () => {
    const { g, id } = withData('ssd1');
    const disk = g.disks.get(id);
    assert.exists(disk);
    const f = disk.fs.create('c1', 'dataset', 8);
    assert.exists(f);
    const foundDevice2 = g.board.devices.find((d) => d.id === id);
    assert.exists(foundDevice2);
    foundDevice2.burnt = true;
    g.syncStorage();
    const fileResult = disk.fs.file(f.id);
    assert.exists(fileResult);
    expect(fileResult.lost).toBe(true);
    expect(g.canServe(id, f.id)).toBe(false);
    const run = g.snapshot().storage.find((s) => s.deviceId === id);
    assert.exists(run);
    expect(run.fs.runs.some((r) => r.kind === 'lost')).toBe(true);
    expect(run.lostBlocks).toBe(8);
  });

  it('is false for a file whose blocks went bad', () => {
    const { g, id } = withData('ssd1');
    const disk = g.disks.get(id);
    assert.exists(disk);
    const f = disk.fs.create('c1', 'dataset', 8);
    assert.exists(f);
    assert.exists(f.extents[0]);
    disk.failGroup(Math.floor(f.extents[0].first / 8));
    expect(g.canServe(id, f.id)).toBe(false);
  });

  it('is false when the drive queue is deeper than its queue depth', () => {
    const { g, id } = withData('nvme2');
    const disk = g.disks.get(id);
    assert.exists(disk);
    const f = disk.fs.create('c1', 'dataset', 8);
    assert.exists(f);
    disk.queued = disk.queueDepth;
    expect(g.canServe(id, f.id)).toBe(true);
    disk.queued = disk.queueDepth + 1;
    expect(g.canServe(id, f.id)).toBe(false);
  });

  it('deeper queues for faster tiers', () => {
    expect(depth('ssd1')).toBeLessThan(depth('nvme2'));
  });
});

/** The queue depth of a fresh drive of `spec`. */
function depth(spec: 'ssd1' | 'nvme2'): number {
  const w = withData(spec);
  const disk = w.g.disks.get(w.id);
  assert.exists(disk);
  return disk.queueDepth;
}

describe('RAID mirror (raid2)', () => {
  it('is a purchasable item, no longer planned', () => {
    const g = rig('hdd0');
    expect(g.purchase('raid2').ok).toBe(true);
  });

  it('needs filesystem tier 4 to mount', () => {
    const g = rig('hdd0');
    powerOff(g);
    assert.exists(g.os);
    g.os.spec = { ...g.os.spec, fsTier: 3 };
    const b = bought(g, 'raid2');
    expect(g.install(b.invId).ok).toBe(true);
    const raid2Device = g.board.devices.find((d) => d.spec === 'raid2');
    assert.exists(raid2Device);
    const { id } = raid2Device;
    const foundDevice3 = g.board.devices.find((d) => d.id === id);
    assert.exists(foundDevice3);
    g.diskFor(foundDevice3).mount = 'clean';
    g.powerButton();
    runUntil(g, 'idle-os');
    expect(g.driveCanHold(id, 'dataset')).toBe(false);
    const foundStorage = g.snapshot().storage.find((s) => s.deviceId === id);
    assert.exists(foundStorage);
    expect(foundStorage.mount.phase).toBe('unmounted');
  });

  it('cannot hold the OS', () => {
    const g = rig('hdd0', { os: false });
    powerOff(g);
    const hdd0Device = g.board.devices.find((d) => d.spec === 'hdd0');
    assert.exists(hdd0Device);
    g.uninstall(hdd0Device.id);
    const b = bought(g, 'raid2');
    g.install(b.invId);
    const o = bought(g, 'os1');
    const r = g.install(o.invId);
    expect(r.ok).toBe(false);
  });

  it("mounts at tier 4 and keeps a dataset when one member's block goes bad", () => {
    const { g, id } = withData('raid2', 4);
    const disk = g.disks.get(id);
    assert.exists(disk);
    expect(disk.twin).not.toBeNull();
    expect(g.driveCanHold(id, 'dataset')).toBe(true);
    const f = disk.fs.create('c1', 'dataset', 8);
    assert.exists(f);
    assert.exists(f.extents[0]);
    const grp = Math.floor(f.extents[0].first / 8);
    disk.failGroup(grp);
    expect(f.lost).toBe(false);
    expect(g.canServe(id, f.id)).toBe(true);
    const snap = g.snapshot().storage.find((s) => s.deviceId === id);
    assert.exists(snap);
    expect(snap.mirror).toBe(true);
    expect(snap.badGroups).toBe(1);
    expect(snap.lostBlocks).toBe(0);
    assert.exists(disk.twin);
    disk.twin.failGroup(grp);
    expect(g.canServe(id, f.id)).toBe(false);
    const foundStorage2 = g.snapshot().storage.find((s) => s.deviceId === id);
    assert.exists(foundStorage2);
    expect(foundStorage2.lostBlocks).toBe(8);
  });

  it('a plain drive loses the same dataset on one bad group', () => {
    const { g, id } = withData('ssd1');
    const disk = g.disks.get(id);
    assert.exists(disk);
    const f = disk.fs.create('c1', 'dataset', 8);
    assert.exists(f);
    assert.exists(f.extents[0]);
    disk.failGroup(Math.floor(f.extents[0].first / 8));
    expect(f.lost).toBe(true);
  });
});

describe('snapshot', () => {
  it('carries wearPct, badGroups, lostBlocks and the queue', () => {
    const { g, id } = withData('ssd1');
    const disk = g.disks.get(id);
    assert.exists(disk);
    const s0 = g.snapshot().storage.find((s) => s.deviceId === id);
    assert.exists(s0);
    expect(s0).toMatchObject({ wearPct: 0, badGroups: 0, lostBlocks: 0, mirror: false });
    expect(s0.queueDepth).toBe(disk.queueDepth);
    for (let i = 0; i < 300; i++) {
      disk.noteWrite(0);
    }
    const s1 = g.snapshot().storage.find((s) => s.deviceId === id);
    assert.exists(s1);
    expect(s1.wearPct).toBeGreaterThan(0);
  });

  it('wear differs by tier: the same writes wear a SATA SSD more than an NVMe', () => {
    const a = withData('ssd1');
    const b = withData('nvme2');
    for (let i = 0; i < 200; i++) {
      const diskValue4 = a.g.disks.get(a.id);
      assert.exists(diskValue4);
      diskValue4.noteWrite(0);
      const diskValue5 = b.g.disks.get(b.id);
      assert.exists(diskValue5);
      diskValue5.noteWrite(0);
    }
    const diskValue6 = a.g.disks.get(a.id);
    assert.exists(diskValue6);
    expect(diskValue6.wearPct).toBeGreaterThan(must(b.g.disks.get(b.id)).wearPct);
  });
});
