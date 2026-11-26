// Game feature: the network transfers (docs/NETWORK.md): one tick of downloads and uploads.
// Methods mixed into `Game` (see game.ts). Re-exported from network.ts.

import { fifoSegsOf, jobSizes, NET, pickOffer } from '.';
import { NIC_FLAG_ABORT, NIC_FLAG_REPLAY, NIC_SEG_WORDS, NIC_STAMP_MASK, NIC_STAMP_SHIFT } from '@/core/sim/memmap';
import type { NicSegment } from './nic';
import { Flow, RttEstimate } from './transport';
import type { Game } from '@/worker/game/game';
import type { Key, Transfer } from '@/worker/game/internal';
import { needsMet } from '../../economy/sim/levels';

export function netTick(this: Game): void {
  this.link = this.computeLink();
  const usable = this.linkUsable;
  // The link arrives (first time, or back after a dead spell): the USB keys the client left behind retire.
  if (usable && !this.linkWasUsable) {
    this.retireUsbKeys();
  }
  this.linkWasUsable = usable;
  if (usable) {
    if (!this.progress.linkUp) {
      this.note(
        'net',
        `link up: ${this.link.bw.downMbps} Mbit down, ${this.link.bw.upMbps} up (limited by ${this.link.bw.binding})`,
      );
    }
    this.progress.linkUp = true;
    this.networkLinked = true;
    this.deadTicks = 0;
  } else if (this.networkLinked) {
    this.deadTicks++;
  }
  this.nic.linkUp = usable;
  this.nic.fifoSegs = fifoSegsOf(this.board.devices.find((d) => d.id === this.link.port.deviceId)?.spec ?? null); // the chip the cable is in has its own packet buffer
  if (usable) {
    deliverAcks(this); // the answers reach their senders before the host adopts a job (the last acknowledgement of a download that is one segment long comes in the tick it is whole)
  }
  this.adoptReceived(); // what the kernel has whole is kept, whatever the link does next
  if (usable) {
    this.runTransfers();
  } else {
    this.loseTransfers();
  }
  this.feedKernel();
}

/** Uploads that hold a client slot and move bytes. */
export function activeUploads(this: Game): Transfer[] {
  return this.uploads.filter((t) => t.waiting !== true);
}

/**
 * Transfers holding a client slot, of both directions (the router's and the plan's `clients` cap this). A download holds its slot while it has segments to put on the wire (a flow that has
 * sent them all and waits for the last acknowledgements holds none, as before there was a transport).
 */
export function activeTransfers(this: Game): number {
  return this.downloads.filter((t) => t.flow?.sending ?? true).length + this.activeUploads().length;
}

/** The megabytes a transfer really moves this tick: its share, but no more than is left (the last tick of a transfer is a part of one). */
const moved = (t: Transfer, share: number): number => Math.max(0, Math.min(share, t.totalMB - t.doneMB));

/**
 * Count the frames of `mb` megabytes of payload that cross the uplink port the way `dir` says (`rx`: into the machine, `tx`: out of it): the data frames
 * on the way they flow, and the acknowledgements the receiver sends back on the other way, one for `NET.ackEvery` data frames. The port's statistics are
 * these, and the jacks' activity lights follow them (`network/render/jackleds.ts`). Fractions stay in the totals, so a whole transfer counts exactly.
 */
function countFrames(f: { rx: number; tx: number }, mb: number, dir: 'rx' | 'tx'): void {
  const data = (mb * 1e6) / NET.frameBytes;
  f[dir] += data;
  f[dir === 'rx' ? 'tx' : 'rx'] += data / NET.ackEvery;
}

/**
 * Start downloads for waiting offers, run every flow a tick (the segments it puts on the wire, `network/sim/transport.ts`) and move the bytes of the uploads. The acknowledgements the kernel
 * sent come back first (`wireSend` queued them; `netTick` has handed over the ones that were due already, so this finds none unless it is called alone).
 */
export function runTransfers(this: Game): void {
  const { bw } = this.link;
  const slots = this.os?.queueSlots ?? 0;
  const caps = this.capsWith(true);
  deliverAcks(this);
  // A client slot serves one transfer of either direction. Results waiting to go out take the free slots first (they are paid work), in the order they were read out.
  for (const t of this.uploads) {
    if (this.activeTransfers() >= bw.clients) {
      break;
    }
    if (t.waiting === true) {
      t.waiting = false;
    }
  }
  while (this.activeTransfers() < bw.clients && this.reserved() < slots) {
    const next = pickOffer({
      offers: this.offersQ.waiting(),
      now: this.baseTick,
      bandTicks: NET.ageBandTicks,
      mayStart: (k) => needsMet(k.needs, caps).ok,
    });
    if (!next) {
      break;
    }
    this.offersQ.take(next.id);
    next.pluggedAt = this.baseTick;
    next.c0 = this.countersNow();
    delete next.ranAt;
    delete next.reloaded; // a returned offer starts over: it runs when the kernel begins it
    this.downloads.push(newDownload(this, next, false));
  }
  // The line's bytes are shared among the downloads that have segments to send and room in their window. Each flow puts on the wire what its share and its window allow.
  const moving = this.downloads.filter((t) => t.flow?.moving === true).length;
  const each = moving > 0 ? bw.downMbps / 8 / moving : 0;
  for (const t of [...this.downloads, ...this.restores]) {
    runFlow(this, t, each);
  }
  // A download is whole when the kernel has acknowledged every segment (it has queued the job: the receive window holds it until the host sees that); one the sender gave up goes back to the offers.
  settleDownloads(this);
  this.restores = this.restores.filter((t) => t.flow?.done !== true && t.flow?.failed !== true);
  runUploads(this, bw.upMbps);
}

function abandonDownload(g: Game, t: Transfer): void {
  t.key.attempts++;
  g.offersQ.giveBack(t.key);
  g.netCount.lost++;
  g.wireQ.push({
    at: g.baseTick + 1,
    seg: { key: t.key.id, seq: 0, count: 0, total: 0, words: new Uint32Array(0), flags: NIC_FLAG_ABORT },
  });
  g.note(
    'net',
    `download #${String(t.key.jobNo).padStart(2, '0')} failed: the machine did not answer, it goes back to the offers`,
  );
}

function settleDownloads(g: Game): void {
  const kept: Transfer[] = [];
  for (const t of g.downloads) {
    const { flow } = t;
    if (flow === undefined) {
      kept.push(t);
      continue;
    }
    if (flow.failed) {
      abandonDownload(g, t);
    } else if (flow.done) {
      g.rx.push(t.key);
      g.netCount.downloaded++;
    } else {
      kept.push(t);
    }
  }
  g.downloads = kept;
}

/** Move the bytes of the uploads that hold a client slot (they share the line's upload speed); a whole one is delivered. */
function runUploads(g: Game, upMbps: number): void {
  const sending = g.activeUploads();
  if (sending.length > 0) {
    const each = upMbps / 8 / sending.length;
    for (const t of sending) {
      countFrames(g.netFrames, moved(t, each), 'tx');
      t.doneMB += each;
    }
    for (const t of sending.filter((x) => x.doneMB >= x.totalMB)) {
      g.uploads = g.uploads.filter((x) => x !== t);
      g.spool = g.spool.filter((k) => k.id !== t.key.id); // delivery is the receipt: the spool slot is free
      g.netCount.uploaded++;
      g.netCount.delivered++;
      t.key.done = true;
      g.progress.firstNetJob = true;
      g.progress.firstOsJob = true;
      g.deliver(t.key, 'delivered over the network');
    }
  }
}

/**
 * A download of a job's program: cut into the segments the NIC takes (one spool block, `NIC_SEG_WORDS` words, each) and given a flow to carry them. The segments share the job's megabytes of
 * line time; the first window is what the line moves in a round trip. A replay (the kernel lost the job at a boot) costs no line time and loses nothing.
 */
export function newDownload(g: Game, key: Key, replay: boolean): Transfer {
  const words = g.jobWords(key);
  const segs = Math.max(1, Math.ceil(words.length / NIC_SEG_WORDS));
  const segMB = replay ? 0 : jobSizes(key.cls, key.type, key.scale).downMB / segs;
  const share = g.link.bw.downMbps / 8 / (g.downloads.length + 1);
  const cwnd = segMB > 0 ? Math.ceil((share * NET.rttTicks) / segMB) : 2;
  // the downloads of a link learn the round trip together; a replay never leaves the machine, so what it measures says nothing about the link
  const rtt = replay ? NET.rttTicks : (g.netRtt ??= new RttEstimate(NET.rttTicks));
  const flow = new Flow({ id: key.id, seed: g.seed, segs, segMB, rtt, cwnd, loss: replay ? 0 : g.wireLoss() });
  return { key, totalMB: flow.workMB, doneMB: 0, words, segs, flow, ...(replay ? { replay: true } : {}) };
}

/** One tick of a download's flow: its share of the line, the segments it puts on the wire (the wire may lose them) and what the jack's counters and the progress bar follow. */
function runFlow(g: Game, t: Transfer, share: number): void {
  const { flow: f, words, segs } = t;
  if (f === undefined || words === undefined || segs === undefined) {
    return;
  }
  const was = { ...f.stats };
  if (t.replay !== true) {
    f.loss = g.wireLoss(); // the line, the router and the card can change while a download runs (a card heats up)
  }
  const sends = f.step(g.baseTick, f.moving ? share : 0);
  for (const k of ['sent', 'resent', 'lost', 'timeouts'] as const) {
    g.netWire[k] += f.stats[k] - was[k];
  }
  if (t.replay !== true) {
    countFrames(g.netFrames, f.earned, 'rx');
    t.doneMB = f.carriedMB;
    t.totalMB = f.workMB;
  }
  const stamp = (g.baseTick & NIC_STAMP_MASK) << NIC_STAMP_SHIFT; // the clock the segment leaves by: the kernel echoes it in the acknowledgement
  for (const s of sends) {
    if (s.lost) {
      continue;
    }
    const seg: NicSegment = {
      key: t.key.id,
      seq: s.seq,
      count: segs,
      total: words.length,
      words: words.subarray(s.seq * NIC_SEG_WORDS, (s.seq + 1) * NIC_SEG_WORDS),
      flags: ((t.replay === true ? NIC_FLAG_REPLAY : 0) | stamp) >>> 0,
    };
    g.wireQ.push({ at: g.baseTick + 1, seg }); // the NIC's step in the next tick takes it
  }
}

/** The acknowledgements that have reached their senders: each tells a flow which segment the kernel wants next, and (the echo of the segment's stamp) how long ago that segment left. */
function deliverAcks(g: Game): void {
  const due = g.wireAcks.filter((a) => a.at <= g.baseTick);
  if (due.length === 0) {
    return;
  }
  g.wireAcks = g.wireAcks.filter((a) => a.at > g.baseTick);
  for (const a of due) {
    (g.downloads.find((t) => t.key.id === a.key) ?? g.restores.find((t) => t.key.id === a.key))?.flow?.ack(
      g.baseTick,
      a.next,
      (g.baseTick - a.stamp) & NIC_STAMP_MASK,
    );
  }
}

/** The program of a job as a client sends it: generated from the job's template and seed (a USB key carries the same one). */
