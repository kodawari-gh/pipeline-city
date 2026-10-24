import { describe, expect, it } from 'vitest';
import type { OsSnap, StorageSnap } from '../sim/game/game';
import type { Progress } from '../sim/game/save';
import { newProgress } from '../sim/game/save';
import {
  currentStep, effectiveProgress, INITIAL_TUTORIAL, legacyFinished, offerNextLesson, resumeState, STEPS, stepCount,
  stepProblem, type TutorialState,
} from './tutorial';
import { dev, key, snap, STARTER_CRATE } from './testdata';

const welcomed: TutorialState = { ...INITIAL_TUTORIAL, welcomed: true };
/** The first fourteen flags, in the order the player meets them (the pre-OS tutorial: key in first, then power, then the manual cycle). */
const OLD_IN_ORDER: Array<keyof Progress> = [
  'cpuInstalled', 'coolerInstalled', 'ramInstalled', 'psuInstalled', 'monitorInstalled', 'atxConnected', 'cpuPowerConnected',
  'videoConnected', 'firstKeyPlugged', 'poweredOn', 'firstJobDone', 'firstKeyEjected', 'firstManualCycle', 'firstPurchase',
];
const oldUpTo = (n: number): Progress => {
  const p = newProgress(false);
  for (const f of OLD_IN_ORDER.slice(0, n)) p[f] = true;
  return p;
};
const idOf = (s: ReturnType<typeof currentStep>) => s?.id ?? null;
const oldDone = () => oldUpTo(14);

const drive = (o: Partial<StorageSnap> = {}): StorageSnap => ({
  deviceId: 'dev-hdd', slot: 'sata0', spec: 'hdd0', name: 'HDD 96K', burnt: false, capacityBytes: 96 * 1024,
  usedBytes: 0, bytesRead: 0, bytesWritten: 0, busy: false, latencyTicks: 720, blockTicks: 72, bytesPerSecond: 3600,
  hasOs: false, ...o,
});
const osOn = (o: Partial<OsSnap> = {}): OsSnap => ({
  spec: 'os1', tier: 1, name: 'Resident OS 1.0', deviceId: 'dev-hdd', slot: 'sata0', programSlots: 1, queueSlots: 4,
  up: true, queue: [], runningKeyId: null, ...o,
});
/** The old tutorial done, a CPU and RAM bought, with `extra` on top. */
/** The level block at level `n` (the OS lesson needs Level 3: the 'Grow your client base' step waits for it). */
const atLevel = (n: number) => ({ ...snap().level, level: n });
const afterSpend = (extra: Partial<Parameters<typeof snap>[0]> = {}) => snap({ progress: oldDone(), money: 500, inventory: [], level: atLevel(3), ...extra });
const invItem = (kind: string, spec: string, id: string, freeSlots: string[] = []) => ({
  id, spec, kind: kind as 'ram', name: spec, freeSlots, swapSlots: [], installable: freeSlots.length > 0,
});

describe('the sandbox has no tutorial', () => {
  it('a sandbox game (all flags set) shows no step and no OS lesson offer', () => {
    const s = snap({ sandbox: true, progress: newProgress(true) });
    expect(currentStep(s, INITIAL_TUTORIAL)).toBeNull();
    expect(offerNextLesson(s, INITIAL_TUTORIAL)).toBe(false);
  });

  it('a campaign game with the same flags still gets the offer', () => {
    expect(offerNextLesson(snap({ progress: newProgress(true) }), INITIAL_TUTORIAL)).toBe(true);
  });
});

describe('tutorial step from snapshot flags', () => {
  it('a new game opens on the welcome card', () => {
    expect(idOf(currentStep(snap(), INITIAL_TUTORIAL))).toBe('welcome');
  });

  it('after welcome, with nothing done, it asks for the processor', () => {
    expect(idOf(currentStep(snap(), welcomed))).toBe('cpu');
  });

  it('walks the old steps in order as flags come in, then the OS steps', () => {
    const order = ['cpu', 'cooler', 'ram', 'psu', 'monitor', 'atx', 'cpuPower', 'video', 'plugKey', 'power', 'watch', 'removeKey', 'cycle', 'spend'];
    for (let n = 0; n < OLD_IN_ORDER.length; n++) {
      expect(idOf(currentStep(snap({ progress: oldUpTo(n) }), welcomed)), `after ${n} flags`).toBe(order[n]);
    }
  });

  it('the old flags alone are not the end: the next step is fitting the bought part', () => {
    expect(idOf(currentStep(snap({ progress: oldDone() }), welcomed))).toBe('fit');
  });

  it('the final card shows once the OS job is paid out', () => {
    const s = snap({
      progress: { ...oldDone(), storageInstalled: true, osInstalled: true, firstOsJob: true },
      storage: [drive({ hasOs: true })], os: osOn(), inventory: [],
    });
    expect(idOf(currentStep(s, welcomed))).toBe('done');
  });

  it('skipped and finished tutorials show nothing', () => {
    expect(currentStep(snap(), { ...welcomed, skipped: true })).toBeNull();
    expect(currentStep(snap(), { ...welcomed, finished: true, osLesson: true })).toBeNull();
  });

  it('resumes mid-way from a loaded save, without the welcome card again', () => {
    // A save where the CPU, cooler, RAM, PSU, monitor and ATX cable are already in: resume at the CPU power cable.
    const s = snap({ progress: oldUpTo(6) });
    const step = currentStep(s, INITIAL_TUTORIAL);
    expect(step?.id).toBe('cpuPower');
    expect(stepCount(step!)).toEqual({ n: 7, total: 14 + 12 });
  });

  it('resumes at the drive step from a save that has the bought part fitted and no drive yet', () => {
    const s = afterSpend({ inventory: [], storage: [], os: null });
    expect(idOf(currentStep(s, welcomed))).toBe('buyDrive');
  });

  it('waits at the client-base step below Level 3, and the step is done at Level 3 or once a drive is owned', () => {
    const low = afterSpend({ level: atLevel(2) });
    expect(idOf(currentStep(low, welcomed))).toBe('reachLevel3');
    expect(idOf(currentStep(afterSpend({ level: atLevel(3) }), welcomed))).toBe('buyDrive');
    // A player who already owns a drive (an older save) is not sent back to wait.
    expect(idOf(currentStep(afterSpend({ level: atLevel(1), storage: [drive()] }), welcomed))).not.toBe('reachLevel3');
  });

  it('resumes at the OS install from a save with a drive installed and the OS bought', () => {
    const s = afterSpend({
      progress: { ...oldDone(), storageInstalled: true },
      storage: [drive()],
      inventory: [invItem('os', 'os1', 'inv9')],
    });
    expect(idOf(currentStep(s, welcomed))).toBe('os');
  });

  it('resumes while the machine is booting the OS from the drive', () => {
    const s = afterSpend({ progress: { ...oldDone(), storageInstalled: true, osInstalled: true }, storage: [drive({ hasOs: true })], os: osOn(), phase: 'booting-os', powered: true });
    expect(idOf(currentStep(s, welcomed))).toBe('bootOs');
  });

  it('out of order: parts placed before the earlier ones are skipped past, not repeated', () => {
    // The player installs the PSU and monitor first. The CPU is still the first thing to ask for.
    const p = newProgress(false);
    p.psuInstalled = true;
    p.monitorInstalled = true;
    expect(idOf(currentStep(snap({ progress: p }), welcomed))).toBe('cpu');
    // Then the CPU and RAM: the next open step is the ATX cable, not the PSU again.
    p.cpuInstalled = true;
    p.coolerInstalled = true;
    p.ramInstalled = true;
    expect(idOf(currentStep(snap({ progress: p }), welcomed))).toBe('atx');
  });

  it('out of order: the cooler needs the CPU, and the power step waits for the cooler', () => {
    // CPU in, cooler not yet: the cooler step comes before RAM, and power is not offered.
    const p = newProgress(false);
    p.cpuInstalled = true;
    expect(idOf(currentStep(snap({ progress: p }), welcomed))).toBe('cooler');
    // Everything but the cooler is done: still the cooler, not the power button.
    const q = { ...oldUpTo(14), coolerInstalled: false, poweredOn: false, firstKeyPlugged: false, firstJobDone: false, firstKeyEjected: false, firstManualCycle: false, firstPurchase: false };
    expect(idOf(currentStep(snap({ progress: q }), welcomed))).toBe('cooler');
    // A legacy save (cooler pre-mounted, flag derived true) skips the step.
    expect(idOf(currentStep(snap({ progress: oldUpTo(2) }), welcomed))).toBe('ram');
  });

  it('the cooler step shows the sim reason when it is dragged too early or power is pressed without it', () => {
    const step = STEPS.find((x) => x.id === 'cooler')!;
    const cooler = { id: 'inv5', spec: 'cooler0', kind: 'cooler' as const, name: 'Stock heatsink', freeSlots: [], swapSlots: [], installable: false, reason: 'install the CPU first: the cooler mounts on it' };
    expect(stepProblem(snap({ inventory: [cooler] }), step)).toMatch(/install the CPU first/);
    expect(stepProblem(snap({ phase: 'error', powered: true, postBlocker: 'no CPU cooler installed: it mounts on the CPU' }), step)).toMatch(/machine is on/);
    expect(stepProblem(snap({ phase: 'error', powered: false, postBlocker: 'no CPU cooler installed: it mounts on the CPU' }), step)).toMatch(/no CPU cooler/);
    expect(step.targets(snap({ inventory: [{ ...cooler, freeSlots: ['cooler0'], installable: true }] }))).toEqual(['inventory', 'inv:inv5', 'cooler0']);
  });

  it('out of order: a job served before the power was ever pressed still points at the power button', () => {
    const p = newProgress(false);
    p.firstKeyPlugged = true;
    expect(idOf(currentStep(snap({ progress: p }), welcomed))).toBe('cpu');
  });

  it('out of order: the OS bought before the drive is installed still asks for the drive first', () => {
    // A drive is owned (in the inventory) and the OS is bought too: the install of the drive comes first.
    const s = afterSpend({ storage: [], inventory: [invItem('storage', 'hdd0', 'inv5', ['sata0']), invItem('os', 'os1', 'inv6')] });
    expect(idOf(currentStep(s, welcomed))).toBe('drive');
  });

  it('out of order: an OS installed before the drive step was seen is simply skipped past', () => {
    const s = afterSpend({ progress: { ...oldDone(), osInstalled: true, storageInstalled: true }, storage: [drive({ hasOs: true })], os: osOn() });
    expect(idOf(currentStep(s, welcomed))).toBe('bootOs');
  });

  it('a machine powered off during the OS boot goes back to the power button', () => {
    const s = afterSpend({ progress: { ...oldDone(), storageInstalled: true, osInstalled: true }, storage: [drive({ hasOs: true })], os: osOn(), phase: 'off' });
    expect(idOf(currentStep(s, welcomed))).toBe('bootOs');
  });

  it('a migrated save with every old flag set and no welcome shows the offer, not the full flow', () => {
    const s = snap({ progress: newProgress(true) });
    expect(currentStep(s, INITIAL_TUTORIAL)).toBeNull();
    expect(offerNextLesson(s, INITIAL_TUTORIAL)).toBe(true);
  });

  it('every flag-driven step names a real progress key, and the step ids are unique', () => {
    const ids = STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys: string[] = Object.keys(newProgress(false));
    for (const s of STEPS) if (s.flag) expect(keys).toContain(s.flag);
  });
});

describe('the OS lesson for players who finished the first tutorial', () => {
  const finishedOld: TutorialState = { ...INITIAL_TUTORIAL, welcomed: true, finished: true };

  it('is not forced through: no step, and one offer', () => {
    const s = snap({ progress: oldDone() });
    expect(legacyFinished(s, finishedOld)).toBe(true);
    expect(currentStep(s, finishedOld)).toBeNull();
    expect(offerNextLesson(s, finishedOld)).toBe(true);
  });

  it('taking the lesson starts at the drive step (the finished steps stay done)', () => {
    const taken: TutorialState = { ...finishedOld, finished: false, osLesson: true, offered: true };
    const s = afterSpend();
    expect(idOf(currentStep(s, taken))).toBe('buyDrive');
    expect(offerNextLesson(s, taken)).toBe(false);
  });

  it('dismissing it never offers it again', () => {
    const declined: TutorialState = { ...finishedOld, osLesson: false, offered: true };
    expect(offerNextLesson(snap({ progress: oldDone() }), declined)).toBe(false);
    expect(currentStep(snap({ progress: oldDone() }), declined)).toBeNull();
  });

  it('a skipped old tutorial is not offered the lesson', () => {
    expect(offerNextLesson(snap({ progress: oldDone() }), { ...finishedOld, skipped: true })).toBe(false);
  });

  it('a player who has the lesson (finished the new tutorial) is never offered it', () => {
    const doneNew: TutorialState = { ...finishedOld, osLesson: true };
    expect(legacyFinished(snap({ progress: oldDone() }), doneNew)).toBe(false);
    expect(offerNextLesson(snap({ progress: oldDone() }), doneNew)).toBe(false);
  });

  it('a player still in the old tutorial at its last card continues into the OS steps', () => {
    expect(idOf(currentStep(snap({ progress: oldDone() }), welcomed))).toBe('fit');
  });

  it('a new game is not treated as finished', () => {
    expect(offerNextLesson(snap(), INITIAL_TUTORIAL)).toBe(false);
  });
});

describe('the OS steps (live state and phases)', () => {
  it('buying a drive is done as soon as one is owned, and the install step follows', () => {
    const s = afterSpend({ inventory: [invItem('storage', 'hdd0', 'inv5', ['sata0'])] });
    expect(idOf(currentStep(s, welcomed))).toBe('drive');
    expect(STEPS.find((x) => x.id === 'drive')!.targets(s)).toEqual(['inv:inv5', 'sata0']);
  });

  it('the OS is owned once bought: the next step installs it on the drive', () => {
    const s = afterSpend({ progress: { ...oldDone(), storageInstalled: true }, storage: [drive()], inventory: [invItem('os', 'os1', 'inv6', ['sata0'])] });
    expect(idOf(currentStep(s, welcomed))).toBe('os');
    expect(STEPS.find((x) => x.id === 'os')!.targets(s)).toEqual(['inv:inv6', 'sata0']);
  });

  it('the boot step is done in any running OS phase, and points at the monitor and the OS badge', () => {
    const s = afterSpend({ progress: { ...oldDone(), storageInstalled: true, osInstalled: true }, storage: [drive({ hasOs: true })], os: osOn(), phase: 'idle-os', powered: true });
    expect(idOf(currentStep(s, welcomed))).toBe('osIngest');
    expect(STEPS.find((x) => x.id === 'bootOs')!.targets(s)).toEqual(['power', 'monitor', 'os']);
  });

  const osFlow = (extra: Partial<Parameters<typeof snap>[0]>) =>
    afterSpend({ progress: { ...oldDone(), storageInstalled: true, osInstalled: true }, storage: [drive({ hasOs: true })], os: osOn(), powered: true, phase: 'ingesting', ...extra });

  it('a key ingested by the OS and unplugged is held; the step after is waiting for its result', () => {
    const held = key({ id: 7, stage: 'queued' });
    const s = osFlow({ held: [held] });
    expect(idOf(currentStep(s, welcomed))).toBe('osWait');
    expect(STEPS.find((x) => x.id === 'osWait')!.targets(s)).toEqual(['os', 'held']);
  });

  it('a key plugged and queued: the next step is to unplug it', () => {
    const s = osFlow({ plugged: key({ id: 7, stage: 'queued' }) });
    expect(idOf(currentStep(s, welcomed))).toBe('osHold');
  });

  it('a key still being copied is not yet ingested', () => {
    const s = osFlow({ plugged: key({ id: 7, stage: 'ingesting' }), tray: [] });
    expect(idOf(currentStep(s, welcomed))).toBe('osIngest');
  });

  it('a held key with its result: collect it by plugging it back in', () => {
    const s = osFlow({ held: [key({ id: 7, stage: 'result' })] });
    expect(idOf(currentStep(s, welcomed))).toBe('osCollect');
    expect(STEPS.find((x) => x.id === 'osCollect')!.targets(s)).toEqual(['usb', 'key:7']);
  });

  it('a result being flashed onto the plugged key, then removed to get paid', () => {
    expect(idOf(currentStep(osFlow({ plugged: key({ id: 7, stage: 'flashing' }) }), welcomed))).toBe('osPaid');
  });

  it('keys held when the machine powers off go back to the tray: the job is lost and the step shows again', () => {
    const s = afterSpend({ progress: { ...oldDone(), storageInstalled: true, osInstalled: true }, storage: [drive({ hasOs: true })], os: osOn(), powered: false, phase: 'off', tray: [key({ id: 7 })] });
    expect(idOf(currentStep(s, welcomed))).toBe('bootOs');
  });

  it('a job the OS delivered sets the final flag; the last card is then the one to show', () => {
    const p = effectiveProgress(afterSpend({ progress: { ...oldDone(), firstOsJob: true } }), INITIAL_TUTORIAL);
    expect(p.firstOsJob).toBe(true);
  });
});

describe('replay', () => {
  // Replay: every flag is already true in the save, so the steps are judged from live state and deltas.
  const replay: TutorialState = { ...INITIAL_TUTORIAL, welcomed: true, osLesson: true, replay: { completed: 2, owned: 5 } };

  it('judges installs from live state, not the sticky flags', () => {
    const s = snap({ progress: newProgress(true), devices: [] });
    expect(idOf(currentStep(s, replay))).toBe('cpu');
  });

  it('a part that is installed right now is skipped', () => {
    const s = snap({ progress: newProgress(true), devices: [dev({ kind: 'cpu' })] });
    expect(idOf(currentStep(s, replay))).toBe('cooler'); // the cooler is not mounted yet
    const s2 = snap({ progress: newProgress(true), devices: [dev({ kind: 'cpu' }), dev({ id: 'dc', kind: 'cooler', slot: 'cooler0' })] });
    expect(idOf(currentStep(s2, replay))).toBe('ram');
  });

  it('a new key ejected since the replay started finishes the removal step', () => {
    const s = snap({ progress: newProgress(true), completed: 3 });
    const p = effectiveProgress(s, replay);
    expect(p.firstKeyEjected).toBe(true);
    expect(p.firstPurchase).toBe(false);
  });

  it('a purchase since the replay started counts', () => {
    const s = snap({ progress: newProgress(true), inventory: [...STARTER_CRATE, { ...STARTER_CRATE[0]!, id: 'inv9' }] });
    expect(effectiveProgress(s, { ...replay, replay: { completed: 0, owned: 5 } }).firstPurchase).toBe(true);
  });

  it('a replay does not show the welcome card a second time once welcomed', () => {
    const s = snap({ progress: newProgress(true) });
    expect(idOf(currentStep(s, { ...replay, welcomed: true }))).not.toBe('welcome');
  });
});

describe('effectiveProgress', () => {
  it('uses the sticky flags outside a replay', () => {
    const p = oldUpTo(3);
    expect(effectiveProgress(snap({ progress: p }), INITIAL_TUTORIAL)).toEqual(p);
  });

  it('a plugged key that is already done counts as the job done', () => {
    const k = key({ done: true });
    const p = effectiveProgress(snap({ plugged: k }), { ...INITIAL_TUTORIAL, replay: { completed: 0, owned: 5 } });
    expect(p.firstKeyPlugged).toBe(true);
    expect(p.firstJobDone).toBe(true);
  });
});

describe('stepProblem: why a step is stuck, in the sim\'s own words', () => {
  const step = (id: string) => STEPS.find((x) => x.id === id)!;

  it('the CPU step explains a refusal when the machine is on', () => {
    const s = snap({ powered: true, phase: 'halted', haltReason: 'no-boot-media' });
    expect(stepProblem(s, step('cpu'))).toMatch(/Press the power button to switch it off/);
  });

  it('the cable step shows the cable\'s blocked reason', () => {
    expect(stepProblem(snap(), step('atx'))).toMatch(/power supply is not installed/);
  });

  it('the power step shows the power button refusal', () => {
    expect(stepProblem(snap(), step('power'))).toMatch(/Install a power supply/);
  });

  it('the key step waits for a key; a running machine would ignore it, an off machine is the right moment', () => {
    const plug = step('plugKey');
    expect(stepProblem(snap(), plug)).toMatch(/No key yet/);
    expect(stepProblem(snap({ tray: [key()] }), plug)).toBeNull();
    expect(stepProblem(snap({ tray: [key()], powered: true }), plug)).toMatch(/already on.*Power it off/);
  });

  it('the power step warns about a missing key (NO BOOT MEDIA) and shows POST errors as such', () => {
    const power = step('power');
    expect(stepProblem(snap({ noPowerReason: null }), power)).toMatch(/NO BOOT MEDIA/);
    expect(stepProblem(snap({ noPowerReason: null, plugged: key() }), power)).toBeNull();
    expect(stepProblem(snap({ noPowerReason: null, powered: true, phase: 'error', phaseReason: 'no CPU installed', postFailed: true }), power)).toMatch(/POST error: no CPU installed/);
  });

  it('the watch step explains an ignored key, and the cycle step walks through the manual loop', () => {
    expect(stepProblem(snap({ powered: true, phase: 'halted', haltReason: 'no-boot-media', plugged: key(), keyIgnored: true }), step('watch'))).toMatch(/only looks at boot/);
    const cycle = step('cycle');
    expect(stepProblem(snap({ tray: [key()] }), cycle)).toMatch(/Plug the next key/);
    expect(stepProblem(snap({ plugged: key(), powered: true, phase: 'halted' }), cycle)).toMatch(/Press the power button/);
    expect(stepProblem(snap({ plugged: key() }), cycle)).toBeNull();
  });

  it('no problem on the welcome card', () => {
    expect(stepProblem(snap(), STEPS[0]!)).toBeNull();
  });

  it('buying a drive says what is missing: money, or a blocked reason', () => {
    const hdd = { id: 'hdd0', name: 'HDD 96K', kind: 'storage' as const, price: 40, affordable: false };
    expect(stepProblem(afterSpend({ money: 10, purchases: [hdd] }), step('buyDrive'))).toBe('Need $30 more.');
    expect(stepProblem(afterSpend({ money: 10, purchases: [{ ...hdd, blocked: 'the board has no SATA slot' }] }), step('buyDrive')))
      .toBe('the board has no SATA slot');
  });

  it('buying the OS says what blocks it (memory, a drive)', () => {
    const os = { id: 'os1', name: 'Resident OS 1.0', kind: 'os' as const, price: 150, affordable: true, blocked: 'needs 32K of RAM' };
    expect(stepProblem(afterSpend({ purchases: [os] }), step('buyOs'))).toBe('needs 32K of RAM');
  });

  it('the boot step says the machine must be on, and shows the sim\'s reason if it stops', () => {
    expect(stepProblem(afterSpend({ progress: oldDone(), phase: 'off', powered: false }), step('bootOs'))).toMatch(/machine is off/);
    expect(stepProblem(afterSpend({ progress: oldDone(), phase: 'error', powered: true, phaseReason: 'the OS drive burnt out' }), step('bootOs')))
      .toBe('the OS drive burnt out');
  });

  it('the drive and OS install steps refuse while the machine is on', () => {
    const s = afterSpend({ powered: true, phase: 'idle-os', inventory: [invItem('storage', 'hdd0', 'inv5', ['sata0'])] });
    expect(stepProblem(s, step('drive'))).toMatch(/Power it off first/);
  });
});

describe('step targets (what the renderer pulses)', () => {
  it('installing the CPU pulses its crate item and the socket it fits', () => {
    const cpu = STEPS.find((x) => x.id === 'cpu')!;
    expect(cpu.targets(snap())).toEqual(['inv:inv1', 'cpu0']);
  });

  it('no step points at the old crate: the welcome card highlights the inventory button', () => {
    for (const step of STEPS) {
      expect(step.targets(snap({ devices: [dev()] })), step.id).not.toContain('crate');
    }
    expect(STEPS[0]!.targets(snap())).toEqual(['inventory']);
  });

  it('install steps point at their inventory items (inv:) and the socket, and the last card points nowhere', () => {
    expect(STEPS.find((x) => x.id === 'ram')!.targets(snap())).toEqual(['inv:inv3', 'dimm0', 'dimm1']);
    expect(STEPS.find((x) => x.id === 'spend')!.targets(snap())).toEqual(['inventory']);
    expect(STEPS.find((x) => x.id === 'done')!.targets(snap())).toEqual([]);
  });

  it('the power step pulses the button; the key step pulses the USB port and the key', () => {
    expect(STEPS.find((x) => x.id === 'power')!.targets(snap())).toEqual(['power']);
    expect(STEPS.find((x) => x.id === 'plugKey')!.targets(snap({ tray: [key({ id: 9 })] }))).toEqual(['usb', 'key:9']);
  });

  it('the drive bay is the target of the buy-a-drive and buy-an-OS steps (the OS is offered there)', () => {
    expect(STEPS.find((x) => x.id === 'buyDrive')!.targets(snap())).toEqual(['bay']);
    expect(STEPS.find((x) => x.id === 'buyOs')!.targets(snap())).toEqual(['bay']);
  });
});

describe('persisted tutorial state', () => {
  it('reads a stored object and ignores junk', () => {
    expect(resumeState({ welcomed: true, skipped: true, finished: false, replay: { completed: 1, owned: 4 }, osLesson: true, offered: true })).toEqual({
      welcomed: true, skipped: true, finished: false, replay: { completed: 1, owned: 4 }, osLesson: true, offered: true,
    });
    expect(resumeState('nonsense')).toEqual(INITIAL_TUTORIAL);
    expect(resumeState({ replay: { completed: 'x' } })).toEqual({ ...INITIAL_TUTORIAL, replay: null });
  });

  it('a state saved before the OS lesson existed reads as not having it', () => {
    expect(resumeState({ welcomed: true, finished: true })).toEqual({ ...INITIAL_TUTORIAL, welcomed: true, finished: true });
  });
});
