// The network panel model (docs/UI.md "Network").

import type { KeySnap, Snapshot, TransferSnap } from '@/worker/game/game';
import * as uiLogic from '@/core/ui/logic';
import * as nethud from './nethud';
import * as netlimiter from './netlimiter';
import * as netaddrui from './netaddrui';

// ---------- the network panel ----------

type StageId = 'offer' | 'downloading' | 'spooled' | 'uploading';
interface StageCount {
  id: StageId;
  label: string;
  count: number;
  dir: 'down' | 'up' | null;
}

/** The latency SLA of a web offer: how long it still pays in full, then that the pay is falling. */
export interface SlaModel {
  left: number;
  over: boolean;
  text: string;
}

/** The SLA countdown of a job (`KeySnap.slaTick`, web only), or null for a job without one. */
export function slaModel(k: KeySnap, now: number): SlaModel | null {
  if (k.slaTick === undefined) {
    return null;
  }
  const left = k.slaTick - now;
  return left > 0
    ? { left, over: false, text: `full pay for ${uiLogic.fmtTicks(left)}` }
    : { left: 0, over: true, text: 'pay is falling' };
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
interface TransferRow {
  jobId: number;
  label: string;
  dir: 'down' | 'up';
  pct: number;
  etaText: string;
  doneMB: number;
  totalMB: number;
  /** A download's segments and window in words (`3 of 6 segments in · window 2`), the segments it has sent again and the words behind them. Null for an upload. */
  flow: { text: string; resent: number; title: string } | null;
}

/** One line of the panel's packet section: what it counts, its value, the words behind it and how it looks (`warn`: something is going wrong). */
interface StackRow {
  id: 'rtt' | 'loss' | 'segments' | 'nic';
  label: string;
  text: string;
  title: string;
  level: 'info' | 'warn';
}
interface StackModel {
  rows: StackRow[];
}
interface SpoolRow {
  key: KeySnap;
  label: string;
  state: string;
  level: 'info' | 'ok' | 'warn';
}
export interface NetPanelModel {
  chip: nethud.NetChip;
  reason: string | null;
  ladder: netlimiter.LimiterLadder;
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
  usb: netaddrui.UsbModel | null;
  retiredKeys: number;
  delivered: number;
  addrs: netaddrui.AddrModel;
  /** The transport and the NIC in numbers (`NetSnap.stack`), or null while nothing has crossed the wire and there is no link. */
  stack: StackModel | null;
}

const SPOOL_DEFAULT: { text: string; level: SpoolRow['level'] } = { text: 'on the drive', level: 'info' };
const SPOOL_STATE: Record<string, { text: string; level: SpoolRow['level'] }> = {
  spooled: SPOOL_DEFAULT,
  ingesting: { text: 'copying in', level: 'info' },
  queued: { text: 'queued', level: 'info' },
  running: { text: 'running now', level: 'ok' },
  result: { text: 'result ready', level: 'ok' },
  uploading: { text: 'uploading', level: 'ok' },
};

/** The USB fallback block of the panel, from `net.usbFallback`: state words and the countdown. Null while it never linked. */
/** A share of segments in words: `0%`, `0.5%`, `4.0%`, `12%`. */
function fmtLoss(f: number): string {
  if (f <= 0) {
    return '0%';
  }
  if (f < 0.1) {
    return `${(f * 100).toFixed(f < 0.01 ? 2 : 1)}%`;
  }
  return `${Math.round(f * 100)}%`;
}

/**
 * The transport and the NIC as the panel's lines (docs/NETSTACK.md 3.7): the round trip the senders measured, the chance the line loses a segment now, the segments sent and sent
 * again, and the NIC's buffer, ring and drops. Null with no link and nothing sent (there is nothing to count).
 */
function rttRow(k: NonNullable<Snapshot['net']['stack']>): StackRow {
  if (!k.rtt) {
    return {
      id: 'rtt',
      label: 'Round trip',
      text: '-',
      level: 'info',
      title:
        'No segment has been answered yet. Each download sends its first segments with a short timer, then learns the real round trip.',
    };
  }
  return {
    id: 'rtt',
    label: 'Round trip',
    text: uiLogic.fmtTicks(k.rtt.srtt),
    level: 'info',
    title: `How long a segment takes to be answered, as the senders measured it (smoothed). The kernel answers when its loop gets to the card, so a job that runs on OS 1 or 2 makes it longer. A sender waits ${uiLogic.fmtTicks(k.rtt.rto)} for an answer before it sends a segment again.`,
  };
}

function nicRow(nic: NonNullable<Snapshot['net']['stack']>['nic']): StackRow {
  return {
    id: 'nic',
    label: 'Card buffer',
    text: nic.enabled
      ? `${nic.fifo}/${nic.fifoSegs} waiting · ring ${nic.rxUsed}/${nic.rxSlots}${nic.drops > 0 ? ` · ${nic.drops} dropped` : ''}`
      : 'card off',
    level: nic.drops > 0 ? 'warn' : 'info',
    title: nic.enabled
      ? `The card holds ${nic.fifoSegs} segments in its own buffer (a bigger card holds more) until the kernel has a free slot in the receive ring in RAM (${nic.rxSlots} slots). A segment that finds the buffer full is dropped and sent again after the timeout: the kernel was busy, usually with a job on OS 1 or 2. ${nic.rx} taken in, ${nic.drops} dropped, ${nic.tx} packets sent (answers and results).`
      : 'The kernel sets the card up when it boots. Until then the card takes nothing.',
  };
}

function stackModel(s: Snapshot): StackModel | null {
  const k = s.net.stack;
  if (!(nethud.linkUsable(s) || k.sent > 0)) {
    return null;
  }
  const again = k.sent > 0 ? k.resent / k.sent : 0;
  const { nic } = k;
  const rows: StackRow[] = [
    rttRow(k),
    {
      id: 'loss',
      label: 'Loss chance',
      text: fmtLoss(k.loss),
      level: k.loss >= 0.03 ? 'warn' : 'info',
      title:
        "The chance the line loses a segment now: the plan's line, the router, and a card that has gone too hot (unstable). A lost segment is sent again after the timeout. A better plan and router lose fewer.",
    },
    {
      id: 'segments',
      label: 'Segments',
      text: `${k.sent} sent${k.resent > 0 ? ` · ${k.resent} again` : ''}`,
      level: again >= 0.1 ? 'warn' : 'info',
      title: `A job's program travels in segments of one drive block. ${k.sent} put on the wire since the game started, ${k.resent} of them sent again (${k.timeouts} timers fired), ${k.lost} lost by the line itself. A segment is sent again when the line lost it, when the card dropped it because the kernel was busy, or when the answer came too late.`,
    },
    nicRow(nic),
  ];
  return { rows };
}

/** A download's transport in words for its line in the transfer list, or null for an upload. */
function flowRow(t: TransferSnap): TransferRow['flow'] {
  const f = t.flow;
  if (!f) {
    return null;
  }
  return {
    text: `${f.acked} of ${f.segs} segments in · window ${f.window}`,
    resent: f.resent,
    title: `${f.acked} of ${f.segs} segments acknowledged, ${f.inflight} on the way. The window is how many it may send before an answer comes (it opens with each answer and closes after a timeout). ${f.timeouts} timers fired. It waits ${uiLogic.fmtTicks(f.rto)} for an answer.`,
  };
}

function toTransferRow(t: TransferSnap): TransferRow {
  return {
    jobId: t.jobId,
    label: t.label,
    dir: t.dir,
    pct: Math.min(100, Math.max(0, t.percent)),
    etaText: t.etaTicks > 0 ? uiLogic.fmtTicks(t.etaTicks) : 'now',
    doneMB: t.doneMB,
    totalMB: t.totalMB,
    flow: flowRow(t),
  };
}

function offerRow(k: KeySnap, now: number): OfferRow {
  return {
    key: k,
    label: k.label,
    type: k.type,
    payout: k.payoutEstimate,
    left: Math.max(0, k.deadlineTick - now),
    late: k.late,
    retired: Boolean(k.retired),
    sla: slaModel(k, now),
  };
}

/** The panel's whole model, or null when no network exists yet. */
export function netPanel(s: Snapshot): NetPanelModel | null {
  const chip = nethud.netStateChip(s);
  if (!chip) {
    return null;
  }
  const n = s.net;
  const now = s.baseTick;
  const downs = n.transfers.filter((t) => t.dir === 'down');
  const ups = n.transfers.filter((t) => t.dir === 'up');
  const spooled = n.spooled.filter((k) => k.stage !== 'uploading');
  const busyJobs = new Set(n.transfers.map((t) => t.jobId));
  const ladder = netlimiter.limiterLadder(s);
  return {
    chip,
    reason: n.reason,
    ladder,
    advice: n.state === 'link-up' || n.state === 'saturated' ? netlimiter.limiterAdvice(ladder) : null,
    clients: { busy: busyJobs.size, max: n.bandwidth.clients },
    uploadLimit: netlimiter.uploadLimiter(s)?.text ?? null,
    uploadsWaiting: n.uploadsWaiting ?? 0,
    stages: [
      { id: 'offer', label: 'Offers', count: n.offers.length, dir: null },
      { id: 'downloading', label: 'Downloading', count: downs.length, dir: 'down' },
      { id: 'spooled', label: 'On the drive', count: spooled.length, dir: null },
      { id: 'uploading', label: 'Uploading', count: ups.length, dir: 'up' },
    ],
    offers: n.offers.map((k) => offerRow(k, now)),
    transfers: n.transfers.map(toTransferRow),
    spooled: n.spooled.map((k) => {
      const st = SPOOL_STATE[k.stage] ?? SPOOL_DEFAULT;
      return { key: k, label: k.label, state: st.text, level: st.level };
    }),
    spool: s.os?.spool
      ? { used: s.os.spool.used, slots: s.os.spool.slots, full: s.os.spoolFull ?? s.os.spool.full }
      : null,
    usb: netaddrui.usbModel(s),
    retiredKeys: n.retiredKeys,
    delivered: n.counters.delivered,
    addrs: netaddrui.addressModel(s),
    stack: stackModel(s),
  };
}

/** Whether the panel is on screen: the player opened it (`netOpen`) and a network exists. */
export const netPanelShown = (open: boolean, s: Snapshot): boolean => open && netPanel(s) !== null;

/** Plain money line for an offer. */
export const offerPay = (o: OfferRow): string => uiLogic.fmtMoney(o.payout);
