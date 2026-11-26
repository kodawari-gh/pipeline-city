// Types of the part picker's card model (picker.ts re-exports them). No logic.

import type { DeviceKind } from '@/features/board/sim/specs';
import type { DeviceSnap } from '@/worker/game/game';
import type { Level } from '@/core/ui/logic';
import type { JobView, LevelLock, MoreOffer } from '../progress/levelui';
import type { BoardCard, VrmReadout } from '@/features/board/ui/vrm';

/** What a selected id can stand for: a part kind or a world object with a ladder of its own. */
export type SelectedKind = DeviceKind | 'board' | 'case' | 'os' | 'router' | 'isp';

export type PickerKind =
  DeviceKind | 'board' | 'case' | 'os' | 'router' | 'isp' | 'key' | 'tray' | 'power' | 'usb' | 'info';
export type IconName =
  | 'bolt'
  | 'flame'
  | 'clock'
  | 'dollar'
  | 'memory'
  | 'cpu'
  | 'lock'
  | 'check'
  | 'box'
  | 'fan'
  | 'slot'
  | 'warn'
  | 'gauge'
  | 'net'
  | 'usb'
  | 'screen'
  | 'disk'
  | 'eff'
  | 'wave'
  | 'down'
  | 'up'
  | 'star'
  | 'stick'
  | 'board'
  | 'case'
  | 'heatsink'
  | 'tower'
  | 'layers'
  | 'router'
  | 'globe'
  | 'shop'
  | 'play'
  | 'pause'
  | 'card'
  | 'grid';

export interface PickerLine {
  level: Level | 'info';
  text: string;
}

export interface PickerAction {
  id: 'power' | 'powerCycle' | 'plug' | 'eject' | 'uninstall' | 'uninstallOs' | 'formatDrive';
  label: string;
  keyId?: number | undefined;
  /** `uninstall`: the installed device to take out (`router` for the router spot). */
  deviceId?: string | undefined;
  primary?: boolean | undefined;
  /** Disabled reason, when the action is shown but cannot be taken now. */
  why?: string | undefined;
}

/** One numeric property of a part, for the bars. `value` is in `unit`; bars use `goodness` (0..1). */
export interface Stat {
  key: string;
  label: string;
  icon: IconName;
  value: number;
  unit: string;
  higherIsBetter: boolean;
  /** The values span orders of magnitude (network speeds): bar lengths use a log scale. */
  log?: boolean | undefined;
}

/** One rung of the upgrade ladder for a kind of part. */
type LadderState = 'installed' | 'crate' | 'ready' | 'poor' | 'blocked' | 'locked' | 'level';

export interface LadderStep {
  /** Spec id (`cpu1`), or `board<tier>` for the board ladder. */
  specId: string;
  name: string;
  tier: number;
  state: LadderState;
  price?: number | undefined;
  /** Sandbox game: show "free" instead of the price. */
  free?: boolean | undefined;
  /** Why it cannot be bought (poor, blocked) or a short note (crate, locked). */
  reason?: string | undefined;
  /** State `level`: the player level that opens it (greyed tile, lock and "Level N"). */
  lock?: LevelLock | undefined;
  /** The gating level is the very next one: a subtle outline. */
  soon?: boolean | undefined;
  /** Installed device instance id, for the installed rung. */
  devId?: string | undefined;
  /** Inventory item id, for the crate rung. */
  invId?: string | undefined;
  /** A warning on the rung (a CPU the board's VRM cannot feed, a liquid cooler with no VRM heatsink, a router with no OS yet). */
  warn?: string | undefined;
  /** The word for the installed rung when "Fitted" is wrong: "Active" for a plan, "Placed" for a router. */
  fittedLabel?: string | undefined;
  /** Buying applies it at once (an internet plan) instead of adding it to the inventory. */
  applied?: boolean | undefined;
  /** Copies of it in the inventory (a spare), on a fitted or spare tile. */
  spares?: number | undefined;
  /** Buying another copy: set on a fitted or spare tile, where the tile itself has no buy button. */
  more?: MoreOffer | undefined;
}

export interface PickerModel {
  id: string;
  kind: PickerKind;
  title: string;
  plain: string;
  nerd: string;
  /** Upgrade ladder for part kinds: owned, next and blocked rungs (older tiers are left out). */
  ladder: LadderStep[];
  /** The VRM readout (the `vrm` id, and the CPU card when a CPU is fitted). */
  vrm?: VrmReadout | null | undefined;
  /** The motherboard tier cards (the `board` picker). Replaces the rung list for boards. */
  boardCards?: BoardCard[] | undefined;
  /** Spec id of the part in this socket (or the first of its kind), for the before/after bars. */
  current: string | null;
  /** The spec the player selected (an inventory part, or a spec id): the default option for the bars. */
  focus: string | null;
  emptyText?: string | undefined;
  lines: PickerLine[];
  actions: PickerAction[];
  /** Show the CPU clock control. */
  clock: boolean;
  /** Installed device, for live readings and the clock. */
  device?: DeviceSnap | undefined;
  /** The installed OS, on the card for the OS itself and for the drive that hosts it. */
  osSection?: OsSection | null | undefined;
  /** The bay's shelf: operating systems on offer (only while no OS is installed). */
  shelf?: LadderStep[] | undefined;
  /** A key card: its needs, deadline and decline (levelui.ts). */
  job?: JobView | undefined;
  /** A small tag next to the title: `retired` on a USB key whose client went online. */
  tag?: string | undefined;
}

interface OsQueueRow {
  keyId: number;
  label: string;
  type: string;
  state: string;
  text: string;
  job: JobView | null;
  retired: boolean;
}
/** The OS block of a card: what the OS is doing, its queue, the host drive and the later tiers. */
export interface OsSection {
  name: string;
  tier: number;
  status: string;
  level: Level | 'info';
  programSlots: number;
  queueSlots: number;
  running: string | null;
  queue: OsQueueRow[];
  host: { slot: string; usedK: number; capK: number } | null;
  ladder: LadderStep[];
}

export interface CompareRow {
  key: string;
  label: string;
  icon: IconName;
  /** Bar lengths 0..1 for the current part (null when there is none) and the option. */
  cur: number | null;
  opt: number;
  curText: string | null;
  optText: string;
  /** better / worse / same, for the colour of the delta. Null with no current part. */
  trend: 'better' | 'worse' | 'same' | null;
  deltaText: string | null;
}
