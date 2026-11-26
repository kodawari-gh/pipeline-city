// Board model: pure data plus validation. A Board is plain JSON-serialisable data.

import { BOARD_TIERS, CASE_TIERS, cardLeads, caseMounts, getSpec, pcieLabel } from './specs';
import type * as specsTypes from './specs';

export interface InstalledDevice {
  /** Instance id, unique within the board (e.g. "dev3"). */
  id: string;
  /** Key into DEVICE_SPECS. */
  spec: string;
  /** Slot instance id (e.g. "dimm1"). */
  slot: string;
  /** Requested clock in ticks per base tick (absent for unclocked parts). */
  clock?: number;
  /** Set by the thermal model after sustained excess heat. Burnt parts do nothing until replaced. */
  burnt?: boolean;
}

export interface Board {
  tier: number;
  /** The PC case it sits in (`CASE_TIERS`); it holds boards up to its `maxBoard`. The game refuses a board the case cannot hold. */
  caseTier: number;
  nextId: number;
  devices: InstalledDevice[];
  /** The board's VRM burnt out: the board is dead (nothing powers on) until replaced by the same or a higher tier. */
  burnt?: boolean;
}

/** `width`: a `pcie` slot's lanes. `size`: a `fan` spot's fan size, mm. */
export interface SlotInfo {
  id: string;
  type: specsTypes.SlotType;
  width?: number | undefined;
  size?: number | undefined;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };

/** A slot of type `have` takes a device that needs `need`: same type, or an ATX+ connector taking a plain ATX PSU. */
export function slotAccepts(have: specsTypes.SlotType, need: specsTypes.SlotType): boolean {
  return have === need || (have === 'atx-plus' && need === 'atx');
}

/** A fresh board in the smallest case that holds it (or in `caseTier`, which must hold it). */
export function createBoard(tier = 0, caseTier?: number): Board {
  if (!BOARD_TIERS[tier]) {
    throw new RangeError(`unknown board tier ${tier}`);
  }
  const c = caseTier ?? CASE_TIERS.findIndex((x) => x.maxBoard >= tier);
  if (!CASE_TIERS[c] || CASE_TIERS[c]!.maxBoard < tier) {
    throw new RangeError(`case ${c} cannot hold board tier ${tier}`);
  }
  return { tier, caseTier: c, nextId: 1, devices: [] };
}

/** Does the board's case hold a board of this tier? */
export const caseHolds = (board: Board, boardTier: number): boolean =>
  (CASE_TIERS[board.caseTier]?.maxBoard ?? -1) >= boardTier;

/** Fit another case, bigger or smaller, as long as it holds the board (the board and every part stay as they are). */
export function upgradeCase(board: Board, tier: number): Result<object> {
  const c = CASE_TIERS[tier];
  if (!c) {
    return { ok: false, reason: `unknown case tier ${tier}` };
  }
  if (tier === board.caseTier) {
    return { ok: false, reason: `the ${c.name} is already fitted` };
  }
  if (c.maxBoard < board.tier) {
    return {
      ok: false,
      reason: `the ${c.name} is too small for the ${BOARD_TIERS[board.tier]!.name} board: fit a smaller board first`,
    };
  }
  for (const d of board.devices) {
    const side = radiatorSide(d.slot);
    if (side !== null && sideMounts(tier, side).length === 0) {
      return { ok: false, reason: `the ${c.name} has no ${side} fan mounts for the radiator: take it out first` };
    }
  }
  board.caseTier = tier;
  return { ok: true };
}

/** Slot instances of a board tier, ids like "dimm0", "dimm1". */
export function boardSlots(board: Board): SlotInfo[] {
  const t = BOARD_TIERS[board.tier];
  if (!t) {
    return [];
  }
  const out: SlotInfo[] = [];
  for (const [type, n] of Object.entries(t.slots) as [specsTypes.SlotType, number][]) {
    for (let k = 0; k < n; k++) {
      out.push(type === 'pcie' ? { id: `${type}${k}`, type, width: t.pcieWidths[k] } : { id: `${type}${k}`, type });
    }
  }
  // A radiator bolts onto one side of the case (front or top) and spans every fan mount of that side; their fans push air through it.
  for (const side of RADIATOR_SIDES) {
    if (sideMounts(board.caseTier, side).length > 0) {
      out.push({ id: radiatorSlot(side), type: 'radiator' });
    }
  }
  return [...out, ...fanSlots(board)];
}

/** The fan spots: every case mount (the case's fan size), then the spots of each fitted heatsink that has them (`<its slot>.fan<k>`). */
export function fanSlots(board: Board): SlotInfo[] {
  const size = CASE_TIERS[board.caseTier]?.fanSize;
  const out: SlotInfo[] = caseMounts(board.caseTier).map((id) => ({ id, type: 'fan', size }));
  for (const d of board.devices) {
    const spots = hostSpots(d);
    if (spots) {
      for (let k = 0; k < spots.n; k++) {
        out.push({ id: `${d.slot}.fan${k}`, type: 'fan', size: spots.size });
      }
    }
  }
  return out;
}

/** A device's fan spots (an air heatsink, the fan fins), or null. */
export function hostSpots(d: InstalledDevice): specsTypes.FanSpots | null {
  return (getSpec(d.spec) as { fanSpots?: specsTypes.FanSpots } | undefined)?.fanSpots ?? null;
}

/** The slot of the heatsink a fan spot belongs to (`cooler0` for `cooler0.fan1`), or null for a case mount. */
export const fanHost = (slotId: string): string | null => {
  const k = slotId.lastIndexOf('.fan');
  return k > 0 ? slotId.slice(0, k) : null;
};

/** The fans on a heatsink's spots (by the heatsink's slot). */
export const fansOn = (board: Board, hostSlot: string): InstalledDevice[] =>
  board.devices.filter((d) => fanHost(d.slot) === hostSlot && getSpec(d.spec)?.kind === 'fan');

/** The fan on a case mount, if one is fitted. */
export const mountFan = (board: Board, mount: string): InstalledDevice | undefined =>
  board.devices.find((d) => d.slot === mount && getSpec(d.spec)?.kind === 'fan');

/** The summed airflow of these fans (burnt ones turn no more). */
export const fanAir = (fans: readonly InstalledDevice[]): number =>
  fans.reduce((a, d) => a + (d.burnt ? 0 : (getSpec(d.spec) as specsTypes.FanSpec).airflow), 0);

/**
 * The fans whose spot is gone or takes another size now: a case swapped for one with fewer or other mounts, a heatsink taken out or swapped for one
 * with other spots. The Game sends them back to the inventory.
 */
export function strayFans(board: Board): InstalledDevice[] {
  const spots = new Map(fanSlots(board).map((s) => [s.id, s.size]));
  return board.devices.filter((d) => {
    const s = getSpec(d.spec);
    return s?.kind === 'fan' && spots.get(d.slot) !== (s as specsTypes.FanSpec).size;
  });
}

/** The sides of the case a radiator can bolt onto (the rear has one fan and the tubes cannot reach it). */
const RADIATOR_SIDES = ['front', 'top'] as const;
export type RadiatorSide = (typeof RADIATOR_SIDES)[number];

/** The slot id of the radiator on a side of the case (`rad-front`, `rad-top`). */
export const radiatorSlot = (side: RadiatorSide): string => `rad-${side}`;

/** The side a radiator slot sits on, or null for any other slot. */
function radiatorSide(slotId: string): RadiatorSide | null {
  if (slotId === 'rad-front') {
    return 'front';
  }
  if (slotId === 'rad-top') {
    return 'top';
  }
  return null;
}

/** The fan mounts of one side of the case (`front0..`, `top0..`): the ones a radiator on that side spans. */
export const sideMounts = (tier: number, side: RadiatorSide): string[] =>
  caseMounts(tier).filter((m) => m.startsWith(side));

/** The radiator, the side it is on and the mounts it spans, if one is fitted. */
export function fittedRadiator(board: Board): { dev: InstalledDevice; side: RadiatorSide; mounts: string[] } | null {
  for (const d of board.devices) {
    const side = radiatorSide(d.slot);
    if (side !== null) {
      return { dev: d, side, mounts: sideMounts(board.caseTier, side) };
    }
  }
  return null;
}

/** A save from when a radiator took one mount (`rad-top1`, `rad-rear`) keeps it, now on that mount's side (the rear becomes the top, or the front). */
export function legacyRadiatorSlots(board: Board): void {
  for (const d of board.devices) {
    const m = /^rad-(?<side>front|top|rear)\d*$/u.exec(d.slot);
    if (!m || radiatorSide(d.slot)) {
      continue;
    }
    d.slot = radiatorSlot(
      m.groups?.['side'] === 'front' || sideMounts(board.caseTier, 'top').length === 0 ? 'front' : 'top',
    );
  }
}

export function deviceSpec(d: InstalledDevice): specsTypes.DeviceSpec {
  const s = getSpec(d.spec);
  if (!s) {
    throw new Error(`unknown device spec ${d.spec}`);
  }
  return s;
}

export function findDevices(board: Board, kind: specsTypes.DeviceSpec['kind']): InstalledDevice[] {
  return board.devices.filter((d) => deviceSpec(d).kind === kind);
}

/** Does `spec` fit the slot's size: a card narrow enough for its lanes, a fan of the spot's size? (Always, for a slot without a width or a size.) */
export const slotFits = (slot: SlotInfo, spec: specsTypes.DeviceSpec): boolean =>
  (slot.width === undefined || (spec.pcieWidth ?? 1) <= slot.width) &&
  (slot.size === undefined || (spec as Partial<specsTypes.FanSpec>).size === slot.size);

/** Why `spec` does not go into `slot`, or null if it does. */
export function slotRefusal(slot: SlotInfo, spec: specsTypes.DeviceSpec): string | null {
  if (!slotAccepts(slot.type, spec.slot)) {
    return `${spec.name} needs a ${spec.slot} slot, "${slot.id}" is ${slot.type}`;
  }
  if (slot.size !== undefined && !slotFits(slot, spec)) {
    return `${spec.name} does not fit: "${slot.id}" takes a ${slot.size} mm fan`;
  }
  if (!slotFits(slot, spec)) {
    return `${spec.name} needs a ${pcieLabel(spec.pcieWidth ?? 1)} slot, "${slot.id}" is only ${pcieLabel(slot.width ?? 1)}`;
  }
  return null;
}

/**
 * Free slots of `type`; with `spec`, only those it fits, the narrowest first (a small card does not take the big slot a GPU needs) and a
 * heatsink's fan spot before a case mount (the processor's cooling first).
 */
export function freeSlots(board: Board, type: specsTypes.SlotType, spec?: specsTypes.DeviceSpec): SlotInfo[] {
  const used = new Set(board.devices.map((d) => d.slot));
  const free = boardSlots(board).filter(
    (s) => slotAccepts(s.type, type) && !used.has(s.id) && (!spec || slotFits(s, spec)),
  );
  const rank = (s: SlotInfo) => (s.width ?? 0) + (s.type === 'fan' && fanHost(s.id) === null ? 1 : 0);
  return spec ? free.sort((a, b) => rank(a) - rank(b)) : free;
}

/** Rated load (W, at base clocks) of everything except the PSU. */
export function ratedLoadW(board: Board, extra?: specsTypes.DeviceSpec): number {
  let w = extra && extra.kind !== 'psu' ? extra.loadW : 0;
  for (const d of board.devices) {
    const s = deviceSpec(d);
    if (s.kind !== 'psu') {
      w += s.loadW;
    }
  }
  return w;
}

/** PCIe power leads the working GPUs and NPUs on the board take together (burnt cards count out). */
export function pcieLeadsNeeded(board: Board): number {
  let n = 0;
  for (const d of board.devices) {
    const s = deviceSpec(d);
    if (!d.burnt && (s.kind === 'gpu' || s.kind === 'npu')) {
      n += cardLeads(s);
    }
  }
  return n;
}

export function installedPsu(board: Board): { dev: InstalledDevice; spec: specsTypes.PsuSpec } | null {
  for (const d of board.devices) {
    const s = deviceSpec(d);
    if (s.kind === 'psu') {
      return { dev: d, spec: s };
    }
  }
  return null;
}
