// Cables: which board connectors are plugged, and what the machine needs to boot. Plain data; the Game owns the state.
// A cable belongs to the part it runs from (the PSU, the monitor, a fan...): it exists only while that part is installed, and removing the part
// unplugs it. The `pcie` lead also needs the PSU to have one (`pcieLeads`). The two cords from the wall are the part's own: the PC's cord goes into
// the PSU's inlet (`pcmains`), the monitor's cord is built into the monitor (`monmains`), and the video cable (`video`) runs from the monitor too.

import { deviceSpec, fansOn, findDevices, hostSpots, installedPsu, mountFan, pcieLeadsNeeded } from './board';
import type * as boardTypes from './board';
import { cardLeads } from './specs';
import type * as specsTypes from './specs';
import { cablesOf, isFanCable, mountName, PCIE_LEADS, pcieLeadNo, spec, WALL_CABLES } from './cableList';
import type * as cableListTypes from './cableList';

export type { CableId, Cables } from './cableList';
export {
  PCIE_LEADS,
  CABLE_IDS,
  cablesOf,
  isFanCable,
  noCables,
  WALL_CABLES,
  hotPluggable,
  cableName,
} from './cableList';

function blockedSinkFan(board: boardTypes.Board, kind: 'vrm-sink' | 'ram-sink'): string | null {
  const what = kind === 'vrm-sink' ? 'VRM' : 'RAM VRM';
  const [sink] = findDevices(board, kind);
  if (!sink || !hostSpots(sink)) {
    return `no ${what} fan fins installed`;
  }
  return fansOn(board, sink.slot).length > 0 ? null : `no fan on the ${what} fan fins`;
}

function blockedCpuFan(board: boardTypes.Board): string | null {
  const [cooler] = findDevices(board, 'cooler');
  if (!cooler) {
    return 'no CPU cooler installed for the CPU fan cable';
  }
  if ((deviceSpec(cooler) as specsTypes.CoolerSpec).loop || fansOn(board, cooler.slot).length > 0) {
    return null;
  }
  return 'no fan on the CPU heatsink';
}

function blockedPcieLead(board: boardTypes.Board, id: string): string | null {
  const lead = pcieLeadNo(id);
  if (lead <= 0) {
    return null;
  }
  const have = installedPsu(board)?.spec.pcieLeads ?? 0;
  if (have >= lead) {
    return null;
  }
  if (have === 0) {
    return 'this PSU has no PCIe power lead';
  }
  return `this PSU has only ${have} PCIe power lead${have === 1 ? '' : 's'}`;
}

function missingSource(board: boardTypes.Board, from: string, name: string): string | null {
  if (findDevices(board, from as specsTypes.DeviceKind).length > 0) {
    return null;
  }
  const who = from === 'display' ? 'monitor' : from.toUpperCase();
  const suffix = /(?:cable|cord)$/iu.test(name) ? '' : ' cable';
  return `no ${who} installed for the ${name}${suffix}`;
}

/** Why a cable cannot be plugged in right now (its source part is missing), or null if it can. */
export function cableBlocked(board: boardTypes.Board, id: cableListTypes.CableId): string | null {
  const c = spec(id, board);
  if (!c) {
    return `unknown cable "${id}"`;
  }
  if (c.from === 'router' || c.from === 'case') {
    return null; // the Game owns the router and the port choice; the case brings its own hub
  }
  if (c.from === 'fan') {
    return mountFan(board, c.id.slice(4)) ? null : `no fan on the ${mountName(c.id.slice(4))} mount`;
  }
  if (c.id === 'vrmfan' || c.id === 'ramfan') {
    return blockedSinkFan(board, c.from as 'vrm-sink' | 'ram-sink');
  }
  if (c.id === 'cpufan') {
    return blockedCpuFan(board);
  }
  return missingSource(board, c.from, c.name) ?? blockedPcieLead(board, c.id);
}

/** Does a part installed now need this cable? Every cable but the PCIe leads and the fans' always does (the machine is not complete without it); lead N only while the cards take N leads or more, a fan's only while the fan is there. */
export function cableNeeded(board: boardTypes.Board, id: cableListTypes.CableId): boolean {
  const lead = pcieLeadNo(id);
  if (lead > 0) {
    return lead <= pcieLeadsNeeded(board);
  }
  if (isFanCable(id)) {
    return cableBlocked(board, id) === null;
  }
  return true;
}

/** Everything plugged that has something to plug into (with a `board`, the cables of the parts and the case it has: no PSU, no leads; no monitor, no video cable or cord). */
export const allCables = (board?: boardTypes.Board): cableListTypes.Cables => {
  const c: cableListTypes.Cables = {
    atx: true,
    cpu: true,
    video: true,
    lan: false,
    pcmains: true,
    monmains: true,
    pcie: false,
    pcie2: false,
    pcie3: false,
    pcie4: false,
    cpufan: true,
    vrmfan: !board,
    ramfan: !board,
    sysfan: true,
  };
  if (board) {
    for (const s of cablesOf(board)) {
      if (isFanCable(s.id) || s.id === 'atx' || s.id === 'cpu' || s.id === 'video' || WALL_CABLES.includes(s.id)) {
        c[s.id] = cableBlocked(board, s.id) === null;
      }
    }
  }
  return c;
};

/** One PCIe lead and the card socket it plugs into: the card's slot and which of its sockets (0 = the first). */
export interface LeadPlug {
  lead: cableListTypes.PcieLeadId;
  slot: string;
  plug: number;
}

/** Deal the leads out to the working cards in slot order, each card taking `cardLeads` of them. The render and the sim share this, so a lead goes to the socket the board shows. */
export function assignLeads(cards: readonly { slot: string; loadW: number }[]): LeadPlug[] {
  const out: LeadPlug[] = [];
  for (const c of [...cards].sort((a, b) => a.slot.localeCompare(b.slot))) {
    for (let k = 0; k < cardLeads(c); k++) {
      const lead = PCIE_LEADS[out.length];
      if (lead) {
        out.push({ lead, slot: c.slot, plug: k });
      }
    }
  }
  return out;
}

/** Lead cable ids (`pcie`...) that feed this card, in the order of the leads used. */
export const cardLeadIds = (board: boardTypes.Board, dev: boardTypes.InstalledDevice): cableListTypes.PcieLeadId[] => {
  const cards = board.devices
    .filter((d) => !d.burnt && (deviceSpec(d).kind === 'gpu' || deviceSpec(d).kind === 'npu'))
    .map((d) => ({ slot: d.slot, loadW: deviceSpec(d).loadW }));
  return assignLeads(cards)
    .filter((l) => l.slot === dev.slot)
    .map((l) => l.lead);
};

/** Is the card fully fed: slot power only, or all its leads plugged? An unfed card does not start. */
export const cardPowered = (
  board: boardTypes.Board,
  cables: cableListTypes.Cables,
  dev: boardTypes.InstalledDevice,
): boolean => cardLeadIds(board, dev).every((id) => cables[id]);

export function connectCable(
  board: boardTypes.Board,
  cables: cableListTypes.Cables,
  id: string,
): boardTypes.Result<{ cable: cableListTypes.CableId }> {
  const c = spec(id, board);
  if (!c) {
    return { ok: false, reason: `unknown cable "${id}"` };
  }
  if (cables[c.id]) {
    return { ok: false, reason: `${c.name} is already connected` };
  }
  if (c.from === 'router') {
    return { ok: false, reason: 'the ethernet cable is plugged in through the network (Game.connectCable)' };
  }
  const why = cableBlocked(board, c.id);
  if (why) {
    return { ok: false, reason: why };
  }
  cables[c.id] = true;
  return { ok: true, cable: c.id };
}

export function disconnectCable(
  cables: cableListTypes.Cables,
  id: string,
  board?: boardTypes.Board,
): boardTypes.Result<{ cable: cableListTypes.CableId }> {
  const c = spec(id, board);
  if (!c) {
    return { ok: false, reason: `unknown cable "${id}"` };
  }
  if (!cables[c.id]) {
    return { ok: false, reason: `${c.name} is not connected` };
  }
  cables[c.id] = false;
  return { ok: true, cable: c.id };
}

/** Unplug every cable whose source part is gone (after an uninstall or swap). Returns the cables that came off. */
export function pruneCables(board: boardTypes.Board, cables: cableListTypes.Cables): cableListTypes.CableId[] {
  const off: cableListTypes.CableId[] = [];
  for (const c of cablesOf(board)) {
    if (c.from === 'router' || c.from === 'case') {
      continue;
    }
    if (cables[c.id] && (cableBlocked(board, c.id) || pcieLeadNo(c.id) > pcieLeadsNeeded(board))) {
      // (a lead no card takes any more comes off too)
      cables[c.id] = false;
      off.push(c.id);
    }
  }
  return off;
}

/**
 * The cables that exist now and would not once the device `devId` was gone: its own (the PSU's leads and cord, the monitor's cables, a fan's cord) and a PCIe
 * lead no card needs any more. They go back into their part with it: Build my PC reels them in before the part comes out (`BuildStage.takeOut`).
 */
function cableExists(board: boardTypes.Board, id: cableListTypes.CableId): boolean {
  return cableBlocked(board, id) === null && cableNeeded(board, id);
}

export function cablesLost(board: boardTypes.Board, devId: string): cableListTypes.CableId[] {
  const left: boardTypes.Board = { ...board, devices: board.devices.filter((d) => d.id !== devId) };
  return cablesOf(board)
    .filter((c) => cableExists(board, c.id) && !cableExists(left, c.id))
    .map((c) => c.id);
}

export interface BootCheck {
  /** Set if the machine gets no power at all (the power button does nothing). */
  noPower: string | null;
  /** Set if it powers on but POST cannot pass; `short` is the line the PCH shows on the monitor. */
  post: { reason: string; short: string } | null;
}

/** What stops the machine booting with this board and these cables (burnt parts count as missing). */
export function bootCheck(board: boardTypes.Board, cables: cableListTypes.Cables): BootCheck {
  const psu = installedPsu(board);
  let noPower: string | null = null;
  if (board.burnt) {
    noPower = 'board dead: replace the board';
  } else if (!psu) {
    noPower = 'no PSU installed';
  } else if (psu.dev.burnt) {
    noPower = 'the PSU is burnt out';
  } else if (!cables['atx']) {
    noPower = 'the 24-pin ATX cable is not connected';
  } else if (!cables['pcmains']) {
    noPower = 'the PC power cord is not plugged into the wall';
  }
  let post: BootCheck['post'] = null;
  const [cpu] = findDevices(board, 'cpu');
  const ram = findDevices(board, 'ram').filter((d) => !d.burnt);
  if (!cpu) {
    post = { reason: 'no CPU installed', short: 'NO CPU' };
  } else if (cpu.burnt) {
    post = { reason: 'the CPU is burnt out', short: 'CPU FAILED' };
  } else if (!findDevices(board, 'cooler').some((d) => !d.burnt)) {
    post = { reason: 'no CPU cooler installed: it mounts on the CPU', short: 'NO CPU COOLER' };
  }
  // an air heatsink still cools without its fans (the CPU runs hot); a liquid loop's pump must run
  else if (
    !cables['cpufan'] &&
    findDevices(board, 'cooler').some((d) => (deviceSpec(d) as specsTypes.CoolerSpec).loop)
  ) {
    post = { reason: 'the pump cable is not connected: plug it into the CPU_FAN header', short: 'NO CPU FAN' };
  } else if (!cables['cpu']) {
    post = { reason: 'the 8-pin CPU power cable is not connected', short: 'NO CPU POWER' };
  } else if (ram.length === 0) {
    post = { reason: 'no working RAM installed', short: 'NO RAM' };
  } else if (PCIE_LEADS.slice(0, pcieLeadsNeeded(board)).some((id) => !cables[id])) {
    const missing = PCIE_LEADS.slice(0, pcieLeadsNeeded(board)).filter((id) => !cables[id]).length;
    post = {
      reason: `a card needs PCIe power and ${missing} lead${missing === 1 ? ' is' : 's are'} not connected`,
      short: 'GPU power cable',
    };
  }
  return { noPower, post };
}
