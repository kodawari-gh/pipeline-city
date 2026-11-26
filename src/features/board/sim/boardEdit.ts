// Board edits: install, uninstall, clocks, board upgrades and JSON. Pure data, like board.ts.

import { BOARD_TIERS, PCIE_POWER_MIN_TIER, PCIE_SLOT_W, cardLeads, getSpec, pcieLabel } from './specs';
import type * as specsTypes from './specs';
import {
  boardSlots,
  deviceSpec,
  fittedRadiator,
  freeSlots,
  installedPsu,
  pcieLeadsNeeded,
  ratedLoadW,
  slotAccepts,
  slotFits,
  slotRefusal,
} from './board';
import type * as boardTypes from './board';

/** What `install` checks besides the shape of the part, and optionally which slot to use. */
export interface InstallOpts {
  /**
   * Hold the power rules (default true): a PSU needs the watts of what is installed, a part must not push the rated load past an installed PSU, and a card
   * needs PCIe power leads. With false only the shape decides (the slot's type and size and its lanes, one radiator): a part that draws too much goes in, and
   * the machine then behaves as it would: the supply browns out or trips (`ThermalModel`), a card with no lead does not start (`bootCheck`), `checkCompat` says so.
   */
  power?: boolean;
  /** A given slot must match and be free; otherwise the first free one of the spec's type is used. */
  slotId?: string;
}

const installArgs = (slotOrOpts?: string | InstallOpts): { slotId?: string | undefined; power: boolean } =>
  typeof slotOrOpts === 'string'
    ? { slotId: slotOrOpts, power: true }
    : { slotId: slotOrOpts?.slotId, power: slotOrOpts?.power !== false };

function noFreeSlotReason(board: boardTypes.Board, spec: specsTypes.DeviceSpec): string {
  const all = boardSlots(board).filter((s) => slotAccepts(s.type, spec.slot)),
    total = all.length,
    wide = all.filter((s) => slotFits(s, spec)).length;
  if (spec.kind === 'fan') {
    const { size } = spec;
    if (wide === 0) {
      return `no spot for a ${size} mm fan: the case mounts and the heatsinks take ${[...new Set(all.map((s) => `${s.size} mm`))].join(', ') || 'no fan'}`;
    }
    return `every ${size} mm fan spot is taken (${wide} of ${wide})`;
  }
  if (total === 0) {
    return `this board has no ${spec.slot} slot for ${spec.name}`;
  }
  if (wide === 0) {
    return `no ${spec.slot} slot on this board is wide enough for ${spec.name} (needs ${pcieLabel(spec.pcieWidth ?? 1)}, the widest is ${pcieLabel(Math.max(...all.map((s) => s.width ?? 0)))})`;
  }
  return `no free ${spec.slot} slot for ${spec.name} (${wide} of ${wide} used)`;
}

function powerRefusal(board: boardTypes.Board, spec: specsTypes.DeviceSpec): string | null {
  if ((spec.kind === 'gpu' || spec.kind === 'npu') && cardLeads(spec) > 0) {
    // The card draws more than the slot's share (PCIE_SLOT_W): it needs PCIe power leads, and the board needs a connector for them.
    if (board.tier < PCIE_POWER_MIN_TIER) {
      return `${spec.name} draws ${spec.loadW} W, more than a PCIe slot gives (${PCIE_SLOT_W} W), and this board has no PCIe power connector`;
    }
    const need = pcieLeadsNeeded(board) + cardLeads(spec),
      psu = installedPsu(board);
    if (psu && psu.spec.pcieLeads < need) {
      return `${spec.name} brings the cards to ${need} PCIe power lead${need === 1 ? '' : 's'} but the PSU has ${psu.spec.pcieLeads}`;
    }
  }
  if (spec.kind === 'psu') {
    const need = ratedLoadW(board);
    if (spec.watts < need) {
      return `${spec.name} gives ${spec.watts} W but installed parts need ${need} W`;
    }
    return null;
  }
  const psu = installedPsu(board);
  if (psu) {
    const need = ratedLoadW(board, spec);
    if (need > psu.spec.watts) {
      return `PSU gives ${psu.spec.watts} W but parts would need ${need} W`;
    }
  }
  return null;
}

/**
 * Install a device. Needs a free slot of the spec's type (a given `slotId` must match and be free,
 * otherwise the first free one is used). A PSU needs a matching connector and enough watts for the
 * rated load of what is installed; any other device must not push the rated load past an installed PSU
 * (both only with `opts.power`, which is on by default).
 * Only one CPU/PSU/cooler/display per board falls out of the slot counts.
 * `slotOrOpts` may be a slot id or an `InstallOpts` object (which may itself name the slot).
 */
export function install(
  board: boardTypes.Board,
  specId: string,
  slotOrOpts?: string | InstallOpts,
): boardTypes.Result<{ id: string; slot: string }> {
  const { slotId, power } = installArgs(slotOrOpts);
  const spec = getSpec(specId);
  if (!spec) {
    return { ok: false, reason: `unknown device "${specId}"` };
  }
  let slot: boardTypes.SlotInfo | undefined;
  if (slotId === undefined) {
    [slot] = freeSlots(board, spec.slot, spec);
    if (slot === undefined) {
      return { ok: false, reason: noFreeSlotReason(board, spec) };
    }
  } else {
    slot = boardSlots(board).find((s) => s.id === slotId);
    if (slot === undefined) {
      return { ok: false, reason: `board has no slot "${slotId}"` };
    }
    const namedRefusal = slotRefusal(slot, spec);
    if (namedRefusal !== null && namedRefusal !== '') {
      return { ok: false, reason: namedRefusal };
    }
    if (board.devices.some((d) => d.slot === slotId)) {
      return { ok: false, reason: `slot "${slotId}" is already used` };
    }
  }
  if (spec.kind === 'radiator' && fittedRadiator(board)) {
    return { ok: false, reason: 'the loop already has a radiator: take it out first' };
  }
  const refusal = power ? powerRefusal(board, spec) : null;
  if (refusal !== null && refusal !== '') {
    return { ok: false, reason: refusal };
  }
  const id = `dev${board.nextId++}`;
  const dev: boardTypes.InstalledDevice = { id, spec: specId, slot: slot.id };
  if (spec.clock) {
    dev.clock = spec.clock.base;
  }
  board.devices.push(dev);
  return { ok: true, id, slot: slot.id };
}

/**
 * Move to another board tier, bigger or smaller (or, when the board is burnt, the same tier again), carrying every installed device over (same instance ids, clocks and burnt flags).
 * A smaller board refuses while a device has no slot on it.
 * A device keeps its slot id if the new board has an accepting slot with that id, otherwise it takes the first free
 * accepting slot (e.g. the plain ATX PSU moves to the ATX+ connector). On failure the board is left untouched.
 */

function placeOnNextBoard(
  board: boardTypes.Board,
  next: boardTypes.Board,
  nextName: string,
): boardTypes.Result<object> {
  const slots = boardSlots(next).filter((s) => s.type !== 'fan');
  const used = new Set<string>();
  const place = (d: boardTypes.InstalledDevice): string | undefined => {
    const spec = deviceSpec(d),
      need = spec.slot,
      fits = (s: boardTypes.SlotInfo) => slotAccepts(s.type, need) && slotFits(s, spec) && !used.has(s.id);
    const same = slots.find((s) => s.id === d.slot && fits(s));
    return (same ?? slots.filter((s) => fits(s)).toSorted((a, b) => (a.width ?? 0) - (b.width ?? 0))[0])?.id;
  };
  // (the widest cards choose first, so a narrow one does not leave them without a slot; the fans stay on their spot: a heatsink keeps its slot id,
  // and a fan whose spot is gone is the Game's stray)
  const moved = new Map<string, string>();
  for (const d of board.devices) {
    if (deviceSpec(d).kind === 'fan') {
      moved.set(d.id, d.slot);
    }
  }
  for (const d of [...board.devices]
    .filter((x) => !moved.has(x.id))
    .toSorted((a, b) => (deviceSpec(b).pcieWidth ?? 0) - (deviceSpec(a).pcieWidth ?? 0))) {
    const slot = place(d);
    if (slot === undefined || slot === '') {
      return {
        ok: false,
        reason: `the ${nextName} board has no slot for ${deviceSpec(d).name}: take it out first`,
      };
    }
    used.add(slot);
    moved.set(d.id, slot);
  }
  for (const d of board.devices) {
    const slot = moved.get(d.id);
    if (slot === undefined) {
      throw new Error(`upgrade: no slot for ${d.id}`);
    }
    next.devices.push({ ...d, slot });
  }
  return { ok: true };
}

export function upgradeBoard(board: boardTypes.Board, tier: number): boardTypes.Result<object> {
  const nextTier = BOARD_TIERS[tier];
  if (nextTier === undefined) {
    return { ok: false, reason: `unknown board tier ${tier}` };
  }
  // A dead board may be replaced by one of the same tier.
  if (tier === board.tier && board.burnt !== true) {
    return { ok: false, reason: `the ${nextTier.name} board is already fitted` };
  }
  const next: boardTypes.Board = { tier, caseTier: board.caseTier, nextId: board.nextId, devices: [] };
  const placed = placeOnNextBoard(board, next, nextTier.name);
  if (!placed.ok) {
    return placed;
  }
  board.tier = next.tier;
  board.devices = next.devices;
  delete board.burnt; // the dead board is gone
  return { ok: true };
}

export function uninstall(board: boardTypes.Board, id: string): boardTypes.Result<object> {
  const k = board.devices.findIndex((d) => d.id === id);
  if (k === -1) {
    return { ok: false, reason: `no device "${id}"` };
  }
  board.devices.splice(k, 1);
  return { ok: true };
}

/** Set a device's requested clock; must be inside the spec's range. */
export function setClock(board: boardTypes.Board, id: string, clock: number): boardTypes.Result<object> {
  const d = board.devices.find((x) => x.id === id);
  if (!d) {
    return { ok: false, reason: `no device "${id}"` };
  }
  const r = deviceSpec(d).clock;
  if (!r) {
    return { ok: false, reason: `${deviceSpec(d).name} has no clock` };
  }
  if (!(clock >= r.min && clock <= r.max)) {
    return { ok: false, reason: `clock ${clock} outside ${r.min}..${r.max}` };
  }
  d.clock = clock;
  return { ok: true };
}

export type { BoardJson } from './boardEditJson';
export { boardToJson, boardFromJson } from './boardEditJson';
