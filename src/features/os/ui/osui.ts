// OS menu, pure logic (no DOM, no signals): the spool settings model and the resource monitor (docs/OS.md "OS menu").
// The monitor reads the whole machine out of the snapshot in one list, each part with its load and a level, and names the
// worst one as the bottleneck with what to do about it.

import type { Snapshot } from '@/worker/game/game';
import { fmtMbit, limiterLadder, linkUsable } from '../../network/ui/netui';
import type { Level } from '@/core/ui/logic';
import type { IconName } from '../../economy/ui/shop/picker';

export type ResId = 'cpu' | 'vrm' | 'ram' | 'psu' | 'queue' | 'net' | `disk:${string}`;

export interface ResRow {
  id: ResId;
  label: string;
  icon: IconName;
  /** Load 0..1 (the bar), or null when the part has no meaningful load. */
  load: number | null;
  /** The headline number next to the bar, and the small print under it. */
  text: string;
  detail: string;
  level: Level;
  /** What is wrong and what to do about it, for a row that is not `ok`. */
  advice?: string;
}

export interface Bottleneck { id: ResId; label: string; level: Level; text: string }

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round(n)} B`;
}

/** Load level of a 0..1 share: warn from 85%, bad from 100%. */
const shareLevel = (v: number): Level => (v >= 1 ? 'bad' : v >= 0.85 ? 'warn' : 'ok');

function cpuRow(s: Snapshot): ResRow | null {
  const d = s.devices.find((x) => x.kind === 'cpu');
  if (!d) return null;
  const live = s.cores?.live;
  const active = live ? live.filter((c) => !c.parked) : [];
  const busy = active.filter((c) => c.job !== 0).length;
  const running = !!s.os?.runningKeyId || s.phase === 'running';
  const load = !s.powered ? 0 : active.length ? busy / active.length : running ? 1 : 0;
  const clk = s.cpuClock;
  const clockText = clk ? `${d.effectiveClock.toFixed(2)} of ${clk.max.toFixed(2)} GHz` : `${d.effectiveClock.toFixed(2)} GHz`;
  let level: Level = 'ok';
  let advice: string | undefined;
  if (d.burnt) { level = 'bad'; advice = 'The processor is burnt out. Replace it.'; }
  else if (d.unstable) { level = 'bad'; advice = 'The processor is unstable and may crash jobs. Lower its clock or cool it better.'; }
  else if (d.throttle < 0.98) { level = 'warn'; advice = `Heat holds the clock at ${pct(d.throttle)} of the request. A better cooler or a lower clock helps.`; }
  return {
    id: 'cpu', label: d.name, icon: 'cpu', load, level, advice,
    text: s.powered ? `${pct(load)} busy` : 'off',
    detail: `${clockText} | ${Math.round(d.tempC)} °C | ${d.powerW.toFixed(1)} W${active.length ? ` | ${busy}/${active.length} cores working` : ''}`,
  };
}

function vrmRow(s: Snapshot): ResRow {
  const v = s.board.vrm;
  const load = clamp(v.loadRatio);
  let level: Level = shareLevel(v.loadRatio);
  let advice: string | undefined;
  if (v.burnt) { level = 'bad'; advice = 'The board regulator is burnt out. The board is dead.'; }
  else if (v.unstable || v.loadRatio >= 1) { level = 'bad'; advice = 'The regulator is overloaded: expect crashes. Lower the CPU clock or buy a board with a stronger regulator.'; }
  else if (v.throttle < 0.98) { level = 'warn'; advice = 'The regulator runs hot and slows the CPU. A heatsink on it helps.'; }
  else if (level === 'warn') advice = 'Most of the regulator rating is in use. Keep the clock near stock.';
  return { id: 'vrm', label: 'Power regulator', icon: 'bolt', load, level, advice, text: pct(v.loadRatio), detail: `${v.phases} phases | ${Math.round(v.tempC)} °C | ${v.heatW.toFixed(1)} W lost` };
}

function ramRow(s: Snapshot): ResRow | null {
  const m = s.ram;
  const sticks = s.devices.filter((d) => d.kind === 'ram');
  if (!m && sticks.length === 0) return null;
  const filled = m && m.filled.length ? m.filled.reduce((a, b) => a + b, 0) / (m.filled.length * 255) : 0;
  const level = shareLevel(filled);
  return {
    id: 'ram', label: `Memory${sticks.length ? ` (${sticks.length} stick${sticks.length === 1 ? '' : 's'})` : ''}`, icon: 'memory', load: filled, level,
    advice: level === 'ok' ? undefined : 'Memory is nearly full. More RAM lets bigger jobs run without stalls.',
    text: m ? `${pct(filled)} in use` : '-',
    detail: m ? `${fmtBytes(m.bytes)} installed` : [...new Set(sticks.map((d) => d.name))].map((n) => `${sticks.filter((d) => d.name === n).length} x ${n}`).join(', '),
  };
}

function diskRows(s: Snapshot): ResRow[] {
  return s.storage.map((d) => {
    const used = d.capacityBytes > 0 ? d.usedBytes / d.capacityBytes : 0;
    const depth = Math.max(1, d.queueDepth);
    const q = d.queued / depth;
    let level: Level = shareLevel(used);
    let advice: string | undefined;
    if (d.burnt) { level = 'bad'; advice = 'The drive is burnt out. Its data is gone.'; }
    else if (d.wearPct >= 90) { level = 'bad'; advice = 'The drive is nearly worn out. Replace it before it loses data.'; }
    else if (q >= 1) { level = 'warn'; advice = 'Requests queue up at this drive. A faster drive, or another drive for the spool, spreads the work.'; }
    else if (level !== 'ok') advice = 'The drive is nearly full. Free space or add a drive.';
    else if (d.wearPct >= 70) { level = 'warn'; advice = 'The drive is wearing out. Plan a replacement.'; }
    return {
      id: `disk:${d.deviceId}` as ResId, label: `${d.name}${d.hasOs ? ' (OS)' : ''}`, icon: 'disk', load: used, level, advice,
      text: `${fmtBytes(d.usedBytes)} of ${fmtBytes(d.capacityBytes)}`,
      detail: `${d.slot} | ${d.busy ? 'busy' : 'idle'} | ${fmtBytes(d.bytesPerSecond)}/s | queue ${d.queued}/${d.queueDepth} | wear ${d.wearPct}%`,
    };
  });
}

function netRow(s: Snapshot): ResRow | null {
  if (!s.net.router && !s.net.isp) return null;
  const lad = limiterLadder(s);
  const slow = lad.segs.find((g) => g.binding);
  const usable = linkUsable(s);
  const top = Math.max(0, ...lad.segs.map((g) => g.mbps ?? 0));
  let level: Level = 'ok';
  let advice: string | undefined;
  if (!s.powered) { level = 'ok'; }
  else if (!usable) { level = s.net.state === 'down' ? 'bad' : 'warn'; advice = s.net.reason ? `${s.net.reason.charAt(0).toUpperCase()}${s.net.reason.slice(1)}.` : 'The link is not up.'; }
  else if (slow && top > 0 && (slow.mbps ?? top) < top * 0.5) {
    level = 'warn';
    advice = `${slow.label} (${slow.text}) is the slowest link, far below the rest. Upgrading it speeds the whole path.`;
  }
  return {
    id: 'net', label: 'Network', icon: 'net', load: top > 0 ? clamp(lad.downMbps / top) : null, level, advice,
    text: !s.powered ? 'off' : usable ? `${fmtMbit(lad.downMbps)} down` : s.net.state,
    detail: `${slow ? `limited by ${slow.label.toLowerCase()} ` : ''}| ${fmtMbit(lad.upMbps)} up | ${lad.clients} clients`,
  };
}

function psuRow(s: Snapshot): ResRow | null {
  const p = s.power;
  if (!(p.budgetW > 0)) return null;
  const load = clamp(p.totalW / p.budgetW);
  let level = shareLevel(p.totalW / p.budgetW);
  let advice: string | undefined;
  if (p.tripped) { level = 'bad'; advice = 'The power supply tripped. Cut the load or buy a bigger supply.'; }
  else if (level !== 'ok') advice = 'The power supply is near its limit. A bigger supply leaves room to add parts.';
  return { id: 'psu', label: 'Power supply', icon: 'bolt', load, level, advice, text: `${Math.round(p.totalW)} of ${Math.round(p.budgetW)} W`, detail: `${Math.round(s.energy.wallW)} W from the wall` };
}

function queueRow(s: Snapshot): ResRow | null {
  const os = s.os;
  if (!os) return null;
  const used = os.spool.slots > 0 ? os.spool.used / os.spool.slots : 0;
  const full = os.spool.full;
  return {
    id: 'queue', label: 'Job queue', icon: 'slot', load: used, level: full ? 'warn' : 'ok',
    advice: full ? 'Every queue slot is taken, so no new downloads start. Add slots below, or use more drives for the spool.' : undefined,
    text: `${os.spool.used}/${os.spool.slots} slots`,
    detail: `${os.queue.length} job${os.queue.length === 1 ? '' : 's'} in the OS${os.spool.slots < os.config!.spoolMax ? ` | the OS allows ${os.config!.spoolMax}` : ''}`,
  };
}

/** Every part of the machine, in the order data and work flow through it. Empty without a CPU. */
export function resourceRows(s: Snapshot): ResRow[] {
  return [cpuRow(s), vrmRow(s), ramRow(s), ...diskRows(s), netRow(s), queueRow(s), psuRow(s)].filter((r): r is ResRow => !!r);
}

const RANK: Record<Level, number> = { ok: 0, warn: 1, bad: 2 };

/** The worst part: bad before warn, then the most loaded. Null when every part is fine. */
export function bottleneck(rows: ResRow[]): Bottleneck | null {
  let best: ResRow | null = null;
  for (const r of rows) {
    if (r.level === 'ok') continue;
    if (!best || RANK[r.level] > RANK[best.level] || (RANK[r.level] === RANK[best.level] && (r.load ?? 0) > (best.load ?? 0))) best = r;
  }
  return best && { id: best.id, label: best.label, level: best.level, text: best.advice ?? best.text };
}

// ---------- spool settings ----------

export interface SpoolDriveRow { deviceId: string; label: string; home: boolean; on: boolean; why: string | null; slots: number; freeText: string; canToggle: boolean }
export interface SpoolModel {
  slots: number;
  max: number;
  /** The slider value: slots wanted (the max when automatic). */
  wanted: number;
  auto: boolean;
  used: number;
  drives: SpoolDriveRow[];
  /** The machine is on: a change waits for the next power-on. */
  pending: boolean;
}

export function spoolModel(s: Snapshot): SpoolModel | null {
  const os = s.os;
  if (!os?.config) return null;
  const c = os.config;
  return {
    slots: os.spool.slots, max: c.spoolMax, wanted: c.spoolWanted ?? c.spoolMax, auto: c.spoolWanted === null, used: os.spool.used, pending: s.powered,
    drives: c.drives.map((d) => ({
      deviceId: d.deviceId, label: `${d.name} (${d.slot})`, home: d.home, on: d.on, why: d.why, slots: d.slots, freeText: `${fmtBytes(d.freeBytes)} free`,
      canToggle: d.on || !d.why,
    })),
  };
}
