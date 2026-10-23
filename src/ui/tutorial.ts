// Guided tutorial, pure logic. The current step is the first step not yet done, judged from the snapshot: the sticky
// `progress` flags where there is one, else live state (an item in the inventory, the phase, a key's stage). Loading a
// save mid-way resumes at the right step, and out-of-order actions are simply skipped past. Only the welcome card
// (Start) and the last card (Got it) have buttons, plus the one-time "Next lesson: the OS" offer. No DOM, no signals.

import { getSpec } from '../sim/board/specs';
import { getOsSpec } from '../sim/os';
import type { Snapshot } from '../sim/game/game';
import type { Progress } from '../sim/game/save';
import { fmtMoney } from './logic';

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
  | 'welcome' | 'cpu' | 'ram' | 'psu' | 'monitor' | 'atx' | 'cpuPower' | 'video' | 'power' | 'plugKey' | 'watch'
  | 'removeKey' | 'spend' | 'fit' | 'buyDrive' | 'drive' | 'buyOs' | 'os' | 'bootOs' | 'osIngest' | 'osHold' | 'osWait'
  | 'osCollect' | 'osPaid' | 'done';

export interface StepDef {
  id: StepId;
  title: string;
  text: string;
  /** Progress flag that completes the step, if it has one. */
  flag: keyof Progress | null;
  /** Live completion test for steps without a flag (see `isDone`). */
  done?: (s: Snapshot, p: Progress) => boolean;
  /** World ids to pulse (renderer highlight). */
  targets: (s: Snapshot) => string[];
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
const heldWith = (s: Snapshot, stage: string) => s.held.find((k) => k.stage === stage);
/** The OS has copied a key into its queue (plugged, or already held). */
const ingested = (s: Snapshot) => s.held.length > 0 || pluggedAt(s, ['queued', 'running', 'result', 'flashing', 'done']);

/** The HUD's inventory button. A UI-only id: the renderer ignores it, the HUD pulses the button. */
export const INVENTORY_ID = 'inventory';

const OS_RAM_KB = (getOsSpec('os1')?.minRamBytes ?? 32 * 1024) / 1024;

export const STEPS: StepDef[] = [
  {
    id: 'welcome', title: 'Welcome', flag: null,
    text: 'You run a one-person computer workshop. Clients send small jobs on USB keys; your machine does them and you get paid. First, open the inventory (top right) and build the machine from the parts in it.',
    targets: () => [INVENTORY_ID],
  },
  { id: 'cpu', title: 'Install the processor', flag: 'cpuInstalled',
    text: 'Open the inventory and drag the processor (CPU) onto the big square socket in the middle of the board.',
    targets: installTargets('cpu') },
  { id: 'ram', title: 'Install the memory', flag: 'ramInstalled',
    text: 'Drag a memory stick (RAM) from the inventory into a long memory slot next to the processor.',
    targets: installTargets('ram') },
  { id: 'psu', title: 'Install the power supply', flag: 'psuInstalled',
    text: 'Drag the power supply (PSU) from the inventory into the bay below the board.',
    targets: installTargets('psu') },
  { id: 'monitor', title: 'Install the monitor', flag: 'monitorInstalled',
    text: 'Drag the monitor from the inventory onto the display port. It will show what the machine is doing.',
    targets: installTargets('display') },
  { id: 'atx', title: 'Connect the main power cable', flag: 'atxConnected',
    text: 'Plug in the big ATX cable: drag its end from the power supply to the matching socket on the board.',
    targets: () => ['cable.atx', 'psu'] },
  { id: 'cpuPower', title: 'Connect the processor power cable', flag: 'cpuPowerConnected',
    text: 'The processor gets its own cable. Plug the CPU power cable from the power supply into the board.',
    targets: () => ['cable.cpu', 'psu'] },
  { id: 'video', title: 'Connect the video cable', flag: 'videoConnected',
    text: 'Plug the video cable between the board and the monitor so you can see the screen.',
    targets: () => ['cable.video', 'monitor'] },
  { id: 'power', title: 'Press the power button', flag: 'poweredOn',
    text: 'Press the power button. The machine tests itself (POST) and the monitor shows the results.',
    targets: () => ['power'] },
  { id: 'plugKey', title: 'Plug in a client key', flag: 'firstKeyPlugged',
    text: 'A client left a key in the tray. This is where work comes from: drag it into the USB port. The machine runs one job at a time.',
    targets: (s) => ['usb', ...(s.tray[0] ? [`key:${s.tray[0].id}`] : ['tray'])] },
  { id: 'watch', title: 'Watch it work', flag: 'firstJobDone',
    text: 'The machine copies the job into memory, runs it, and writes the answer back to the key. Watch the monitor.',
    targets: () => ['monitor'] },
  { id: 'removeKey', title: 'Remove the key', flag: 'firstKeyEjected',
    text: 'Done! Pull the key out of the USB port to hand it back. You are paid when it is removed, and idle time is lost income.',
    targets: () => ['usb'] },
  { id: 'spend', title: 'Spend your first money', flag: 'firstPurchase',
    text: 'Click the processor on the board to see its upgrades. Buy one. It goes into the inventory.',
    targets: (s) => {
      const cpu = s.devices.find((d) => d.kind === 'cpu');
      return cpu ? [cpu.slot] : [INVENTORY_ID];
    } },
  // ---- storage and the OS ----
  { id: 'fit', title: 'Fit your new part', flag: null,
    done: (s) => !s.inventory.some((i) => pendingUpgrade(s, i)),
    text: `Power the machine off, then drag the part you bought from the inventory onto its socket. The operating system needs ${OS_RAM_KB}K of memory fitted.`,
    targets: (s) => s.inventory
      .filter((i) => pendingUpgrade(s, i))
      .flatMap((i) => [`inv:${i.id}`, ...i.freeSlots, ...i.swapSlots]) },
  { id: 'buyDrive', title: 'Buy a drive', flag: null,
    done: (s) => ownsStorage(s),
    text: 'The machine needs somewhere to keep an operating system. Click the drive bay to see the drives: an HDD is slow and cheap, an SSD is faster.',
    targets: () => ['bay'] },
  { id: 'drive', title: 'Install the drive', flag: 'storageInstalled',
    text: 'Power off, then drag the drive from the inventory onto a free drive bay (a SATA port) on the board. The drive speed decides how fast the OS loads.',
    targets: installTargets('storage') },
  { id: 'buyOs', title: 'Buy an operating system', flag: null,
    done: (s) => ownsOs(s),
    text: 'An operating system keeps the machine running, so it does not reboot for every job. Click the OS area on the monitor to see the systems on offer.',
    targets: () => ['os'] },
  { id: 'os', title: 'Install the OS on the drive', flag: 'osInstalled',
    text: 'Power off, then drag the operating system from the inventory onto the drive. It is written onto the drive, which is where it boots from.',
    targets: installTargets('os') },
  { id: 'bootOs', title: 'Boot the OS from the drive', flag: null,
    done: (s) => OS_PHASES.includes(s.phase) || s.progress.firstOsJob,
    text: 'Press the power button. The machine loads the OS from the drive. Watch the monitor: a faster drive boots sooner.',
    targets: () => ['power', 'os', 'bay'] },
  { id: 'osIngest', title: 'Plug in a key: the OS takes it', flag: null,
    done: (s, p) => ingested(s) || p.firstOsJob,
    text: 'Drag a client key into the USB port. The OS copies the job onto the drive and queues it. Keep the key in until it is queued.',
    targets: (s) => ['usb', ...(s.plugged ? [`key:${s.plugged.id}`] : s.tray[0] ? [`key:${s.tray[0].id}`] : ['tray'])] },
  { id: 'osHold', title: 'Unplug it: the OS keeps the job', flag: null,
    done: (s, p) => s.held.length > 0 || pluggedAt(s, ['result', 'flashing', 'done']) || p.firstOsJob,
    text: 'Pull the key out. The OS now holds it: the job runs while you are away and the key waits in your hands until the result is ready.',
    targets: (s) => ['usb', ...(s.plugged ? [`key:${s.plugged.id}`] : [])] },
  { id: 'osWait', title: 'Wait for the job', flag: null,
    done: (s, p) => !!heldWith(s, 'result') || pluggedAt(s, ['result', 'flashing', 'done']) || p.firstOsJob,
    text: 'The OS runs its queued jobs one at a time. The monitor shows the work. When a held key has its result, it is ready to collect.',
    targets: () => ['monitor', 'os', 'held'] },
  { id: 'osCollect', title: 'Plug the key back in to collect', flag: null,
    done: (s, p) => pluggedAt(s, ['flashing', 'done']) || p.firstOsJob,
    text: 'Plug the same key back into the USB port. The OS writes the result onto it. Wait for it to land.',
    targets: (s) => {
      const k = s.plugged ?? heldWith(s, 'result') ?? s.held[0];
      return ['usb', ...(k ? [`key:${k.id}`] : ['held'])];
    } },
  { id: 'osPaid', title: 'Remove the key to get paid', flag: 'firstOsJob',
    text: 'Pull the finished key out of the USB port. You are paid on removal, and the OS is free for the next job.',
    targets: (s) => ['usb', ...(s.plugged ? [`key:${s.plugged.id}`] : [])] },
  { id: 'done', title: 'Workshop open', flag: null,
    text: 'Your OS now runs jobs from the USB keys. Next: a network card and a router will fetch jobs and send results for you, so the USB keys will fade away.',
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
    cpuInstalled: has('cpu'), psuInstalled: has('psu'), ramInstalled: has('ram'), monitorInstalled: has('display'),
    atxConnected: cable('atx'), cpuPowerConnected: cable('cpu'), videoConnected: cable('video'),
    poweredOn: s.powered && s.phase !== 'off',
    storageInstalled: s.storage.length > 0, osInstalled: !!s.os, firstOsJob: s.progress.firstOsJob,
    firstKeyPlugged: !!s.plugged || done,
    firstJobDone: done,
    firstKeyEjected: ejected,
    firstPurchase: owned > b.owned,
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
  return !st.skipped && !st.offered && legacyFinished(s, st);
}

/** The step to show now, or null when the tutorial is skipped, finished, or a legacy player is not taking the lesson. */
export function currentStep(s: Snapshot, st: TutorialState): StepDef | null {
  if (!tutorialActive(st) || legacyFinished(s, st)) return null;
  const p = effectiveProgress(s, st);
  const welcomed = st.welcomed || (!st.replay && anyFlag(p));
  if (!welcomed) return STEPS[0]!;
  for (const step of STEPS) {
    if (step.id === 'welcome' || step.id === 'done') continue;
    if (!isDone(step, s, p)) return step;
  }
  return STEPS[STEPS.length - 1]!;
}

/** "3 / 12" style position, skipping the welcome and final cards. */
export function stepCount(step: StepDef): { n: number; total: number } {
  const mid = STEPS.filter((x) => x.id !== 'welcome' && x.id !== 'done');
  const i = mid.findIndex((x) => x.id === step.id);
  return { n: i < 0 ? (step.id === 'welcome' ? 0 : mid.length) : i + 1, total: mid.length };
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
    case 'atx': case 'cpuPower': case 'video': {
      const id = step.id === 'atx' ? 'atx' : step.id === 'cpuPower' ? 'cpu' : 'video';
      const c = s.cables.find((x) => x.id === id);
      if (c?.blocked) return c.blocked;
      return s.powered ? 'The machine is on. Power it off before plugging cables.' : null;
    }
    case 'power':
      return s.noPowerReason ?? (s.phase === 'error' ? s.phaseReason : null) ?? s.postBlocker;
    case 'plugKey':
      if (!s.tray.length) return 'No key yet. A client key will arrive in the tray soon.';
      return s.powered ? null : 'The machine is off. Press the power button first.';
    case 'watch':
      return s.phase === 'error' ? s.phaseReason : null;
    case 'fit':
      return unpowered(s);
    case 'buyDrive': case 'buyOs': {
      const id = step.id === 'buyDrive' ? 'hdd0' : 'os1';
      const p = s.purchases.find((x) => x.id === id);
      if (!p) return null;
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
      return s.tray.length || s.plugged ? null : 'No key yet. A client key will arrive in the tray soon.';
    case 'osWait':
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
