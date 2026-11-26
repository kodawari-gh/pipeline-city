import type { Snapshot } from '../../../worker/protocol';
import { assignLeads, getSpec } from './features';
import type { BusKind, Cpu } from './types';
import { clamp } from './consts';
import { drawDead, updateHeatGlows } from './draw';
import { updateFans } from './fans';
import { drawPsu } from './psu';
import type { LiveState } from './state';
import { updateStatus } from './status';

/** What each PCIe lead carries: an equal share of its card's draw with the slot (a card with two leads: a third each). */
function leadWatts(snap: Snapshot): Map<string, number> {
  const cards = snap.devices.filter((d) => (d.kind === 'gpu' || d.kind === 'npu') && !d.burnt);
  const leadW = new Map<string, number>();
  for (const l of assignLeads(cards.map((d) => ({ slot: d.slot, loadW: getSpec(d.spec)?.loadW ?? 0 })))) {
    const d = cards.find((c) => c.slot === l.slot);
    if (!d) {
      continue;
    }
    const n = assignLeads([{ slot: d.slot, loadW: getSpec(d.spec)?.loadW ?? 0 }]).length;
    leadW.set(l.lead, d.powerW / (n + 1));
  }
  return leadW;
}

/** How bright a conductor that carries `w` watts glows (0 while no current flows). */
function levelOf(snap: Snapshot): (w: number) => number {
  const flow = !snap.power.off && !snap.power.tripped && !snap.board?.burnt;
  return (w) => (flow && snap.power.budgetW > 0 ? clamp(Math.sqrt(w / snap.power.budgetW) * 1.15) : 0);
}

/** What a power cable's glow aims for: the CPU's draw, the board's share, or its PCIe lead's (none when unplugged). */
function cableTarget(kind: string, w: { cpuW: number; totalW: number; leadW: Map<string, number> }): number {
  if (kind === 'cpu') {
    return w.cpuW;
  }
  if (kind === 'atx') {
    return w.totalW * 0.6;
  }
  return w.leadW.get(kind) ?? 0;
}

/** The power conductors and cables glow in proportion to the current they carry. */
function updateGlowLevels(s: LiveState, snap: Snapshot, cpu: Cpu | undefined): void {
  const level = levelOf(snap);
  const cpuW = cpu?.powerW ?? 0;
  const ramW = snap.devices.filter((d) => d.kind === 'ram').reduce((a, d) => a + d.powerW, 0);
  const cardW = snap.devices.filter((d) => /^pcie\d+$/u.test(d.slot)).reduce((a, d) => a + d.powerW, 0); // what the cards in the slots draw: the slot rail's glow
  const leadW = leadWatts(snap);
  const lv: [BusKind, number][] = [
    ['pwrcpu', level(cpuW)],
    ['vcore', level(cpuW)],
    ['pwr12', level(snap.power.totalW * 0.55)],
    ['vdimm', level(ramW + 0.5)],
    ['pwrpcie', level(cardW)],
  ];
  for (const [id, v] of lv) {
    const l = s.lit.get(id);
    if (l) {
      l.hold = v;
    }
  }
  for (const lc of s.cables) {
    lc.target = level(cableTarget(lc.cable.kind, { cpuW, totalW: snap.power.totalW, leadW }));
    if (!s.connected.has(lc.cable.kind)) {
      lc.target = 0;
    }
  }
}

/** ---- power ----: the PSU's readout values, the conductors' glow, the fans, the parts' heat glow, the PSU panel and the badges. */
export function updatePower(s: LiveState, snap: Snapshot, cpu: Cpu | undefined): void {
  const psuDev = snap.devices.find((d) => d.kind === 'psu');
  const ratio = snap.power.budgetW > 0 ? snap.power.totalW / snap.power.budgetW : 0;
  s.psuRatio = ratio;
  s.psuOff = snap.power.off;
  s.psuTripped = snap.power.tripped;
  // a hard power-off reads the ambient value at once: no cooling tail on a dead PSU (the low-pass only runs while it is on)
  if (snap.power.off || !snap.powered) {
    s.psuTemp = 25;
  }
  s.psuW = snap.power.totalW;
  s.psuBudget = psuDev ? snap.power.budgetW : 0;
  updateGlowLevels(s, snap, cpu);
  updateFans(s, snap, { cpu, ratio });
  updateHeatGlows(s, snap);
  drawPsu(s);
  drawDead(s);
  updateStatus(s, snap, cpu);
}
