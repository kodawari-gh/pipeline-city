import { describe, expect, it } from 'vitest';
import { generate } from '../../jobs/sim/gen';
import { Game } from '@/worker/game/game';
import type * as gameTypes from '@/worker/game/game';
import { Operator } from '../../economy/sim/operator';
import type * as economyTypes from '../../economy/sim/economy';
import { ECONOMY } from '../../economy/sim/economy';

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

/** The inventory id of what was bought; fails the test when the purchase was refused. */
function bought(r: ReturnType<Game['purchase']>): string {
  if (!r.ok) {
    throw new Error(`purchase refused: ${r.reason}`);
  }
  return r.invId;
}

/** What pulling the key paid; fails the test when it was refused or its job was not done. */
function payoutOf(r: ReturnType<Game['ejectKey']>): number {
  if (!r.ok || !r.done) {
    throw new Error('expected a finished key to be paid for');
  }
  return r.payout;
}

/** Whether a cable needs a part before it can go in (the case's hub and its fans need none). */
const needsAPart = (id: string): boolean => id !== 'sysfan' && !id.startsWith('fan:');

/** Whether a cable says why it cannot go in yet. */
const isBlocked = (c: { blocked?: string }): boolean => (c.blocked ?? '') !== '';

/** Appends `p` to `seen` unless it is already the last one. */
function noteChange<T>(seen: T[], p: T): void {
  if (seen.at(-1) !== p) {
    seen.push(p);
  }
}

/** Ticks `g` until it halts, at most `max` ticks, calling `each` after every tick. */
function tickUntilHalted(g: Game, max: number, each?: (game: Game) => void): void {
  for (let i = 0; i < max && g.currentPhase() !== 'halted'; i++) {
    g.advanceBaseTick();
    each?.(g);
  }
}

/** The parts to buy for a CPU tier run: the `extra` ones and the CPU itself unless it is the stock cpu0. */
const partsFor = (cpu: string, extra: readonly string[]): string[] => [...extra, ...(cpu === 'cpu0' ? [] : [cpu])];

// These tests are about hardware, not player levels: every item is buyable (levels have their own tests in levels.test.ts).
ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

// The manual removal of a finished key is what most of these tests are about: auto-eject has its own tests at the end.
const NO_ARRIVALS: Partial<economyTypes.EconomyConfig> = { baseDemandPerTick: 0, autoEjectTicks: 0 };

/** Bare game with the starter crate, ids inv1..inv6 = cpu0 psu0 ram0 display0 cooler0 fan92. */
function bare(economy: Partial<economyTypes.EconomyConfig> = NO_ARRIVALS): Game {
  return new Game({ seed: 1, economy });
}

function assembled(economy: Partial<economyTypes.EconomyConfig> = NO_ARRIVALS): Game {
  const g = bare(economy);
  for (const id of ['inv1', 'inv5', 'inv6', 'inv2', 'inv3', 'inv4']) {
    expect(g.install(id).ok).toBe(true);
  }
  for (const c of ['atx', 'cpu', 'cpufan', 'video', 'pcmains', 'monmains']) {
    expect(g.connectCable(c).ok).toBe(true);
  }
  return g;
}

function runUntil(g: Game, phase: gameTypes.Phase, max = 600): number {
  let t = 0;
  while (g.currentPhase() !== phase && t < max) {
    g.advanceBaseTick();
    t++;
  }
  expect(g.currentPhase()).toBe(phase);
  return t;
}

/** The no-OS flow: machine off, plug a key, press power. */
function bootWithKey(g: Game, id = must(g.trayKeyIds()[0])): void {
  if (g.powered) {
    g.powerButton();
  }
  expect(g.plugKey(id).ok).toBe(true);
  expect(g.powerButton().ok).toBe(true);
}

/** An assembled game booted with a key and left in `when`: still posting, or halted after the job. */
function bootedTo(when: 'posting' | 'halted'): Game {
  const h = assembled();
  bootWithKey(h);
  if (when === 'halted') {
    runUntil(h, 'halted');
  }
  return h;
}

const ticks = (g: Game, n: number) => {
  for (let i = 0; i < n; i++) {
    g.advanceBaseTick();
  }
};

describe('the bare start', () => {
  it('is a bare board, a powered-off machine and a starter crate', () => {
    const g = bare();
    const s = g.snapshot();
    expect(s).toMatchObject({ phase: 'off', powered: false, money: 0, boardTier: 0, display: '', monitorLive: false });
    // only the case's two front fans are mounted: the heatsink and its fan are in the crate and mount on the CPU
    expect(s.devices.map((d) => [d.spec, d.slot])).toStrictEqual([
      ['fan92', 'front0'],
      ['fan92', 'front1'],
    ]);
    expect(s.inventory.map((i) => i.spec)).toStrictEqual(['cpu0', 'psu0', 'ram0', 'display0', 'cooler0', 'fan92']);
    expect(s.tray).toHaveLength(1);
    expect(s.plugged).toBeNull();
    expect(Object.values(s.progress).every((v) => v === false)).toBe(true);
    // the ethernet cable joined with the network; the Mini tower's hub cable and two front fans' cables need only the case (no cooler yet: no CPU fan cable)
    expect(s.cables.map((c) => [c.id, c.connected])).toStrictEqual([
      ['atx', false],
      ['cpu', false],
      ['video', false],
      ['pcmains', false],
      ['monmains', false],
      ['sysfan', false],
      ['lan', false],
      ['fan:front0', false],
      ['fan:front1', false],
    ]);
    expect(s.cables.filter((c) => needsAPart(c.id)).every((c) => isBlocked(c))).toBe(true); // no PSU / monitor yet (only the case's hub and fans need no part: the wall cords belong to the PSU and the monitor)
    expect(s.noPowerReason).toMatch(/PSU/u);
    expect(
      s.slots
        .filter((x) => x.deviceId === null)
        .map((x) => x.id)
        .toSorted(),
    ).toStrictEqual([
      'atx0',
      'cooler0',
      'cpu0',
      'dimm0',
      'display0',
      'pcie0',
      'rad-front',
      'ram-sink0',
      'sata0',
      'sata1',
      'usb0',
      'vrm-sink0',
    ]);
  });

  it('lists the free compatible slots of each inventory part (drop targets)', () => {
    const inv = bare().snapshot().inventory;
    const by = (spec: string) => must(inv.find((i) => i.spec === spec));
    expect(by('cpu0')).toMatchObject({ freeSlots: ['cpu0'], swapSlots: [], installable: true });
    expect(by('ram0').freeSlots).toStrictEqual(['dimm0']); // the Starter board has one DIMM slot
    expect(by('psu0').freeSlots).toStrictEqual(['atx0']);
    expect(by('display0').freeSlots).toStrictEqual(['display0']);
  });

  it('preassembled: everything installed, cables on, powered, milestones reached', () => {
    const s = new Game({ seed: 1, preassembled: true }).snapshot();
    expect(s.powered).toBe(true);
    expect(s.inventory).toStrictEqual([]);
    expect(s.devices.map((d) => d.kind).toSorted()).toStrictEqual([
      'cooler',
      'cpu',
      'display',
      'fan',
      'fan',
      'fan',
      'psu',
      'ram',
    ]);
    expect(s.devices.find((d) => d.slot === 'cooler0.fan0')?.spec).toBe('fan92'); // the crate's fan is on the heatsink
    expect(s.cables.filter((c) => c.id !== 'lan').every((c) => c.connected)).toBe(true); // the ethernet cable is the player's
    expect(s.progress.poweredOn).toBe(true);
  });
});

describe('install, uninstall and cables', () => {
  it('refuses the wrong slot type, a missing slot, an unknown item and an occupied slot of another kind', () => {
    const g = bare();
    expect(refusal(g.install('inv1', 'dimm0'))).toMatch(/needs a cpu slot/u);
    expect(refusal(g.install('inv1', 'nope9'))).toMatch(/no slot/u);
    expect(refusal(g.install('inv99'))).toMatch(/no inventory item/u);
    expect(refusal(g.install('inv2', 'cooler0'))).toMatch(/needs a atx slot/u);
    expect(g.snapshot().inventory).toHaveLength(6); // nothing was consumed
    expect(g.snapshot().devices).toHaveLength(2); // the case fans only
  });

  it('installs into a chosen slot, then a second part of the same kind swaps over it and the old one comes back', () => {
    const g = bare();
    g.money = 1e6;
    expect(g.install('inv3', 'dimm0')).toMatchObject({ ok: true, slot: 'dimm0' });
    const r = bought(g.purchase('ram1'));
    expect(g.install(r, 'dimm0')).toMatchObject({ ok: true, slot: 'dimm0' }); // swap
    const s = g.snapshot();
    expect(s.devices.filter((d) => d.kind === 'ram').map((d) => [d.spec, d.slot])).toStrictEqual([['ram1', 'dimm0']]);
    expect(s.inventory.map((i) => i.spec)).toContain('ram0');
  });

  it('only works while the machine is off, for install, uninstall and cables', () => {
    const g = assembled();
    expect(g.powerButton()).toMatchObject({ ok: true, powered: true });
    const dev = must(g.snapshot().devices.find((d) => d.kind === 'ram'));
    for (const r of [g.uninstall(dev.id), g.connectCable('atx'), g.disconnectCable('atx')]) {
      expect(refusal(r)).toContain('power the machine off first');
    }
    g.money = 1e6;
    const inv = bought(g.purchase('ram1'));
    expect(g.install(inv)).toMatchObject({ ok: false, reason: 'power the machine off first' });
  });

  it('keeps the PSU watt rule: an install that would overload the PSU is refused and changes nothing', () => {
    const g = assembled();
    g.money = 1e6;
    const inv = bought(g.purchase('psu1'));
    // cpu2 needs the 100 W PSU: buy it into the plan, then try to install it before the PSU
    const cpu = bought(g.purchase('cpu2'));
    const r = g.install(cpu);
    expect(refusal(r)).toMatch(/PSU gives 40 W/u);
    expect(must(g.snapshot().devices.find((d) => d.kind === 'cpu')).spec).toBe('cpu0');
    expect(g.snapshot().inventory.some((i) => i.id === cpu)).toBe(true);
    expect(g.install(inv).ok).toBe(true);
    expect(g.install(cpu).ok).toBe(true);
  });

  it('uninstall puts the part in the inventory and unplugs the cables that ran from it', () => {
    const g = assembled();
    const psu = must(g.snapshot().devices.find((d) => d.kind === 'psu'));
    const r = g.uninstall(psu.id);
    expect(r).toMatchObject({ ok: true });
    const s = g.snapshot();
    expect(s.inventory.map((i) => i.spec)).toStrictEqual(['psu0']);
    expect(must(s.cables.find((c) => c.id === 'atx')).connected).toBe(false);
    expect(must(s.cables.find((c) => c.id === 'cpu')).connected).toBe(false);
    expect(must(s.cables.find((c) => c.id === 'video')).connected).toBe(true);
    expect(refusal(g.connectCable('atx'))).toMatch(/no PSU/u);
    expect(g.uninstall('dev99')).toMatchObject({ ok: false });
  });

  it('validates cables', () => {
    const g = bare();
    expect(refusal(g.connectCable('video'))).toMatch(/no monitor/u);
    expect(refusal(g.connectCable('hdmi'))).toMatch(/unknown cable/u);
    g.install('inv2');
    expect(g.connectCable('atx').ok).toBe(true);
    expect(refusal(g.connectCable('atx'))).toMatch(/already connected/u);
    expect(g.disconnectCable('atx').ok).toBe(true);
    expect(refusal(g.disconnectCable('atx'))).toMatch(/not connected/u);
  });
});

describe('power button and POST errors', () => {
  it('does nothing without a PSU and the 24-pin cable, with the reason', () => {
    const g = bare();
    expect(refusal(g.powerButton())).toMatch(/no PSU/u);
    g.install('inv2');
    expect(refusal(g.powerButton())).toMatch(/ATX cable/u);
    g.connectCable('atx');
    expect(refusal(g.powerButton())).toMatch(/power cord/u);
    g.connectCable('pcmains');
    expect(g.powerButton().ok).toBe(true);
    expect(g.currentPhase()).toBe('error'); // powered, but no CPU yet
  });

  it('POST halts in phase error with a message on the monitor when a required part is missing', () => {
    const cases: [string, (g: Game) => unknown, RegExp, string][] = [
      ['no CPU', (g) => g.uninstall(must(g.snapshot().devices.find((d) => d.kind === 'cpu')).id), /no CPU/u, 'NO CPU'],
      ['no CPU power', (g) => g.disconnectCable('cpu'), /8-pin/u, 'NO CPU POWER'],
      ['no RAM', (g) => g.uninstall(must(g.snapshot().devices.find((d) => d.kind === 'ram')).id), /RAM/u, 'NO RAM'],
      [
        'no cooler',
        (g) => g.uninstall(must(g.snapshot().devices.find((d) => d.kind === 'cooler')).id),
        /cooler/u,
        'NO CPU COOLER',
      ],
    ];
    const reasons = new Set<string>();
    for (const [name, breakIt, reason, short] of cases) {
      const g = assembled();
      breakIt(g);
      expect(g.powerButton().ok, `for ${name}`).toBe(true);
      // The phase and its reason are there at once (the UI chip reads them); the monitor is black through the cold-boot wait.
      const s = g.snapshot();
      expect(s.phase, `for ${name}`).toBe('error');
      expect(s.phaseReason, `for ${name}`).toMatch(reason);
      expect(s.display, `for ${name}`).toBe('');
      expect(s.postFailed, `for ${name}`).toBe(true);
      reasons.add(must(s.phaseReason));
      expect(s.pipe, `for ${name}`).toBeNull(); // no CPU activity
      ticks(g, s.postTicks - 1);
      expect(g.snapshot().display, `for ${name}`).toBe('');
      ticks(g, 1); // the wait is over: the POST error text appears, all at once
      expect(g.snapshot().display, `for ${name}`).toContain(`POST FAILED: ${short}`);
      ticks(g, 50);
      expect(g.currentPhase(), `for ${name}`).toBe('error'); // stays halted
    }
    expect(reasons.size).toBe(cases.length); // every part has its own readable reason
    // A POST error is not a refusal: a missing key is not one either, and a missing monitor path just means no message.
    const g = assembled();
    g.disconnectCable('video');
    g.uninstall(must(g.snapshot().devices.find((d) => d.kind === 'cpu')).id);
    expect(g.powerButton().ok).toBe(true);
    expect(g.snapshot()).toMatchObject({ phase: 'error', display: '', postFailed: true });
  });

  it('an error is cleared by powering off, fixing and powering on', () => {
    const g = assembled();
    g.disconnectCable('cpu');
    g.powerButton();
    expect(g.currentPhase()).toBe('error');
    expect(refusal(g.connectCable('cpu'))).toContain('power the machine off first');
    g.powerButton();
    expect(g.currentPhase()).toBe('off');
    g.connectCable('cpu');
    g.powerButton();
    expect(g.currentPhase()).toBe('posting');
  });

  it('the PSU cables stay put on a running machine; video, fan and wall cables change', () => {
    const g = assembled();
    g.powerButton();
    for (const id of ['atx', 'cpu']) {
      expect(g.disconnectCable(id)).toMatchObject({ ok: false });
    }
    expect(g.disconnectCable('video')).toMatchObject({ ok: true });
    expect(g.connectCable('video')).toMatchObject({ ok: true });
    expect(g.disconnectCable('cpufan')).toMatchObject({ ok: true });
    expect(g.connectCable('cpufan')).toMatchObject({ ok: true });
    expect(g.snapshot().powered).toBe(true);
  });

  it('without a monitor cable the machine still boots, but nothing is displayed', () => {
    const g = assembled();
    g.disconnectCable('video');
    g.powerButton();
    runUntil(g, 'halted');
    const s = g.snapshot();
    expect(s).toMatchObject({ monitorLive: false, display: '' });
    expect(s.progress.videoConnected).toBe(true); // it was connected once (sticky milestone)
  });
});

describe('boot sequence (the ROM runs on the real engine)', () => {
  it('POST text appears on the monitor; with no key at boot the BIOS says NO BOOT MEDIA and halts', () => {
    const g = assembled();
    g.powerButton();
    expect(g.snapshot()).toMatchObject({ phase: 'posting', powered: true, display: '' });
    runUntil(g, 'halted');
    ticks(g, 15); // let the display writes land
    const s = g.snapshot();
    expect(s.display).toBe('PCH BIOS 1.0\nCPU T0 OK\nRAM 16K OK\nUSB OK\n\nNO BOOT MEDIA\nINSERT A KEY AND RESTART');
    expect(s.haltReason).toBe('no-boot-media');
    expect(s.bootProgress).toBeCloseTo(0.4);
    expect(s.pipe).not.toBeNull();
    ticks(g, 400);
    expect(g.currentPhase()).toBe('halted'); // halted until the player power-cycles
  });

  it('walks the phases in order for one key and shows the job output and JOB DONE, then halts', () => {
    const g = assembled();
    bootWithKey(g);
    const seen: gameTypes.Phase[] = [];
    noteChange(seen, g.currentPhase());
    tickUntilHalted(g, 400, (game) => {
      noteChange(seen, game.currentPhase());
    });
    expect(seen).toStrictEqual(['posting', 'loading', 'running', 'writing', 'halted']);
    ticks(g, 10);
    const s = g.snapshot();
    expect(s.display.split('\n')[8]).toMatch(/^#\d\d .+ OK$/u); // the job's output sits on its row
    expect(s.display).toContain('JOB DONE');
    expect(s.display).toContain('POWER OFF/ON FOR THE NEXT JOB');
    expect(s.haltReason).toBe('job-done');
    expect(must(s.plugged).done).toBe(true);
    expect(must(s.plugged).result).toBe(s.display.split('\n')[8]);
    expect(s.bootProgress).toBe(1);
    ticks(g, 500);
    expect(g.currentPhase()).toBe('halted'); // waits indefinitely for the player
    expect(g.money).toBe(0); // and nothing is paid until the key is removed
  });

  it('the halt text is complete on the first snapshot in phase halted (no partial message)', () => {
    // Job done: the ROM writes JOB DONE and REMOVE KEY before it halts, so a snapshot that says halted shows all of it.
    const done = assembled();
    bootWithKey(done);
    tickUntilHalted(done, 600);
    expect(done.currentPhase()).toBe('halted');
    const first = done.snapshot();
    expect(first.haltReason).toBe('job-done');
    expect(first.display).toContain('JOB DONE');
    expect(first.display).toContain('POWER OFF/ON FOR THE NEXT JOB');
    // No boot media: the ROM writes the whole message before it halts.
    const none = assembled();
    none.powerButton();
    tickUntilHalted(none, 600);
    expect(none.currentPhase()).toBe('halted');
    expect(none.snapshot()).toMatchObject({
      haltReason: 'no-boot-media',
      display: 'PCH BIOS 1.0\nCPU T0 OK\nRAM 16K OK\nUSB OK\n\nNO BOOT MEDIA\nINSERT A KEY AND RESTART',
    });
  });

  it('leaves the exact text the generator promised on the key, for every template and CPU tier', () => {
    // cpu2 gets the strongest board: on the Starter VRM it droops and crashes, which is a different test.
    for (const [cpu, extra] of [
      ['cpu0', []],
      ['cpu1', []],
      ['cpu2', ['board1', 'board2', 'board3', 'psu1']],
    ] as const) {
      for (const [template, scale] of [
        ['cli.log', 1],
        ['cli.calc', 1],
        ['cli.checksum', 1],
        ['cli.scan', 2],
      ] as const) {
        const g = new Game({
          seed: 7,
          preassembled: true,
          economy: { ...NO_ARRIVALS, startQueue: [{ template, scale }] },
        });
        g.money = 1e6;
        g.powerButton(); // boards are bought while powered off
        for (const p of partsFor(cpu, extra)) {
          g.purchase(p);
        }
        new Operator(g).assemble(false);
        const snap = must(g.snapshot().tray[0]);
        bootWithKey(g);
        runUntil(g, 'halted', 3000);
        const key = must(g.snapshot().plugged);
        // regenerate the job exactly as the key carries it, on the job's display row
        const saved = must(g.toSave().plugged);
        const want = generate(saved.template, saved.seed, { scale: saved.scale, row: 8 }).meta.expectedText.trim();
        expect(key.result, `${cpu} ${template}`).toBe(want.split('\n').pop());
        expect(snap.jobNo).toBe(key.jobNo);
      }
    }
  });

  it('after a job the machine stays halted: no reboot, no new key is read until the player power-cycles it by hand', () => {
    const g = assembled({ baseDemandPerTick: 0.3 });
    bootWithKey(g);
    runUntil(g, 'halted');
    expect(g.ejectKey()).toMatchObject({ ok: true, done: true });
    const seen = new Set<gameTypes.Phase>();
    for (let i = 0; i < 200; i++) {
      g.advanceBaseTick();
      seen.add(g.currentPhase());
    }
    expect([...seen]).toStrictEqual(['halted']); // no auto-reboot
    expect(g.powered).toBe(true);
    // The next key plugged into the halted machine is ignored (no LED activity)...
    const next = must(g.trayKeyIds()[0]);
    expect(g.plugKey(next).ok).toBe(true);
    ticks(g, 100);
    expect(g.snapshot()).toMatchObject({ phase: 'halted', keyActivity: 'none', keyIgnored: true });
    // ...until the manual cycle: power off, power on.
    g.powerButton();
    expect(g.currentPhase()).toBe('off');
    expect(must(g.pluggedKey()).id).toBe(next);
    g.powerButton();
    runUntil(g, 'halted');
    expect(g.snapshot()).toMatchObject({ haltReason: 'job-done', keyIgnored: false });
    expect(g.ejectKey()).toMatchObject({ ok: true, done: true });
    expect(g.completed).toBe(2);
  });

  it('a key plugged into a running no-OS machine after the boot check is ignored; one plugged during POST is read', () => {
    const g = assembled();
    g.powerButton();
    runUntil(g, 'halted'); // no key at boot
    ticks(g, 30);
    const trayKey = must(g.trayKeyIds()[0]);
    expect(g.plugKey(trayKey).ok).toBe(true);
    const seen = new Set<gameTypes.Phase>();
    for (let i = 0; i < 300; i++) {
      g.advanceBaseTick();
      seen.add(g.currentPhase());
      expect(g.snapshot().keyActivity).toBe('none'); // the USB LED stays dark
    }
    expect([...seen]).toStrictEqual(['halted']);
    expect(g.snapshot().keyIgnored).toBe(true);
    expect(must(g.pluggedKey()).done).toBe(false);
    // POST has not reached the loader yet: the key plugged now is the job.
    const h = assembled();
    h.powerButton();
    ticks(h, 2);
    expect(h.currentPhase()).toBe('posting');
    h.plugKey(must(h.trayKeyIds()[0]));
    runUntil(h, 'halted');
    expect(h.snapshot()).toMatchObject({ haltReason: 'job-done', keyIgnored: false });
  });

  it('a finished key left in the port is shown as JOB DONE again after a power cycle', () => {
    const g = assembled();
    bootWithKey(g);
    runUntil(g, 'halted');
    g.powerButton();
    g.powerButton();
    runUntil(g, 'halted');
    expect(g.snapshot().haltReason).toBe('job-done');
    expect(g.ejectKey()).toMatchObject({ ok: true, done: true });
  });
});

describe('keys and the queue', () => {
  it('plugging: unknown key, one program at a time', () => {
    const g = assembled({ baseDemandPerTick: 0.5 });
    g.powerButton();
    ticks(g, 40);
    const ids = g.trayKeyIds();
    expect(ids.length).toBeGreaterThan(1);
    expect(refusal(g.plugKey(999))).toMatch(/no key 999/u);
    expect(g.plugKey(must(ids[0])).ok).toBe(true);
    const second = must(ids[1]);
    expect(refusal(g.plugKey(second))).toMatch(/already plugged/u);
    const s = g.snapshot();
    expect(must(s.plugged).id).toBe(ids[0]);
    expect(s.tray.map((k) => k.id)).not.toContain(ids[0]);
    expect(s.queueLength).toBe(ids.length - 1);
    expect(g.ejectKey().ok).toBe(true); // pulled before the job: back to the tray, in order
    expect(g.trayKeyIds().slice(0, 2)).toStrictEqual([ids[0], ids[1]]);
  });

  it('removing the key pays the client: payout, reputation and counters change then, not before', () => {
    const g = assembled();
    bootWithKey(g);
    const arrival = must(g.snapshot().plugged).arrivalTick;
    runUntil(g, 'halted');
    const before = g.snapshot();
    ticks(g, 20); // the player dawdles
    expect(g.snapshot()).toMatchObject({ money: 0, completed: 0, avgTurnaround: before.avgTurnaround });
    const r = g.ejectKey();
    expect(payoutOf(r)).toBeGreaterThan(0);
    const s = g.snapshot();
    expect(s.money).toBe(payoutOf(r));
    expect(s.completed).toBe(1);
    expect(s.lastCompleted).toMatchObject({
      id: 1,
      completedAt: g.baseTick,
      turnaround: g.baseTick - arrival,
      payout: s.money,
    });
    expect(must(s.lastCompleted).execTicks).toBeGreaterThan(10);
    expect(s.avgTurnaround).not.toBe(before.avgTurnaround);
    expect(s.plugged).toBeNull();
    expect(s.progress).toMatchObject({ firstKeyPlugged: true, firstJobDone: true, firstKeyEjected: true });
    expect(refusal(g.ejectKey())).toMatch(/no key/u);
  });

  it('pulling the key mid-job aborts it: no payout, the machine crashes and reboots (and finds no key), the key is back in the tray', () => {
    const g = assembled();
    const id = must(g.trayKeyIds()[0]);
    bootWithKey(g, id);
    runUntil(g, 'running');
    expect(g.ejectKey()).toMatchObject({ ok: true, done: false, payout: 0 });
    expect(g.snapshot()).toMatchObject({ money: 0, completed: 0, phase: 'posting' });
    expect(g.trayKeyIds()).toContain(id);
    runUntil(g, 'halted');
    expect(g.snapshot().haltReason).toBe('no-boot-media');
    // and it can be tried again by hand
    bootWithKey(g, id);
    runUntil(g, 'halted');
    expect(g.snapshot().haltReason).toBe('job-done');
    expect(must(g.snapshot().plugged).attempts).toBe(2);
    expect(g.ejectKey()).toMatchObject({ ok: true, done: true });
  });

  it('the power button is a hard power-off in any powered phase: the job is lost, the key keeps its data and the job restarts at the next boot', () => {
    const g = assembled();
    bootWithKey(g);
    runUntil(g, 'running');
    expect(g.powerButton()).toMatchObject({ ok: true, powered: false });
    expect(g.snapshot()).toMatchObject({ phase: 'off', display: '' });
    expect(g.snapshot().plugged).toMatchObject({ done: false, attempts: 2 });
    g.powerButton();
    const seen = new Set<gameTypes.Phase>();
    tickUntilHalted(g, 600, (game) => {
      seen.add(game.currentPhase());
    });
    expect([...seen]).toStrictEqual(expect.arrayContaining(['posting', 'loading', 'running', 'writing', 'halted']));
    expect(must(g.snapshot().plugged).done).toBe(true);
    // also while posting and while halted
    for (const when of ['posting', 'halted'] as const) {
      const h = bootedTo(when);
      expect(h.currentPhase()).toBe(when);
      expect(h.powerButton()).toMatchObject({ ok: true, powered: false });
      expect(h.pluggedKey()).not.toBeNull();
    }
  });

  it('a key can be plugged in while the machine is off, and is picked up at boot', () => {
    const g = assembled();
    const trayKey = must(g.trayKeyIds()[0]);
    expect(g.plugKey(trayKey).ok).toBe(true);
    g.powerButton();
    runUntil(g, 'halted');
    expect(must(g.snapshot().plugged).done).toBe(true);
  });

  it('idle time is lost: keys age while the machine waits, and late ones pay less', () => {
    // A short base deadline (x4 patience at level 1 = 160 ticks) so the key is late within the test.
    const g = assembled({ ...NO_ARRIVALS, deadlineTicks: 40 });
    g.powerButton();
    runUntil(g, 'halted');
    ticks(g, 250);
    const k = must(g.snapshot().tray[0]);
    expect(k.age).toBeGreaterThan(g.cfg.deadlineTicks);
    expect(k.late).toBe(true);
    bootWithKey(g, k.id);
    runUntil(g, 'halted');
    const r = g.ejectKey();
    expect(must(g.snapshot().lastCompleted).late).toBe(true);
    expect(payoutOf(r)).toBeLessThan(k.payoutEstimate);
  });

  it('tray keys have a label, a job number and an age', () => {
    const g = assembled();
    g.powerButton();
    ticks(g, 7);
    const k = must(g.snapshot().tray[0]);
    expect(k.label).toMatch(/^#\d\d (?:log|calc|checksum|scan)$/u);
    expect(k).toMatchObject({ id: 1, age: 7, done: false, result: '' });
    expect(k.deadlineTick - k.arrivalTick).toBe(g.snapshot().patience.deadlineTicks);
  });
});

describe('tutorial progress flags are set by real events', () => {
  it('each milestone flips on its own event and stays', () => {
    const g = bare();
    const p = () => g.snapshot().progress;
    expect(p().cpuInstalled).toBe(false);
    g.install('inv1');
    expect(p()).toMatchObject({ cpuInstalled: true, psuInstalled: false, coolerInstalled: false });
    g.install('inv5');
    expect(p().coolerInstalled).toBe(true);
    g.install('inv2');
    expect(p().psuInstalled).toBe(true);
    g.install('inv3');
    expect(p().ramInstalled).toBe(true);
    g.install('inv4');
    expect(p().monitorInstalled).toBe(true);
    g.connectCable('atx');
    expect(p()).toMatchObject({ atxConnected: true, cpuPowerConnected: false });
    g.connectCable('cpu');
    expect(p().cpuPowerConnected).toBe(true);
    g.connectCable('cpufan'); // the CPU fan cable: POST stops without it
    g.connectCable('video');
    expect(p().videoConnected).toBe(true);
    g.connectCable('pcmains');
    expect(p().mainsConnected).toBe(false); // both cords make the milestone
    g.connectCable('monmains');
    expect(p().mainsConnected).toBe(true);
    expect(p().poweredOn).toBe(false);
    expect(p().firstKeyPlugged).toBe(false);
    g.plugKey(1);
    expect(p().firstKeyPlugged).toBe(true); // the key goes in first, then power
    g.powerButton();
    expect(p().poweredOn).toBe(true);
    expect(p().firstJobDone).toBe(false);
    runUntil(g, 'halted');
    expect(p().firstJobDone).toBe(true);
    expect(p().firstKeyEjected).toBe(false);
    g.ejectKey();
    expect(p().firstKeyEjected).toBe(true);
    expect(p().firstPurchase).toBe(false);
    g.money = 100;
    g.purchase('ram1');
    expect(p().firstPurchase).toBe(true);
    g.powerButton();
    g.uninstall(must(g.snapshot().devices.find((d) => d.kind === 'cpu')).id);
    expect(p().cpuInstalled).toBe(true); // sticky
  });

  it('a failed action does not set a flag', () => {
    const g = bare();
    g.install('inv1', 'dimm0');
    g.purchase('cpu1');
    expect(g.snapshot().progress).toMatchObject({ cpuInstalled: false, firstPurchase: false });
  });

  it('has a short event log of what happened', () => {
    const g = assembled();
    g.powerButton();
    const { log } = g.snapshot();
    expect(log.map((e) => e.kind)).toContain('power');
    expect(log.length).toBeLessThanOrEqual(16);
  });
});

describe('the CPU cooler mounts on the CPU', () => {
  it('is in the crate, not mounted, and cannot be installed before the CPU', () => {
    const g = bare();
    const cooler = must(g.snapshot().inventory.find((i) => i.id === 'inv5'));
    expect(cooler).toMatchObject({ spec: 'cooler0', installable: false });
    expect(cooler.reason).toMatch(/install the CPU first/u);
    expect(g.install('inv5')).toMatchObject({ ok: false, reason: 'install the CPU first: the cooler mounts on it' });
    expect(g.install('inv5', 'cooler0')).toMatchObject({ ok: false });
    expect(g.snapshot().progress.coolerInstalled).toBe(false);
    g.install('inv1');
    expect(g.snapshot().inventory.find((i) => i.id === 'inv5')).toMatchObject({
      installable: true,
      freeSlots: ['cooler0'],
    });
    expect(g.install('inv5')).toMatchObject({ ok: true, slot: 'cooler0' });
    expect(g.snapshot().progress.coolerInstalled).toBe(true);
  });

  it('powering on without a cooler halts in phase error: NO CPU COOLER on the monitor, fixed by mounting it', () => {
    const g = assembled();
    g.uninstall(must(g.snapshot().devices.find((d) => d.kind === 'cooler')).id);
    expect(g.snapshot().postBlocker).toMatch(/cooler/u);
    expect(g.powerButton()).toMatchObject({ ok: true });
    const s = g.snapshot();
    expect(s.phase).toBe('error');
    expect(s.phaseReason).toMatch(/cooler/u);
    expect(s.display).toBe(''); // the cold-boot wait first (monitor black), then the message
    ticks(g, s.postTicks);
    expect(g.snapshot().display).toContain('NO CPU COOLER');
    g.powerButton();
    const coolerItem = must(g.snapshot().inventory.find((i) => i.spec === 'cooler0'));
    expect(g.install(coolerItem.id).ok).toBe(true);
    // a bare heatsink (its fan came off with it) boots: it cools by itself, and the CPU fan cable waits for a fan
    expect(g.snapshot().cables.find((c) => c.id === 'cpufan')).toBeUndefined();
    g.powerButton();
    expect(g.snapshot().phase).toBe('posting');
    g.powerButton();
    const fanItem = must(g.snapshot().inventory.find((i) => i.spec === 'fan92'));
    expect(g.install(fanItem.id)).toMatchObject({
      ok: true,
      slot: 'cooler0.fan0',
    });
    expect(g.connectCable('cpufan').ok).toBe(true);
  });

  it('uninstalling the CPU takes the cooler back to the inventory; swapping the CPU keeps it mounted', () => {
    const g = assembled();
    g.money = 1e6;
    const cpu1 = bought(g.purchase('cpu1'));
    expect(g.install(cpu1).ok).toBe(true); // swap
    expect(g.snapshot().devices.filter((d) => d.kind === 'cooler')).toHaveLength(1);
    g.uninstall(must(g.snapshot().devices.find((d) => d.kind === 'cpu')).id);
    const s = g.snapshot();
    expect(s.devices.some((d) => d.kind === 'cooler')).toBe(false);
    expect(s.inventory.map((i) => i.spec).toSorted()).toStrictEqual(['cooler0', 'cpu0', 'cpu1', 'fan92']); // the heatsink's fan comes off with it
    expect(s.progress).toMatchObject({ cpuInstalled: true, coolerInstalled: true }); // sticky
  });

  it('a better cooler swaps over the stock one, and preassembled games keep theirs', () => {
    const g = assembled();
    g.money = 1e6;
    const c = bought(g.purchase('cooler1'));
    expect(g.install(c)).toMatchObject({ ok: true, slot: 'cooler0' });
    expect(must(g.snapshot().devices.find((d) => d.kind === 'cooler')).spec).toBe('cooler1');
    expect(g.snapshot().inventory.map((i) => i.spec)).toStrictEqual(['cooler0', 'fan92']); // the 92 mm fan does not fit the tower's 120 mm spots
    const p = new Game({ seed: 1, preassembled: true }).snapshot();
    expect(must(p.devices.find((d) => d.kind === 'cooler')).spec).toBe('cooler0');
    expect(p.progress.coolerInstalled).toBe(true);
    expect(p.phase).not.toBe('error');
  });
});

describe('auto-eject and quick boots (no OS)', () => {
  it('a finished key ejects itself a few ticks after the halt and pays, with no action from the player', () => {
    const g = assembled({ baseDemandPerTick: 0 }); // default config: auto-eject on
    expect(g.snapshot().autoEject).toBe(true);
    bootWithKey(g);
    runUntil(g, 'halted');
    expect(g.snapshot().plugged?.done).toBe(true);
    expect(g.money).toBe(0); // the key sits in the port for a beat first (the monitor shows JOB DONE)
    ticks(g, g.cfg.autoEjectTicks);
    const s = g.snapshot();
    expect(s.plugged).toBeNull();
    expect(s.completed).toBe(1);
    expect(s.money).toBeGreaterThan(0);
    expect(s.progress).toMatchObject({ firstJobDone: true, firstKeyEjected: true });
    expect(s.phase).toBe('off'); // and the machine has switched itself off: the next job is plug, power on
  });

  it('auto-eject is off with the config at 0, and an installed OS never uses it', () => {
    const off = assembled({ baseDemandPerTick: 0, autoEjectTicks: 0 });
    expect(off.snapshot().autoEject).toBe(false);
    bootWithKey(off);
    runUntil(off, 'halted');
    ticks(off, 50);
    expect(off.snapshot().plugged?.done).toBe(true);
  });

  it('the first job takes about 20 s from the power button, and POST about 3 s on the Starter machine', () => {
    const g = assembled({ baseDemandPerTick: 0 });
    bootWithKey(g);
    expect(g.snapshot().postTicks).toBeLessThanOrEqual(5);
    const t = runUntil(g, 'halted');
    expect(t).toBeLessThanOrEqual(30);
  });
});

/** The two wall cords of the machine: the PC's and the monitor's. */
const cords = (g: Game) => g.snapshot().cables.filter((c) => c.id === 'pcmains' || c.id === 'monmains');

describe('the cords from the wall', () => {
  it('start loose in a campaign, plugged in as their part goes into a sandbox, and plugged in a preassembled machine', () => {
    const g = bare();
    expect(cords(g).map((c) => c.connected)).toStrictEqual([false, false]);
    // (a sandbox plugs the cord with its part: a PSU for the PC's, a monitor for the monitor's)
    const sb = new Game({ seed: 1, sandbox: true });
    expect(cords(sb).map((c) => c.connected)).toStrictEqual([false, false]);
    sb.install('inv2');
    expect(cords(sb).map((c) => [c.id, c.connected])).toStrictEqual([
      ['pcmains', true],
      ['monmains', false],
    ]);
    sb.install('inv4');
    expect(cords(sb).every((c) => c.connected)).toBe(true);
    const pre = new Game({ seed: 1, sandbox: true, preassembled: true });
    expect(pre.snapshot().progress.mainsConnected).toBe(true);
    expect(cords(pre).every((c) => c.connected)).toBe(true);
  });

  it("belong to their parts: the PC's to the PSU, the monitor's to the monitor, with the video cable; they come off with the part and cannot be plugged without it", () => {
    const g = assembled();
    expect(refusal(g.connectCable('pcmains'))).toMatch(/already connected/u);
    bootWithKey(g);
    expect(g.disconnectCable('monmains').ok).toBe(true); // a running machine: allowed
    expect(g.connectCable('monmains').ok).toBe(true);
    g.powerButton();
    g.uninstall(must(g.snapshot().devices.find((d) => d.kind === 'display')).id);
    // (no monitor: no video cable, no cord)
    const monCord = must(cords(g).find((c) => c.id === 'monmains')),
      video = must(g.snapshot().cables.find((c) => c.id === 'video'));
    expect(monCord).toMatchObject({ connected: false });
    expect(monCord.blocked).toMatch(/no monitor installed/u);
    expect(video).toMatchObject({ connected: false });
    expect(video.blocked).toMatch(/no monitor installed/u);
    expect(refusal(g.connectCable('monmains'))).toMatch(/no monitor installed/u);
    expect(g.connectCable('video').ok).toBe(false);
    expect(must(cords(g).find((c) => c.id === 'pcmains')).connected).toBe(true);
    g.uninstall(must(g.snapshot().devices.find((d) => d.kind === 'psu')).id);
    const pcCord = must(cords(g).find((c) => c.id === 'pcmains'));
    expect(pcCord).toMatchObject({ connected: false });
    expect(pcCord.blocked).toMatch(/no PSU installed/u);
    expect(refusal(g.connectCable('pcmains'))).toMatch(/no PSU installed/u);
  });

  it("pulling the PC's cord on a running machine cuts the power: a hard power-off, and the button refuses until it is back", () => {
    const g = assembled();
    bootWithKey(g);
    ticks(g, 40);
    expect(g.powered).toBe(true);
    expect(g.disconnectCable('pcmains').ok).toBe(true);
    expect(g.powered).toBe(false);
    expect(g.currentPhase()).toBe('off');
    expect(refusal(g.powerButton())).toMatch(/power cord/u);
    expect(g.snapshot().noPowerReason).toMatch(/power cord/u);
    g.connectCable('pcmains');
    expect(g.powerButton().ok).toBe(true);
  });

  it("without the monitor's cord the screen is dark (not NO SIGNAL) and the machine keeps running", () => {
    const g = assembled();
    g.disconnectCable('monmains');
    bootWithKey(g);
    ticks(g, 30);
    let s = g.snapshot();
    expect(s.powered).toBe(true);
    expect(s.monitorLive).toBe(false);
    expect(s.monitorPowered).toBe(false);
    g.connectCable('monmains');
    s = g.snapshot();
    expect(s.monitorLive).toBe(true);
    expect(s.monitorPowered).toBe(true);
  });

  it('the wall meters what the machine draws while it is on, and a monitor with its cord out draws nothing', () => {
    const g = assembled();
    expect(g.snapshot().energy).toStrictEqual({ wallW: 0, wh: 0 });
    bootWithKey(g);
    ticks(g, 60);
    const a = g.snapshot().energy;
    expect(a.wallW).toBeGreaterThan(0);
    expect(a.wh).toBeGreaterThan(0);
    ticks(g, 60);
    expect(g.snapshot().energy.wh).toBeGreaterThan(a.wh);
    g.disconnectCable('monmains');
    ticks(g, 2);
    expect(g.snapshot().energy.wallW).toBeLessThan(a.wallW);
    g.powerButton();
    ticks(g, 2);
    expect(g.snapshot().energy.wallW).toBe(0);
  });

  it('a save from before the cords loads with both plugged', () => {
    const g = assembled();
    const save = structuredClone(g.toSave());
    delete save.cables['pcmains'];
    delete save.cables['monmains'];
    const progress = Object.fromEntries(Object.entries(save.progress).filter(([k]) => k !== 'mainsConnected'));
    const l = Game.fromSave({ ...save, progress });
    expect(cords(l).every((c) => c.connected)).toBe(true);
    expect(l.snapshot().progress.mainsConnected).toBe(true);
  });

  it('a save from before the cords has none plugged for a part it lacks (no monitor, no monitor cord)', () => {
    const g = assembled();
    g.uninstall(must(g.snapshot().devices.find((d) => d.kind === 'display')).id);
    const save = structuredClone(g.toSave());
    delete save.cables['pcmains'];
    delete save.cables['monmains'];
    const l = Game.fromSave(save);
    expect(cords(l).map((c) => [c.id, c.connected])).toStrictEqual([
      ['pcmains', true],
      ['monmains', false],
    ]);
  });
});
