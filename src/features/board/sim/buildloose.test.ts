import { describe, expect, it } from 'vitest';
import { Prng } from '@/core/sim';
import { Game } from '@/worker/game/game';
import { BUILD_PRESETS } from './buildspecs';
import { presetGame } from './buildpreset';
import { checkCompat, deviceSpec, ThermalModel } from './index';
import { FANS_ON } from './thermal';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** The reason `r` was refused; fails the test when it went through. */
function refusal(r: { ok: true } | { ok: false; reason: string }): string {
  if (r.ok) {
    throw new Error('expected a refusal, but it went through');
  }
  return r.reason;
}

// Build my PC fits a part whenever its shape fits (`GameOptions.looseFit`): the power rules are not refusals there, the machine behaves as it would.

/** Buy a part and fit it: the game's answer. */
function put(g: Game, id: string, slot?: string) {
  const b = g.purchase(id);
  if (!b.ok) {
    throw new Error(`${id}: ${b.reason}`);
  }
  return g.install(b.invId, slot);
}

/** A Basic board in a Micro tower with `parts` on it, bought free in a sandbox game. */
function rig(parts: string[], looseFit: boolean): Game {
  const g = new Game({ seed: 1, sandbox: true, looseFit });
  put(g, 'case1');
  put(g, 'board1');
  for (const id of parts) {
    expect(put(g, id), `for ${id}`).toMatchObject({ ok: true });
  }
  return g;
}

const step = (g: Game, loads: Record<string, number>): ThermalModel => {
  const th = new ThermalModel(new Prng(1));
  th.step(g.board, { loads, powered: true, fans: { ...FANS_ON, caseFans: 0 } });
  return th;
};

describe('Build my PC fits by shape alone', () => {
  it('a part that overloads the supply goes in, where a sandbox game refuses it', () => {
    // 40 W supply, a 35 W CPU and a 3 W monitor: the memory (7 W) makes it 45 W
    const strict = rig(['psu0', 'cpu2', 'display0'], false),
      loose = rig(['psu0', 'cpu2', 'display0'], true);
    expect(refusal(put(strict, 'ram2'))).toMatch(/PSU gives 40 W/u);
    expect(put(loose, 'ram2')).toMatchObject({ ok: true });
    // (a supply too small for what is in is fitted as well)
    const weak = rig(['cpu2', 'ram2', 'display0'], true);
    expect(put(weak, 'psu0')).toMatchObject({ ok: true });
    // (and a swap for the smaller one)
    expect(put(weak, 'psu1')).toMatchObject({ ok: true });
    expect(put(weak, 'psu0')).toMatchObject({ ok: true });
  });

  it('a card with no PCIe lead goes in, and the machine will not start with it', () => {
    const g = rig(['psu1', 'cpu1', 'cooler0', 'ram0'], true);
    expect(put(g, 'gpu2', 'pcie0')).toMatchObject({ ok: true }); // 90 W: a lead the 100 W supply does not have
    const issue = checkCompat(g.board).find((i) => i.id === 'pcie-leads');
    expect(issue).toMatchObject({ severity: 'error', value: 1, limit: 0 });
    expect(must(issue).message).toMatch(/does not start/u);
  });

  it('the shape still decides: a card too wide for its socket and a part for another socket are refused', () => {
    const g = rig(['psu1', 'cpu1'], true);
    expect(put(g, 'gpu3', 'pcie0')).toMatchObject({ ok: false });
    expect(put(g, 'ram0', 'pcie0')).toMatchObject({ ok: false });
  });

  it('the clearance in the case still decides: a case too small for the board, a second radiator, a fan the mounts do not take, a case with no mounts for the radiator', () => {
    // a Micro tower holds boards up to micro-ATX: the Mini tower is too small for the Basic board that stands in it
    const g = rig(['psu1', 'cpu1'], true);
    expect(refusal(put(g, 'case0'))).toMatch(/too small/u);
    // one radiator along the front or the top, not two
    expect(put(g, 'rad1')).toMatchObject({ ok: true });
    expect(refusal(put(g, 'rad2'))).toMatch(/already has a radiator/u);
    // the mounts of a Micro tower take 92 mm fans only
    expect(refusal(put(g, 'fan120'))).toMatch(/no spot for a 120 mm fan/u);
    expect(put(g, 'fan92')).toMatchObject({ ok: true });
    // a Mini tower has no mounts on its top: the radiator that stands there does not go with it
    const h = new Game({ seed: 1, sandbox: true, looseFit: true });
    expect(put(h, 'case1')).toMatchObject({ ok: true }); // (the Starter board stands in it: a smaller board in a bigger case)
    expect(put(h, 'rad1', 'rad-top')).toMatchObject({ ok: true });
    expect(refusal(put(h, 'case0'))).toMatch(/no top fan mounts/u);
  });

  it('says what the machine will do, as the thermal model does: slows when a little short, trips when far short', () => {
    // 45 W of parts on a 40 W supply, and the regulators waste some more: every part runs at the supply's share of that draw
    const flat = { cpu: 1, ram: 1, gpu: 1, npu: 1 };
    const brown = rig(['psu0', 'cpu2', 'ram2', 'display0'], true);
    const slow = checkCompat(brown.board).find((i) => i.id === 'psu-brownout');
    expect(slow).toMatchObject({ severity: 'warn', limit: 40 });
    expect(must(slow).value).toBeGreaterThan(45); // (the regulators' loss is in it)
    const th = step(brown, flat);
    expect(th.power.tripped).toBe(false);
    expect(th.power.psuFactor).toBeCloseTo(40 / must(must(slow).value), 2);
    expect(must(slow).message).toContain(`${Math.round(th.power.psuFactor * 100)}% of its speed`);
    // far over: past one and a half times the supply
    const far = rig(['psu0', 'cpu2', 'ram2', 'display0', 'gpu1'], true);
    const trip = checkCompat(far.board).find((i) => i.id === 'psu-trip');
    expect(trip).toMatchObject({ severity: 'error', limit: 60 });
    expect(must(trip).value).toBeGreaterThan(85);
    expect(checkCompat(far.board).some((i) => i.id === 'psu-brownout')).toBe(false);
    expect(step(far, flat).power).toMatchObject({ tripped: true, off: true });
    // within the rating: neither
    const fine = rig(['psu1', 'cpu2', 'ram2', 'display0'], true);
    expect(checkCompat(fine.board).map((i) => i.id)).not.toStrictEqual(expect.arrayContaining(['psu-brownout']));
    expect(step(fine, { cpu: 1 }).power).toMatchObject({ tripped: false, psuFactor: 1 });
  });
});

const drive = (g: Game) => must(g.board.devices.find((d) => deviceSpec(d).kind === 'storage'));

describe('the OS follows its drive', () => {
  it('the drive that holds it comes out in Build my PC, and not in a sandbox game', async () => {
    const strict = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
    const os = must(strict.os);
    expect(refusal(strict.uninstall(os.deviceId))).toMatch(/uninstall the OS first/u);
    const g = await presetGame(must(BUILD_PRESETS[0]));
    expect(g.snapshot().os).not.toBeNull();
    expect(g.uninstall(drive(g).id)).toMatchObject({ ok: true });
    expect(g.snapshot().os).toBeNull();
    expect(g.snapshot().inventory.filter((i) => i.kind === 'os')).toHaveLength(1);
  });

  it('waits in the inventory with no drive, then goes on the drive that goes in (the socket it left first)', async () => {
    const g = await presetGame(must(BUILD_PRESETS[1]));
    const old = drive(g),
      { slot } = old;
    g.uninstall(old.id);
    g.keepOs();
    expect(g.snapshot().os).toBeNull(); // no drive to hold it
    expect(put(g, old.spec, slot)).toMatchObject({ ok: true });
    g.keepOs();
    expect(g.snapshot().os).toMatchObject({ slot });
    expect(g.snapshot().inventory.some((i) => i.kind === 'os')).toBe(false);
    g.keepOs(); // (nothing left to do)
    expect(g.snapshot().os).toMatchObject({ slot });
  });

  it("a drive put in the OS drive's socket takes its place, and the OS goes on it", async () => {
    const g = await presetGame(must(BUILD_PRESETS[0])); // Budget: a SATA SSD in sata0
    const old = drive(g),
      { slot } = old;
    expect(old.spec).not.toBe('hdd0');
    expect(put(g, 'hdd0', slot)).toMatchObject({ ok: true });
    expect(g.snapshot().os).toBeNull();
    g.keepOs();
    expect(g.snapshot().os).toMatchObject({ slot });
    expect(drive(g).spec).toBe('hdd0');
  });

  it('with two drives the OS comes back to the socket it left, not to the first drive in the list', async () => {
    const g = await presetGame(must(BUILD_PRESETS[2])); // Workstation: three drives
    const drives = g.board.devices.filter((d) => deviceSpec(d).kind === 'storage');
    expect(drives.length).toBeGreaterThan(1);
    const home = must(drives.find((d) => d.id === must(g.os).deviceId));
    const { spec } = home,
      { slot } = home;
    g.uninstall(home.id);
    expect(put(g, spec, slot)).toMatchObject({ ok: true });
    g.keepOs();
    expect(g.snapshot().os).toMatchObject({ slot });
  });
});
