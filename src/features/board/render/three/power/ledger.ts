// The watts behind the power lens (docs/render/power.md): where the machine's draw goes, cable by cable and part by part, from one snapshot. Directions are
// source to sink: wall to machine, supply to board, board to part. Pure: no Three, no DOM, so it is tested alone (`ledger.test.ts`).
import type { Snapshot } from '@/worker/protocol';
import { assignLeads } from '@/features/board/sim/cables';
import { fanHost } from '@/features/board/sim/board';
import { getSpec } from '@/features/board/sim/specs';

/** A run of power: carrying watts, standing still (the machine is off, nothing draws) or cut (its plug is out). */
export type FlowState = 'on' | 'idle' | 'missing';

/** A group of parts drawing together (all the RAM sticks, all the case fans). */
export interface KindDraw { w: number; ids: string[] }

export interface Ledger {
  /** The machine draws now: it is powered and its supply holds. */
  on: boolean;
  hasPsu: boolean;
  hasMonitor: boolean;
  /** What the wall gives the monitor, what it gives the PC (the total less the monitor), and what the meter reads at the wall (the supply's losses are in it). */
  monW: number;
  pcW: number;
  wallW: number;
  /** The supply's load and rating (W), and whether it tripped. */
  loadW: number;
  budgetW: number;
  tripped: boolean;
  /** The draw at which a line or a part reads full on the lens's scale (`levelOf`): the machine's own draw, so the busiest runs read hottest. */
  refW: number;
  /** Each part's draw by device id (the supply: what it hands the machine). */
  part: ReadonlyMap<string, number>;
  /** Each cable's draw by cable id (a drive's SATA lead is `<device id>:power`). The two cords from the wall, the supply's cables, the fans' cords. */
  cable: ReadonlyMap<string, number>;
  /** What each part takes through the board's own copper, by device id: a card, its share from the slot (its leads bring the rest); a SATA drive, nothing (its lead brings it all). */
  board: ReadonlyMap<string, number>;
  /** The draw of each kind of part (`cpu`, `ram`, `storage`, `gpu`, `fan`...), the supply and the monitor left out. */
  kinds: ReadonlyMap<string, KindDraw>;
  /** Is this cable out of its socket? Only a cable the sim lists (it needs it, or it is plugged) can be. */
  missing(id: string): boolean;
  /** The state of a cable's run. */
  state(id: string): FlowState;
}

/** The watts as words: a decimal under 10 W, whole above. */
export const wattsText = (w: number): string => (w >= 10 ? `${Math.round(w)} W` : `${(Math.round(w * 10) / 10).toFixed(1)} W`);

/** The cable a fan header's fan or a pump follows, by the kind of the part that hosts it. */
const HEADER: Readonly<Record<string, string>> = { cooler: 'cpufan', 'vrm-sink': 'vrmfan', 'ram-sink': 'ramfan' };

const sum = (a: Iterable<number>): number => { let t = 0; for (const x of a) t += x; return t; };

/**
 * Split the machine's draw over its cables: the PC cord carries what the machine takes less the monitor, the monitor's cord the monitor, the 8-pin the CPU, each
 * PCIe lead its share of its card (the card takes its draw in equal shares from the slot and each of its leads), each drive's lead the drive, each fan's cord
 * the fan, and the 24-pin the rest (the board: memory, cards' slot shares, drives on the board, the fan headers, the regulators' losses). So the cables add up
 * to the cord.
 */
export function powerLedger(s: Snapshot): Ledger {
  const on = s.powered && !s.power.off;
  const w = (d: { powerW: number }): number => (on ? d.powerW : 0);
  const hasPsu = s.devices.some((d) => d.kind === 'psu'), hasMonitor = s.devices.some((d) => d.kind === 'display');
  const monW = sum(s.devices.filter((d) => d.kind === 'display').map(w));
  const cpuW = sum(s.devices.filter((d) => d.kind === 'cpu').map(w));
  const sata = new Map(s.storage.filter((d) => d.slot.startsWith('sata')).map((d) => [d.slot, d.deviceId] as const));
  const sataDrives = s.devices.filter((d) => sata.has(d.slot));
  const pcW = on ? Math.max(0, s.power.totalW - monW) : 0;

  const cable = new Map<string, number>();
  // the PCIe leads: a card's share is its draw over its leads and the slot
  const cards = s.devices.filter((d) => (d.kind === 'gpu' || d.kind === 'npu') && !d.burnt).map((d) => ({ slot: d.slot, loadW: getSpec(d.spec)?.loadW ?? 0, w: w(d) }));
  for (const l of assignLeads(cards)) {
    const c = cards.find((q) => q.slot === l.slot)!;
    cable.set(l.lead, c.w / (assignLeads([c]).length + 1));
  }
  for (const d of sataDrives) cable.set(`${d.id}:power`, w(d));
  // the fans: a heatsink's, a sink's and the pump on their board header; a case fan on its mount's cord to the hub, and the hub's cord carries them all
  let hub = 0;
  for (const d of s.devices) {
    if (d.kind === 'fan') {
      const host = fanHost(d.slot);
      if (host === null) { cable.set(`fan:${d.slot}`, w(d)); hub += w(d); continue; }
      const h = s.devices.find((x) => x.slot === host), id = h ? HEADER[h.kind] : undefined;
      if (id) cable.set(id, (cable.get(id) ?? 0) + w(d));
    } else if (HEADER[d.kind]) cable.set(HEADER[d.kind]!, (cable.get(HEADER[d.kind]!) ?? 0) + w(d)); // (a loop's pump)
  }
  cable.set('sysfan', hub);
  cable.set('cpu', cpuW);
  cable.set('atx', Math.max(0, pcW - cpuW - sum(sataDrives.map(w)) - sum([...cable].filter(([id]) => /^pcie\d*$/.test(id)).map(([, x]) => x))));
  cable.set('pcmains', pcW);
  cable.set('monmains', monW);

  const listed = new Map<string, boolean>(s.cables.map((c) => [c.id, c.connected]));
  const missing = (id: string): boolean => listed.get(id) === false;
  // (a cord that is out carries nothing)
  for (const [id] of cable) if (missing(id)) cable.set(id, 0);

  const part = new Map<string, number>();
  const board = new Map<string, number>();
  const kinds = new Map<string, KindDraw>();
  for (const d of s.devices) {
    if (d.kind === 'psu') { part.set(d.id, pcW); continue; }
    part.set(d.id, w(d));
    const card = cards.find((c) => c.slot === d.slot);
    board.set(d.id, sata.has(d.slot) ? 0 : card ? card.w / (assignLeads([card]).length + 1) : w(d));
    if (d.kind === 'display') continue;
    const k = kinds.get(d.kind) ?? { w: 0, ids: [] };
    k.w += w(d); k.ids.push(d.id);
    kinds.set(d.kind, k);
  }
  const loadW = on ? s.power.totalW : 0;
  return {
    on, hasPsu, hasMonitor, monW, pcW, wallW: s.energy.wallW, loadW, budgetW: s.power.budgetW, tripped: s.power.tripped, refW: Math.max(60, loadW),
    part, cable, board, kinds, missing,
    state: (id) => (missing(id) ? 'missing' : (cable.get(id) ?? 0) > 0.05 ? 'on' : 'idle'),
  };
}
