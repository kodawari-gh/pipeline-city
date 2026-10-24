// Guided tutorial, pure logic. The current step is the first step not yet done, judged from the snapshot: the sticky
// `progress` flags where there is one, else live state (an item in the inventory, the phase, a key's stage). Loading a
// save mid-way resumes at the right step, and out-of-order actions are simply skipped past. Only the welcome card
// (Start) and the last card (Got it) have buttons, plus the one-time "Next lesson: the OS" offer. No DOM, no signals.
//
// The tutorial covers the game up to the network: building the machine, the first jobs, storage and the OS. The network
// itself (level 4) is the next goal the last card points at, not a lesson.
//
// Each step is one short instruction (`text`); the explanation is part of the text, in plain words, written for someone who has never opened a computer. A step belongs
// to a chapter (`Build`, `First jobs`, `The OS`), which the card shows instead of "step 17 of 33".

import { getSpec } from '../sim/board/specs';
import { getOsSpec } from '../sim/os';
import type { Snapshot } from '../sim/game/game';
import type { Progress } from '../sim/game/save';
import { fmtMoney } from './logic';
import { levelBar } from './levelui';

export interface ReplayBase { completed: number; owned: number }
export interface TutorialState {
  welcomed: boolean;
  skipped: boolean;
  finished: boolean;
  /** Set when replaying: flags are sticky, so steps are judged from live state and deltas against this baseline. */
  replay: ReplayBase | null;
  /** The OS lesson is part of this viewer's tutorial (set when a new-style tutorial finishes, replays, or the offer is taken). */
  osLesson: boolean;
  /** The "Next lesson: the OS" offer was answered (taken or dismissed). */
  offered: boolean;
}

export const INITIAL_TUTORIAL: TutorialState = {
  welcomed: false, skipped: false, finished: false, replay: null, osLesson: false, offered: false,
};

export type StepId =
  | 'welcome' | 'cpu' | 'cooler' | 'ram' | 'psu' | 'monitor' | 'cables' | 'plugKey' | 'watch'
  | 'cycle' | 'spend' | 'fit' | 'reachLevel3' | 'buyDrive' | 'drive' | 'buyRam' | 'fitRam' | 'buyOs' | 'os' | 'bootOs' | 'osIngest' | 'osPaid' | 'done';

export type Chapter = 'Build' | 'First jobs' | 'The OS';
export const CHAPTERS: Chapter[] = ['Build', 'First jobs', 'The OS'];

export interface StepDef {
  id: StepId;
  chapter: Chapter | null;
  title: string;
  /** What the step is about, in plain words, ending with what to do. Typed out by the dialogue box in pages. */
  text: string;
  /** Progress flag that completes the step, if it has one. */
  flag: keyof Progress | null;
  /** Live completion test for steps without a flag (see `isDone`). */
  done?: (s: Snapshot, p: Progress) => boolean;
  /** World ids to pulse (renderer highlight). */
  targets: (s: Snapshot) => string[];
  /** A waiting step shows a meter (the level bar's progress) instead of leaving the player wondering how long it takes. */
  meter?: (s: Snapshot) => { pct: number; label: string };
}

/** The twelve steps before storage and the OS existed. A player who finished them is not forced through the rest. */
const OLD_FLAGS: Array<keyof Progress> = [
  'cpuInstalled', 'ramInstalled', 'psuInstalled', 'monitorInstalled', 'atxConnected', 'cpuPowerConnected',
  'videoConnected', 'poweredOn', 'firstKeyPlugged', 'firstJobDone', 'firstKeyEjected', 'firstPurchase',
];

const PART_KINDS = ['cpu', 'ram', 'psu', 'cooler', 'display', 'board'];
/**
 * A bought upgrade that is still waiting to be fitted: a part in the inventory that is a higher tier than the best one
 * installed of its kind (on a one-DIMM board it swaps with the old stick, which then returns to the inventory as a lower tier).
 */
export const pendingUpgrade = (s: Snapshot, i: Snapshot['inventory'][number]): boolean => {
  if (!PART_KINDS.includes(i.kind)) return false;
  const spec = getSpec(i.spec);
  if (!spec) return false;
  const have = s.devices.filter((d) => d.kind === spec.kind && !d.burnt);
  return have.length === 0 || Math.max(...have.map((d) => getSpec(d.spec)?.tier ?? -1)) < spec.tier;
};
/** A part swap is queued behind a running job: the player has done their bit, so point at the work instead of the shelf. */
const whileSwapQueued = (targets: (s: Snapshot) => string[]) => (s: Snapshot): string[] => (s.pendingSwap ? ['monitor'] : targets(s));
/** The shop tile to buy, pulsed inside the picker (`buy:<spec id>`): the cheapest processor on offer for the spend step. */
const cheapestCpu = (s: Snapshot): string | null => {
  const c = s.purchases.filter((p) => p.kind === 'cpu' && !p.locked && !p.later && !p.blocked).sort((a, b) => a.price - b.price)[0];
  return c ? c.id : null;
};
/** Nothing is lit while the player cannot pay for the thing the step asks them to buy: the grey line says how much is missing. */
const whenAffordable = (id: string | ((s: Snapshot) => string | null), targets: (s: Snapshot) => string[]) => (s: Snapshot): string[] => {
  const sid = typeof id === 'string' ? id : id(s);
  const p = sid ? s.purchases.find((x) => x.id === sid) : undefined;
  return p && !p.affordable ? [] : targets(s);
};
const BROKE = ' Short on cash? Keep delivering jobs: the tile glows once you can afford it.';
const SWAP_WAIT = 'Waiting for the running job to finish: your part swaps in by itself.';
const invOf = (s: Snapshot, kind: string) => s.inventory.filter((i) => i.kind === kind);
/** Inventory items of a kind plus the free slots they fit. */
const installTargets = (kind: string) => (s: Snapshot): string[] => {
  const items = invOf(s, kind);
  return [...items.map((i) => `inv:${i.id}`), ...items.flatMap((i) => i.freeSlots)];
};
/** Memory fitted now, in bytes (the OS lives in RAM while it runs, so the machine needs a minimum before it can have one). */
const ramBytes = (s: Snapshot): number =>
  s.devices.filter((d) => d.kind === 'ram' && !d.burnt).reduce((n, d) => { const sp = getSpec(d.spec); return n + (sp && 'sizeBytes' in sp ? sp.sizeBytes : 0); }, 0);
const OS_RAM_BYTES = getOsSpec('os1')?.minRamBytes ?? 32 * 1024;
const ramShort = (s: Snapshot) => !s.os && ramBytes(s) < OS_RAM_BYTES;
/** Memory is its own lesson while the OS is waiting for it, so the general "fit your new part" step leaves it alone. */
const fitsGeneralStep = (s: Snapshot, i: Snapshot['inventory'][number]) => pendingUpgrade(s, i) && !(i.kind === 'ram' && ramShort(s) && !ownsOs(s));
/** A spare memory stick big enough on its own (it replaces the small one, or fills a free slot). */
const hasBigRam = (s: Snapshot) => invOf(s, 'ram').some((i) => { const sp = getSpec(i.spec); return !!sp && 'sizeBytes' in sp && sp.sizeBytes >= OS_RAM_BYTES; });
const ownsStorage = (s: Snapshot) => s.storage.length > 0 || invOf(s, 'storage').length > 0;
const ownsOs = (s: Snapshot) => !!s.os || invOf(s, 'os').length > 0;
const OS_PHASES = ['idle-os', 'ingesting', 'running-os', 'flashing'];
const pluggedAt = (s: Snapshot, stages: string[]) => s.plugged !== null && stages.includes(s.plugged.stage);
/** The OS has copied a key into its queue (plugged). */
const ingested = (s: Snapshot) => pluggedAt(s, ['queued', 'running', 'result', 'flashing', 'done']);

/** The inventory button (bottom bar). A UI-only id: the renderer ignores it, the bar pulses the button. */
export const INVENTORY_ID = 'inventory';

const OS_RAM_KB = (getOsSpec('os1')?.minRamBytes ?? 32 * 1024) / 1024;

/** The three cables of the first build, by cable id and the progress flag that says each is in. */
const CABLES: Array<{ id: 'atx' | 'cpu' | 'video'; flag: keyof Progress; end: string }> = [
  { id: 'atx', flag: 'atxConnected', end: 'psu' },
  { id: 'cpu', flag: 'cpuPowerConnected', end: 'psu' },
  { id: 'video', flag: 'videoConnected', end: 'monitor' },
];

const levelMeter = (s: Snapshot) => { const m = levelBar(s); return { pct: m.pct, label: m.label }; };

export const STEPS: StepDef[] = [
  {
    id: 'welcome', chapter: null, title: 'Welcome', flag: null,
    text: 'Every computer has a brain. This one is called the processor, or CPU, and it does all the thinking, one tiny step at a time. Drag it onto the big square socket on the board.',
    targets: () => [INVENTORY_ID],
  },
  { id: 'cpu', chapter: 'Build', title: 'Install the processor', flag: 'cpuInstalled',
    text: 'Drag the processor (CPU) onto the big square socket.',
    targets: installTargets('cpu') },
  { id: 'cooler', chapter: 'Build', title: 'Install the cooler', flag: 'coolerInstalled',
    text: 'Thinking is hot work! The CPU gets toasty while it runs, so it needs a fan to blow the heat away. Drag the cooler onto the processor.',
    targets: (s) => {
      const items = invOf(s, 'cooler');
      return [INVENTORY_ID, ...items.map((i) => `inv:${i.id}`), ...items.flatMap((i) => i.freeSlots)];
    } },
  { id: 'ram', chapter: 'Build', title: 'Install the memory', flag: 'ramInstalled',
    text: 'Now a desk to work on. Memory (RAM) is where the machine keeps a job while it works on it. Small or slow memory makes the brain sit around waiting. Drag the memory stick into a long slot next to the processor.',
    targets: installTargets('ram') },
  { id: 'psu', chapter: 'Build', title: 'Install the power supply', flag: 'psuInstalled',
    text: 'Time for some energy! The power supply is the machine\'s battery pack: it feeds electricity to every other part. Drag it into the bay below the board.',
    targets: installTargets('psu') },
  { id: 'monitor', chapter: 'Build', title: 'Install the monitor', flag: 'monitorInstalled',
    text: 'A screen lets you see what your machine is up to, from its first wake-up to the finished answer. Drag the monitor onto the display bay.',
    targets: installTargets('display') },
  { id: 'cables', chapter: 'Build', title: 'Plug in the three cables', flag: null,
    done: (_s, p) => CABLES.every((c) => p[c.flag]),
    text: 'Parts need wires to talk to each other. Main power and processor power carry energy from the power supply to the board. The video cable carries pictures from the board to the monitor. Drag the lit cable plug to its socket, three cables in all.',
    // One cable at a time, and only its two ends (plug and socket), not the whole device around it.
    targets: (s) => {
      const c = CABLES.find((x) => !s.cables.find((y) => y.id === x.id)?.connected);
      return c ? [`cable.${c.id}`] : [];
    } },
  { id: 'plugKey', chapter: 'First jobs', title: 'Plug in a client key', flag: 'firstKeyPlugged',
    text: 'Your first client has arrived! Jobs come on USB keys, a bit like a letter in an envelope. Plugging one in wakes the machine up: it checks itself, then reads the job off the key. Drag the key from the tray into the USB port.',
    targets: (s) => ['usb', ...(s.tray[0] ? [`key:${s.tray[0].id}`] : ['tray'])] },
  { id: 'watch', chapter: 'First jobs', title: 'Watch it work', flag: 'firstKeyEjected',
    text: 'The machine does the job and writes the answer back onto the key. Every second it sits idle is money lost! Watch the monitor. When the job is done the key pops out, you get paid and the machine goes back to sleep.',
    targets: () => ['monitor'] },
  { id: 'cycle', chapter: 'First jobs', title: 'Next job: plug the next key', flag: 'firstManualCycle',
    text: 'With no operating system, the machine only looks at the USB port when it wakes up, so every job needs a fresh start. Plug in the next key and it starts again by itself.',
    targets: (s) => ['usb', ...(!s.plugged && s.tray[0] ? [`key:${s.tray[0].id}`] : [])] },
  { id: 'spend', chapter: 'First jobs', title: 'Spend your first money', flag: 'firstPurchase',
    text: 'You earned your first coins! Better parts finish jobs sooner, and sooner means more money. Click the processor and buy an upgrade. It lands in your inventory.' + BROKE,
    targets: whenAffordable(cheapestCpu, (s) => {
      const cpu = s.devices.find((d) => d.kind === 'cpu');
      const buy = cheapestCpu(s);
      return [...(cpu ? [cpu.slot] : [INVENTORY_ID]), ...(buy ? [`buy:${buy}`] : [])];
    }) },
  // ---- storage and the OS ----
  { id: 'fit', chapter: 'First jobs', title: 'Fit your new part', flag: null,
    done: (s) => !s.inventory.some((i) => fitsGeneralStep(s, i)),
    text: `Your new part is waiting in the inventory. Drag it onto its socket and the machine swaps it in for you, waiting for a running job to finish first. Heads up: the operating system will need ${OS_RAM_KB}K of memory.`,
    targets: whileSwapQueued((s) => s.inventory
      .filter((i) => fitsGeneralStep(s, i))
      .flatMap((i) => [`inv:${i.id}`, ...i.freeSlots, ...i.swapSlots])) },
  { id: 'reachLevel3', chapter: 'The OS', title: 'Grow your client base', flag: null,
    done: (s) => s.level.level >= 3 || ownsStorage(s) || !!s.os,
    text: 'Every job you deliver adds to your client base, and your level grows with it. Higher levels bring more clients and better pay, though clients wait less. The OS opens at Level 3 and the network at Level 4. Keep delivering jobs, and use the 4x button to speed up the waiting.',
    targets: () => [], meter: levelMeter },
  { id: 'buyDrive', chapter: 'The OS', title: 'Buy a drive', flag: null,
    done: (s) => ownsStorage(s),
    text: 'A computer needs somewhere to keep its software, like a bookshelf for its brain. That is a drive. An HDD is slow and cheap, an SSD is faster. Click the drive bay and buy the HDD.' + BROKE,
    targets: whenAffordable('hdd0', () => ['bay', 'buy:hdd0']) },
  { id: 'drive', chapter: 'The OS', title: 'Install the drive', flag: 'storageInstalled',
    text: 'The drive\'s speed decides how quickly the machine wakes up later. Drag the drive onto a free drive bay.',
    targets: whileSwapQueued(installTargets('storage')) },
  { id: 'buyRam', chapter: 'The OS', title: 'More memory first', flag: null,
    done: (s) => !ramShort(s) || hasBigRam(s) || ownsOs(s),
    text: `The operating system does not run from the drive alone: while it works it lives in memory, like a manager who needs a big desk. Your starter stick is too small: the OS wants ${OS_RAM_BYTES / 1024}K. Click the memory stick on the board and buy the bigger one.${BROKE}`,
    targets: whenAffordable('ram1', (s) => [...s.devices.filter((d) => d.kind === 'ram').map((d) => d.slot).slice(0, 1), 'buy:ram1']) },
  { id: 'fitRam', chapter: 'The OS', title: 'Fit the bigger memory', flag: null,
    done: (s) => !ramShort(s) || ownsOs(s),
    text: 'Drag the new memory stick onto the old one. The machine swaps it in for you, waiting for a running job to finish first.',
    targets: whileSwapQueued((s) => invOf(s, 'ram').flatMap((i) => [`inv:${i.id}`, ...i.freeSlots, ...i.swapSlots])) },
  { id: 'buyOs', chapter: 'The OS', title: 'Buy an operating system', flag: null,
    done: (s) => ownsOs(s),
    text: 'An operating system (OS) is the machine\'s manager. It keeps the computer awake and busy, so it does not need a fresh start for every job. Click the drive bay again and buy the OS.' + BROKE,
    targets: whenAffordable('os1', () => ['bay', 'buy:os1']) },
  { id: 'os', chapter: 'The OS', title: 'Install the OS on the drive', flag: 'osInstalled',
    text: 'The OS gets written onto the drive, which is where the machine wakes up from. Drag the OS onto the drive.',
    targets: whileSwapQueued(installTargets('os')) },
  { id: 'bootOs', chapter: 'The OS', title: 'Boot from the drive', flag: null,
    done: (s) => OS_PHASES.includes(s.phase) || s.progress.firstOsJob,
    text: 'Now wake the machine from its drive! The monitor shows the start-up text, and the little badge on the drive shows what the OS is doing. A faster drive wakes up sooner. Press the power button and wait for the OS.',
    targets: () => ['power'] },
  { id: 'osIngest', chapter: 'The OS', title: 'Plug in a key', flag: null,
    done: (s, p) => ingested(s) || p.firstOsJob,
    text: 'The OS reads the job onto the drive and works on it with no restart. The key just has to stay in the port while it does. Drag a client key into the USB port and leave it there.',
    targets: (s) => ['usb', ...(s.plugged ? [`key:${s.plugged.id}`] : s.tray[0] ? [`key:${s.tray[0].id}`] : ['tray'])] },
  { id: 'osPaid', chapter: 'The OS', title: 'Wait for the result', flag: 'firstOsJob',
    text: 'The OS runs the job and writes the answer onto the key. It pops out by itself and you get paid. The machine stays on and takes the next key as soon as you plug it in. Watch the drive badge to see what the OS is doing.',
    targets: () => ['os'] },
  { id: 'done', chapter: null, title: 'Workshop open', flag: null,
    text: 'The machine now runs jobs on its own. Next goal: the network, which opens at Level 4, so jobs arrive without keys. It needs a Basic board for the jack, a router and a plan, and no more memory.',
    targets: () => [] },
];

export const stepIndex = (id: StepId) => STEPS.findIndex((x) => x.id === id);

const anyFlag = (p: Progress) => Object.values(p).some(Boolean);

/**
 * Progress as seen by the tutorial. Normally the snapshot's sticky flags. When replaying, the flags are all true
 * already, so judge from live state and from changes against the baseline taken when the replay began.
 */
export function effectiveProgress(s: Snapshot, st: TutorialState): Progress {
  if (!st.replay) return s.progress;
  const b = st.replay;
  const has = (kind: string) => s.devices.some((d) => d.kind === kind && !d.burnt);
  const cable = (id: string) => s.cables.some((c) => c.id === id && c.connected);
  const ejected = s.completed > b.completed;
  const owned = s.devices.length + s.inventory.length;
  const done = ejected || !!s.plugged?.done;
  return {
    cpuInstalled: has('cpu'), coolerInstalled: has('cooler'), psuInstalled: has('psu'), ramInstalled: has('ram'), monitorInstalled: has('display'),
    atxConnected: cable('atx'), cpuPowerConnected: cable('cpu'), videoConnected: cable('video'),
    poweredOn: s.powered && s.phase !== 'off',
    storageInstalled: s.storage.length > 0, osInstalled: !!s.os, firstOsJob: s.progress.firstOsJob,
    firstKeyPlugged: !!s.plugged || done,
    firstManualCycle: s.completed >= b.completed + 2 || (ejected && !!s.plugged && s.powered && s.phase !== 'halted' && s.phase !== 'off'),
    firstJobDone: done,
    firstKeyEjected: ejected,
    firstPurchase: owned > b.owned,
    ispBought: s.progress.ispBought, routerInstalled: s.progress.routerInstalled, lanConnected: s.progress.lanConnected,
    linkUp: s.progress.linkUp, firstNetJob: s.progress.firstNetJob,
  };
}

/** Whether a step is complete: its flag, else its live test. */
export function isDone(step: StepDef, s: Snapshot, p: Progress): boolean {
  if (step.done) return step.done(s, p);
  return step.flag ? p[step.flag] : false;
}

export function tutorialActive(st: TutorialState): boolean {
  return !st.skipped && !st.finished;
}

/**
 * A player who finished the first tutorial before the OS lesson existed (or a migrated save with all of its flags). They
 * are not forced through the new steps: they get one offer card instead. Never true for a replay or for anyone with the lesson.
 */
export function legacyFinished(s: Snapshot, st: TutorialState): boolean {
  if (st.osLesson || st.replay) return false;
  return st.finished || (!st.welcomed && OLD_FLAGS.every((f) => s.progress[f]));
}

/** Show the "Next lesson: the OS" card once: a legacy player who has not answered it and did not skip the tutorial. */
export function offerNextLesson(s: Snapshot, st: TutorialState): boolean {
  return !s.sandbox && !st.skipped && !st.offered && legacyFinished(s, st);
}

/** The step to show now, or null when the tutorial is skipped, finished, or a legacy player is not taking the lesson. */
export function currentStep(s: Snapshot, st: TutorialState): StepDef | null {
  // The sandbox has no tutorial: its progress flags are all set, which would otherwise look like a finished campaign.
  if (s.sandbox || !tutorialActive(st) || legacyFinished(s, st)) return null;
  const p = effectiveProgress(s, st);
  const welcomed = st.welcomed || (!st.replay && anyFlag(p));
  if (!welcomed) return STEPS[0]!;
  for (const step of STEPS) {
    if (step.id === 'welcome' || step.id === 'done') continue;
    if (!isDone(step, s, p)) return step;
  }
  return STEPS[STEPS.length - 1]!;
}

/** Position of a step inside its chapter ("Build 3 of 7"), skipping the welcome and final cards. */
export function stepCount(step: StepDef): { n: number; total: number; chapter: Chapter | null } {
  if (!step.chapter) return { n: step.id === 'welcome' ? 0 : 0, total: 0, chapter: null };
  const mine = STEPS.filter((x) => x.chapter === step.chapter);
  return { n: mine.findIndex((x) => x.id === step.id) + 1, total: mine.length, chapter: step.chapter };
}

/** The first reason an inventory item of this kind cannot be fitted, or null. */
const itemReason = (s: Snapshot, kind: string): string | null => {
  const items = invOf(s, kind);
  if (!items.length) return null;
  return items.every((i) => !i.freeSlots.length) ? items[0]!.reason ?? null : null;
};

/**
 * A live "why is this not working" line for the current step (null when nothing is wrong). Uses the sim's own
 * reasons so the card explains refusals instead of leaving the player guessing.
 */
export function stepProblem(s: Snapshot, step: StepDef): string | null {
  switch (step.id) {
    case 'cpu': case 'ram': case 'psu': case 'monitor': {
      if (s.powered) return 'The machine is on. Press the power button to switch it off, then install parts.';
      const kind = step.id === 'monitor' ? 'display' : step.id;
      const items = invOf(s, kind);
      if (!items.length) return `No ${kind} in the inventory. Buy one from a part on the board.`;
      return itemReason(s, kind);
    }
    case 'cooler': {
      if (s.powered) return 'The machine is on. Press the power button to switch it off, then install parts.';
      if (s.phase === 'error' && s.postBlocker) return s.postBlocker;
      const items = invOf(s, 'cooler');
      if (!items.length) return 'No cooler in the inventory. Buy one from the cooler slot on the processor.';
      return itemReason(s, 'cooler');
    }
    case 'cables': {
      const open = s.cables.filter((c) => CABLES.some((x) => x.id === c.id) && !c.connected);
      const blocked = open.find((c) => c.blocked)?.blocked;
      if (blocked) return blocked;
      return s.powered ? 'The machine is on. Power it off before plugging cables.' : null;
    }
    case 'plugKey':
      if (!s.tray.length && !s.plugged) return 'No key yet. A client key will arrive in the tray soon.';
      return s.noPowerReason ?? (s.postBlocker && `The machine would not start: ${s.postBlocker}`) ?? (s.powered ? 'The machine is already on, so it will not look at a new key. Power it off first, then plug the key in.' : null);
    case 'watch':
      if (s.phase === 'error' && s.phaseReason) return `POST error: ${s.phaseReason}. Power off, fix it, power on again.`;
      if (s.keyIgnored || s.haltReason === 'no-boot-media') return 'The machine did not see the key: it only looks at boot. Power off, plug the key in, and power on again.';
      return s.phase === 'error' ? s.phaseReason : null;
    case 'cycle':
      if (!s.plugged) return s.tray.length ? 'Plug the next key into the USB port first.' : 'No key yet. A client key will arrive in the tray soon.';
      return s.powered ? 'Press the power button to switch off, then again to switch on: the machine reads the key at boot.' : null;
    case 'spend': {
      const cpus = s.purchases.filter((p) => p.kind === 'cpu' && !p.locked && !p.later && !p.blocked);
      if (!cpus.length || cpus.some((p) => p.affordable)) return null;
      const cheapest = Math.min(...cpus.map((p) => p.price));
      return `Need ${fmtMoney(cheapest - s.money)} more. Finish another job to earn it.`;
    }
    case 'fit':
      return s.pendingSwap ? SWAP_WAIT : null;
    case 'fitRam':
      return s.pendingSwap ? SWAP_WAIT : itemReason(s, 'ram');
    case 'buyDrive': case 'buyRam': case 'buyOs': {
      const id = step.id === 'buyDrive' ? 'hdd0' : step.id === 'buyRam' ? 'ram1' : 'os1';
      const p = s.purchases.find((x) => x.id === id);
      if (!p) return null;
      if (p.locked) return `Needs Level ${p.locked.level} (${p.locked.name}). Keep serving clients.`;
      if (p.blocked) return p.blocked;
      return p.affordable ? null : `Need ${fmtMoney(p.price - s.money)} more.`;
    }
    case 'drive':
      return s.pendingSwap ? SWAP_WAIT : (invOf(s, 'storage').length ? itemReason(s, 'storage') : 'No drive in the inventory. Buy one first.');
    case 'os':
      return s.pendingSwap ? SWAP_WAIT : (invOf(s, 'os').length ? itemReason(s, 'os') : 'No operating system in the inventory. Buy one first.');
    case 'bootOs':
      if (!s.powered) return 'The machine is off. Press the power button to boot from the drive.';
      return s.phase === 'error' ? s.phaseReason : s.noPowerReason ?? s.postBlocker;
    case 'osIngest':
      if (!s.powered) return 'The machine is off. Press the power button first.';
      if (s.phase === 'booting-os' || s.phase === 'posting') return 'The OS is still starting. A key plugged in meanwhile is picked up when it is idle.';
      return s.tray.length || s.plugged ? null : 'No key yet. A client key will arrive in the tray soon.';
    case 'osPaid':
      return s.phase === 'error' ? s.phaseReason : null;
    default:
      return null;
  }
}

export function resumeState(raw: unknown): TutorialState {
  const o = (raw ?? {}) as Partial<TutorialState>;
  const r = o.replay;
  return {
    welcomed: o.welcomed === true,
    skipped: o.skipped === true,
    finished: o.finished === true,
    replay: r && typeof r.completed === 'number' && typeof r.owned === 'number' ? { completed: r.completed, owned: r.owned } : null,
    osLesson: o.osLesson === true,
    offered: o.offered === true,
  };
}
