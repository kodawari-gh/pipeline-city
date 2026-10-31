// Board model: pure data plus validation. A Board is plain JSON-serialisable data.

import { BOARD_TIERS, CASE_TIERS, PCIE_SLOT_W, caseMounts, getSpec, type DeviceSpec, type PsuSpec, type SlotType } from "./specs";

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

/** `width`: a `pcie` slot's lanes. */
export interface SlotInfo { id: string; type: SlotType; width?: number }

export type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };

/** A slot of type `have` takes a device that needs `need`: same type, or an ATX+ connector taking a plain ATX PSU. */
export function slotAccepts(have: SlotType, need: SlotType): boolean {
  return have === need || (have === "atx-plus" && need === "atx");
}

/** A fresh board in the smallest case that holds it (or in `caseTier`, which must hold it). */
export function createBoard(tier = 0, caseTier?: number): Board {
  if (!BOARD_TIERS[tier]) throw new RangeError(`unknown board tier ${tier}`);
  const c = caseTier ?? CASE_TIERS.findIndex((x) => x.maxBoard >= tier);
  if (!CASE_TIERS[c] || CASE_TIERS[c]!.maxBoard < tier) throw new RangeError(`case ${c} cannot hold board tier ${tier}`);
  return { tier, caseTier: c, nextId: 1, devices: [] };
}

/** Does the board's case hold a board of this tier? */
export const caseHolds = (board: Board, boardTier: number): boolean => (CASE_TIERS[board.caseTier]?.maxBoard ?? -1) >= boardTier;

/** Fit another case, bigger or smaller, as long as it holds the board (the board and every part stay as they are). */
export function upgradeCase(board: Board, tier: number): Result<object> {
  const c = CASE_TIERS[tier];
  if (!c) return { ok: false, reason: `unknown case tier ${tier}` };
  if (tier === board.caseTier) return { ok: false, reason: `the ${c.name} is already fitted` };
  if (c.maxBoard < board.tier) return { ok: false, reason: `the ${c.name} is too small for the ${BOARD_TIERS[board.tier]!.name} board: fit a smaller board first` };
  for (const d of board.devices) {
    const side = radiatorSide(d.slot);
    if (side !== null && sideMounts(tier, side).length === 0) return { ok: false, reason: `the ${c.name} has no ${side} fan mounts for the radiator: take it out first` };
  }
  board.caseTier = tier;
  return { ok: true };
}

/** Slot instances of a board tier, ids like "dimm0", "dimm1". */
export function boardSlots(board: Board): SlotInfo[] {
  const t = BOARD_TIERS[board.tier];
  if (!t) return [];
  const out: SlotInfo[] = [];
  for (const [type, n] of Object.entries(t.slots) as [SlotType, number][]) {
    for (let k = 0; k < n; k++) out.push(type === "pcie" ? { id: `${type}${k}`, type, width: t.pcieWidths[k] } : { id: `${type}${k}`, type });
  }
  // A radiator bolts onto one side of the case (front or top) and spans every fan mount of that side, taking their fans.
  for (const side of RADIATOR_SIDES) if (sideMounts(board.caseTier, side).length > 0) out.push({ id: radiatorSlot(side), type: "radiator" });
  return out;
}

/** The sides of the case a radiator can bolt onto (the rear has one fan and the tubes cannot reach it). */
export const RADIATOR_SIDES = ["front", "top"] as const;
export type RadiatorSide = (typeof RADIATOR_SIDES)[number];

/** The slot id of the radiator on a side of the case (`rad-front`, `rad-top`). */
export const radiatorSlot = (side: RadiatorSide): string => `rad-${side}`;

/** The side a radiator slot sits on, or null for any other slot. */
export const radiatorSide = (slotId: string): RadiatorSide | null => (slotId === "rad-front" ? "front" : slotId === "rad-top" ? "top" : null);

/** The fan mounts of one side of the case (`front0..`, `top0..`): the ones a radiator on that side spans. */
export const sideMounts = (tier: number, side: RadiatorSide): string[] => caseMounts(tier).filter((m) => m.startsWith(side));

/** The radiator, the side it is on and the mounts it spans, if one is fitted. */
export function fittedRadiator(board: Board): { dev: InstalledDevice; side: RadiatorSide; mounts: string[] } | null {
  for (const d of board.devices) {
    const side = radiatorSide(d.slot);
    if (side !== null) return { dev: d, side, mounts: sideMounts(board.caseTier, side) };
  }
  return null;
}

/** A save from when a radiator took one mount (`rad-top1`, `rad-rear`) keeps it, now on that mount's side (the rear becomes the top, or the front). */
export function legacyRadiatorSlots(board: Board): void {
  for (const d of board.devices) {
    const m = /^rad-(front|top|rear)\d*$/.exec(d.slot);
    if (!m || radiatorSide(d.slot)) continue;
    d.slot = radiatorSlot(m[1] === "front" || sideMounts(board.caseTier, "top").length === 0 ? "front" : "top");
  }
}

export function deviceSpec(d: InstalledDevice): DeviceSpec {
  const s = getSpec(d.spec);
  if (!s) throw new Error(`unknown device spec ${d.spec}`);
  return s;
}

export function findDevices(board: Board, kind: DeviceSpec["kind"]): InstalledDevice[] {
  return board.devices.filter((d) => deviceSpec(d).kind === kind);
}

/** Is a card of `spec` narrow enough for the slot? (Always, for a slot without a width.) */
export const slotFitsWidth = (slot: SlotInfo, spec: DeviceSpec): boolean => slot.width === undefined || (spec.pcieWidth ?? 1) <= slot.width;

/** Why `spec` does not go into `slot`, or null if it does. */
export function slotRefusal(slot: SlotInfo, spec: DeviceSpec): string | null {
  if (!slotAccepts(slot.type, spec.slot)) return `${spec.name} needs a ${spec.slot} slot, "${slot.id}" is ${slot.type}`;
  if (!slotFitsWidth(slot, spec)) return `${spec.name} needs a x${spec.pcieWidth} slot, "${slot.id}" is only x${slot.width}`;
  return null;
}

/** Free slots of `type`; with `spec`, only those it fits, the narrowest first (a small card does not take the big slot a GPU needs). */
export function freeSlots(board: Board, type: SlotType, spec?: DeviceSpec): SlotInfo[] {
  const used = new Set(board.devices.map((d) => d.slot));
  const free = boardSlots(board).filter((s) => slotAccepts(s.type, type) && !used.has(s.id) && (!spec || slotFitsWidth(s, spec)));
  return spec ? free.sort((a, b) => (a.width ?? 0) - (b.width ?? 0)) : free;
}

/** Rated load (W, at base clocks) of everything except the PSU. */
export function ratedLoadW(board: Board, extra?: DeviceSpec): number {
  let w = extra && extra.kind !== "psu" ? extra.loadW : 0;
  for (const d of board.devices) {
    const s = deviceSpec(d);
    if (s.kind !== "psu") w += s.loadW;
  }
  return w;
}

export function installedPsu(board: Board): { dev: InstalledDevice; spec: PsuSpec } | null {
  for (const d of board.devices) {
    const s = deviceSpec(d);
    if (s.kind === "psu") return { dev: d, spec: s };
  }
  return null;
}

/**
 * Install a device. Needs a free slot of the spec's type (a given `slotId` must match and be free,
 * otherwise the first free one is used). A PSU needs a matching connector and enough watts for the
 * rated load of what is installed; any other device must not push the rated load past an installed PSU.
 * Only one CPU/PSU/cooler/display per board falls out of the slot counts.
 */
export function install(board: Board, specId: string, slotId?: string): Result<{ id: string; slot: string }> {
  const spec = getSpec(specId);
  if (!spec) return { ok: false, reason: `unknown device "${specId}"` };
  let slot: SlotInfo | undefined;
  if (slotId !== undefined) {
    slot = boardSlots(board).find((s) => s.id === slotId);
    if (!slot) return { ok: false, reason: `board has no slot "${slotId}"` };
    const refusal = slotRefusal(slot, spec);
    if (refusal) return { ok: false, reason: refusal };
    if (board.devices.some((d) => d.slot === slotId)) return { ok: false, reason: `slot "${slotId}" is already used` };
  } else {
    slot = freeSlots(board, spec.slot, spec)[0];
    if (!slot) {
      const all = boardSlots(board).filter((s) => slotAccepts(s.type, spec.slot)), total = all.length;
      const wide = all.filter((s) => slotFitsWidth(s, spec)).length;
      return {
        ok: false,
        reason: total === 0 ? `this board has no ${spec.slot} slot for ${spec.name}`
          : wide === 0 ? `no ${spec.slot} slot on this board is wide enough for ${spec.name} (needs x${spec.pcieWidth}, the widest is x${Math.max(...all.map((s) => s.width ?? 0))})`
          : `no free ${spec.slot} slot for ${spec.name} (${wide} of ${wide} used)`,
      };
    }
  }
  if (spec.kind === "radiator" && fittedRadiator(board)) return { ok: false, reason: "the loop already has a radiator: take it out first" };
  if ((spec.kind === "gpu" || spec.kind === "npu") && spec.loadW > PCIE_SLOT_W && !spec.needsPcieCable) {
    return { ok: false, reason: `${spec.name} draws ${spec.loadW} W, more than a PCIe slot gives (${PCIE_SLOT_W} W): it needs the PCIe power cable` };
  }
  if ((spec.kind === "gpu" || spec.kind === "npu") && (spec.pcieLeads ?? 1) > 1 && spec.needsPcieCable) {
    const have = installedPsu(board)?.spec.pcieLeads ?? 0;
    if (installedPsu(board) && have < spec.pcieLeads!) return { ok: false, reason: `${spec.name} needs ${spec.pcieLeads} PCIe power leads but the PSU has ${have}` };
  }
  if (spec.kind === "psu") {
    const need = ratedLoadW(board);
    if (spec.watts < need) return { ok: false, reason: `${spec.name} gives ${spec.watts} W but installed parts need ${need} W` };
  } else {
    const psu = installedPsu(board);
    if (psu) {
      const need = ratedLoadW(board, spec);
      if (need > psu.spec.watts) return { ok: false, reason: `PSU gives ${psu.spec.watts} W but parts would need ${need} W` };
    }
  }
  const id = `dev${board.nextId++}`;
  const dev: InstalledDevice = { id, spec: specId, slot: slot.id };
  if (spec.clock) dev.clock = spec.clock.base;
  board.devices.push(dev);
  return { ok: true, id, slot: slot.id };
}

/**
 * Move to another board tier, bigger or smaller (or, when the board is burnt, the same tier again), carrying every installed device over (same instance ids, clocks and burnt flags).
 * A smaller board refuses while a device has no slot on it.
 * A device keeps its slot id if the new board has an accepting slot with that id, otherwise it takes the first free
 * accepting slot (e.g. the plain ATX PSU moves to the ATX+ connector). On failure the board is left untouched.
 */
export function upgradeBoard(board: Board, tier: number): Result<object> {
  if (!BOARD_TIERS[tier]) return { ok: false, reason: `unknown board tier ${tier}` };
  // A dead board may be replaced by one of the same tier.
  if (tier === board.tier && !board.burnt) return { ok: false, reason: `the ${BOARD_TIERS[tier]!.name} board is already fitted` };
  const next: Board = { tier, caseTier: board.caseTier, nextId: board.nextId, devices: [] };
  const slots = boardSlots(next);
  const used = new Set<string>();
  const place = (d: InstalledDevice): string | undefined => {
    const spec = deviceSpec(d), need = spec.slot, fits = (s: SlotInfo) => slotAccepts(s.type, need) && slotFitsWidth(s, spec) && !used.has(s.id);
    const same = slots.find((s) => s.id === d.slot && fits(s));
    return (same ?? slots.filter(fits).sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0])?.id;
  };
  // (the widest cards choose first, so a narrow one does not leave them without a slot)
  const moved = new Map<string, string>();
  for (const d of [...board.devices].sort((a, b) => (deviceSpec(b).pcieWidth ?? 0) - (deviceSpec(a).pcieWidth ?? 0))) {
    const slot = place(d);
    if (!slot) return { ok: false, reason: `the ${BOARD_TIERS[tier]!.name} board has no slot for ${deviceSpec(d).name}: take it out first` };
    used.add(slot);
    moved.set(d.id, slot);
  }
  for (const d of board.devices) next.devices.push({ ...d, slot: moved.get(d.id)! });
  board.tier = next.tier;
  board.devices = next.devices;
  delete board.burnt; // the dead board is gone
  return { ok: true };
}

export function uninstall(board: Board, id: string): Result<object> {
  const k = board.devices.findIndex((d) => d.id === id);
  if (k < 0) return { ok: false, reason: `no device "${id}"` };
  board.devices.splice(k, 1);
  return { ok: true };
}

/** Set a device's requested clock; must be inside the spec's range. */
export function setClock(board: Board, id: string, clock: number): Result<object> {
  const d = board.devices.find((x) => x.id === id);
  if (!d) return { ok: false, reason: `no device "${id}"` };
  const r = deviceSpec(d).clock;
  if (!r) return { ok: false, reason: `${deviceSpec(d).name} has no clock` };
  if (!(clock >= r.min && clock <= r.max)) return { ok: false, reason: `clock ${clock} outside ${r.min}..${r.max}` };
  d.clock = clock;
  return { ok: true };
}

/** Plain-JSON form for the save (same shape as Board). */
export type BoardJson = Board;

export function boardToJson(board: Board): BoardJson {
  return JSON.parse(JSON.stringify(board)) as BoardJson;
}

/** Rebuild and validate a board from JSON (unknown specs, bad slots, duplicates throw). */
export function boardFromJson(json: BoardJson): Board {
  // an older save has no case: it sits in the smallest one that holds its board
  const board = createBoard(json.tier);
  if (json.caseTier !== undefined) {
    if (!CASE_TIERS[json.caseTier]) throw new Error(`save: unknown case tier ${json.caseTier}`);
    board.caseTier = Math.max(json.caseTier, board.caseTier);
  }
  const slots = boardSlots(board);
  const seen = new Set<string>();
  for (const d of json.devices) {
    const spec = getSpec(d.spec);
    if (!spec) throw new Error(`save: unknown device spec "${d.spec}"`);
    const slot = slots.find((s) => s.id === d.slot);
    if (!slot || !slotAccepts(slot.type, spec.slot)) throw new Error(`save: bad slot "${d.slot}" for ${d.spec}`);
    if (seen.has(d.slot) || board.devices.some((x) => x.id === d.id)) throw new Error(`save: duplicate slot or id "${d.id}"`);
    seen.add(d.slot);
    const dev: InstalledDevice = { id: d.id, spec: d.spec, slot: d.slot };
    if (spec.clock) {
      const c = d.clock ?? spec.clock.base;
      if (!(c >= spec.clock.min && c <= spec.clock.max)) throw new Error(`save: clock ${c} out of range for ${d.spec}`);
      dev.clock = c;
    }
    if (d.burnt) dev.burnt = true;
    board.devices.push(dev);
  }
  if (json.burnt) board.burnt = true;
  board.nextId = Math.max(json.nextId, ...board.devices.map((d) => Number(d.id.replace(/\D/g, "")) + 1), 1);
  return board;
}
