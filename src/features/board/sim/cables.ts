// Cables: which board connectors are plugged, and what the machine needs to boot. Plain data; the Game owns the state.
// Cable connectors sit on the board, so a cable only needs its source part installed (the PSU, or the monitor);
// removing that part unplugs it. The `pcie` lead also needs the PSU to have one (`pcieLeads`). The two cords from the wall (`pcmains`, `monmains`) are the exception:
// they need no part and stay plugged when parts are swapped.

import { deviceSpec, findDevices, installedPsu, pcieLeadsNeeded, type Board, type InstalledDevice, type Result } from "./board";
import { cardLeads, caseMounts, type DeviceKind, type VrmSinkSpec } from "./specs";

/** The cables every machine has. A case fan's cable has the id `fan:<mount>` (`caseMounts`): those depend on the case. `pcie` to `pcie4` are the PSU's PCIe power leads, one cable each. */
export type StaticCableId = "atx" | "cpu" | "video" | "lan" | "pcmains" | "monmains" | PcieLeadId | "cpufan" | "vrmfan" | "ramfan" | "sysfan";
export type PcieLeadId = "pcie" | "pcie2" | "pcie3" | "pcie4";
/** The PCIe lead cables in the order they are used (the first is `pcie`, as in older saves). */
export const PCIE_LEADS: readonly PcieLeadId[] = ["pcie", "pcie2", "pcie3", "pcie4"];
/** Which lead (1-based) a cable id is, or 0 if it is no PCIe lead. */
export const pcieLeadNo = (id: string): number => PCIE_LEADS.indexOf(id as PcieLeadId) + 1;
export type CableId = StaticCableId | `fan:${string}`;

export interface CableSpec {
  id: CableId;
  name: string;
  /** Kind of part the cable runs from. It must be installed to plug the cable in. */
  /** `wall`: a cord from the room's wall socket (the case's inlet and the monitor's built-in cord): no part has to be installed, and it stays in the wall when a part is swapped. */
  from: DeviceKind | "router" | "wall" | "case";
  /** One-line explanation for tooltips. */
  plain: string;
}

const PCIE_PLAIN = "Extra 75 W from the PSU to a graphics or AI card. A card that draws more than its slot gives asks for one lead per 75 W; the PSU has a fixed number of leads.";

export const CABLES: readonly CableSpec[] = [
  { id: "atx", name: "24-pin ATX power", from: "psu", plain: "Main power from the PSU to the board." },
  { id: "cpu", name: "8-pin CPU power", from: "psu", plain: "Extra power from the PSU to the CPU socket." },
  { id: "pcie", name: "PCIe power lead 1", from: "psu", plain: PCIE_PLAIN },
  { id: "pcie2", name: "PCIe power lead 2", from: "psu", plain: PCIE_PLAIN },
  { id: "pcie3", name: "PCIe power lead 3", from: "psu", plain: PCIE_PLAIN },
  { id: "pcie4", name: "PCIe power lead 4", from: "psu", plain: PCIE_PLAIN },
  { id: "video", name: "Video cable", from: "display", plain: "Board display output to the monitor." },
  { id: "pcmains", name: "PC power cord", from: "wall", plain: "From the case's power inlet to the wall socket. Without it the PSU has no power at all. Can be plugged or pulled at any time (pulling it cuts the power)." },
  { id: "monmains", name: "Monitor power cord", from: "wall", plain: "From the monitor to the wall socket. Without it the screen stays dark. Can be plugged or pulled at any time." },
  { id: "cpufan", name: "CPU fan cable", from: "cooler", plain: "The CPU cooler's fan (or the loop's pump) to the CPU_FAN header. The CPU needs it: without it the board stops at POST and the cooler does not turn." },
  { id: "vrmfan", name: "VRM fan cable", from: "vrm-sink", plain: "The VRM heatsink's fan to the VRM_FAN header. Without it the fan stands still and cools less." },
  { id: "ramfan", name: "RAM VRM fan cable", from: "ram-sink", plain: "The memory VRM heatsink's fan to the RAM_FAN header. Without it the fan stands still and cools less." },
  { id: "sysfan", name: "Fan hub cable", from: "case", plain: "The case's fan hub to the SYS_FAN header: it carries the power of every case fan, so with it unplugged none of them turns." },
  { id: "lan", name: "Ethernet cable", from: "router", plain: "A board or network card port to the router. Can be plugged while the machine is on." },
];

/** The cables with a fixed id (the ones a save must say about). */
export const CABLE_IDS: readonly StaticCableId[] = CABLES.map((c) => c.id as StaticCableId);

/** Which cables are plugged. A case fan's key is only there once the Game has set it (a missing one is unplugged). */
export type Cables = Record<string, boolean>;

const mountName = (m: string): string => (m === "rear" ? "rear fan" : m.replace(/^(front|top)(\d+)$/, (_, side: string, k: string) => `${side} fan ${Number(k) + 1}`));

/** The cable of one case fan, from the fan to its header on the fan hub. */
function mountCable(m: string): CableSpec {
  return { id: `fan:${m}`, name: `Case fan cable (${mountName(m)})`, from: "case", plain: `The ${mountName(m)}'s cable to the fan hub. Without it the fan stands still and the case gets less airflow.` };
}

/** Every cable this board's machine can have: the fixed ones and one per fan mount of its case. */
export function cablesOf(board: Board): CableSpec[] {
  return [...CABLES, ...caseMounts(board.caseTier).map(mountCable)];
}

/** Is this a fan's cable (CPU, VRM, RAM, the hub or a case fan)? A new part's fan cable starts unplugged. */
export const isFanCable = (id: string): boolean => id === "cpufan" || id === "vrmfan" || id === "ramfan" || id === "sysfan" || id.startsWith("fan:");

export const noCables = (): Cables => ({ atx: false, cpu: false, video: false, lan: false, pcmains: false, monmains: false, pcie: false, pcie2: false, pcie3: false, pcie4: false, cpufan: false, vrmfan: false, ramfan: false, sysfan: false });
/** Everything plugged that has something to plug into (with a `board`, the fans of the parts and the case it has). */
export const allCables = (board?: Board): Cables => {
  const c: Cables = { atx: true, cpu: true, video: true, lan: false, pcmains: true, monmains: true, pcie: false, pcie2: false, pcie3: false, pcie4: false, cpufan: true, vrmfan: !board, ramfan: !board, sysfan: true };
  if (board) for (const s of cablesOf(board)) if (isFanCable(s.id)) c[s.id] = cableBlocked(board, s.id) === null;
  return c;
};
/** The cords from the wall: the ones a saved game from before them is given as plugged (nobody is locked out of a machine that used to run). */
export const WALL_CABLES: readonly CableId[] = ["pcmains", "monmains"];

/** The cable called `id`: a fixed one, or a fan mount's (of `board`'s case when given, any mount otherwise). */
function spec(id: string, board?: Board): CableSpec | undefined {
  const s = CABLES.find((c) => c.id === id);
  if (s || !id.startsWith("fan:")) return s;
  const m = id.slice(4);
  return !board || caseMounts(board.caseTier).includes(m) ? mountCable(m) : undefined;
}

/** The cable's name for messages. */
export const cableName = (id: string): string => spec(id)?.name ?? id;

/** Why a cable cannot be plugged in right now (its source part is missing), or null if it can. */
export function cableBlocked(board: Board, id: CableId): string | null {
  const c = spec(id, board);
  if (!c) return `unknown cable "${id}"`;
  if (c.from === "router" || c.from === "wall" || c.from === "case") return null; // the Game owns the router and the port choice; a wall cord needs no part; the case brings its own hub and fans
  if (c.id === "vrmfan" || c.id === "ramfan") {
    const kind = c.from as "vrm-sink" | "ram-sink";
    return findDevices(board, kind).some((d) => (deviceSpec(d) as VrmSinkSpec).fan) ? null : `no ${kind === "vrm-sink" ? "VRM" : "RAM VRM"} heatsink with a fan installed`;
  }
  if (c.id === "cpufan") return findDevices(board, "cooler").length === 0 ? "no CPU cooler installed for the CPU fan cable" : null;
  if (findDevices(board, c.from).length === 0) return `no ${c.from === "display" ? "monitor" : c.from.toUpperCase()} installed for the ${c.name} cable`;
  const lead = pcieLeadNo(c.id);
  if (lead > 0) {
    const have = installedPsu(board)?.spec.pcieLeads ?? 0;
    if (have < lead) return have === 0 ? "this PSU has no PCIe power lead" : `this PSU has only ${have} PCIe power lead${have === 1 ? "" : "s"}`;
  }
  return null;
}

/** Does a part installed now need this cable? Every cable but the PCIe leads and the fans' always does (the machine is not complete without it); lead N only while the cards take N leads or more, a fan's only while the fan is there. */
export function cableNeeded(board: Board, id: CableId): boolean {
  const lead = pcieLeadNo(id);
  if (lead > 0) return lead <= pcieLeadsNeeded(board);
  if (isFanCable(id)) return cableBlocked(board, id) === null;
  return true;
}

/** How many PCIe power leads are plugged. */
export const pcieLeadsPlugged = (cables: Cables): number => PCIE_LEADS.filter((id) => cables[id]).length;

/** Leads this card needs: those of the cards before it (by slot) and its own, so the leads fill the cards in slot order. Returns [first, last] lead numbers, 1-based; first > last for a card on slot power only. */
function leadRange(board: Board, dev: InstalledDevice): [number, number] {
  let used = 0;
  const cards = board.devices.filter((d) => !d.burnt && (deviceSpec(d).kind === "gpu" || deviceSpec(d).kind === "npu")).sort((a, b) => a.slot.localeCompare(b.slot));
  for (const d of cards) {
    const n = cardLeads(deviceSpec(d));
    if (d === dev) return [used + 1, used + n];
    used += n;
  }
  return [1, 0];
}

/** Lead cable ids (`pcie`...) that feed this card, in the order of the leads used. */
export const cardLeadIds = (board: Board, dev: InstalledDevice): PcieLeadId[] => {
  const [a, b] = leadRange(board, dev);
  return PCIE_LEADS.slice(a - 1, Math.max(a - 1, b));
};

/** Is the card fully fed: slot power only, or all its leads plugged? An unfed card does not start. */
export const cardPowered = (board: Board, cables: Cables, dev: InstalledDevice): boolean => cardLeadIds(board, dev).every((id) => cables[id]);

export function connectCable(board: Board, cables: Cables, id: string): Result<{ cable: CableId }> {
  const c = spec(id, board);
  if (!c) return { ok: false, reason: `unknown cable "${id}"` };
  if (cables[c.id]) return { ok: false, reason: `${c.name} is already connected` };
  if (c.from === "router") return { ok: false, reason: "the ethernet cable is plugged in through the network (Game.connectCable)" };
  const why = cableBlocked(board, c.id);
  if (why) return { ok: false, reason: why };
  cables[c.id] = true;
  return { ok: true, cable: c.id };
}

export function disconnectCable(cables: Cables, id: string, board?: Board): Result<{ cable: CableId }> {
  const c = spec(id, board);
  if (!c) return { ok: false, reason: `unknown cable "${id}"` };
  if (!cables[c.id]) return { ok: false, reason: `${c.name} is not connected` };
  cables[c.id] = false;
  return { ok: true, cable: c.id };
}

/** Unplug every cable whose source part is gone (after an uninstall or swap). Returns the cables that came off. */
export function pruneCables(board: Board, cables: Cables): CableId[] {
  const off: CableId[] = [];
  for (const c of cablesOf(board)) {
    if (c.from === "router" || c.from === "wall" || c.from === "case") continue;
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
  else if (!cables.cpufan) post = { reason: "the CPU fan cable is not connected: plug it into the CPU_FAN header", short: "NO CPU FAN" };
  else if (!cables.cpu) post = { reason: "the 8-pin CPU power cable is not connected", short: "NO CPU POWER" };
  else if (ram.length === 0) post = { reason: "no working RAM installed", short: "NO RAM" };
  else if (PCIE_LEADS.slice(0, pcieLeadsNeeded(board)).some((id) => !cables[id])) {
    const missing = PCIE_LEADS.slice(0, pcieLeadsNeeded(board)).filter((id) => !cables[id]).length;
    post = { reason: `a card needs PCIe power and ${missing} lead${missing === 1 ? " is" : "s are"} not connected`, short: "GPU power cable" };
  }
  return { noPower, post };
}
