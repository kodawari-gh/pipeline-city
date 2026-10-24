// Cables: which board connectors are plugged, and what the machine needs to boot. Plain data; the Game owns the state.
// Cable connectors sit on the board, so a cable only needs its source part installed (the PSU, or the monitor);
// removing that part unplugs it. A GPU would add a "pcie" cable later.

import { findDevices, installedPsu, type Board, type Result } from "./board";
import type { DeviceKind } from "./specs";

export type CableId = "atx" | "cpu" | "video" | "lan";

export interface CableSpec {
  id: CableId;
  name: string;
  /** Kind of part the cable runs from. It must be installed to plug the cable in. */
  from: DeviceKind | "router";
  /** One-line explanation for tooltips. */
  plain: string;
}

export const CABLES: readonly CableSpec[] = [
  { id: "atx", name: "24-pin ATX power", from: "psu", plain: "Main power from the PSU to the board." },
  { id: "cpu", name: "8-pin CPU power", from: "psu", plain: "Extra power from the PSU to the CPU socket." },
  { id: "video", name: "Video cable", from: "display", plain: "Board display output to the monitor." },
  { id: "lan", name: "Ethernet cable", from: "router", plain: "A board or network card port to the router. Can be plugged while the machine is on." },
];

export const CABLE_IDS: readonly CableId[] = CABLES.map((c) => c.id);

export type Cables = Record<CableId, boolean>;

export const noCables = (): Cables => ({ atx: false, cpu: false, video: false, lan: false });
export const allCables = (): Cables => ({ atx: true, cpu: true, video: true, lan: false });

function spec(id: string): CableSpec | undefined {
  return CABLES.find((c) => c.id === id);
}

/** Why a cable cannot be plugged in right now (its source part is missing), or null if it can. */
export function cableBlocked(board: Board, id: CableId): string | null {
  const c = spec(id)!;
  if (c.from === "router") return null; // the Game owns the router and the port choice
  return findDevices(board, c.from).length > 0 ? null : `no ${c.from === "display" ? "monitor" : c.from.toUpperCase()} installed for the ${c.name} cable`;
}

export function connectCable(board: Board, cables: Cables, id: string): Result<{ cable: CableId }> {
  const c = spec(id);
  if (!c) return { ok: false, reason: `unknown cable "${id}"` };
  if (cables[c.id]) return { ok: false, reason: `${c.name} is already connected` };
  if (c.from === "router") return { ok: false, reason: "the ethernet cable is plugged in through the network (Game.connectCable)" };
  const why = cableBlocked(board, c.id);
  if (why) return { ok: false, reason: why };
  cables[c.id] = true;
  return { ok: true, cable: c.id };
}

export function disconnectCable(cables: Cables, id: string): Result<{ cable: CableId }> {
  const c = spec(id);
  if (!c) return { ok: false, reason: `unknown cable "${id}"` };
  if (!cables[c.id]) return { ok: false, reason: `${c.name} is not connected` };
  cables[c.id] = false;
  return { ok: true, cable: c.id };
}

/** Unplug every cable whose source part is gone (after an uninstall or swap). Returns the cables that came off. */
export function pruneCables(board: Board, cables: Cables): CableId[] {
  const off: CableId[] = [];
  for (const c of CABLES) {
    if (c.from === "router") continue;
    if (cables[c.id] && cableBlocked(board, c.id)) {
      cables[c.id] = false;
      off.push(c.id);
    }
  }
  return off;
}

export interface BootCheck {
  /** Set if the machine gets no power at all (the power button does nothing). */
  noPower: string | null;
  /** Set if it powers on but POST cannot pass; `short` is the line the PCH shows on the monitor. */
  post: { reason: string; short: string } | null;
}

/** What stops the machine booting with this board and these cables (burnt parts count as missing). */
export function bootCheck(board: Board, cables: Cables): BootCheck {
  const psu = installedPsu(board);
  let noPower: string | null = null;
  if (board.burnt) noPower = "board dead: replace the board";
  else if (!psu) noPower = "no PSU installed";
  else if (psu.dev.burnt) noPower = "the PSU is burnt out";
  else if (!cables.atx) noPower = "the 24-pin ATX cable is not connected";
  let post: BootCheck["post"] = null;
  const cpu = findDevices(board, "cpu")[0];
  const ram = findDevices(board, "ram").filter((d) => !d.burnt);
  if (!cpu) post = { reason: "no CPU installed", short: "NO CPU" };
  else if (cpu.burnt) post = { reason: "the CPU is burnt out", short: "CPU FAILED" };
  else if (!findDevices(board, "cooler").some((d) => !d.burnt)) post = { reason: "no CPU cooler installed: it mounts on the CPU", short: "NO CPU COOLER" };
  else if (!cables.cpu) post = { reason: "the 8-pin CPU power cable is not connected", short: "NO CPU POWER" };
  else if (ram.length === 0) post = { reason: "no working RAM installed", short: "NO RAM" };
  return { noPower, post };
}
