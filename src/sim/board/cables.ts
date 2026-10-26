// Cables: which board connectors are plugged, and what the machine needs to boot. Plain data; the Game owns the state.
// Cable connectors sit on the board, so a cable only needs its source part installed (the PSU, or the monitor);
// removing that part unplugs it. The `pcie` lead also needs the PSU to have one (`pcieLeads`). The two cords from the wall (`pcmains`, `monmains`) are the exception:
// they need no part and stay plugged when parts are swapped.

import { deviceSpec, findDevices, installedPsu, type Board, type Result } from "./board";
import type { DeviceKind } from "./specs";

export type CableId = "atx" | "cpu" | "video" | "lan" | "pcmains" | "monmains" | "pcie";

export interface CableSpec {
  id: CableId;
  name: string;
  /** Kind of part the cable runs from. It must be installed to plug the cable in. */
  /** `wall`: a cord from the room's wall socket (the case's inlet and the monitor's built-in cord): no part has to be installed, and it stays in the wall when a part is swapped. */
  from: DeviceKind | "router" | "wall";
  /** One-line explanation for tooltips. */
  plain: string;
}

export const CABLES: readonly CableSpec[] = [
  { id: "atx", name: "24-pin ATX power", from: "psu", plain: "Main power from the PSU to the board." },
  { id: "cpu", name: "8-pin CPU power", from: "psu", plain: "Extra power from the PSU to the CPU socket." },
  { id: "pcie", name: "PCIe power lead", from: "psu", plain: "Extra power from the PSU to a graphics or AI card. Only PSUs with a PCIe lead have one, and only a card that needs it asks for it." },
  { id: "video", name: "Video cable", from: "display", plain: "Board display output to the monitor." },
  { id: "pcmains", name: "PC power cord", from: "wall", plain: "From the case's power inlet to the wall socket. Without it the PSU has no power at all. Can be plugged or pulled at any time (pulling it cuts the power)." },
  { id: "monmains", name: "Monitor power cord", from: "wall", plain: "From the monitor to the wall socket. Without it the screen stays dark. Can be plugged or pulled at any time." },
  { id: "lan", name: "Ethernet cable", from: "router", plain: "A board or network card port to the router. Can be plugged while the machine is on." },
];

export const CABLE_IDS: readonly CableId[] = CABLES.map((c) => c.id);

export type Cables = Record<CableId, boolean>;

export const noCables = (): Cables => ({ atx: false, cpu: false, video: false, lan: false, pcmains: false, monmains: false, pcie: false });
export const allCables = (): Cables => ({ atx: true, cpu: true, video: true, lan: false, pcmains: true, monmains: true, pcie: false });
/** The cords from the wall: the ones a saved game from before them is given as plugged (nobody is locked out of a machine that used to run). */
export const WALL_CABLES: readonly CableId[] = ["pcmains", "monmains"];

function spec(id: string): CableSpec | undefined {
  return CABLES.find((c) => c.id === id);
}

/** Why a cable cannot be plugged in right now (its source part is missing), or null if it can. */
export function cableBlocked(board: Board, id: CableId): string | null {
  const c = spec(id)!;
  if (c.from === "router" || c.from === "wall") return null; // the Game owns the router and the port choice; a wall cord needs no part
  if (findDevices(board, c.from).length === 0) return `no ${c.from === "display" ? "monitor" : c.from.toUpperCase()} installed for the ${c.name} cable`;
  if (c.id === "pcie" && (installedPsu(board)?.spec.pcieLeads ?? 0) < 1) return "this PSU has no PCIe power lead";
  return null;
}

/** Does a part installed now need this cable? Every cable but `pcie` always does (the machine is not complete without it); `pcie` only for a card that wants the lead. */
export function cableNeeded(board: Board, id: CableId): boolean {
  if (id !== "pcie") return true;
  return needyCards(board).length > 0;
}

/** Working cards whose spec asks for the PCIe power lead. */
function needyCards(board: Board): Board["devices"] {
  return board.devices.filter((d) => {
    if (d.burnt) return false;
    const s = deviceSpec(d);
    return (s.kind === "gpu" || s.kind === "npu") && s.needsPcieCable;
  });
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
    if (c.from === "router" || c.from === "wall") continue;
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
  else if (!cables.pcmains) noPower = "the PC power cord is not plugged into the wall";
  let post: BootCheck["post"] = null;
  const cpu = findDevices(board, "cpu")[0];
  const ram = findDevices(board, "ram").filter((d) => !d.burnt);
  if (!cpu) post = { reason: "no CPU installed", short: "NO CPU" };
  else if (cpu.burnt) post = { reason: "the CPU is burnt out", short: "CPU FAILED" };
  else if (!findDevices(board, "cooler").some((d) => !d.burnt)) post = { reason: "no CPU cooler installed: it mounts on the CPU", short: "NO CPU COOLER" };
  else if (!cables.cpu) post = { reason: "the 8-pin CPU power cable is not connected", short: "NO CPU POWER" };
  else if (ram.length === 0) post = { reason: "no working RAM installed", short: "NO RAM" };
  else if (!cables.pcie && needyCards(board).length > 0) post = { reason: "a card needs the PCIe power lead and it is not connected", short: "GPU power cable" };
  return { noPower, post };
}
