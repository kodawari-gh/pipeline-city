// Guided tutorial, pure logic. The current step is derived from the snapshot's `progress` flags (so loading a save
// mid-way resumes correctly and out-of-order actions are simply skipped) plus a tiny persisted state
// (welcome acknowledged / skipped / finished / replay baseline). No DOM, no signals.

import type { Snapshot } from '../sim/game/game';
import type { Progress } from '../sim/game/save';

export interface ReplayBase { completed: number; owned: number }
export interface TutorialState {
  welcomed: boolean;
  skipped: boolean;
  finished: boolean;
  /** Set when replaying: flags are sticky, so steps are judged from live state and deltas against this baseline. */
  replay: ReplayBase | null;
}

export const INITIAL_TUTORIAL: TutorialState = { welcomed: false, skipped: false, finished: false, replay: null };

export type StepId =
  | 'welcome' | 'cpu' | 'ram' | 'psu' | 'monitor' | 'atx' | 'cpuPower' | 'video' | 'power' | 'plugKey' | 'watch'
  | 'removeKey' | 'spend' | 'done';

export interface StepDef {
  id: StepId;
  title: string;
  text: string;
  /** Progress flag that completes the step (null: needs the player to press the card button). */
  flag: keyof Progress | null;
  /** World ids to pulse (renderer highlight). */
  targets: (s: Snapshot) => string[];
}

const invOf = (s: Snapshot, kind: string) => s.inventory.filter((i) => i.kind === kind);
/** Crate item ids of a kind plus the free slots they fit. */
const installTargets = (kind: string) => (s: Snapshot): string[] => {
  const items = invOf(s, kind);
  return [...items.map((i) => `inv:${i.id}`), ...items.flatMap((i) => i.freeSlots)];
};

/** The HUD's inventory button. A UI-only id: the renderer ignores it, the HUD pulses the button. */
export const INVENTORY_ID = 'inventory';

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
  { id: 'done', title: 'Workshop open', flag: null,
    text: 'Your new part is in the inventory. Power the machine off, then drag it onto its socket. Keep the keys moving: one day a router will plug them in for you.',
    targets: (s) => (s.inventory[0] ? [`inv:${s.inventory[0].id}`] : []) },
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

export function tutorialActive(st: TutorialState): boolean {
  return !st.skipped && !st.finished;
}

/** The step to show now, or null when the tutorial is skipped/finished. */
export function currentStep(s: Snapshot, st: TutorialState): StepDef | null {
  if (!tutorialActive(st)) return null;
  const p = effectiveProgress(s, st);
  const welcomed = st.welcomed || (!st.replay && anyFlag(p));
  if (!welcomed) return STEPS[0]!;
  for (const step of STEPS) {
    if (step.id === 'welcome' || step.id === 'done') continue;
    if (!p[step.flag as keyof Progress]) return step;
  }
  return STEPS[STEPS.length - 1]!;
}

/** "3 / 12" style position, skipping the welcome and final cards. */
export function stepCount(step: StepDef): { n: number; total: number } {
  const mid = STEPS.filter((x) => x.id !== 'welcome' && x.id !== 'done');
  const i = mid.findIndex((x) => x.id === step.id);
  return { n: i < 0 ? (step.id === 'welcome' ? 0 : mid.length) : i + 1, total: mid.length };
}

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
      return items.every((i) => !i.freeSlots.length && !i.swapSlots.length) ? items[0]!.reason ?? null : null;
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
  };
}
