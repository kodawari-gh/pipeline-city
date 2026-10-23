// Board model: pure data plus validation. A Board is plain JSON-serialisable data.

import { BOARD_TIERS, getSpec, type DeviceSpec, type PsuSpec, type SlotType } from "./specs";

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
  nextId: number;
  devices: InstalledDevice[];
}

export interface SlotInfo { id: string; type: SlotType }

export type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };

export function createBoard(tier = 0): Board {
  if (!BOARD_TIERS[tier]) throw new RangeError(`unknown board tier ${tier}`);
  return { tier, nextId: 1, devices: [] };
}

/** Slot instances of a board tier, ids like "dimm0", "dimm1". */
export function boardSlots(board: Board): SlotInfo[] {
  const t = BOARD_TIERS[board.tier];
  if (!t) return [];
  const out: SlotInfo[] = [];
  for (const [type, n] of Object.entries(t.slots) as [SlotType, number][]) {
    for (let k = 0; k < n; k++) out.push({ id: `${type}${k}`, type });
  }
  return out;
}

export function deviceSpec(d: InstalledDevice): DeviceSpec {
  const s = getSpec(d.spec);
  if (!s) throw new Error(`unknown device spec ${d.spec}`);
  return s;
}

export function findDevices(board: Board, kind: DeviceSpec["kind"]): InstalledDevice[] {
  return board.devices.filter((d) => deviceSpec(d).kind === kind);
}

export function freeSlots(board: Board, type: SlotType): SlotInfo[] {
  const used = new Set(board.devices.map((d) => d.slot));
  return boardSlots(board).filter((s) => s.type === type && !used.has(s.id));
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
    if (slot.type !== spec.slot) return { ok: false, reason: `${spec.name} needs a ${spec.slot} slot, "${slotId}" is ${slot.type}` };
    if (board.devices.some((d) => d.slot === slotId)) return { ok: false, reason: `slot "${slotId}" is already used` };
  } else {
    slot = freeSlots(board, spec.slot)[0];
    if (!slot) {
      const total = boardSlots(board).filter((s) => s.type === spec.slot).length;
      return {
        ok: false,
        reason: total === 0 ? `this board has no ${spec.slot} slot for ${spec.name}` : `no free ${spec.slot} slot for ${spec.name} (${total} of ${total} used)`,
      };
    }
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
  const board = createBoard(json.tier);
  const slots = boardSlots(board);
  const seen = new Set<string>();
  for (const d of json.devices) {
    const spec = getSpec(d.spec);
    if (!spec) throw new Error(`save: unknown device spec "${d.spec}"`);
    const slot = slots.find((s) => s.id === d.slot);
    if (!slot || slot.type !== spec.slot) throw new Error(`save: bad slot "${d.slot}" for ${d.spec}`);
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
  board.nextId = Math.max(json.nextId, ...board.devices.map((d) => Number(d.id.replace(/\D/g, "")) + 1), 1);
  return board;
}
