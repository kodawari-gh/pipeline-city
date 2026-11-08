// The removal graph (docs/BOARD.md "Build my PC"): which part must come out before which. Pure and static, like `compat.ts`: it reads the board and
// the plugged cables and says what stands in the way. The build mode (render/three/buildmode3d.ts) plays each step as an animation, in this order.
//   node ids  `side` the case's side panel · `board` · `case` · `cable:<id>` · `dev:<id>` (an installed device by its instance id)
//   an edge   A -> B means "B must be out before A can come out" (B blocks A)
// Two kinds of block: a *cable* feeds the part (unplug it first), and a part *covers* another (a cooler hides the CPU, a long card hides the next slot).
// The cover table (`COVERS`) is checked against the 3D geometry in render/three/fit.test.ts, so the rules and the models cannot drift apart.

import { boardSlots, deviceSpec, fanHost, fansOn, fittedRadiator, mountFan, type Board, type InstalledDevice } from "./board";
import { cablesOf, cardLeadIds, type Cables } from "./cables";
import type { DeviceKind } from "./specs";

export const SIDE = "side";
export const BOARD = "board";
export const CASE = "case";
export const cableNode = (id: string): string => `cable:${id}`;
export const devNode = (id: string): string => `dev:${id}`;
export const isCableNode = (n: string): boolean => n.startsWith("cable:");
export const isDevNode = (n: string): boolean => n.startsWith("dev:");

/** Cables that run outside the case (a part inside never blocks them and the side panel does not hide them). */
const OUTSIDE = new Set(["video", "lan", "pcmains", "monmains"]);

/**
 * How many PCIe slots further down the row a card in a slot covers: a GPU's or an NPU's cooler stands less than a finger's width from the next
 * slot's card, so that card's latch cannot be reached; a NIC's small sink leaves room. Checked against the 3D cards in render/three/fit.test.ts.
 */
export const COVERS: Readonly<Partial<Record<DeviceKind, number>>> = { gpu: 1, npu: 1 };

/**
 * The M.2 sockets a card's cooler stands over, by spec id and the PCIe slot it stands in: its stick cannot come out under it. Checked against the
 * 3D cards on every board in render/three/fit.test.ts (a socket a board lacks is never covered).
 */
export const OVER_M2: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  gpu1: { pcie0: ["m20"], pcie1: ["m21"], pcie2: ["m22"] },
  gpu2: { pcie0: ["m20"], pcie1: ["m21", "m22"] },
  gpu3: { pcie0: ["m20"] },
  npu1: { pcie0: ["m20"], pcie1: ["m21"], pcie2: ["m22"] },
  npu2: { pcie0: ["m20"], pcie1: ["m21"], pcie2: ["m22"] },
};
/** Whether a card (spec `spec` in PCIe slot `pcie`) stands over M.2 socket `m2`. */
export const overM2 = (spec: string, pcie: string, m2: string): boolean => !!OVER_M2[spec]?.[pcie]?.includes(m2);

const slotNo = (slot: string): number => Number(slot.replace(/^(m2|\D+)/, ""));

export type Graph = ReadonlyMap<string, readonly string[]>;

/** The parts (devices) that block removing `dev` by covering it, among `board.devices`. */
function coveredBy(board: Board, dev: InstalledDevice): InstalledDevice[] {
  const spec = deviceSpec(dev), out: InstalledDevice[] = [];
  const others = board.devices.filter((o) => o.id !== dev.id);
  if (spec.kind === "cpu") out.push(...others.filter((o) => deviceSpec(o).kind === "cooler"));
  if (spec.kind === "cooler" && (spec as { loop?: unknown }).loop) out.push(...others.filter((o) => deviceSpec(o).kind === "radiator")); // the hoses join the pump to the radiator: it comes out first
  // a heatsink's fans clip onto it; the fans on a radiator's mounts are screwed through it into the case
  out.push(...fansOn(board, dev.slot));
  const rad = spec.kind === "radiator" ? fittedRadiator(board) : null;
  if (rad) out.push(...rad.mounts.map((m) => mountFan(board, m)).filter((f): f is InstalledDevice => !!f));
  if (spec.slot === "pcie") {
    const n = slotNo(dev.slot);
    for (const o of others) {
      const os = deviceSpec(o);
      if (os.slot === "pcie" && slotNo(o.slot) < n && slotNo(o.slot) + (COVERS[os.kind] ?? 0) >= n) out.push(o);
    }
  }
  if (spec.slot === "m2") out.push(...others.filter((o) => overM2(o.spec, o.slot, dev.slot)));
  return out;
}

/** The cables that feed or leave `dev` and are plugged now. */
function cablesOn(board: Board, cables: Cables, dev: InstalledDevice): string[] {
  const spec = deviceSpec(dev), plugged = (id: string) => !!cables[id];
  const ids: string[] = [];
  switch (spec.kind) {
    case "psu": ids.push("atx", "cpu", "pcmains", "pcie", "pcie2", "pcie3", "pcie4"); break;
    case "cooler": ids.push("cpufan"); break;
    case "vrm-sink": ids.push("vrmfan"); break;
    case "ram-sink": ids.push("ramfan"); break;
    case "display": ids.push("video", "monmains"); break;
    case "gpu": case "npu": ids.push(...cardLeadIds(board, dev)); if (spec.kind === "gpu") ids.push("video"); break;
    case "nic": ids.push("lan"); break;
    case "fan": {
      // a case fan's own cord, or the header cable of the heatsink it sits on
      const host = fanHost(dev.slot), hostDev = host === null ? undefined : board.devices.find((o) => o.slot === host);
      const hostKind = hostDev ? deviceSpec(hostDev).kind : null;
      ids.push(host === null ? `fan:${dev.slot}` : hostKind === "cooler" ? "cpufan" : hostKind === "vrm-sink" ? "vrmfan" : hostKind === "ram-sink" ? "ramfan" : "");
      break;
    }
    default: break;
  }
  return ids.filter(plugged);
}

/** Every node that exists now with the nodes that block it. */
export function buildGraph(board: Board, cables: Cables): Graph {
  const g = new Map<string, string[]>();
  const add = (n: string, ...blockers: string[]) => g.set(n, [...new Set(blockers)]);
  add(SIDE);
  const cableIds = new Set(cablesOf(board).map((c) => c.id as string));
  for (const id of cableIds) if (cables[id]) add(cableNode(id), ...(OUTSIDE.has(id) ? [] : [SIDE]));
  for (const d of board.devices) {
    const spec = deviceSpec(d);
    // the monitor and the wall sit outside the case; everything else needs the side panel off
    const inside = spec.kind !== "display";
    add(devNode(d.id), ...(inside ? [SIDE] : []), ...cablesOn(board, cables, d).map(cableNode), ...coveredBy(board, d).map((o) => devNode(o.id)));
  }
  // The board comes out only bare: every part that sits on it and every cable inside the case first. The PSU, the drives in the cage, the monitor, the
  // radiator and the fans on the case mounts hang off the case.
  const offBoard = (d: InstalledDevice) => ["psu", "display", "radiator"].includes(deviceSpec(d).kind) || deviceSpec(d).slot.startsWith("sata") || (deviceSpec(d).kind === "fan" && fanHost(d.slot) === null);
  const onBoard = board.devices.filter((d) => !offBoard(d));
  const innerCables = ["atx", "cpu", "sysfan", "vrmfan", "ramfan"].filter((id) => cables[id]);
  add(BOARD, SIDE, ...onBoard.map((d) => devNode(d.id)), ...innerCables.map(cableNode));
  const fanCables = [...cableIds].filter((id) => cables[id] && (id.startsWith("fan:") || id === "sysfan"));
  add(CASE, SIDE, BOARD, ...board.devices.map((d) => devNode(d.id)).filter((n) => !onBoard.some((d) => devNode(d.id) === n)), ...fanCables.map(cableNode));
  return g;
}

/**
 * The steps to take `target` out: every block first (and what blocks those), then the target itself last. A block is listed once, after
 * everything that blocks it. Throws if the graph has a cycle (a rule bug the tests would catch).
 */
export function removalPlan(graph: Graph, target: string): string[] {
  if (!graph.has(target)) return [];
  const out: string[] = [], state = new Map<string, 1 | 2>();
  const visit = (n: string): void => {
    const s = state.get(n);
    if (s === 2) return;
    if (s === 1) throw new Error(`removal cycle at ${n}`);
    state.set(n, 1);
    for (const b of graph.get(n) ?? []) if (graph.has(b)) visit(b);
    state.set(n, 2);
    out.push(n);
  };
  visit(target);
  return out;
}

/** Many targets at once (a swap that takes several parts out), each part once, still in a valid order. */
export function removalPlanAll(graph: Graph, targets: readonly string[]): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const t of targets) for (const n of removalPlan(graph, t)) if (!seen.has(n)) { seen.add(n); out.push(n); }
  return out;
}

/** The nodes that come back, in the order to put them back: the plan reversed, without the target (the player puts the new part in its place). */
export function restorePlan(plan: readonly string[]): string[] {
  return plan.slice(0, -1).reverse();
}

/** What a node is, for the animation: the device's kind, `cable`, or the case's own parts. */
export type NodeKind = DeviceKind | "cable" | "side" | "board" | "case";

export function nodeKind(board: Board, node: string): NodeKind {
  if (node === SIDE) return "side";
  if (node === BOARD) return "board";
  if (node === CASE) return "case";
  if (isCableNode(node)) return "cable";
  const d = board.devices.find((x) => devNode(x.id) === node);
  return d ? deviceSpec(d).kind : "cable";
}

/** The slots a new part of this device kind can reach only with these devices out: used by the build mode to take a cooler off before a CPU goes in. */
export function accessBlockers(board: Board, slotId: string, kind: DeviceKind): string[] {
  const slot = boardSlots(board).find((s) => s.id === slotId);
  if (!slot) return [];
  const out: string[] = [];
  const others = board.devices;
  if (kind === "cpu") out.push(...others.filter((o) => deviceSpec(o).kind === "cooler").map((o) => devNode(o.id)));
  if (slot.type === "pcie") {
    const n = slotNo(slotId);
    for (const o of others) { const os = deviceSpec(o); if (os.slot === "pcie" && slotNo(o.slot) < n && slotNo(o.slot) + (COVERS[os.kind] ?? 0) >= n) out.push(devNode(o.id)); }
  }
  if (slot.type === "m2") out.push(...others.filter((o) => overM2(o.spec, o.slot, slotId)).map((o) => devNode(o.id)));
  if (kind === "cooler" && fittedRadiator(board)) out.push(...others.filter((o) => deviceSpec(o).kind === "radiator").map((o) => devNode(o.id)));
  return [...new Set(out)];
}
