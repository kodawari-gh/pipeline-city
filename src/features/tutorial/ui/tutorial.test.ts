import { assert, describe, expect, it } from 'vitest';
import type { OsSnap, StorageSnap } from '@/worker/game/game';
import type * as saveTypes from '@/worker/game/save';
import { newProgress } from '@/worker/game/save';
import {
  currentStep,
  effectiveProgress,
  INITIAL_TUTORIAL,
  legacyFinished,
  offerNextLesson,
  resumeState,
  STEPS,
  stepCount,
  stepProblem,
  tutorialForSave,
} from './tutorial';
import type * as tutorialTypes from './tutorial';
import { describeId } from '@/core/ui/logic';
import { dev, EMPTY_SLOTS, key, snap, STARTER_CRATE, STOCK_COOLER } from '@/core/ui/testdata';

const welcomed: tutorialTypes.TutorialState = { ...INITIAL_TUTORIAL, welcomed: true };
/** The first fifteen flags, in the order the player meets them (the pre-OS tutorial: key in first, then power, then the manual cycle). */
const OLD_IN_ORDER: (keyof saveTypes.Progress)[] = [
  'cpuInstalled',
  'coolerInstalled',
  'ramInstalled',
  'psuInstalled',
  'monitorInstalled',
  'atxConnected',
  'cpuPowerConnected',
  'videoConnected',
  'mainsConnected',
  'firstKeyPlugged',
  'poweredOn',
  'firstJobDone',
  'firstKeyEjected',
  'firstManualCycle',
  'firstPurchase',
];
const oldUpTo = (n: number): saveTypes.Progress => {
  const p = newProgress(false);
  for (const f of OLD_IN_ORDER.slice(0, n)) {
    p[f] = true;
  }
  return p;
};
const idOf = (s: ReturnType<typeof currentStep>) => s?.id ?? null;
/** The id of the step the player is on. */
const stepOf = (s: ReturnType<typeof snap>, st: tutorialTypes.TutorialState) => idOf(currentStep(s, st));
/** The id of the step the player is on with these flags (nothing else done). */
const stepAfter = (progress: saveTypes.Progress, st: tutorialTypes.TutorialState) =>
  idOf(currentStep(snap({ progress }), st));
const oldDone = () => oldUpTo(15);

const drive = (o: Partial<StorageSnap> = {}): StorageSnap => ({
  deviceId: 'dev-hdd',
  slot: 'sata0',
  spec: 'hdd0',
  name: 'HDD 96K',
  burnt: false,
  capacityBytes: 96 * 1024,
  usedBytes: 0,
  bytesRead: 0,
  bytesWritten: 0,
  busy: false,
  latencyTicks: 720,
  blockTicks: 72,
  bytesPerSecond: 3600,
  hasOs: false,
  fs: { runs: [], fragmentation: 0, byKind: { os: 0, spool: 0, program: 0, dataset: 0, meta: 0 }, files: [] },
  wear: [],
  headLba: 0,
  cmds: [],
  wearPct: 0,
  badGroups: 0,
  lostBlocks: 0,
  queueDepth: 2,
  queued: 0,
  mirror: false,
  mount: { state: 'unformatted', phase: 'unmounted', progress: 0 },
  format: { why: null, datasets: 0 },
  ...o,
});
const osOn = (o: Partial<OsSnap> = {}): OsSnap => ({
  spec: 'os1',
  tier: 1,
  name: 'Resident OS 1.0',
  deviceId: 'dev-hdd',
  slot: 'sata0',
  programSlots: 1,
  queueSlots: 4,
  up: true,
  queue: [],
  runningKeyId: null,
  spool: { slotBytes: 4096, slots: 4, used: 0, freeBytes: 0, full: false },
  ...o,
});
/** The old tutorial done, a CPU and RAM bought, with `extra` on top. */
/** The level block at level `n` (the OS lesson needs Level 3: the 'Grow your client base' step waits for it). */
const atLevel = (n: number) => ({ ...snap().level, level: n });
const afterSpend = (extra: Partial<Parameters<typeof snap>[0]> = {}) =>
  snap({ progress: oldDone(), money: 500, inventory: [], level: atLevel(3), ...extra });
type InvItem = ReturnType<typeof snap>['inventory'][number];
type CableSnap = ReturnType<typeof snap>['cables'][number];
const invItem = (kind: InvItem['kind'], spec: string, id: string): InvItem => ({
  id,
  spec,
  kind,
  name: spec,
  freeSlots: [],
  swapSlots: [],
  installable: false,
});
/** `item`, fitting the free `slots` (installable when there is one). */
const fitsIn = (item: InvItem, freeSlots: string[]): InvItem => ({
  ...item,
  freeSlots,
  installable: freeSlots.length > 0,
});
/** The step the player is on after the welcome card. */
const welcomedStep = (s: ReturnType<typeof snap>) => stepOf(s, welcomed);
/** A RAM stick of `spec` fitted in `slot`. */
const ramDev = (spec: string, slot = 'dimm1') =>
  dev({
    id: 'dev3',
    spec,
    kind: 'ram',
    name: 'RAM',
    slot,
    burnt: false,
    requestedClock: null,
    effectiveClock: 1,
    tempC: 25,
    powerW: 1,
    throttle: 1,
    unstable: false,
  });
/** A bigger RAM stick in the inventory that can swap into `swap`. */
const bigRam = (swap = ['dimm1']) => ({ ...invItem('ram', 'ram1', 'inv7'), swapSlots: swap });
/** The OS installed and booted, ingesting, with `extra` on top. */
const osFlow = (extra: Partial<Parameters<typeof snap>[0]>) =>
  afterSpend({
    progress: { ...oldDone(), storageInstalled: true, osInstalled: true },
    storage: [drive({ hasOs: true })],
    os: osOn(),
    powered: true,
    phase: 'ingesting',
    ...extra,
  });
/** The step with this id (fails the test when there is none). */
const stepWithId = (id: string) => {
  const foundSTEPS = STEPS.find((x) => x.id === id);
  assert.exists(foundSTEPS);
  return foundSTEPS;
};
/** A CPU offer in the shop at `price`. */
const cpuOffer = (price: number, affordable: boolean) => ({
  id: 'cpu1',
  name: 'CPU',
  kind: 'cpu' as const,
  price,
  affordable,
});
/** These cables, all plugged in except the `open` ones. */
const cablesOpen = (ids: CableSnap['id'][], open: string[]): CableSnap[] =>
  ids.map((id) => ({ id, name: id, connected: !open.includes(id) }));
/** What the `stepId` step lights with these cables, all plugged in except the `open` ones. */
const cableTargets = (stepId: string, ids: CableSnap['id'][], open: string[]) =>
  stepWithId(stepId).targets(snap({ cables: cablesOpen(ids, open) }));
const cableStepTargets = (open: string[]) => cableTargets('cables', ['atx', 'cpu', 'cpufan', 'video'], open);
const wallStepTargets = (open: string[]) => cableTargets('wall', ['pcmains', 'monmains'], open);
/** The progress flags the steps are driven by. */
const stepFlags = () => STEPS.flatMap((s) => (s.flag === null ? [] : [s.flag]));

describe('the sandbox has no tutorial', () => {
  it('a sandbox game (all flags set) shows no step and no OS lesson offer', () => {
    const s = snap({ sandbox: true, progress: newProgress(true) });
    expect(currentStep(s, INITIAL_TUTORIAL)).toBeNull();
    expect(offerNextLesson(s, INITIAL_TUTORIAL)).toBe(false);
  });

  it('a campaign game with the same flags still gets the offer', () => {
    const allFlags = snap({ progress: newProgress(true) });
    expect(offerNextLesson(allFlags, INITIAL_TUTORIAL)).toBe(true);
  });
});

describe('tutorial step from snapshot flags', () => {
  it('a new game opens on the welcome card', () => {
    expect(stepOf(snap(), INITIAL_TUTORIAL)).toBe('welcome');
  });

  it('after welcome, with nothing done, it asks for the processor', () => {
    expect(stepOf(snap(), welcomed)).toBe('cpu');
  });

  it('walks the old steps in order as flags come in, then the OS steps', () => {
    // the four cables are one step, the two wall cords the next; the key leaves by itself, so the watch step ends on its removal
    const order = [
      'cpu',
      'cooler',
      'ram',
      'psu',
      'monitor',
      'cables',
      'cables',
      'cables',
      'wall',
      'plugKey',
      'watch',
      'watch',
      'watch',
      'money',
      'spend',
    ];
    for (let n = 0; n < OLD_IN_ORDER.length; n++) {
      expect(stepAfter(oldUpTo(n), welcomed), `after ${n} flags`).toBe(order[n]);
    }
  });

  it('after the first pay the three numbers are explained one by one, each ended by Got it, before the next key', () => {
    const paid = { progress: oldUpTo(13) }; // firstKeyEjected is the 13th flag
    const at = (acks: string[]) => stepOf(snap(paid), { ...welcomed, acks });
    expect(at([])).toBe('money');
    expect(at(['money'])).toBe('reputation');
    expect(at(['money', 'reputation'])).toBe('level');
    expect(at(['money', 'reputation', 'level'])).toBe('cycle');
    // A player already past them (an older save) is not sent back.
    expect(stepAfter(oldUpTo(14), welcomed)).toBe('spend');
    expect(STEPS.filter((x) => x.ack === true).map((x) => x.targets(snap()))).toStrictEqual([
      ['hud:money'],
      ['hud:reputation'],
      ['hud:level'],
    ]);
  });

  it('the old flags alone are not the end: the next step is fitting the bought part', () => {
    expect(stepAfter(oldDone(), welcomed)).toBe('fit');
  });

  it('after the OS job is paid out the network chapter follows, step by step, to the last card', () => {
    const base = { ...oldDone(), storageInstalled: true, osInstalled: true, firstOsJob: true };
    const net = (progress: Record<string, boolean>, extra: Partial<Parameters<typeof snap>[0]> = {}) =>
      snap({
        progress: { ...base, ...progress },
        storage: [drive({ hasOs: true })],
        os: osOn(),
        inventory: [],
        level: atLevel(4),
        ...extra,
      });
    const jackBoard = { ...snap().board, features: { ...snap().board.features, ethernetMbps: 100 } };
    const router = fitsIn(invItem('router', 'router1', 'inv8'), ['router']);
    const spareCase = { ...invItem('case', 'case1', 'inv8'), freeSlots: ['case'] };
    const spareBoard = { ...invItem('board', 'board1', 'inv9'), swapSlots: ['board'] };
    const level3 = net({}, { level: atLevel(3) });
    expect(welcomedStep(level3)).toBe('reachLevel4');
    expect(welcomedStep(net({}))).toBe('buyIsp');
    expect(welcomedStep(net({ ispBought: true }))).toBe('buyRouter');
    expect(welcomedStep(net({ ispBought: true }, { inventory: [router] }))).toBe('placeRouter');
    expect(welcomedStep(net({ ispBought: true, routerInstalled: true }))).toBe('buyCase');
    expect(welcomedStep(net({ ispBought: true, routerInstalled: true }, { inventory: [spareCase] }))).toBe('fitCase');
    expect(welcomedStep(net({ ispBought: true, routerInstalled: true }, { caseTier: 1 }))).toBe('buyBoard');
    expect(
      welcomedStep(net({ ispBought: true, routerInstalled: true }, { caseTier: 1, inventory: [spareBoard] })),
    ).toBe('fitBoard');
    expect(welcomedStep(net({ ispBought: true, routerInstalled: true }, { board: jackBoard }))).toBe('plugLan');
    expect(
      welcomedStep(net({ ispBought: true, routerInstalled: true, lanConnected: true }, { board: jackBoard })),
    ).toBe('linkUp');
    expect(
      welcomedStep(
        net({ ispBought: true, routerInstalled: true, lanConnected: true, linkUp: true }, { board: jackBoard }),
      ),
    ).toBe('firstNetJob');
    expect(
      welcomedStep(
        net(
          { ispBought: true, routerInstalled: true, lanConnected: true, linkUp: true, firstNetJob: true },
          { board: jackBoard },
        ),
      ),
    ).toBe('done');
  });

  it('the case can only be bought with the machine off, like the board: the power button first, then the Shop', () => {
    const step = STEPS.find((x) => x.id === 'buyCase');
    assert.exists(step);
    const purchases = [{ id: 'case1', name: 'Micro tower', kind: 'case' as const, price: 70, affordable: true }];
    expect(step.targets(snap({ powered: true, purchases }))).toStrictEqual(['power']);
    expect(step.targets(snap({ powered: false, purchases }))).toStrictEqual(['hud:shop', 'buy:case1']);
    expect(stepProblem(snap({ powered: true, purchases }), step)).toMatch(/power button/u);
  });

  it('the board can only be bought with the machine off: the step lights the power button first, then the Shop', () => {
    const step = STEPS.find((x) => x.id === 'buyBoard');
    assert.exists(step);
    const purchases = [{ id: 'board1', name: 'Basic', kind: 'board' as const, price: 150, affordable: true }];
    expect(step.targets(snap({ powered: true, purchases }))).toStrictEqual(['power']);
    expect(step.targets(snap({ powered: false, purchases }))).toStrictEqual(['hud:shop', 'buy:board1']);
    expect(stepProblem(snap({ powered: true, purchases }), step)).toMatch(/power button/u);
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
    assert.exists(step);
    expect(stepCount(step)).toStrictEqual({ n: 7, total: 8, chapter: 'Build' });
  });

  it('resumes at the drive step from a save that has the bought part fitted and no drive yet', () => {
    const s = afterSpend({ inventory: [], storage: [], os: null });
    expect(stepOf(s, welcomed)).toBe('buyDrive');
  });

  it('waits at the client-base step below Level 3, and the step is done at Level 3 or once a drive is owned', () => {
    const low = afterSpend({ level: atLevel(2) });
    expect(stepOf(low, welcomed)).toBe('reachLevel3');
    const spentAtLevel3 = afterSpend({ level: atLevel(3) });
    expect(stepOf(spentAtLevel3, welcomed)).toBe('buyDrive');
    // A player who already owns a drive (an older save) is not sent back to wait.
    const driveAtLevel1 = afterSpend({ level: atLevel(1), storage: [drive()] });
    expect(stepOf(driveAtLevel1, welcomed)).not.toBe('reachLevel3');
  });

  it('resumes at the OS install from a save with a drive installed and the OS bought', () => {
    const s = afterSpend({
      progress: { ...oldDone(), storageInstalled: true },
      storage: [drive()],
      inventory: [invItem('os', 'os1', 'inv9')],
    });
    expect(stepOf(s, welcomed)).toBe('os');
  });

  it('resumes while the machine is booting the OS from the drive', () => {
    const s = afterSpend({
      progress: { ...oldDone(), storageInstalled: true, osInstalled: true },
      storage: [drive({ hasOs: true })],
      os: osOn(),
      phase: 'booting-os',
      powered: true,
    });
    expect(stepOf(s, welcomed)).toBe('bootOs');
  });

  it('out of order: parts placed before the earlier ones are skipped past, not repeated', () => {
    // The player installs the PSU and monitor first. The CPU is still the first thing to ask for.
    const p = newProgress(false);
    p.psuInstalled = true;
    p.monitorInstalled = true;
    expect(stepAfter(p, welcomed)).toBe('cpu');
    // Then the CPU and RAM: the next open step is the cables, not the PSU again.
    p.cpuInstalled = true;
    p.coolerInstalled = true;
    p.ramInstalled = true;
    expect(stepAfter(p, welcomed)).toBe('cables');
  });

  it('out of order: the cooler needs the CPU, and the power step waits for the cooler', () => {
    // CPU in, cooler not yet: the cooler step comes before RAM, and power is not offered.
    const p = newProgress(false);
    p.cpuInstalled = true;
    expect(stepAfter(p, welcomed)).toBe('cooler');
    // Everything but the cooler is done: still the cooler, not the power button.
    const q = {
      ...oldUpTo(15),
      coolerInstalled: false,
      poweredOn: false,
      firstKeyPlugged: false,
      firstJobDone: false,
      firstKeyEjected: false,
      firstManualCycle: false,
      firstPurchase: false,
    };
    expect(stepAfter(q, welcomed)).toBe('cooler');
    // A legacy save (cooler pre-mounted, flag derived true) skips the step.
    expect(stepAfter(oldUpTo(2), welcomed)).toBe('ram');
  });

  it('a fitted heatsink with a free fan spot asks for the fan next; the fan lights its spot and the step ends when it sits there', () => {
    const p = oldUpTo(2),
      cooler = { ...STOCK_COOLER };
    const spot = { id: 'cooler0.fan0', type: 'fan' as const, deviceId: null, size: 92 };
    const fan = fitsIn(invItem('fan', 'fan92', 'inv6'), ['cooler0.fan0', 'front0']);
    const open = snap({ progress: p, devices: [cooler], slots: [...EMPTY_SLOTS, spot], inventory: [fan] });
    const step = currentStep(open, welcomed);
    assert.exists(step);
    expect(step.id).toBe('fan');
    expect(step.targets(open)).toStrictEqual(['inventory', 'inv:inv6', 'cooler0.fan0']); // not the case mount
    const fitted = snap({
      progress: p,
      devices: [cooler, dev({ id: 'f', kind: 'fan', spec: 'fan92', slot: 'cooler0.fan0' })],
      slots: [...EMPTY_SLOTS, { ...spot, deviceId: 'f' }],
    });
    expect(stepOf(fitted, welcomed)).toBe('ram');
    // a size that fits no spot of the heatsink
    const tooBig = snap({
      progress: p,
      devices: [cooler],
      slots: [...EMPTY_SLOTS, spot],
      inventory: [invItem('fan', 'fan120', 'inv7')],
    });
    assert.isNotEmpty(stepProblem(tooBig, step));
    const running = snap({ progress: { ...p, poweredOn: true }, devices: [cooler], slots: [...EMPTY_SLOTS, spot] });
    expect(stepOf(running, welcomed)).not.toBe('fan'); // an old game that already runs is not sent back
  });

  it('the cooler step shows the sim reason when it is dragged too early or power is pressed without it', () => {
    const step = STEPS.find((x) => x.id === 'cooler');
    assert.exists(step);
    const cooler = {
      id: 'inv5',
      spec: 'cooler0',
      kind: 'cooler' as const,
      name: 'Stock heatsink',
      freeSlots: [],
      swapSlots: [],
      installable: false,
      reason: 'install the CPU first: the cooler mounts on it',
    };
    expect(stepProblem(snap({ inventory: [cooler] }), step)).toMatch(/install the CPU first/u);
    expect(
      stepProblem(
        snap({ phase: 'error', powered: true, postBlocker: 'no CPU cooler installed: it mounts on the CPU' }),
        step,
      ),
    ).toMatch(/machine is on/u);
    expect(
      stepProblem(
        snap({ phase: 'error', powered: false, postBlocker: 'no CPU cooler installed: it mounts on the CPU' }),
        step,
      ),
    ).toMatch(/no CPU cooler/u);
    expect(step.targets(snap({ inventory: [{ ...cooler, freeSlots: ['cooler0'], installable: true }] }))).toStrictEqual(
      ['inventory', 'inv:inv5', 'cooler0'],
    );
  });

  it('out of order: a job served before the power was ever pressed still points at the power button', () => {
    const p = newProgress(false);
    p.firstKeyPlugged = true;
    expect(stepAfter(p, welcomed)).toBe('cpu');
  });

  it('out of order: the OS bought before the drive is installed still asks for the drive first', () => {
    // A drive is owned (in the inventory) and the OS is bought too: the install of the drive comes first.
    const s = afterSpend({
      storage: [],
      inventory: [fitsIn(invItem('storage', 'hdd0', 'inv5'), ['sata0']), invItem('os', 'os1', 'inv6')],
    });
    expect(stepOf(s, welcomed)).toBe('drive');
  });

  it('out of order: an OS installed before the drive step was seen is simply skipped past', () => {
    const s = afterSpend({
      progress: { ...oldDone(), osInstalled: true, storageInstalled: true },
      storage: [drive({ hasOs: true })],
      os: osOn(),
    });
    expect(stepOf(s, welcomed)).toBe('bootOs');
  });

  it('a machine powered off during the OS boot goes back to the power button', () => {
    const s = afterSpend({
      progress: { ...oldDone(), storageInstalled: true, osInstalled: true },
      storage: [drive({ hasOs: true })],
      os: osOn(),
      phase: 'off',
    });
    expect(stepOf(s, welcomed)).toBe('bootOs');
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
    for (const flag of stepFlags()) {
      expect(keys).toContain(flag);
    }
  });
});

describe('the OS lesson for players who finished the first tutorial', () => {
  const finishedOld: tutorialTypes.TutorialState = { ...INITIAL_TUTORIAL, welcomed: true, finished: true };

  it('is not forced through: no step, and one offer', () => {
    const s = snap({ progress: oldDone() });
    expect(legacyFinished(s, finishedOld)).toBe(true);
    expect(currentStep(s, finishedOld)).toBeNull();
    expect(offerNextLesson(s, finishedOld)).toBe(true);
  });

  it('taking the lesson starts at the drive step (the finished steps stay done)', () => {
    const taken: tutorialTypes.TutorialState = { ...finishedOld, finished: false, osLesson: true, offered: true };
    const s = afterSpend();
    expect(stepOf(s, taken)).toBe('buyDrive');
    expect(offerNextLesson(s, taken)).toBe(false);
  });

  it('dismissing it never offers it again', () => {
    const declined: tutorialTypes.TutorialState = { ...finishedOld, osLesson: false, offered: true };
    const doneOffer = snap({ progress: oldDone() });
    expect(offerNextLesson(doneOffer, declined)).toBe(false);
    const doneStep = snap({ progress: oldDone() });
    expect(currentStep(doneStep, declined)).toBeNull();
  });

  it('a skipped old tutorial is not offered the lesson', () => {
    const doneSkipped = snap({ progress: oldDone() });
    expect(offerNextLesson(doneSkipped, { ...finishedOld, skipped: true })).toBe(false);
  });

  it('a player who has the lesson (finished the new tutorial) is never offered it', () => {
    const doneNew: tutorialTypes.TutorialState = { ...finishedOld, osLesson: true };
    const doneLegacy = snap({ progress: oldDone() });
    expect(legacyFinished(doneLegacy, doneNew)).toBe(false);
    const doneOfferNew = snap({ progress: oldDone() });
    expect(offerNextLesson(doneOfferNew, doneNew)).toBe(false);
  });

  it('a player still in the old tutorial at its last card continues into the OS steps', () => {
    expect(stepAfter(oldDone(), welcomed)).toBe('fit');
  });

  it('a new game is not treated as finished', () => {
    expect(offerNextLesson(snap(), INITIAL_TUTORIAL)).toBe(false);
  });
});

describe('the OS steps (live state and phases)', () => {
  it('buying a drive is done as soon as one is owned, and the install step follows', () => {
    const s = afterSpend({ inventory: [fitsIn(invItem('storage', 'hdd0', 'inv5'), ['sata0'])] });
    expect(stepOf(s, welcomed)).toBe('drive');
    const driveSTEPS = STEPS.find((x) => x.id === 'drive');
    assert.exists(driveSTEPS);
    expect(driveSTEPS.targets(s)).toStrictEqual(['inv:inv5', 'sata0']);
  });

  describe('the memory lesson before the OS', () => {
    const base = { progress: { ...oldDone(), storageInstalled: true }, storage: [drive()] };

    it('a machine with too little memory buys, then fits, a bigger stick before it buys the OS', () => {
      const short = afterSpend({ ...base, devices: [ramDev('ram0')] });
      expect(stepOf(short, welcomed)).toBe('buyRam');
      const buyRamSTEPS = STEPS.find((x) => x.id === 'buyRam');
      assert.exists(buyRamSTEPS);
      expect(buyRamSTEPS.targets(short)).toStrictEqual(['dimm1', 'buy:ram1']);
      const owned = afterSpend({ ...base, devices: [ramDev('ram0')], inventory: [bigRam()] });
      expect(stepOf(owned, welcomed)).toBe('fitRam');
      const fitRamSTEPS = STEPS.find((x) => x.id === 'fitRam');
      assert.exists(fitRamSTEPS);
      expect(fitRamSTEPS.targets(owned)).toStrictEqual(['inv:inv7', 'dimm1']);
      const fitted = afterSpend({ ...base, devices: [ramDev('ram1')] });
      expect(stepOf(fitted, welcomed)).toBe('buyOs');
    });

    it('the general fit step leaves the memory to its own lesson', () => {
      const s = afterSpend({ ...base, devices: [ramDev('ram0')], inventory: [bigRam()] });
      const fitSTEPS = STEPS.find((x) => x.id === 'fit');
      assert.exists(fitSTEPS);
      expect(fitSTEPS.targets(s)).toStrictEqual([]);
    });

    it('is skipped once the OS is bought, and says why the buy tile is stuck when money or the board is the problem', () => {
      const withOs = afterSpend({
        ...base,
        devices: [ramDev('ram0')],
        inventory: [invItem('os', 'os1', 'inv9')],
      });
      expect(stepOf(withOs, welcomed)).toBe('os');
      const ram = { id: 'ram1', name: 'DRAM 32K fast', kind: 'ram' as const, price: 100, affordable: false };
      const poor = afterSpend({ ...base, money: 40, devices: [ramDev('ram0')], purchases: [ram] });
      expect(stepProblem(poor, stepWithId('buyRam'))).toBe('Need $60 more.');
    });
  });

  it('the OS is owned once bought: the next step installs it on the drive', () => {
    const s = afterSpend({
      progress: { ...oldDone(), storageInstalled: true },
      storage: [drive()],
      inventory: [fitsIn(invItem('os', 'os1', 'inv6'), ['sata0'])],
    });
    expect(stepOf(s, welcomed)).toBe('os');
    const osSTEPS = STEPS.find((x) => x.id === 'os');
    assert.exists(osSTEPS);
    expect(osSTEPS.targets(s)).toStrictEqual(['inv:inv6', 'sata0']);
  });

  it('the boot step is done in any running OS phase, and points at the monitor and the OS badge', () => {
    const s = afterSpend({
      progress: { ...oldDone(), storageInstalled: true, osInstalled: true },
      storage: [drive({ hasOs: true })],
      os: osOn(),
      phase: 'idle-os',
      powered: true,
    });
    expect(stepOf(s, welcomed)).toBe('osIngest');
    const bootOsSTEPS = STEPS.find((x) => x.id === 'bootOs');
    assert.exists(bootOsSTEPS);
    expect(bootOsSTEPS.targets(s)).toStrictEqual(['power']);
  });

  it('a key plugged and queued: the OS lesson waits for the result and the pay-out, nothing is held', () => {
    const s = osFlow({ plugged: key({ id: 7, stage: 'queued' }) });
    expect(stepOf(s, welcomed)).toBe('osPaid');
    const osPaidSTEPS = STEPS.find((x) => x.id === 'osPaid');
    assert.exists(osPaidSTEPS);
    expect(osPaidSTEPS.targets(s)).toStrictEqual(['monitor']);
  });

  it('a key still being copied is not yet ingested', () => {
    const s = osFlow({ plugged: key({ id: 7, stage: 'ingesting' }), tray: [] });
    expect(stepOf(s, welcomed)).toBe('osIngest');
  });

  it('a result being flashed onto the plugged key: still waiting for the pay-out', () => {
    const flashing = osFlow({ plugged: key({ id: 7, stage: 'flashing' }) });
    expect(stepOf(flashing, welcomed)).toBe('osPaid');
  });

  it('a key back in the tray after the machine powers off: the job is lost and the boot step shows again', () => {
    const s = afterSpend({
      progress: { ...oldDone(), storageInstalled: true, osInstalled: true },
      storage: [drive({ hasOs: true })],
      os: osOn(),
      powered: false,
      phase: 'off',
      tray: [key({ id: 7 })],
    });
    expect(stepOf(s, welcomed)).toBe('bootOs');
  });

  it('a job the OS delivered sets the final flag; the last card is then the one to show', () => {
    const p = effectiveProgress(afterSpend({ progress: { ...oldDone(), firstOsJob: true } }), INITIAL_TUTORIAL);
    expect(p.firstOsJob).toBe(true);
  });
});

describe('replay', () => {
  // Replay: every flag is already true in the save, so the steps are judged from live state and deltas.
  const replay: tutorialTypes.TutorialState = {
    ...INITIAL_TUTORIAL,
    welcomed: true,
    osLesson: true,
    replay: { completed: 2, owned: 5 },
  };

  it('judges installs from live state, not the sticky flags', () => {
    const s = snap({ progress: newProgress(true), devices: [] });
    expect(stepOf(s, replay)).toBe('cpu');
  });

  it('a part that is installed right now is skipped', () => {
    const s = snap({ progress: newProgress(true), devices: [dev({ kind: 'cpu' })] });
    expect(stepOf(s, replay)).toBe('cooler'); // the cooler is not mounted yet
    const s2 = snap({
      progress: newProgress(true),
      devices: [dev({ kind: 'cpu' }), dev({ id: 'dc', kind: 'cooler', slot: 'cooler0' })],
    });
    expect(stepOf(s2, replay)).toBe('ram');
  });

  it('a new key ejected since the replay started finishes the removal step', () => {
    const s = snap({ progress: newProgress(true), completed: 3 });
    const p = effectiveProgress(s, replay);
    expect(p.firstKeyEjected).toBe(true);
    expect(p.firstPurchase).toBe(false);
  });

  it('a purchase since the replay started counts', () => {
    assert.exists(STARTER_CRATE[0]);
    const s = snap({
      progress: newProgress(true),
      inventory: [...STARTER_CRATE, { ...STARTER_CRATE[0], id: 'inv9' }],
    });
    expect(effectiveProgress(s, { ...replay, replay: { completed: 0, owned: 5 } }).firstPurchase).toBe(true);
  });

  it('a replay does not show the welcome card a second time once welcomed', () => {
    const s = snap({ progress: newProgress(true) });
    expect(stepOf(s, { ...replay, welcomed: true })).not.toBe('welcome');
  });
});

describe('effectiveProgress', () => {
  it('uses the sticky flags outside a replay', () => {
    const p = oldUpTo(3);
    expect(effectiveProgress(snap({ progress: p }), INITIAL_TUTORIAL)).toStrictEqual(p);
  });

  it('a plugged key that is already done counts as the job done', () => {
    const k = key({ done: true });
    const p = effectiveProgress(snap({ plugged: k }), { ...INITIAL_TUTORIAL, replay: { completed: 0, owned: 5 } });
    expect(p.firstKeyPlugged).toBe(true);
    expect(p.firstJobDone).toBe(true);
  });
});

describe("stepProblem: why a step is stuck, in the sim's own words", () => {
  it('the CPU step explains a refusal when the machine is on', () => {
    const s = snap({ powered: true, phase: 'halted', haltReason: 'no-boot-media' });
    expect(stepProblem(s, stepWithId('cpu'))).toMatch(/Press the power button to switch it off/u);
  });

  it("the cable step shows the cable's blocked reason", () => {
    expect(stepProblem(snap(), stepWithId('cables'))).toMatch(/power supply is not installed/u);
  });

  it('the key step waits for a key; a running machine would ignore it, an off machine is the right moment', () => {
    const plug = stepWithId('plugKey');
    expect(stepProblem(snap({ noPowerReason: null }), plug)).toMatch(/No key yet/u);
    const keyInTray = snap({ noPowerReason: null, tray: [key()] });
    expect(stepProblem(keyInTray, plug)).toBeNull();
    const keyWhilePowered = snap({ noPowerReason: null, tray: [key()], powered: true });
    expect(stepProblem(keyWhilePowered, plug)).toMatch(/already on.*Power it off/u);
    const keyNoPsu = snap({ tray: [key()] });
    expect(stepProblem(keyNoPsu, plug)).toMatch(/Install a power supply/u); // plugging would start the machine: say why it cannot
  });

  it('the watch step explains an ignored key, and the cycle step walks through the manual loop', () => {
    const ignored = snap({
      powered: true,
      phase: 'halted',
      haltReason: 'no-boot-media',
      plugged: key(),
      keyIgnored: true,
    });
    expect(stepProblem(ignored, stepWithId('watch'))).toMatch(/only looks at boot/u);
    const cycle = stepWithId('cycle');
    const keyWaiting = snap({ tray: [key()] });
    expect(stepProblem(keyWaiting, cycle)).toMatch(/Plug the next key/u);
    const keyHalted = snap({ plugged: key(), powered: true, phase: 'halted' });
    expect(stepProblem(keyHalted, cycle)).toMatch(/Press the power button/u);
    const keyPlugged = snap({ plugged: key() });
    expect(stepProblem(keyPlugged, cycle)).toBeNull();
  });

  it('no problem on the welcome card', () => {
    assert.exists(STEPS[0]);
    expect(stepProblem(snap(), STEPS[0])).toBeNull();
  });

  it('buying a drive says what is missing: money, or a blocked reason', () => {
    const hdd = { id: 'hdd0', name: 'HDD 96K', kind: 'storage' as const, price: 40, affordable: false };
    expect(stepProblem(afterSpend({ money: 10, purchases: [hdd] }), stepWithId('buyDrive'))).toBe('Need $30 more.');
    expect(
      stepProblem(
        afterSpend({ money: 10, purchases: [{ ...hdd, blocked: 'the board has no SATA slot' }] }),
        stepWithId('buyDrive'),
      ),
    ).toBe('the board has no SATA slot');
  });

  it('buying the OS says what blocks it (memory, a drive)', () => {
    const os = {
      id: 'os1',
      name: 'Resident OS 1.0',
      kind: 'os' as const,
      price: 150,
      affordable: true,
      blocked: 'needs 32K of RAM',
    };
    expect(stepProblem(afterSpend({ purchases: [os] }), stepWithId('buyOs'))).toBe('needs 32K of RAM');
  });

  it("the boot step says the machine must be on, and shows the sim's reason if it stops", () => {
    const machineOff = afterSpend({ progress: oldDone(), phase: 'off', powered: false });
    expect(stepProblem(machineOff, stepWithId('bootOs'))).toMatch(/machine is off/u);
    const burnt = afterSpend({
      progress: oldDone(),
      phase: 'error',
      powered: true,
      phaseReason: 'the OS drive burnt out',
    });
    expect(stepProblem(burnt, stepWithId('bootOs'))).toBe('the OS drive burnt out');
  });

  it('a part swap queued behind a running job is explained as waiting, and the pointer moves to the work', () => {
    const queued = { invId: 'inv5', target: 'sata0', replacesId: null };
    const s = afterSpend({
      powered: true,
      pendingSwaps: [queued],
      inventory: [fitsIn(invItem('storage', 'hdd0', 'inv5'), ['sata0'])],
    });
    for (const id of ['fit', 'drive', 'os'] as const) {
      expect(stepProblem(s, stepWithId(id))).toMatch(/^Waiting for the running job/u);
      expect(stepWithId(id).targets(s)).toStrictEqual(['monitor']);
    }
  });

  it('the spend step says how much is missing when nothing can be afforded yet', () => {
    const broke = snap({ money: 50, purchases: [cpuOffer(200, false)] });
    expect(stepProblem(broke, stepWithId('spend'))).toMatch(/^Need \$150/u);
    const flush = snap({ money: 300, purchases: [cpuOffer(200, true)] });
    expect(stepProblem(flush, stepWithId('spend'))).toBeNull();
  });

  it('the drive and OS install steps do not ask for the machine to be off: the swap does that itself', () => {
    const s = afterSpend({
      powered: true,
      phase: 'idle-os',
      inventory: [fitsIn(invItem('storage', 'hdd0', 'inv5'), ['sata0'])],
    });
    expect(stepProblem(s, stepWithId('drive'))).toBeNull();
  });
});

describe('step targets (what the renderer pulses)', () => {
  it('installing the CPU pulses its crate item and the socket it fits', () => {
    const cpu = STEPS.find((x) => x.id === 'cpu');
    assert.exists(cpu);
    expect(cpu.targets(snap())).toStrictEqual(['inv:inv1', 'cpu0']);
  });

  it('no step points at the old crate: the welcome card highlights the inventory button', () => {
    for (const step of STEPS) {
      const withDev = snap({ devices: [dev()] });
      expect(step.targets(withDev), `for ${step.id}`).not.toContain('crate');
    }
    assert.exists(STEPS[0]);
    expect(STEPS[0].targets(snap())).toStrictEqual(['inventory']);
  });

  it('install steps point at their inventory items (inv:) and the socket, and the last card points nowhere', () => {
    const ramSTEPS = STEPS.find((x) => x.id === 'ram');
    assert.exists(ramSTEPS);
    expect(ramSTEPS.targets(snap())).toStrictEqual(['inv:inv3', 'dimm0', 'dimm1']);
    const rich = snap({ purchases: [{ id: 'cpu1', name: 'CPU', kind: 'cpu' as const, price: 200, affordable: true }] });
    const spendSTEPS = STEPS.find((x) => x.id === 'spend');
    assert.exists(spendSTEPS);
    expect(spendSTEPS.targets(rich)).toStrictEqual(['hud:shop', 'buy:cpu1']);
    // Nothing is lit while the player cannot pay: the step's grey line says how much is missing.
    const poor = snap({
      purchases: [{ id: 'cpu1', name: 'CPU', kind: 'cpu' as const, price: 200, affordable: false }],
    });
    const spendSTEPS2 = STEPS.find((x) => x.id === 'spend');
    assert.exists(spendSTEPS2);
    expect(spendSTEPS2.targets(poor)).toStrictEqual([]);
    const doneSTEPS = STEPS.find((x) => x.id === 'done');
    assert.exists(doneSTEPS);
    expect(doneSTEPS.targets(snap())).toStrictEqual([]);
  });

  it('the cable step lights one cable at a time: its plug and socket, not the devices', () => {
    expect(cableStepTargets(['atx', 'cpu', 'cpufan', 'video'])).toStrictEqual(['cable.atx']);
    expect(cableStepTargets(['cpu', 'cpufan', 'video'])).toStrictEqual(['cable.cpu']);
    expect(cableStepTargets(['cpufan', 'video'])).toStrictEqual(['cable.cpufan']);
    expect(cableStepTargets(['video'])).toStrictEqual(['cable.video']);
    expect(cableStepTargets([])).toStrictEqual([]);
  });

  it('the wall step lights the PC cord first, then the monitor cord, with the socket they go into', () => {
    expect(wallStepTargets(['pcmains', 'monmains'])).toStrictEqual(['cable.pcmains', 'socket']);
    expect(wallStepTargets(['monmains'])).toStrictEqual(['cable.monmains', 'socket']);
    expect(wallStepTargets([])).toStrictEqual([]);
  });

  it('the key steps light the key until it is picked up, then only the port it goes into', () => {
    const grab = { kind: 'key' as const, id: 'key:9' };
    const withKey = snap({ tray: [key({ id: 9 })] });
    for (const id of ['plugKey', 'cycle', 'osIngest'] as const) {
      const step = STEPS.find((x) => x.id === id);
      assert.exists(step);
      expect(step.targets(withKey), `${id} before the grab`).toStrictEqual(['key:9']);
      expect(step.targets(withKey, grab), `${id} while dragging`).toStrictEqual(['usb']);
    }
    // No key yet: the tray is what to watch; nothing else is lit.
    const plugKeySTEPS = STEPS.find((x) => x.id === 'plugKey');
    assert.exists(plugKeySTEPS);
    expect(plugKeySTEPS.targets(snap())).toStrictEqual(['tray']);
  });

  it('while the client base grows, the next key is lit, then only the port during a drag; nothing when a key is already in', () => {
    const step = STEPS.find((x) => x.id === 'reachLevel3');
    assert.exists(step);
    const trayKey = snap({ tray: [key({ id: 4 })] });
    expect(step.targets(trayKey)).toStrictEqual(['key:4']);
    const trayKeyHeld = snap({ tray: [key({ id: 4 })] });
    expect(step.targets(trayKeyHeld, { kind: 'key', id: 'key:4' })).toStrictEqual(['usb']);
    const secondKey = snap({ plugged: key({ id: 4 }), tray: [key({ id: 5 })] });
    expect(step.targets(secondKey)).toStrictEqual([]);
    expect(step.targets(snap())).toStrictEqual([]);
  });

  it('the drive bay is the target of the buy-a-drive and buy-an-OS steps (the OS is offered there)', () => {
    const buyDriveSTEPS = STEPS.find((x) => x.id === 'buyDrive');
    assert.exists(buyDriveSTEPS);
    expect(buyDriveSTEPS.targets(snap())).toStrictEqual(['bay', 'buy:hdd0']);
    const buyOsSTEPS = STEPS.find((x) => x.id === 'buyOs');
    assert.exists(buyOsSTEPS);
    expect(buyOsSTEPS.targets(snap())).toStrictEqual(['bay', 'buy:os1']);
  });
});

describe('step texts', () => {
  it('every step has its own text, and the welcome opens the game', () => {
    const texts = STEPS.map((x) => x.text);
    expect(new Set(texts).size).toBe(texts.length);
    assert.exists(STEPS[0]);
    expect(STEPS[0].text).toMatch(/^Welcome to Pipeline City!/u);
    const cpuSTEPS = STEPS.find((x) => x.id === 'cpu');
    assert.exists(cpuSTEPS);
    expect(cpuSTEPS.text).toMatch(/processor/u);
  });
});

describe('every step target names a real id', () => {
  /** Ids the renderer registers that are not described slots: buttons, the monitor, and the per-item `inv:`/`key:` ids. */
  const FIXED = new Set(['inventory', 'power', 'monitor']);
  const known = (id: string, s: ReturnType<typeof snap>) =>
    FIXED.has(id) ||
    /^(?:inv|key|hud):\S+$/u.test(id) ||
    (id.startsWith('buy:') && describeId(id.slice(4), s) !== null) ||
    describeId(id, s) !== null;

  it('the checker rejects an id that does not exist', () => {
    expect(known('routr', snap())).toBe(false);
    expect(known('router', snap())).toBe(true);
  });

  it('every target of every step is a real id', () => {
    const states = [
      snap(),
      snap({
        inventory: [
          fitsIn(invItem('board', 'board1', 'inv2'), ['cpu0']),
          fitsIn(invItem('ram', 'ram1', 'inv3'), ['dimm1']),
        ],
      }),
    ];
    for (const s of states) {
      for (const step of STEPS) {
        for (const t of step.targets(s)) {
          expect(known(t, s), `${step.id} targets ${t}`).toBe(true);
        }
      }
    }
  });
});

describe('persisted tutorial state', () => {
  it('reads a stored object and ignores junk', () => {
    expect(
      resumeState({
        welcomed: true,
        skipped: true,
        finished: false,
        replay: { completed: 1, owned: 4 },
        osLesson: true,
        offered: true,
      }),
    ).toStrictEqual({
      welcomed: true,
      skipped: true,
      finished: false,
      replay: { completed: 1, owned: 4 },
      osLesson: true,
      offered: true,
      acks: [],
    });
    expect(resumeState('nonsense')).toStrictEqual(INITIAL_TUTORIAL);
    expect(resumeState({ replay: { completed: 'x' } })).toStrictEqual({ ...INITIAL_TUTORIAL, replay: null });
  });

  it('a state saved before the OS lesson existed reads as not having it', () => {
    expect(resumeState({ welcomed: true, finished: true })).toStrictEqual({
      ...INITIAL_TUTORIAL,
      welcomed: true,
      finished: true,
    });
  });
});

describe('tutorial state in a save', () => {
  it('a state stored in the save wins (skipped, acks, replay baseline)', () => {
    const saved = {
      ...INITIAL_TUTORIAL,
      welcomed: true,
      skipped: true,
      acks: ['money'],
      replay: { completed: 2, owned: 5 },
    };
    expect(tutorialForSave(saved, newProgress(false))).toStrictEqual(saved);
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
    expect(stepAfter(oldUpTo(6), st)).not.toBe('welcome');
  });

  it('an older save that finished the first lesson still gets the OS offer; a blank one starts at the welcome', () => {
    const done = snap({ progress: oldDone() });
    const oldSave = tutorialForSave(undefined, oldDone());
    expect(offerNextLesson(done, oldSave)).toBe(true);
    const freshSave = tutorialForSave(undefined, newProgress(false));
    expect(stepOf(snap(), freshSave)).toBe('welcome');
  });
});
