// Guided tutorial, pure logic. The current step is the first step not yet done, judged from the snapshot: the sticky
// `progress` flags where there is one, else live state (an item in the inventory, the phase, a key's stage). Loading a
// save mid-way resumes at the right step, and out-of-order actions are simply skipped past. Only the welcome card
// (Start) and the last card (Got it) have buttons, plus the one-time "Next lesson: the OS" offer. No DOM, no signals.
//
// The tutorial covers the game up to the network: building the machine, the first jobs, storage and the OS. The network
// itself (level 4) is the next goal the last card points at, not a lesson.
//
// Each step is one short instruction (`text`); the reason for it is `why`, shown only when the player asks. A step belongs
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
  | 'welcome' | 'cpu' | 'cooler' | 'ram' | 'psu' | 'monitor' | 'cables' | 'plugKey' | 'power' | 'watch'
  | 'cycle' | 'spend' | 'fit' | 'reachLevel3' | 'buyDrive' | 'drive' | 'buyOs' | 'os' | 'bootOs' | 'osIngest' | 'osPaid' | 'done';

export type Chapter = 'Build' | 'First jobs' | 'The OS';
export const CHAPTERS: Chapter[] = ['Build', 'First jobs', 'The OS'];

export interface StepDef {
  id: StepId;
  chapter: Chapter | null;
  title: string;
  /** One short instruction. */
  text: string;
  /** The reason, shown behind "Why?" only. */
  why?: string;
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
const invOf = (s: Snapshot, kind: string) => s.inventory.filter((i) => i.kind === kind);
/** Inventory items of a kind plus the free slots they fit. */
const installTargets = (kind: string) => (s: Snapshot): string[] => {
  const items = invOf(s, kind);
  return [...items.map((i) => `inv:${i.id}`), ...items.flatMap((i) => i.freeSlots)];
};
const ownsStorage = (s: Snapshot) => s.storage.length > 0 || invOf(s, 'storage').length > 0;
const ownsOs = (s: Snapshot) => !!s.os || invOf(s, 'os').length > 0;
const OS_PHASES = ['idle-os', 'ingesting', 'running-os', 'flashing'];
const pluggedAt = (s: Snapshot, stages: string[]) => s.plugged !== null && stages.includes(s.plugged.stage);
/** The OS has copied a key into its queue (plugged, or already held). */
const ingested = (s: Snapshot) => s.held.length > 0 || pluggedAt(s, ['queued', 'running', 'result', 'flashing', 'done']);

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
    text: 'You run a one-person computer workshop. Clients bring jobs on USB keys, your machine does them, you get paid. First, build the machine: open the inventory (the box at the bottom) and drag the parts onto the board.',
    targets: () => [INVENTORY_ID],
  },
  { id: 'cpu', chapter: 'Build', title: 'Install the processor', flag: 'cpuInstalled',
    text: 'Drag the processor (CPU) onto the big square socket.',
    why: 'The CPU is the machine\'s brain: it runs every instruction of every job.',
    targets: installTargets('cpu') },
  { id: 'cooler', chapter: 'Build', title: 'Install the cooler', flag: 'coolerInstalled',
    text: 'Drag the cooler onto the processor.',
    why: 'A running CPU makes heat. The fan sits on it to carry the heat away, and spins only while the machine is on.',
    targets: (s) => {
      const items = invOf(s, 'cooler');
      return [INVENTORY_ID, ...items.map((i) => `inv:${i.id}`), ...items.flatMap((i) => i.freeSlots)];
    } },
  { id: 'ram', chapter: 'Build', title: 'Install the memory', flag: 'ramInstalled',
    text: 'Drag the memory stick (RAM) into a long slot next to the processor.',
    why: 'Memory holds the job while it runs. Slow or small memory makes the CPU wait.',
    targets: installTargets('ram') },
  { id: 'psu', chapter: 'Build', title: 'Install the power supply', flag: 'psuInstalled',
    text: 'Drag the power supply (PSU) into the bay below the board.',
    why: 'Everything draws power from it. A small one trips when you add hungry parts.',
    targets: installTargets('psu') },
  { id: 'monitor', chapter: 'Build', title: 'Install the monitor', flag: 'monitorInstalled',
    text: 'Drag the monitor onto the display bay.',
    why: 'It shows what the machine is doing, from the first test to the job\'s answer.',
    targets: installTargets('display') },
  { id: 'cables', chapter: 'Build', title: 'Plug in the three cables', flag: null,
    done: (_s, p) => CABLES.every((c) => p[c.flag]),
    text: 'Drag each cable\'s plug to its socket: main power, processor power, video.',
    why: 'Main power and processor power run from the supply to the board. Video runs from the board to the monitor.',
    targets: (s) => CABLES.flatMap((c) => (s.cables.find((x) => x.id === c.id)?.connected ? [] : [`cable.${c.id}`, c.end])) },
  { id: 'plugKey', chapter: 'First jobs', title: 'Plug in a client key', flag: 'firstKeyPlugged',
    text: 'Drag the key from the tray into the USB port.',
    why: 'Work comes on keys. The machine only looks for a key when it starts, so plug it in while the machine is still off.',
    targets: (s) => ['usb', ...(s.tray[0] ? [`key:${s.tray[0].id}`] : ['tray'])] },
  { id: 'power', chapter: 'First jobs', title: 'Press the power button', flag: 'poweredOn',
    text: 'Press the power button on the case.',
    why: 'The machine tests itself, looks at the USB port once, then copies the job from the key into memory.',
    targets: () => ['power'] },
  { id: 'watch', chapter: 'First jobs', title: 'Watch it work', flag: 'firstKeyEjected',
    text: 'Watch the monitor. When the job is done the key pops out, you are paid and the machine switches itself off.',
    why: 'The machine runs the job and writes the answer back to the key. Idle time is lost income.',
    targets: () => ['monitor'] },
  { id: 'cycle', chapter: 'First jobs', title: 'Next job: plug a key, power on', flag: 'firstManualCycle',
    text: 'Plug in the next key, then press power.',
    why: 'Without an operating system the machine only reads a key at start-up, so every job needs a fresh start. An OS removes that chore.',
    targets: (s) => ['power', 'usb', ...(!s.plugged && s.tray[0] ? [`key:${s.tray[0].id}`] : [])] },
  { id: 'spend', chapter: 'First jobs', title: 'Spend your first money', flag: 'firstPurchase',
    text: 'Click the processor and buy an upgrade.',
    why: 'Better parts finish jobs sooner, which earns more. The part goes into your inventory.',
    targets: (s) => {
      const cpu = s.devices.find((d) => d.kind === 'cpu');
      return cpu ? [cpu.slot] : [INVENTORY_ID];
    } },
  // ---- storage and the OS ----
  { id: 'fit', chapter: 'First jobs', title: 'Fit your new part', flag: null,
    done: (s) => !s.inventory.some((i) => pendingUpgrade(s, i)),
    text: 'Switch the machine off, then drag the new part from the inventory onto its socket.',
    why: `Parts only change while the machine is off. The operating system needs ${OS_RAM_KB}K of memory fitted.`,
    targets: (s) => s.inventory
      .filter((i) => pendingUpgrade(s, i))
      .flatMap((i) => [`inv:${i.id}`, ...i.freeSlots, ...i.swapSlots]) },
  { id: 'reachLevel3', chapter: 'The OS', title: 'Grow your client base', flag: null,
    done: (s) => s.level.level >= 3 || ownsStorage(s) || !!s.os,
    text: 'Keep delivering jobs. The OS opens at Level 3, the network at Level 4.',
    why: 'Every job adds to your client base and the level grows with it. Later levels bring more clients and better pay, but clients wait less. The 4x button speeds the waiting up.',
    targets: () => [], meter: levelMeter },
  { id: 'buyDrive', chapter: 'The OS', title: 'Buy a drive', flag: null,
    done: (s) => ownsStorage(s),
    text: 'Click the drive bay and buy a drive.',
    why: 'The machine needs somewhere to keep an operating system. An HDD is slow and cheap, an SSD is faster.',
    targets: () => ['bay'] },
  { id: 'drive', chapter: 'The OS', title: 'Install the drive', flag: 'storageInstalled',
    text: 'Switch off, then drag the drive onto a free drive bay.',
    why: 'The drive\'s speed decides how fast the OS loads.',
    targets: installTargets('storage') },
  { id: 'buyOs', chapter: 'The OS', title: 'Buy an operating system', flag: null,
    done: (s) => ownsOs(s),
    text: 'Click the drive bay again and buy the operating system.',
    why: 'An OS keeps the machine running, so it does not restart for every job.',
    targets: () => ['bay'] },
  { id: 'os', chapter: 'The OS', title: 'Install the OS on the drive', flag: 'osInstalled',
    text: 'Switch off, then drag the OS onto the drive.',
    why: 'It is written onto the drive, which is where the machine boots from.',
    targets: installTargets('os') },
  { id: 'bootOs', chapter: 'The OS', title: 'Boot from the drive', flag: null,
    done: (s) => OS_PHASES.includes(s.phase) || s.progress.firstOsJob,
    text: 'Press the power button and wait for the OS.',
    why: 'The monitor shows the boot text and the badge on the drive shows its status. A faster drive boots sooner.',
    targets: () => ['power', 'monitor', 'os'] },
  { id: 'osIngest', chapter: 'The OS', title: 'Plug in a key', flag: null,
    done: (s, p) => ingested(s) || p.firstOsJob,
    text: 'Drag a client key into the USB port and leave it there.',
    why: 'The OS reads the job onto the drive and runs it, with no restart. The key stays in the port while the OS works.',
    targets: (s) => ['usb', ...(s.plugged ? [`key:${s.plugged.id}`] : s.tray[0] ? [`key:${s.tray[0].id}`] : ['tray'])] },
  { id: 'osPaid', chapter: 'The OS', title: 'Wait for the result', flag: 'firstOsJob',
    text: 'The OS runs the job and writes the answer onto the key. It pops out by itself and you are paid.',
    why: 'The machine stays on and takes the next key as soon as you plug it. Watch the badge on the drive for what the OS is doing.',
    targets: () => ['os', 'monitor'] },
  { id: 'done', chapter: null, title: 'Workshop open', flag: null,
    text: 'The machine now runs jobs on its own. Next goal: Level 4 opens the network, so jobs arrive without keys. It needs a Basic board for the jack, a router and a plan, and no more memory.',
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

const unpowered = (s: Snapshot) => (s.powered ? 'The machine is on. Power it off first.' : null);

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
    case 'power':
      if (s.phase === 'error' && s.phaseReason) return `POST error: ${s.phaseReason}. Power off, fix it, power on again.`;
      return s.noPowerReason ?? (s.postBlocker && `POST would fail: ${s.postBlocker}`) ?? (s.plugged ? null : 'No key in the USB port yet: the machine would halt with NO BOOT MEDIA.');
    case 'plugKey':
      if (!s.tray.length && !s.plugged) return 'No key yet. A client key will arrive in the tray soon.';
      return s.powered ? 'The machine is already on, so it will not look at a new key. Power it off, plug the key in, then power on.' : null;
    case 'watch':
      if (s.keyIgnored || s.haltReason === 'no-boot-media') return 'The machine did not see the key: it only looks at boot. Power off, plug the key in, and power on again.';
      return s.phase === 'error' ? s.phaseReason : null;
    case 'cycle':
      if (!s.plugged) return s.tray.length ? 'Plug the next key into the USB port first.' : 'No key yet. A client key will arrive in the tray soon.';
      return s.powered ? 'Press the power button to switch off, then again to switch on: the machine reads the key at boot.' : null;
    case 'fit':
      return unpowered(s);
    case 'buyDrive': case 'buyOs': {
      const id = step.id === 'buyDrive' ? 'hdd0' : 'os1';
      const p = s.purchases.find((x) => x.id === id);
      if (!p) return null;
      if (p.locked) return `Needs Level ${p.locked.level} (${p.locked.name}). Keep serving clients.`;
      if (p.blocked) return p.blocked;
      return p.affordable ? null : `Need ${fmtMoney(p.price - s.money)} more.`;
    }
    case 'drive':
      return unpowered(s) ?? (invOf(s, 'storage').length ? itemReason(s, 'storage') : 'No drive in the inventory. Buy one first.');
    case 'os':
      return unpowered(s) ?? (invOf(s, 'os').length ? itemReason(s, 'os') : 'No operating system in the inventory. Buy one first.');
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
