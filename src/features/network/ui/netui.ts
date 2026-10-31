// Network UI, pure logic (no DOM, no signals): the network panel model, the four-segment limiter ladder, the link state
// chip, the HUD chip, the link checklist, the effective speed with a candidate part, and the stats of routers and plans.
// Every number comes from the snapshot (docs/NETWORK.md "Snapshot"). See docs/UI.md "Network".

import { getSpec, type NicSpec } from '../../board/sim/specs';
import type { KeySnap, LinkState, Snapshot, TransferSnap } from '@/worker/game/game';
import { bandwidth, DISK_NET_MBPS, getIspSpec, getRouterSpec, NET, type Binding } from '../sim/specs';
import { fmtMbit, jackPort, nicsInOrder } from './netdesc';
import { fmtMoney, fmtTicks, type ChipLevel } from '@/core/ui/logic';
import type { IconName, PickerLine, Stat } from '../../economy/ui/picker';

export { fmtMbit } from './netdesc';

/** The network exists in the player's world once a router or a plan is there. */
export const hasNetwork = (s: Snapshot): boolean => !!(s.net.router || s.net.isp);

const LINK_OK: LinkState[] = ['link-up', 'saturated'];
export const linkUsable = (s: Snapshot): boolean => LINK_OK.includes(s.net.state);

// ---------- the state chip ----------

export interface NetChip { text: string; level: ChipLevel; title: string }

/** The link state in one chip: no cable, link up, link down (with its reason), saturated. Null with no network at all. */
export function netStateChip(s: Snapshot): NetChip | null {
  if (!hasNetwork(s)) return null;
  const n = s.net;
  const why = n.reason ? ` ${n.reason.charAt(0).toUpperCase()}${n.reason.slice(1)}.` : '';
  switch (n.state) {
    case 'no-device': return { text: 'No service', level: 'idle', title: `The network needs a router and an internet plan.${why}` };
    case 'no-cable': return { text: 'No cable', level: 'warn', title: `The router and plan are there, but no ethernet cable is plugged into a jack.${why}` };
    case 'no-os': return { text: 'Setup needed', level: 'warn', title: `The cable is in, but the OS cannot run the link yet.${why}` };
    case 'down': return {
      text: 'Link down', level: s.powered ? 'bad' : 'warn',
      title: `The link is down.${why} Jobs already on the drive are safe.`,
    };
    case 'link-up': return { text: 'Link up', level: 'ok', title: 'The link is up: jobs download in the background, run on the OS and upload when done.' };
    case 'saturated': return { text: 'Saturated', level: 'warn', title: `Every client slot or the spool is full.${why} More bandwidth does not help while the OS or the drive is the limit.` };
  }
}

/** The HUD chip: appears once a router exists. Short text (the speed when up), an icon name and a tooltip. */
export function hudNetChip(s: Snapshot): (NetChip & { icon: IconName }) | null {
  if (!s.net.router) return null;
  const c = netStateChip(s)!;
  const n = s.net;
  const bw = n.bandwidth.downMbps;
  const text = n.state === 'link-up' ? fmtMbit(bw)
    : n.state === 'saturated' ? `${fmtMbit(bw)} full`
    : n.state === 'no-cable' ? 'no cable'
    : n.state === 'down' ? 'down'
    : n.state === 'no-os' ? 'setup' : 'no plan';
  return { ...c, text, icon: 'net', title: `${c.title} Click for the network panel.` };
}

// ---------- the four-segment ladder: port | router | plan | drive ----------

export type LimiterId = 'port' | 'router' | 'isp' | 'disk';

export interface LimiterSeg {
  id: LimiterId;
  label: string;
  /** Speed in Mbit/s, or null when the piece is missing. */
  mbps: number | null;
  text: string;
  detail: string;
  /** The piece that sets the effective speed. */
  binding: boolean;
  /** Bar length 0..1 on a log scale against the fastest of the four. */
  frac: number;
}

export interface LimiterLadder {
  segs: LimiterSeg[];
  binding: LimiterId | null;
  downMbps: number;
  upMbps: number;
  clients: number;
}

/** The OS drive's network sink rate (Mbit/s), or null with no OS. */
export function diskMbps(s: Snapshot): number | null {
  const host = s.storage.find((d) => d.hasOs);
  return host ? DISK_NET_MBPS[host.spec] ?? 80 : null;
}

/** The speed of the jack the cable is in; with no cable, the best jack the machine could use (shown dimmed). */
function portSpeed(s: Snapshot): { mbps: number | null; plugged: boolean; label: string } {
  const p = s.net.port;
  if (p.kind) return { mbps: p.mbps, plugged: true, label: p.kind === 'board' ? 'Board jack' : (s.devices.find((d) => d.id === p.deviceId)?.name ?? 'Network card') };
  const board = s.board.features.ethernetMbps;
  const nic = Math.max(0, ...nicsInOrder(s).filter((d) => !d.burnt).map((d) => (getSpec(d.spec) as NicSpec | undefined)?.mbps ?? 0));
  const best = Math.max(board, nic);
  return { mbps: best > 0 ? best : null, plugged: false, label: best > 0 ? 'Not plugged in' : 'No jack' };
}

const logFrac = (v: number, top: number): number => (v > 0 && top > 0 ? Math.min(1, Math.max(0.04, Math.log10(1 + v) / Math.log10(1 + top))) : 0);

/**
 * The four limits side by side, in the order data flows: port, router, plan, drive. The binding one is the slowest of
 * the four (the sim's own `bandwidth.binding` when the link works, else found here with the same tie order).
 */
export function limiterLadder(s: Snapshot): LimiterLadder {
  const n = s.net;
  const port = portSpeed(s);
  const disk = diskMbps(s);
  const raw: Array<{ id: LimiterId; label: string; mbps: number | null; detail: string }> = [
    { id: 'port', label: 'Port', mbps: port.mbps, detail: port.plugged ? port.label : port.mbps ? `${port.label} (best jack)` : port.label },
    { id: 'router', label: 'Router', mbps: n.router?.mbps ?? null, detail: n.router ? `${n.router.name}, ${n.router.clients} clients` : 'No router' },
    { id: 'isp', label: 'Plan', mbps: n.isp?.downMbps ?? null, detail: n.isp ? `${n.isp.name}, ${fmtMbit(n.isp.upMbps)} up` : 'No plan' },
    { id: 'disk', label: 'Drive', mbps: disk, detail: disk === null ? 'No OS drive' : s.storage.find((d) => d.hasOs)?.name ?? 'Drive' },
  ];
  let found: LimiterId | null = null;
  let min = Infinity;
  for (const r of raw) if (r.mbps !== null && r.mbps < min) { min = r.mbps; found = r.id; }
  const binding: LimiterId | null = n.bandwidth.binding ?? (raw.every((r) => r.mbps !== null) ? found : null);
  const top = Math.max(...raw.map((r) => r.mbps ?? 0));
  return {
    binding,
    downMbps: n.bandwidth.downMbps, upMbps: n.bandwidth.upMbps, clients: n.bandwidth.clients,
    segs: raw.map((r) => ({
      id: r.id, label: r.label, mbps: r.mbps, detail: r.detail,
      text: r.mbps === null ? '-' : fmtMbit(r.mbps),
      binding: r.id === binding, frac: r.mbps === null ? 0 : logFrac(r.mbps, top),
    })),
  };
}

/**
 * The piece that sets the upload speed (the leg a web job pays for): the slowest of the port, the router and the plan's
 * upload, in the sim's tie order. The drive only limits what is written, so it never binds the upload. Null with no usable link.
 */
export function uploadLimiter(s: Snapshot): { id: 'port' | 'router' | 'isp'; text: string } | null {
  const n = s.net;
  if (!linkUsable(s) || n.bandwidth.upMbps <= 0) return null;
  const legs: Array<{ id: 'port' | 'router' | 'isp'; mbps: number }> = [
    { id: 'port', mbps: n.port.mbps }, { id: 'router', mbps: n.router?.mbps ?? 0 }, { id: 'isp', mbps: n.isp?.upMbps ?? 0 },
  ];
  let best = legs[0]!;
  for (const l of legs) if (l.mbps < best.mbps) best = l;
  return { id: best.id, text: `limited by: ${best.id} (upload)` };
}

/** What to upgrade to speed the line up, in plain words (the binding limiter), or null when nothing is binding. */
export function limiterAdvice(l: LimiterLadder): string | null {
  switch (l.binding) {
    case 'port': return 'The port is the slowest link: a better board jack or a network card speeds it up.';
    case 'router': return 'The router is the slowest link: a faster router speeds it up.';
    case 'isp': return 'The plan is the slowest link: a faster plan speeds it up.';
    case 'disk': return 'The drive is the slowest link: a faster drive speeds it up.';
    default: return null;
  }
}

// ---------- the link checklist ----------

export interface CheckItem { id: 'plan' | 'router' | 'jack' | 'cable' | 'os' | 'ram'; label: string; ok: boolean; why: string }

const ramK = (s: Snapshot): number =>
  s.devices.filter((d) => d.kind === 'ram' && !d.burnt).reduce((n, d) => n + ((getSpec(d.spec) as { sizeBytes?: number } | undefined)?.sizeBytes ?? 0) / 1024, 0);

/** The things a working link needs, each ok or missing with the reason in words (hover text). */
export function linkChecklist(s: Snapshot): CheckItem[] {
  const jack = s.board.features.ethernetMbps > 0 || nicsInOrder(s).some((d) => !d.burnt);
  const lan = s.cables.find((c) => c.id === 'lan');
  const need = NET.minRamBytes / 1024;
  const items: CheckItem[] = [
    { id: 'plan', label: 'Plan', ok: !!s.net.isp, why: s.net.isp ? s.net.isp.name : 'needs an internet plan: click the wall socket' },
    { id: 'router', label: 'Router', ok: !!s.net.router, why: s.net.router ? s.net.router.name : 'needs a router next to the monitor' },
    { id: 'jack', label: 'Jack', ok: jack, why: jack ? 'a network jack is there' : 'needs a network jack: a Basic or better board, or a network card (needs a PCIe slot)' },
    { id: 'cable', label: 'Cable', ok: !!lan?.connected, why: lan?.connected ? 'the ethernet cable is plugged in' : lan?.blocked ?? 'plug the ethernet cable into a jack' },
    { id: 'os', label: 'OS', ok: !!s.os, why: s.os ? s.os.name : 'needs an OS: it runs the link' },
    { id: 'ram', label: `${need}K RAM`, ok: ramK(s) >= need, why: ramK(s) >= need ? `${Math.round(ramK(s))}K installed` : `needs ${need}K of RAM (you have ${Math.round(ramK(s))}K)` },
  ];
  // The network asks for no memory beyond the OS's own (NET.minRamBytes is 0): the row only exists if that is ever raised.
  return need > 0 ? items : items.filter((c) => c.id !== 'ram');
}

/** The unmet requirements, as one sentence ("To use it you still need an OS and a router."), or the all-clear. */
export function stillNeeds(s: Snapshot, skip: CheckItem['id'][] = []): string {
  const miss = linkChecklist(s).filter((c) => !c.ok && !skip.includes(c.id));
  if (!miss.length) return 'Everything it needs is in place.';
  const words: Record<CheckItem['id'], string> = { plan: 'a plan', router: 'a router', jack: 'a network jack', cable: 'the cable', os: 'an OS', ram: `${NET.minRamBytes / 1024}K of RAM` };
  const list = miss.map((c) => words[c.id]);
  return `To use it you still need ${list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0]}.`;
}

/**
 * What a part of the network still cannot do for lack of the rest of the machine (an OS, 64K of RAM, a jack), as one
 * sentence for the warning on a buy rung. The plan, router and cable are the player's next steps, so they are not warned
 * about; a network card brings its own jack. Null when nothing hardware is missing.
 */
export function hardwareWarn(s: Snapshot, kind: 'router' | 'isp' | 'nic'): string | null {
  const skip: CheckItem['id'][] = ['plan', 'router', 'cable', ...(kind === 'nic' ? ['jack' as const] : [])];
  return linkChecklist(s).some((c) => !c.ok && !skip.includes(c.id)) ? stillNeeds(s, skip) : null;
}

/** The link in one or two plain lines for a card: the state with its reason, and the speed when it works. */
export function netStateLines(s: Snapshot): PickerLine[] {
  const chip = netStateChip(s);
  if (!chip) return [];
  const n = s.net;
  const lines: PickerLine[] = [{ level: chip.level === 'idle' ? 'info' : chip.level, text: `${chip.text}${n.reason ? `: ${n.reason}` : ''}` }];
  if (linkUsable(s)) {
    const lim: Record<Binding, string> = { port: 'the port', router: 'the router', isp: 'the plan', disk: 'the drive' };
    const b = n.bandwidth;
    lines.push({
      level: 'info',
      text: `Download ${fmtMbit(b.downMbps)}, upload ${fmtMbit(b.upMbps)}, ${b.clients} clients at once${b.binding ? `. Limited by ${lim[b.binding]}.` : '.'}`,
    });
  }
  return lines;
}

/** Lines for an installed network card: its jack, whether the cable is in it, and the half-speed warning. */
export function nicLines(s: Snapshot, dev: { id: string; throttle: number; burnt: boolean }): PickerLine[] {
  const n = nicsInOrder(s).findIndex((d) => d.id === dev.id);
  const plugged = s.net.port.kind === 'nic' && s.net.port.deviceId === dev.id;
  const out: PickerLine[] = [
    plugged
      ? { level: 'ok', text: `The ethernet cable is plugged into this card (${fmtMbit(s.net.port.mbps)}).` }
      : { level: 'info', text: `Its jack is eth${n + 1}. Drag the ethernet plug onto it to use this card instead of the board jack.` },
  ];
  if (!dev.burnt && dev.throttle < 1) out.push({ level: 'warn', text: 'Too hot: the card runs at half speed. Better airflow or a slower card helps.' });
  return out;
}

// ---------- stats of routers and plans, and the effective speed with a candidate ----------

/** Numeric stats of a router or plan spec for the before/after bars (log scale for the speeds), or null for other ids. */
export function netStats(specId: string): Stat[] | null {
  const r = getRouterSpec(specId);
  if (r) return [
    { key: 'bandwidth', label: 'Port speed', icon: 'net', value: r.mbps, unit: 'Mbit', higherIsBetter: true, log: true },
    { key: 'clients', label: 'Clients at once', icon: 'slot', value: r.clients, unit: '', higherIsBetter: true },
  ];
  const p = getIspSpec(specId);
  if (p) return [
    { key: 'bandwidth', label: 'Download', icon: 'down', value: p.downMbps, unit: 'Mbit', higherIsBetter: true, log: true },
    { key: 'upload', label: 'Upload', icon: 'up', value: p.upMbps, unit: 'Mbit', higherIsBetter: true, log: true },
    { key: 'clients', label: 'Clients at once', icon: 'slot', value: p.clients, unit: '', higherIsBetter: true },
  ];
  return null;
}

/** NIC extra stats: the cards also have headroom before they throttle. */
export function nicStats(spec: NicSpec): Stat[] {
  return [
    { key: 'bandwidth', label: 'Speed', icon: 'net', value: spec.mbps, unit: 'Mbit', higherIsBetter: true, log: true },
    { key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false },
    { key: 'throttle', label: 'Throttles at', icon: 'flame', value: spec.thermal.throttleC, unit: 'C', higherIsBetter: true },
  ];
}

/** One line of the key numbers of a router, plan or card, for hover text. */
export function netBrief(specId: string): string | null {
  const r = getRouterSpec(specId);
  if (r) return `${fmtMbit(r.mbps)} port, ${r.clients} clients at once`;
  const p = getIspSpec(specId);
  if (p) return `${fmtMbit(p.downMbps)} down, ${fmtMbit(p.upMbps)} up, ${p.clients} clients at once`;
  const c = getSpec(specId);
  if (c?.kind === 'nic') return `${fmtMbit(c.mbps)} card, ${c.loadW} W under load`;
  return null;
}

export interface Effect {
  before: { downMbps: number; binding: Binding | null; clients: number };
  after: { downMbps: number; binding: Binding | null; clients: number };
}

/**
 * What the candidate would do to the effective download speed and client slots, with the rest of the chain as it is now.
 * The candidate is a router, a plan or a network card. Null when the chain is missing pieces on both sides (no speed to compare).
 */
export function effectOf(s: Snapshot, specId: string): Effect | null {
  const n = s.net;
  const port = portSpeed(s).mbps ?? 0;
  const disk = diskMbps(s) ?? Infinity;
  const router = n.router ? getRouterSpec(n.router.id) ?? null : null;
  const isp = n.isp ? getIspSpec(n.isp.id) ?? null : null;
  const calc = (p: number, r: typeof router, i: typeof isp) => {
    const b = bandwidth(p, r, i, disk);
    return { downMbps: b.downMbps, binding: b.binding, clients: b.clients };
  };
  const before = calc(port, router, isp);
  let after = before;
  const candR = getRouterSpec(specId);
  const candP = getIspSpec(specId);
  const candN = getSpec(specId);
  if (candR) after = calc(port, candR, isp);
  else if (candP) after = calc(port, router, candP);
  else if (candN?.kind === 'nic') after = calc(Math.max(port, candN.mbps), router, isp);
  else return null;
  if (before.downMbps === 0 && after.downMbps === 0) return null;
  return { before, after };
}

/** The effect as words: "Your download: 50 -> 100 Mbit, limited by the plan." */
export function effectLine(e: Effect): { text: string; same: boolean; better: boolean } {
  const lim: Record<Binding, string> = { port: 'the port', router: 'the router', isp: 'the plan', disk: 'the drive' };
  const a = fmtMbit(e.before.downMbps);
  const b = fmtMbit(e.after.downMbps);
  const same = e.after.downMbps === e.before.downMbps;
  const by = e.after.binding ? `, limited by ${lim[e.after.binding]}` : '';
  return {
    text: same ? `Your download stays ${a}${by}.` : `Your download: ${a} -> ${b}${by}.`,
    same, better: e.after.downMbps > e.before.downMbps,
  };
}

// ---------- the network panel ----------

export type StageId = 'offer' | 'downloading' | 'spooled' | 'uploading';
export interface StageCount { id: StageId; label: string; count: number; dir: 'down' | 'up' | null }

/** The latency SLA of a web offer: how long it still pays in full, then that the pay is falling. */
export interface SlaModel { left: number; over: boolean; text: string }

/** The SLA countdown of a job (`KeySnap.slaTick`, web only), or null for a job without one. */
export function slaModel(k: KeySnap, now: number): SlaModel | null {
  if (k.slaTick === undefined) return null;
  const left = k.slaTick - now;
  return left > 0 ? { left, over: false, text: `full pay for ${fmtTicks(left)}` } : { left: 0, over: true, text: 'pay is falling' };
}

export interface OfferRow {
  key: KeySnap;
  label: string;
  type: string;
  payout: number;
  /** Ticks until the client leaves (the job's deadline). */
  left: number;
  late: boolean;
  retired: boolean;
  /** Web only: the SLA countdown beside the payout estimate, which falls once it runs out. */
  sla: SlaModel | null;
}
export interface TransferRow {
  jobId: number;
  label: string;
  dir: 'down' | 'up';
  pct: number;
  etaText: string;
  doneMB: number;
  totalMB: number;
}
export interface SpoolRow { key: KeySnap; label: string; state: string; level: 'info' | 'ok' | 'warn' }
export interface UsbModel { state: 'retired' | 'waiting' | 'fallback'; text: string; detail: string | null; level: ChipLevel; countdown: number | null }

export interface NetPanelModel {
  chip: NetChip;
  reason: string | null;
  ladder: LimiterLadder;
  advice: string | null;
  clients: { busy: number; max: number };
  /** The upload limiter line (`limited by: isp (upload)`), or null with no usable link. */
  uploadLimit: string | null;
  /** Finished results waiting for a client slot (the chip beside the stages). */
  uploadsWaiting: number;
  stages: StageCount[];
  offers: OfferRow[];
  transfers: TransferRow[];
  spooled: SpoolRow[];
  spool: { used: number; slots: number; full: boolean } | null;
  usb: UsbModel | null;
  retiredKeys: number;
  portBusy: { keyId: number; label: string } | null;
  delivered: number;
}

const SPOOL_STATE: Record<string, { text: string; level: SpoolRow['level'] }> = {
  spooled: { text: 'on the drive', level: 'info' },
  ingesting: { text: 'copying in', level: 'info' },
  queued: { text: 'queued', level: 'info' },
  running: { text: 'running now', level: 'ok' },
  result: { text: 'result ready', level: 'ok' },
  uploading: { text: 'uploading', level: 'ok' },
};

/** The USB fallback block of the panel, from `net.usbFallback`: state words and the countdown. Null while it never linked. */
export function usbModel(s: Snapshot): UsbModel | null {
  const f = s.net.usbFallback;
  switch (f.state) {
    case 'off': return null;
    case 'retired': return {
      state: 'retired', text: 'USB keys retired', level: 'idle', countdown: null,
      detail: s.net.retiredKeys > 0 ? `${s.net.retiredKeys} leftover key${s.net.retiredKeys === 1 ? '' : 's'} expire without penalty` : 'clients send jobs over the wire now',
    };
    case 'waiting': return {
      state: 'waiting', text: f.startsIn !== null ? `Keys return in ${fmtTicks(f.startsIn)}` : 'Keys return soon', level: 'warn',
      countdown: f.startsIn, detail: 'the link is down; after 5 minutes clients send keys again at a third of the rate',
    };
    case 'fallback': return {
      state: 'fallback', text: 'Keys are back at 1/3 rate', level: 'warn', countdown: null, detail: 'offers are paused until the link is up',
    };
  }
}

/** The panel's whole model, or null when no network exists yet. */
export function netPanel(s: Snapshot): NetPanelModel | null {
  const chip = netStateChip(s);
  if (!chip) return null;
  const n = s.net;
  const now = s.baseTick;
  const downs = n.transfers.filter((t) => t.dir === 'down');
  const ups = n.transfers.filter((t) => t.dir === 'up');
  const spooled = n.spooled.filter((k) => k.stage !== 'uploading');
  const portKey = n.portBusyKey !== null && s.plugged?.id === n.portBusyKey ? s.plugged : null;
  const busyJobs = new Set(n.transfers.map((t) => t.jobId));
  const row = (t: TransferSnap): TransferRow => ({
    jobId: t.jobId, label: t.label, dir: t.dir, pct: Math.min(100, Math.max(0, t.percent)),
    etaText: t.etaTicks > 0 ? fmtTicks(t.etaTicks) : 'now', doneMB: t.doneMB, totalMB: t.totalMB,
  });
  return {
    chip,
    reason: n.reason,
    ladder: limiterLadder(s),
    advice: n.state === 'link-up' || n.state === 'saturated' ? limiterAdvice(limiterLadder(s)) : null,
    clients: { busy: busyJobs.size, max: n.bandwidth.clients },
    uploadLimit: uploadLimiter(s)?.text ?? null,
    uploadsWaiting: n.uploadsWaiting ?? 0,
    stages: [
      { id: 'offer', label: 'Offers', count: n.offers.length, dir: null },
      { id: 'downloading', label: 'Downloading', count: downs.length, dir: 'down' },
      { id: 'spooled', label: 'On the drive', count: spooled.length, dir: null },
      { id: 'uploading', label: 'Uploading', count: ups.length, dir: 'up' },
    ],
    offers: n.offers.map((k) => ({
      key: k, label: k.label, type: k.type, payout: k.payoutEstimate, left: Math.max(0, k.deadlineTick - now), late: k.late, retired: !!k.retired, sla: slaModel(k, now),
    })),
    transfers: n.transfers.map(row),
    spooled: n.spooled.map((k) => {
      const st = SPOOL_STATE[k.stage] ?? SPOOL_STATE.spooled!;
      return { key: k, label: k.label, state: st.text, level: st.level };
    }),
    spool: s.os?.spool ? { used: s.os.spool.used, slots: s.os.spool.slots, full: !!(s.os.spoolFull ?? s.os.spool.full) } : null,
    usb: usbModel(s),
    retiredKeys: n.retiredKeys,
    portBusy: n.portBusyKey != null ?{ keyId: n.portBusyKey, label: portKey?.label ?? `key ${n.portBusyKey}` } : null,
    delivered: n.counters.delivered,
  };
}

/** Whether the panel is on screen: the player opened it (`netOpen`) and a network exists. */
export const netPanelShown = (open: boolean, s: Snapshot): boolean => open && netPanel(s) !== null;

/** Plain money line for an offer. */
export const offerPay = (o: OfferRow): string => fmtMoney(o.payout);

// ---------- picker support: where the router and plan stand ----------

export { jackPort };
