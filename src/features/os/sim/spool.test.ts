import { assert, describe, expect, it } from 'vitest';
import { getOsSpec, MAX_QUEUE_SLOTS, OS_SPECS, tableSlots } from '.';
import { ECONOMY } from '../../economy/sim/economy';
import type { Game } from '@/worker/game/game';
import { rig } from '@/worker/game/testkit';

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const until = (g: Game, done: () => boolean, max = 6000): void => {
  for (let t = 0; t < max && !done(); t++) {
    g.advanceBaseTick();
  }
  expect(done()).toBe(true);
};

/** The paged OS on an SSD, plus a second drive, formatted clean: the OS machine with room for the spool elsewhere. */
function twoDrives(os = 'os2', ram = 'ram2'): Game {
  const g = rig('ssd1', { cpu: 'cpu2', os: false, keys: [{ template: 'cli.log' }, { template: 'cli.log' }] });
  for (const d of g.board.devices.filter((x) => x.spec.startsWith('ram'))) {
    g.uninstall(d.id);
  }
  for (const id of [ram, os, 'hdd0']) {
    const b = g.purchase(id);
    if (!b.ok) {
      throw new Error(b.reason);
    }
    const r = g.install(b.invId);
    if (!r.ok) {
      throw new Error(r.reason);
    }
  }
  const hdd = g.board.devices.find((d) => d.spec === 'hdd0');
  assert.exists(hdd);
  expect(os === 'os1' || g.formatDrive(hdd.id).ok).toBe(true); // (the resident OS cannot format)
  return g;
}

/** The job is done and its key is out of the port. */
const doneAndUnplugged = (g: Game) => (): boolean => g.completed === 1 && g.pluggedKey() === null;

describe('the spool on other drives', () => {
  it('the queue fills up from the other data drives when the OS drive has no room left', () => {
    const g = twoDrives();
    assert.exists(g.os);
    g.os.homeSlots = 1; // (an OS drive that is nearly full)
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    const os2 = g.snapshot().os;
    assert.exists(os2);
    expect(os2.queueSlots).toBe(8);
    const hdd0Device = g.board.devices.find((d) => d.spec === 'hdd0');
    assert.exists(hdd0Device);
    const diskValue = g.disks.get(hdd0Device.id);
    assert.exists(diskValue);
    expect(diskValue.fs.list('spool')).toHaveLength(1);
  });

  it('a job whose spool area is on another drive is written there, read back and delivered', () => {
    const g = twoDrives();
    assert.exists(g.os);
    g.os.homeSlots = 0;
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    const [os, data] = ['ssd1', 'hdd0'].map((s) => {
      const foundStorage = g.snapshot().storage.find((x) => x.spec === s);
      assert.exists(foundStorage);
      return foundStorage;
    });
    assert.exists(os);
    const osWritten = os.bytesWritten;
    const [firstTrayKeyId] = g.trayKeyIds();
    assert.exists(firstTrayKeyId);
    expect(g.plugKey(firstTrayKeyId).ok).toBe(true);
    until(g, doneAndUnplugged(g));
    const after = (s: string) => {
      const foundStorage2 = g.snapshot().storage.find((x) => x.spec === s);
      assert.exists(foundStorage2);
      return foundStorage2;
    };
    assert.exists(data);
    expect(after('hdd0').bytesWritten).toBeGreaterThan(data.bytesWritten); // the job went to the spool on the data drive
    expect(after('ssd1').bytesWritten).toBe(osWritten); // and not to the OS drive
  });

  it('the resident OS keeps its spool on its own drive', () => {
    const g = twoDrives('os1');
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    const hdd0Device2 = g.board.devices.find((d) => d.spec === 'hdd0');
    assert.exists(hdd0Device2);
    const diskValue2 = g.disks.get(hdd0Device2.id);
    assert.exists(diskValue2);
    expect(diskValue2.fs.list('spool')).toHaveLength(0);
  });
});

describe("the OS menu's spool settings", () => {
  it('fewer slots wanted: the queue shrinks at once while off, and `null` gives the most back', () => {
    const g = twoDrives();
    assert.exists(g.os);
    g.os.homeSlots = 1;
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    const os3 = g.snapshot().os;
    assert.exists(os3);
    expect(os3.queueSlots).toBe(8);
    g.powerButton();
    expect(g.setSpoolSlots(3).ok).toBe(true);
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    const os4 = g.snapshot().os;
    assert.exists(os4);
    expect(os4.queueSlots).toBe(3);
    const os5 = g.snapshot().os;
    assert.exists(os5);
    expect(os5.config).toMatchObject({ spoolWanted: 3, spoolMax: 16 });
    expect(g.setSpoolSlots(0).ok).toBe(false);
  });

  it('a drive turned off holds no slots, and the choice is saved', () => {
    const g = twoDrives();
    assert.exists(g.os);
    g.os.homeSlots = 1;
    const hdd = g.board.devices.find((d) => d.spec === 'hdd0');
    assert.exists(hdd);
    expect(g.setSpoolDrive(hdd.id, false).ok).toBe(true);
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    const os6 = g.snapshot().os;
    assert.exists(os6);
    expect(os6.queueSlots).toBe(1);
    const os7 = g.snapshot().os;
    assert.exists(os7);
    assert.exists(os7.config);
    expect(os7.config.drives.find((d) => d.deviceId === hdd.id)).toMatchObject({
      on: false,
      why: null,
      slots: 0,
    });
    expect(g.toSave().osConfig).toMatchObject({ spoolOff: [hdd.id] });
  });

  it('the higher tiers allow more slots than the old table of eight, up to the kernel table', () => {
    expect(OS_SPECS.map((o) => o.queueSlots)).toStrictEqual([4, 8, 12, 16]);
    expect(Math.max(...OS_SPECS.map((o) => o.queueSlots))).toBeLessThanOrEqual(MAX_QUEUE_SLOTS);
  });
});

describe('the disk allocation page', () => {
  it('a drive holds exactly the slots asked for, and the rest follows the others', () => {
    const g = twoDrives();
    const [ssd, hdd] = ['ssd1', 'hdd0'].map((s) => {
      const foundDevice = g.board.devices.find((d) => d.spec === s);
      assert.exists(foundDevice);
      return foundDevice;
    });
    assert.exists(hdd);
    expect(g.setSpoolAlloc(hdd.id, 3).ok).toBe(true);
    assert.exists(ssd);
    expect(g.setSpoolAlloc(ssd.id, 2).ok).toBe(true);
    const os8 = g.snapshot().os;
    assert.exists(os8);
    assert.exists(os8.config);
    const { drives } = os8.config;
    const foundDrive = drives.find((d) => {
      assert.exists(hdd);
      return d.deviceId === hdd.id;
    });
    assert.exists(foundDrive);
    expect(foundDrive.slots).toBe(3);
    const foundDrive2 = drives.find((d) => {
      assert.exists(ssd);
      return d.deviceId === ssd.id;
    });
    assert.exists(foundDrive2);
    expect(foundDrive2.slots).toBe(2);
    const os9 = g.snapshot().os;
    assert.exists(os9);
    expect(os9.queueSlots).toBe(5);
  });

  it('an allocation beyond the room is cut to what fits, and a bad value is refused', () => {
    const g = twoDrives();
    const hdd = g.board.devices.find((d) => d.spec === 'hdd0');
    assert.exists(hdd);
    expect(g.setSpoolAlloc(hdd.id, 99).ok).toBe(true);
    const os10 = g.snapshot().os;
    assert.exists(os10);
    assert.exists(os10.config);
    const d = os10.config.drives.find((x) => x.deviceId === hdd.id);
    assert.exists(d);
    expect(d.slots).toBeLessThanOrEqual(d.maxSlots);
    const os11 = g.snapshot().os;
    assert.exists(os11);
    expect(os11.queueSlots).toBeLessThanOrEqual(MAX_QUEUE_SLOTS);
    expect(g.setSpoolAlloc(hdd.id, -1).ok).toBe(false);
    expect(g.setSpoolAlloc(hdd.id, null).ok).toBe(true);
  });
});

describe('the queue beyond the old limit', () => {
  it('the job table of a tier with a frame map holds more slots than 16, so only the drives and RAM limit the queue', () => {
    const os2GetOsSpec = getOsSpec('os2');
    assert.exists(os2GetOsSpec);
    expect(tableSlots(os2GetOsSpec)).toBe(16);
    const os3GetOsSpec = getOsSpec('os3');
    assert.exists(os3GetOsSpec);
    expect(tableSlots(os3GetOsSpec)).toBeGreaterThan(16);
    const os4GetOsSpec = getOsSpec('os4');
    assert.exists(os4GetOsSpec);
    expect(tableSlots(os4GetOsSpec)).toBe(MAX_QUEUE_SLOTS);
  });

  it('a queue of 20 slots on an OS 3 machine boots, and a job spooled in a slot past the 16th runs and is delivered', () => {
    const g = twoDrives('os3', 'ram4');
    const hdd = g.board.devices.find((d) => d.spec === 'hdd0');
    assert.exists(hdd);
    assert.exists(g.os);
    g.os.homeSlots = 0;
    expect(g.setSpoolAlloc(hdd.id, 20).ok).toBe(true);
    g.powerButton();
    until(g, () => g.currentPhase() === 'idle-os');
    const os12 = g.snapshot().os;
    assert.exists(os12);
    expect(os12.queueSlots).toBe(20);
    const [firstTrayKeyId2] = g.trayKeyIds();
    assert.exists(firstTrayKeyId2);
    expect(g.plugKey(firstTrayKeyId2).ok).toBe(true);
    until(g, doneAndUnplugged(g));
  });
});
