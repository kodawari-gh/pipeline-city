import { boardSlots, createBoard, slotAccepts } from './board';
import type * as boardTypes from './board';
import { CASE_TIERS, getSpec } from './specs';
import type * as specsTypes from './specs';

/** Plain-JSON form for the save (same shape as Board). */
export type BoardJson = boardTypes.Board;

export function boardToJson(board: boardTypes.Board): BoardJson {
  const json: BoardJson = {
    tier: board.tier,
    caseTier: board.caseTier,
    nextId: board.nextId,
    devices: board.devices.map((d) => {
      const dev: boardTypes.InstalledDevice = { id: d.id, spec: d.spec, slot: d.slot };
      if (d.clock !== undefined) {
        dev.clock = d.clock;
      }
      if (d.burnt === true) {
        dev.burnt = true;
      }
      return dev;
    }),
  };
  if (board.burnt === true) {
    json.burnt = true;
  }
  return json;
}

/** A saved device rebuilt with only its own fields, its clock checked against its spec's range (out of it throws). */
function deviceFromJson(d: boardTypes.InstalledDevice, spec: specsTypes.DeviceSpec): boardTypes.InstalledDevice {
  const dev: boardTypes.InstalledDevice = { id: d.id, spec: d.spec, slot: d.slot };
  if (spec.clock) {
    const c = d.clock ?? spec.clock.base;
    if (!(c >= spec.clock.min && c <= spec.clock.max)) {
      throw new Error(`save: clock ${c} out of range for ${d.spec}`);
    }
    dev.clock = c;
  }
  if (d.burnt === true) {
    dev.burnt = true;
  }
  return dev;
}

function isFanDevice(d: boardTypes.InstalledDevice): boolean {
  return getSpec(d.spec)?.kind === 'fan';
}

/** Rebuild and validate a board from JSON (unknown specs, bad slots, duplicates throw). */
export function boardFromJson(json: BoardJson): boardTypes.Board {
  // an older save has no case: it sits in the smallest one that holds its board
  const board = createBoard(json.tier);
  if (json.caseTier !== undefined) {
    if (!CASE_TIERS[json.caseTier]) {
      throw new Error(`save: unknown case tier ${json.caseTier}`);
    }
    board.caseTier = Math.max(json.caseTier, board.caseTier);
  }
  const seen = new Set<string>();
  // the fans last: a heatsink's spots exist once it is in
  let slots = boardSlots(board),
    hosted = false;
  for (const d of [...json.devices.filter((x) => !isFanDevice(x)), ...json.devices.filter((x) => isFanDevice(x))]) {
    const spec = getSpec(d.spec);
    if (!spec) {
      throw new Error(`save: unknown device spec "${d.spec}"`);
    }
    if (spec.kind === 'fan' && !hosted) {
      slots = boardSlots(board);
      hosted = true;
    }
    const slot = slots.find((s) => s.id === d.slot);
    if (!slot || !slotAccepts(slot.type, spec.slot)) {
      throw new Error(`save: bad slot "${d.slot}" for ${d.spec}`);
    }
    if (seen.has(d.slot) || board.devices.some((x) => x.id === d.id)) {
      throw new Error(`save: duplicate slot or id "${d.id}"`);
    }
    seen.add(d.slot);
    board.devices.push(deviceFromJson(d, spec));
  }
  // back in the saved order
  const at = new Map(json.devices.map((d, k) => [d.id, k]));
  const savedOrder = (id: string): number => {
    const n = at.get(id);
    if (n === undefined) {
      throw new Error(`save: device "${id}" missing from snapshot`);
    }
    return n;
  };
  board.devices = board.devices.toSorted((a, b) => savedOrder(a.id) - savedOrder(b.id));
  if (json.burnt === true) {
    board.burnt = true;
  }
  board.nextId = Math.max(json.nextId, ...board.devices.map((d) => Number(d.id.replaceAll(/\D/gu, '')) + 1), 1);
  return board;
}
