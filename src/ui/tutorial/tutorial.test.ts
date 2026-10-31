import { describe, expect, it } from 'vitest';
import type { OsSnap, StorageSnap } from '../../sim/game/game';
import type { Progress } from '../../sim/game/save';
import { newProgress } from '../../sim/game/save';
import {
  currentStep, effectiveProgress, INITIAL_TUTORIAL, legacyFinished, offerNextLesson, resumeState, STEPS, stepCount,
  stepProblem, tutorialForSave, type TutorialState,
} from './tutorial';
import { describeId } from '../logic';
import { boardSnap, dev, key, snap, STARTER_CRATE } from '../testdata';

const welcomed: TutorialState = { ...INITIAL_TUTORIAL, welcomed: true };
/** The first fifteen flags, in the order the player meets them (the pre-OS tutorial: key in first, then power, then the manual cycle). */
const OLD_IN_ORDER: Array<keyof Progress> = [
  'cpuInstalled', 'coolerInstalled', 'ramInstalled', 'psuInstalled', 'monitorInstalled', 'atxConnected', 'cpuPowerConnected',
  'videoConnected', 'mainsConnected', 'firstKeyPlugged', 'poweredOn', 'firstJobDone', 'firstKeyEjected', 'firstManualCycle', 'firstPurchase',
];
const oldUpTo = (n: number): Progress => {
  const p = newProgress(false);
  for (const f of OLD_IN_ORDER.slice(0, n)) p[f] = true;
  return p;
};
const idOf = (s: ReturnType<typeof currentStep>) => s?.id ?? null;
const oldDone = () => oldUpTo(15);

const drive = (o: Partial<StorageSnap> = {}): StorageSnap => ({
  deviceId: 'dev-hdd', slot: 'sata0', spec: 'hdd0', name: 'HDD 96K', burnt: false, capacityBytes: 96 * 1024,
  usedBytes: 0, bytesRead: 0, bytesWritten: 0, busy: false, latencyTicks: 720, blockTicks: 72, bytesPerSecond: 3600,
  hasOs: false, fs: { runs: [], fragmentation: 0, byKind: { os: 0, spool: 0, program: 0, dataset: 0, meta: 0 } },
  wearPct: 0, badGroups: 0, lostBlocks: 0, queueDepth: 2, queued: 0, mirror: false,
  mount: { state: 'unformatted', phase: 'unmounted', progress: 0 }, format: { why: null, datasets: 0 }, ...o,
});
const osOn = (o: Partial<OsSnap> = {}): OsSnap => ({
  spec: 'os1', tier: 1, name: 'Resident OS 1.0', deviceId: 'dev-hdd', slot: 'sata0', programSlots: 1, queueSlots: 4,
  up: true, queue: [], runningKeyId: null, spool: { slotBytes: 4096, slots: 4, used: 0, freeBytes: 0, full: false }, ...o,
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
    // the four cables are one step, the two wall cords the next; the key leaves by itself, so the watch step ends on its removal
    const order = ['cpu', 'cooler', 'ram', 'psu', 'monitor', 'cables', 'cables', 'cables', 'wall', 'plugKey', 'watch', 'watch', 'watch', 'money', 'spend'];
    for (let n = 0; n < OLD_IN_ORDER.length; n++) {
      expect(idOf(currentStep(snap({ progress: oldUpTo(n) }), welcomed)), `after ${n} flags`).toBe(order[n]);
    }
  });

  it('after the first pay the three numbers are explained one by one, each ended by Got it, before the next key', () => {
    const paid = { progress: oldUpTo(13) }; // firstKeyEjected is the 13th flag
    const at = (acks: string[]) => idOf(currentStep(snap(paid), { ...welcomed, acks }));
    expect(at([])).toBe('money');
    expect(at(['money'])).toBe('reputation');
    expect(at(['money', 'reputation'])).toBe('level');
    expect(at(['money', 'reputation', 'level'])).toBe('cycle');
    // A player already past them (an older save) is not sent back.
    expect(idOf(currentStep(snap({ progress: oldUpTo(14) }), welcomed))).toBe('spend');
    expect(STEPS.filter((x) => x.ack).map((x) => x.targets(snap()))).toEqual([['hud:money'], ['hud:reputation'], ['hud:level']]);
  });

  it('the old flags alone are not the end: the next step is fitting the bought part', () => {
    expect(idOf(currentStep(snap({ progress: oldDone() }), welcomed))).toBe('fit');
  });

  it('after the OS job is paid out the network chapter follows, step by step, to the last card', () => {
    const base = { ...oldDone(), storageInstalled: true, osInstalled: true, firstOsJob: true };
    const net = (progress: Record<string, boolean>, extra: Partial<Parameters<typeof snap>[0]> = {}) => snap({
      progress: { ...base, ...progress }, storage: [drive({ hasOs: true })], os: osOn(), inventory: [], level: atLevel(4), ...extra,
    });
    const jackBoard = { ...snap().board, features: { ...snap().board.features, ethernetMbps: 100 } };
    const at = (s: ReturnType<typeof snap>) => idOf(currentStep(s, welcomed));
    expect(at(net({}, { level: atLevel(3) }))).toBe('reachLevel4');
    expect(at(net({}))).toBe('buyIsp');
    expect(at(net({ ispBought: true }))).toBe('buyRouter');
    expect(at(net({ ispBought: true }, { inventory: [invItem('router', 'router1', 'inv8', ['router'])] }))).toBe('placeRouter');
    expect(at(net({ ispBought: true, routerInstalled: true }))).toBe('buyCase');
    expect(at(net({ ispBought: true, routerInstalled: true }, { inventory: [{ ...invItem('case', 'case1', 'inv8'), freeSlots: ['case'] }] }))).toBe('fitCase');
    expect(at(net({ ispBought: true, routerInstalled: true }, { caseTier: 1 }))).toBe('buyBoard');
    expect(at(net({ ispBought: true, routerInstalled: true }, { caseTier: 1, inventory: [{ ...invItem('board', 'board1', 'inv9'), swapSlots: ['board'] }] }))).toBe('fitBoard');
    expect(at(net({ ispBought: true, routerInstalled: true }, { board: jackBoard }))).toBe('plugLan');
    expect(at(net({ ispBought: true, routerInstalled: true, lanConnected: true }, { board: jackBoard }))).toBe('linkUp');
    expect(at(net({ ispBought: true, routerInstalled: true, lanConnected: true, linkUp: true }, { board: jackBoard }))).toBe('firstNetJob');
    expect(at(net({ ispBought: true, routerInstalled: true, lanConnected: true, linkUp: true, firstNetJob: true }, { board: jackBoard }))).toBe('done');
  });

  it('the case can only be bought with the machine off, like the board: the power button first, then the Shop', () => {
    const step = STEPS.find((x) => x.id === 'buyCase')!;
    const purchases = [{ id: 'case1', name: 'Micro tower', kind: 'case' as const, price: 70, affordable: true }];
    expect(step.targets(snap({ powered: true, purchases }))).toEqual(['power']);
    expect(step.targets(snap({ powered: false, purchases }))).toEqual(['hud:shop', 'buy:case1']);
    expect(stepProblem(snap({ powered: true, purchases }), step)).toMatch(/power button/);
  });

  it('the board can only be bought with the machine off: the step lights the power button first, then the Shop', () => {
    const step = STEPS.find((x) => x.id === 'buyBoard')!;
    const purchases = [{ id: 'board1', name: 'Basic', kind: 'board' as const, price: 150, affordable: true }];
    expect(step.targets(snap({ powered: true, purchases }))).toEqual(['power']);
    expect(step.targets(snap({ powered: false, purchases }))).toEqual(['hud:shop', 'buy:board1']);
    expect(stepProblem(snap({ powered: true, purchases }), step)).toMatch(/power button/);
  });

  it('skipped and finished tutorials show nothing', () => {
    expect(currentStep(snap(), { ...welcomed, skipped: true })).toBeNull();
    expect(currentStep(snap(), { ...welcomed, finished: true, osLesson: true })).toBeNull();
  });

  it('resumes mid-way from a loaded save, without the welcome card again', () => {
    // A save where the CPU, cooler, RAM, PSU, monitor and two cables are already in: resume at the cables step (the third cable).
    const s = snap({ progress: oldUpTo(7) });
    const step = currentStep(s, INITIAL_TUTORIAL);
    expect(step?.id).toBe('cables');
    expect(stepCount(step!)).toEqual({ n: 6, total: 7, chapter: 'Build' });
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
    // Then the CPU and RAM: the next open step is the cables, not the PSU again.
    p.cpuInstalled = true;
    p.coolerInstalled = true;
    p.ramInstalled = true;
    expect(idOf(currentStep(snap({ progress: p }), welcomed))).toBe('cables');
  });

  it('out of order: the cooler needs the CPU, and the power step waits for the cooler', () => {
    // CPU in, cooler not yet: the cooler step comes before RAM, and power is not offered.
    const p = newProgress(false);
    p.cpuInstalled = true;
    expect(idOf(currentStep(snap({ progress: p }), welcomed))).toBe('cooler');
    // Everything but the cooler is done: still the cooler, not the power button.
    const q = { ...oldUpTo(15), coolerInstalled: false, poweredOn: false, firstKeyPlugged: false, firstJobDone: false, firstKeyEjected: false, firstManualCycle: false, firstPurchase: false };
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

  describe('the memory lesson before the OS', () => {
    const ramDev = (spec: string, slot = 'dimm1') => ({ id: 'dev3', spec, kind: 'ram', name: 'RAM', slot, burnt: false, requestedClock: null, effectiveClock: 1, tempC: 25, powerW: 1, throttle: 1, unstable: false });
    const base = { progress: { ...oldDone(), storageInstalled: true }, storage: [drive()] };
    const bigRam = (swap = ['dimm1']) => ({ ...invItem('ram', 'ram1', 'inv7'), swapSlots: swap });

    it('a machine with too little memory buys, then fits, a bigger stick before it buys the OS', () => {
      const short = afterSpend({ ...base, devices: [ramDev('ram0')] as never });
      expect(idOf(currentStep(short, welcomed))).toBe('buyRam');
      expect(STEPS.find((x) => x.id === 'buyRam')!.targets(short)).toEqual(['dimm1', 'buy:ram1']);
      const owned = afterSpend({ ...base, devices: [ramDev('ram0')] as never, inventory: [bigRam()] });
      expect(idOf(currentStep(owned, welcomed))).toBe('fitRam');
      expect(STEPS.find((x) => x.id === 'fitRam')!.targets(owned)).toEqual(['inv:inv7', 'dimm1']);
      const fitted = afterSpend({ ...base, devices: [ramDev('ram1')] as never });
      expect(idOf(currentStep(fitted, welcomed))).toBe('buyOs');
    });

    it('the general fit step leaves the memory to its own lesson', () => {
      const s = afterSpend({ ...base, devices: [ramDev('ram0')] as never, inventory: [bigRam()] });
      expect(STEPS.find((x) => x.id === 'fit')!.targets(s)).toEqual([]);
    });

    it('is skipped once the OS is bought, and says why the buy tile is stuck when money or the board is the problem', () => {
      const withOs = afterSpend({ ...base, devices: [ramDev('ram0')] as never, inventory: [invItem('os', 'os1', 'inv9')] });
      expect(idOf(currentStep(withOs, welcomed))).toBe('os');
      const ram = { id: 'ram1', name: 'DRAM 32K fast', kind: 'ram' as const, price: 100, affordable: false };
      expect(stepProblem(afterSpend({ ...base, money: 40, devices: [ramDev('ram0')] as never, purchases: [ram] }), STEPS.find((x) => x.id === 'buyRam')!)).toBe('Need $60 more.');
    });
  });

  it('the OS is owned once bought: the next step installs it on the drive', () => {
    const s = afterSpend({ progress: { ...oldDone(), storageInstalled: true }, storage: [drive()], inventory: [invItem('os', 'os1', 'inv6', ['sata0'])] });
    expect(idOf(currentStep(s, welcomed))).toBe('os');
    expect(STEPS.find((x) => x.id === 'os')!.targets(s)).toEqual(['inv:inv6', 'sata0']);
  });

  it('the boot step is done in any running OS phase, and points at the monitor and the OS badge', () => {
    const s = afterSpend({ progress: { ...oldDone(), storageInstalled: true, osInstalled: true }, storage: [drive({ hasOs: true })], os: osOn(), phase: 'idle-os', powered: true });
    expect(idOf(currentStep(s, welcomed))).toBe('osIngest');
    expect(STEPS.find((x) => x.id === 'bootOs')!.targets(s)).toEqual(['power']);
  });

  const osFlow = (extra: Partial<Parameters<typeof snap>[0]>) =>
    afterSpend({ progress: { ...oldDone(), storageInstalled: true, osInstalled: true }, storage: [drive({ hasOs: true })], os: osOn(), powered: true, phase: 'ingesting', ...extra });

  it('a key plugged and queued: the OS lesson waits for the result and the pay-out, nothing is held', () => {
    const s = osFlow({ plugged: key({ id: 7, stage: 'queued' }) });
    expect(idOf(currentStep(s, welcomed))).toBe('osPaid');
    expect(STEPS.find((x) => x.id === 'osPaid')!.targets(s)).toEqual(['monitor']);
  });

  it('a key still being copied is not yet ingested', () => {
    const s = osFlow({ plugged: key({ id: 7, stage: 'ingesting' }), tray: [] });
    expect(idOf(currentStep(s, welcomed))).toBe('osIngest');
  });

  it('a result being flashed onto the plugged key: still waiting for the pay-out', () => {
    expect(idOf(currentStep(osFlow({ plugged: key({ id: 7, stage: 'flashing' }) }), welcomed))).toBe('osPaid');
  });

  it('a key back in the tray after the machine powers off: the job is lost and the boot step shows again', () => {
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
    expect(stepProblem(snap(), step('cables'))).toMatch(/power supply is not installed/);
  });

  it('the key step waits for a key; a running machine would ignore it, an off machine is the right moment', () => {
    const plug = step('plugKey');
    expect(stepProblem(snap({ noPowerReason: null }), plug)).toMatch(/No key yet/);
    expect(stepProblem(snap({ noPowerReason: null, tray: [key()] }), plug)).toBeNull();
    expect(stepProblem(snap({ noPowerReason: null, tray: [key()], powered: true }), plug)).toMatch(/already on.*Power it off/);
    expect(stepProblem(snap({ tray: [key()] }), plug)).toMatch(/Install a power supply/); // plugging would start the machine: say why it cannot
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

  it('a part swap queued behind a running job is explained as waiting, and the pointer moves to the work', () => {
    const queued = { invId: 'inv5', slotId: null };
    const s = afterSpend({ powered: true, pendingSwap: queued, inventory: [invItem('storage', 'hdd0', 'inv5', ['sata0'])] });
    for (const id of ['fit', 'drive', 'os'] as const) {
      expect(stepProblem(s, step(id))).toMatch(/^Waiting for the running job/);
      expect(step(id).targets(s)).toEqual(['monitor']);
    }
  });

  it('the spend step says how much is missing when nothing can be afforded yet', () => {
    const p = (price: number, affordable: boolean) => ({ id: 'cpu1', name: 'CPU', kind: 'cpu' as const, price, affordable });
    expect(stepProblem(snap({ money: 50, purchases: [p(200, false)] }), step('spend'))).toMatch(/^Need \$150/);
    expect(stepProblem(snap({ money: 300, purchases: [p(200, true)] }), step('spend'))).toBeNull();
  });

  it('the drive and OS install steps do not ask for the machine to be off: the swap does that itself', () => {
    const s = afterSpend({ powered: true, phase: 'idle-os', inventory: [invItem('storage', 'hdd0', 'inv5', ['sata0'])] });
    expect(stepProblem(s, step('drive'))).toBeNull();
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
    const rich = snap({ purchases: [{ id: 'cpu1', name: 'CPU', kind: 'cpu' as const, price: 200, affordable: true }] });
    expect(STEPS.find((x) => x.id === 'spend')!.targets(rich)).toEqual(['hud:shop', 'buy:cpu1']);
    // Nothing is lit while the player cannot pay: the step's grey line says how much is missing.
    const poor = snap({ purchases: [{ id: 'cpu1', name: 'CPU', kind: 'cpu' as const, price: 200, affordable: false }] });
    expect(STEPS.find((x) => x.id === 'spend')!.targets(poor)).toEqual([]);
    expect(STEPS.find((x) => x.id === 'done')!.targets(snap())).toEqual([]);
  });

  it('the cable step lights one cable at a time: its plug and socket, not the devices', () => {
    const cables = (open: string[]) => ['atx', 'cpu', 'cpufan', 'video'].map((id) => ({ id, connected: !open.includes(id), blocked: null }));
    const targets = (open: string[]) => STEPS.find((x) => x.id === 'cables')!.targets(snap({ cables: cables(open) as never }));
    expect(targets(['atx', 'cpu', 'cpufan', 'video'])).toEqual(['cable.atx']);
    expect(targets(['cpu', 'cpufan', 'video'])).toEqual(['cable.cpu']);
    expect(targets(['cpufan', 'video'])).toEqual(['cable.cpufan']);
    expect(targets(['video'])).toEqual(['cable.video']);
    expect(targets([])).toEqual([]);
  });

  it('the wall step lights the PC cord first, then the monitor cord, with the socket they go into', () => {
    const cables = (open: string[]) => ['pcmains', 'monmains'].map((id) => ({ id, connected: !open.includes(id), blocked: null }));
    const targets = (open: string[]) => STEPS.find((x) => x.id === 'wall')!.targets(snap({ cables: cables(open) as never }));
    expect(targets(['pcmains', 'monmains'])).toEqual(['cable.pcmains', 'socket']);
    expect(targets(['monmains'])).toEqual(['cable.monmains', 'socket']);
    expect(targets([])).toEqual([]);
  });

  it('the key steps light the key until it is picked up, then only the port it goes into', () => {
    const grab = { kind: 'key' as const, id: 'key:9' };
    const withKey = snap({ tray: [key({ id: 9 })] });
    for (const id of ['plugKey', 'cycle', 'osIngest'] as const) {
      const step = STEPS.find((x) => x.id === id)!;
      expect(step.targets(withKey), `${id} before the grab`).toEqual(['key:9']);
      expect(step.targets(withKey, grab), `${id} while dragging`).toEqual(['usb']);
    }
    // No key yet: the tray is what to watch; nothing else is lit.
    expect(STEPS.find((x) => x.id === 'plugKey')!.targets(snap())).toEqual(['tray']);
  });

  it('while the client base grows, the next key is lit, then only the port during a drag; nothing when a key is already in', () => {
    const step = STEPS.find((x) => x.id === 'reachLevel3')!;
    expect(step.targets(snap({ tray: [key({ id: 4 })] }))).toEqual(['key:4']);
    expect(step.targets(snap({ tray: [key({ id: 4 })] }), { kind: 'key', id: 'key:4' })).toEqual(['usb']);
    expect(step.targets(snap({ plugged: key({ id: 4 }), tray: [key({ id: 5 })] }))).toEqual([]);
    expect(step.targets(snap())).toEqual([]);
  });

  it('the drive bay is the target of the buy-a-drive and buy-an-OS steps (the OS is offered there)', () => {
    expect(STEPS.find((x) => x.id === 'buyDrive')!.targets(snap())).toEqual(['bay', 'buy:hdd0']);
    expect(STEPS.find((x) => x.id === 'buyOs')!.targets(snap())).toEqual(['bay', 'buy:os1']);
  });
});

describe('step texts', () => {
  it('every step has its own text, and the welcome opens the game', () => {
    const texts = STEPS.map((x) => x.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(STEPS[0]!.text).toMatch(/^Welcome to Pipeline City!/);
    expect(STEPS.find((x) => x.id === 'cpu')!.text).toMatch(/processor/);
  });
});

describe('every step target names a real id', () => {
  /** Ids the renderer registers that are not described slots: buttons, the monitor, and the per-item `inv:`/`key:` ids. */
  const FIXED = new Set(['inventory', 'power', 'monitor']);
  const known = (id: string, s: ReturnType<typeof snap>) =>
    FIXED.has(id) || /^(inv|key|hud):\S+$/.test(id) || (id.startsWith('buy:') && describeId(id.slice(4), s) !== null) || describeId(id, s) !== null;

  it('the checker rejects an id that does not exist', () => {
    expect(known('routr', snap())).toBe(false);
    expect(known('router', snap())).toBe(true);
  });

  it('every target of every step is a real id', () => {
    const states = [
      snap(),
      snap({ inventory: [invItem('board', 'board1', 'inv2', ['cpu0']), invItem('ram', 'ram1', 'inv3', ['dimm1'])] }),
    ];
    for (const s of states) {
      for (const step of STEPS) for (const t of step.targets(s)) expect(known(t, s), `${step.id} targets ${t}`).toBe(true);
    }
  });
});

describe('persisted tutorial state', () => {
  it('reads a stored object and ignores junk', () => {
    expect(resumeState({ welcomed: true, skipped: true, finished: false, replay: { completed: 1, owned: 4 }, osLesson: true, offered: true })).toEqual({
      welcomed: true, skipped: true, finished: false, replay: { completed: 1, owned: 4 }, osLesson: true, offered: true, acks: [],
    });
    expect(resumeState('nonsense')).toEqual(INITIAL_TUTORIAL);
    expect(resumeState({ replay: { completed: 'x' } })).toEqual({ ...INITIAL_TUTORIAL, replay: null });
  });

  it('a state saved before the OS lesson existed reads as not having it', () => {
    expect(resumeState({ welcomed: true, finished: true })).toEqual({ ...INITIAL_TUTORIAL, welcomed: true, finished: true });
  });
});

describe('tutorial state in a save', () => {
  it('a state stored in the save wins (skipped, acks, replay baseline)', () => {
    const saved = { ...INITIAL_TUTORIAL, welcomed: true, skipped: true, acks: ['money'], replay: { completed: 2, owned: 5 } };
    expect(tutorialForSave(saved, newProgress(false))).toEqual(saved);
  });

  it('an older save mid-OS-lesson resumes the lesson instead of offering it', () => {
    const p = { ...oldDone(), storageInstalled: true };
    const st = tutorialForSave(undefined, p);
    expect(st).toMatchObject({ welcomed: true, osLesson: true, offered: true });
    expect(legacyFinished(snap({ progress: p }), st)).toBe(false);
    expect(offerNextLesson(snap({ progress: p }), st)).toBe(false);
  });

  it('an older save mid-way through the first lesson resumes without the welcome card', () => {
    const st = tutorialForSave(undefined, oldUpTo(6));
    expect(st.welcomed).toBe(true);
    expect(idOf(currentStep(snap({ progress: oldUpTo(6) }), st))).not.toBe('welcome');
  });

  it('an older save that finished the first lesson still gets the OS offer; a blank one starts at the welcome', () => {
    const done = snap({ progress: oldDone() });
    expect(offerNextLesson(done, tutorialForSave(undefined, oldDone()))).toBe(true);
    expect(idOf(currentStep(snap(), tutorialForSave(undefined, newProgress(false))))).toBe('welcome');
  });
});
