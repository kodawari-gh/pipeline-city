// Game feature: the network (docs/NETWORK.md). The link state table, downloads and uploads, retiring the USB keys, the NIC
// feed into the kernel, what a power loss does to it all, and the network snapshot. Every export is a `Game` method (see game.ts).

import * as boardSim from '../../board/sim';
import { generate } from '../../jobs/sim/gen';
import {
  JOB_ROW,
  JobState,
  NIC_ACK_NEXT_MASK,
  NIC_FLAG_ABORT,
  NIC_FLAG_REPLAY,
  NIC_SEG_WORDS,
  NIC_STAMP_MASK,
  NIC_STAMP_SHIFT,
} from '@/core/sim/memmap';
import { bandwidth, DISK_NET_MBPS, fifoSegsOf, ispByTier, jobSizes, NET, pickOffer, routerByTier } from '.';
import type { NicPacket, NicSegment } from './nic';
import { Flow, RttEstimate } from './transport';
import type { Game } from '@/worker/game/game';
import type { Key, KernelJob, Link, Transfer } from '@/worker/game/internal';
import { needsMet } from '../../economy/sim/levels';
import type { FlowSnap, LinkState, NetSnap, NetStackSnap, TransferSnap } from '@/worker/game/types';

/** The uplink port the cable is in: its speed (a hot NIC runs at half), or none. */
export function portInfo(this: Game): Link['port'] {
  if (!this.lan) {
    return { kind: null, deviceId: null, mbps: 0 };
  }
  if (this.lan === 'board') {
    return {
      kind: 'board',
      deviceId: null,
      mbps: this.board.burnt ? 0 : boardSim.BOARD_TIERS[this.board.tier]!.features.ethernetMbps,
    };
  }
  const d = this.board.devices.find((x) => x.id === this.lan);
  if (!d || d.burnt) {
    return { kind: 'nic', deviceId: this.lan, mbps: 0 };
  }
  const half = (this.thermal.state(d.id)?.throttle ?? 1) < 1;
  return { kind: 'nic', deviceId: d.id, mbps: (boardSim.deviceSpec(d) as boardSim.NicSpec).mbps * (half ? 0.5 : 1) };
}

/** Evaluate the link state table (docs/NETWORK.md "Link states") and the effective bandwidth. */
export function computeLink(this: Game): Link {
  const router = routerByTier(this.routerTier) ?? null;
  const isp = ispByTier(this.ispTier) ?? null;
  const port = this.portInfo();
  const mk = (state: LinkState, reason: string | null, bwOn = false): Link => {
    const osDev = this.os && this.board.devices.find((d) => d.id === this.os!.deviceId);
    const disk = osDev ? (DISK_NET_MBPS[osDev.spec] ?? 80) : 0;
    return {
      state,
      reason,
      port,
      router,
      isp,
      bw: bwOn ? bandwidth(port.mbps, router, isp, disk) : { downMbps: 0, upMbps: 0, clients: 0, binding: null },
    };
  };
  if (!router || !isp) {
    return mk('no-device', !isp ? 'no ISP plan: buy one' : 'no router: install one next to the monitor');
  }
  if (!this.lan) {
    return mk('no-cable', 'plug the ethernet cable from the board jack into the router');
  }
  if (!this.os) {
    return mk('no-os', 'needs an OS: the network runs inside it');
  }
  const ram = this.installedRamBytes();
  if (ram < NET.minRamBytes) {
    return mk('no-os', `needs ${NET.minRamBytes / 1024}K of RAM, only ${ram / 1024}K installed`);
  }
  if (this.os.queueSlots < 1) {
    return mk('no-os', 'no free space on the OS drive for a spool slot');
  }
  if (port.mbps <= 0) {
    return mk('down', this.lan === 'board' ? 'the board is dead' : 'the network card is burnt out', true);
  }
  if (!this.powered) {
    return mk('down', 'the machine is off', true);
  }
  const fault = this.fault();
  if (fault || this.postError) {
    return mk('down', fault ?? 'the machine failed POST', true);
  }
  const phase = this.currentPhase();
  if (phase !== 'idle-os' && phase !== 'ingesting' && phase !== 'running-os' && phase !== 'flashing') {
    return mk('down', 'the OS is starting', true);
  }
  const up = mk('link-up', null, true);
  const waiting = this.offersQ.waiting().some((k) => this.runnable(k, this.capsWith(true)));
  const slotsFull = this.activeTransfers() >= up.bw.clients;
  if (slotsFull || (waiting && this.reserved() >= this.os.queueSlots)) {
    return { ...up, state: 'saturated', reason: slotsFull ? 'every client slot is busy' : 'the spool is full' };
  }
  return up;
}

/**
 * The chance the wire loses a segment now (docs/NETSTACK.md 3.5). The parts of the link each lose their own share (`ECONOMY.lossTable`): the ISP plan's line, the router and, in the cabled
 * card, a chip that has gone unstable from heat (above its throttle mark the card only runs at half speed, `portInfo`; its errors start at the unstable mark and grow with the temperature,
 * the thermal model's `errProb`). `ECONOMY.wireLoss` is a fourth, extra source. The chances combine as independent events: 1 - (1 - a)(1 - b)(1 - c)(1 - d).
 */
export function wireLoss(this: Game): number {
  let keep = 1 - this.cfg.wireLoss;
  if (this.cfg.lossTable) {
    const id = this.link.port.deviceId;
    const hot = id ? this.thermal.state(id) : undefined;
    keep *=
      (1 - (this.link.isp?.loss ?? 0)) * (1 - (this.link.router?.loss ?? 0)) * (1 - (hot?.unstable ? hot.errProb : 0));
  }
  return 1 - keep;
}

/**
 * How much of the uplink port's speed the transfers use now (0..1), the busier way of the two (a port is full duplex). A moving transfer fills the limit that binds, so a
 * 40G card behind a 50 Mbit plan is at a tiny share of its speed, not at full load: its watts and its heat follow this (`thermal.step`, kind `nic`).
 */
export function netUtilisation(this: Game): number {
  const port = this.link.port.mbps;
  if (port <= 0) {
    return 0;
  }
  const down = this.downloads.length > 0 ? this.link.bw.downMbps : 0;
  const up = this.activeUploads().length > 0 ? this.link.bw.upMbps : 0;
  return Math.min(1, Math.max(down, up) / port);
}

/** Spool slots in use: spooled jobs, the key in the port if ingested, and downloads (reserved at start). */
export function reserved(this: Game): number {
  return this.spool.length + this.rx.length + this.downloads.length + (this.pluggedIngested() ? 1 : 0);
}

export function usbFallback(this: Game): boolean {
  return this.networkLinked && this.deadTicks >= this.cfg.usbFallbackTicks;
}

/** A job whose result is ready (the key holds it, or the kernel has it in its result state or in the NIC's transmit ring). */
export function resultWaiting(this: Game, k: Key): boolean {
  return (
    k.done ||
    this.kernelJobs().some((j) => j.key === k.id && (j.state === JobState.Result || j.state === JobState.Sending))
  );
}

/**
 * Retire the USB keys the client left behind (docs/NETWORK.md "Retired keys"): every tray key and every key the OS
 * holds, plus the key in the port, that has no result waiting. Their client went online, so they stop counting for
 * reputation and expire without a penalty; they can still be served until their deadline.
 */
export function retireUsbKeys(this: Game): void {
  if (!this.cfg.retireUsbKeys) {
    return;
  }
  for (const k of [...this.tray.waiting(), ...(this.plugged ? [this.plugged] : [])]) {
    if (!this.resultWaiting(k)) {
      k.retired = true;
    }
  }
  this.note('net', 'the USB keys left behind are retired: they no longer hold reputation');
}

/** The kernel can take the NIC feed now (booted, not in a POST error). */
export function kernelUp(this: Game): boolean {
  const phase = this.currentPhase();
  return phase === 'idle-os' || phase === 'ingesting' || phase === 'running-os' || phase === 'flashing';
}

/** One base tick of the network after the machine ran: link state, retirement, transfers, and the feed into the kernel. */
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
  if (!usable) {
    this.loseTransfers();
  } else {
    this.runTransfers();
  }
  this.feedKernel();
}

/** Uploads that hold a client slot and move bytes. */
export function activeUploads(this: Game): Transfer[] {
  return this.uploads.filter((t) => !t.waiting);
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
    if (t.waiting) {
      t.waiting = false;
    }
  }
  while (this.activeTransfers() < bw.clients && this.reserved() < slots) {
    const next = pickOffer(this.offersQ.waiting(), this.baseTick, NET.ageBandTicks, (k) => needsMet(k.needs, caps).ok);
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
  const moving = this.downloads.filter((t) => t.flow!.moving).length;
  const each = moving > 0 ? bw.downMbps / 8 / moving : 0;
  for (const t of [...this.downloads, ...this.restores]) {
    runFlow(this, t, each);
  }
  // A download is whole when the kernel has acknowledged every segment (it has queued the job: the receive window holds it until the host sees that); one the sender gave up goes back to the offers.
  for (const t of [...this.downloads]) {
    if (t.flow!.failed) {
      giveUp(this, t);
    } else if (t.flow!.done) {
      this.downloads = this.downloads.filter((x) => x !== t);
      this.rx.push(t.key);
      this.netCount.downloaded++;
    }
  }
  this.restores = this.restores.filter((t) => !t.flow!.done && !t.flow!.failed);
  runUploads(this, bw.upMbps);
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
function newDownload(g: Game, key: Key, replay: boolean): Transfer {
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
  const f = t.flow!;
  const was = { ...f.stats };
  if (!t.replay) {
    f.loss = g.wireLoss(); // the line, the router and the card can change while a download runs (a card heats up)
  }
  const sends = f.step(g.baseTick, f.moving ? share : 0);
  for (const k of ['sent', 'resent', 'lost', 'timeouts'] as const) {
    g.netWire[k] += f.stats[k] - was[k];
  }
  if (!t.replay) {
    countFrames(g.netFrames, f.earned, 'rx');
    t.doneMB = f.carriedMB;
    t.totalMB = f.workMB;
  }
  const words = t.words!;
  const stamp = (g.baseTick & NIC_STAMP_MASK) << NIC_STAMP_SHIFT; // the clock the segment leaves by: the kernel echoes it in the acknowledgement
  for (const s of sends) {
    if (s.lost) {
      continue;
    }
    const seg: NicSegment = {
      key: t.key.id,
      seq: s.seq,
      count: t.segs!,
      total: words.length,
      words: words.subarray(s.seq * NIC_SEG_WORDS, (s.seq + 1) * NIC_SEG_WORDS),
      flags: ((t.replay ? NIC_FLAG_REPLAY : 0) | stamp) >>> 0,
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

/** A segment sent more times than the transport allows without an answer: the download fails. The offer goes back (attempts + 1) and a reset tells the kernel to free what it holds of the job. */
function giveUp(g: Game, t: Transfer): void {
  g.downloads = g.downloads.filter((x) => x !== t);
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

/** The program of a job as a client sends it: generated from the job's template and seed (a USB key carries the same one). */
export function jobWords(this: Game, key: Key): Uint32Array {
  return generate(key.template, key.seed, {
    row: JOB_ROW,
    scale: key.scale,
    hosted: true,
    gpu: this.gpuTarget(),
    npu: this.npuTarget(),
  }).program;
}

/** The text the result words of a job make: the bytes up to the first NUL, trailing blanks cut (what `kernelResult` reads out of the job table). */
function resultText(words: Uint32Array): string {
  let s = '';
  for (const w of words) {
    for (let i = 0; i < 4; i++) {
      const b = (w >>> (8 * i)) & 0xff;
      if (b === 0) {
        return s.trimEnd();
      }
      s += String.fromCharCode(b);
    }
  }
  return s.trimEnd();
}

/**
 * The wire's side of the NIC's receive path (`Nic.pull`, called from the NIC's own clock): the next segment that has reached the end of the wire. The senders put segments on it (`runFlow`),
 * the ones the wire loses never get here, and the NIC drops the ones that find its input full.
 */
export function wirePull(this: Game): NicSegment | null {
  const [head] = this.wireQ;
  if (!head || head.at > this.baseTick) {
    return null;
  }
  this.wireQ.shift();
  return head.seg;
}

/**
 * The wire's side of the NIC's transmit path (`Nic.onTransmit`, from the NIC's clock): a packet the kernel wrote into the transmit ring and the NIC read by DMA. A result packet of a network job
 * goes out as an upload that waits for a client slot (`runTransfers`). An acknowledgement carries no words: it goes back to the sender of that download (`deliverAcks` hands it over the next time
 * the transfers run), and says which segment the kernel wants next.
 */
export function wireSend(this: Game, p: NicPacket): void {
  if (p.words.length === 0) {
    this.wireAcks.push({
      at: this.baseTick,
      key: p.key,
      next: p.arg & NIC_ACK_NEXT_MASK,
      stamp: p.arg >>> NIC_STAMP_SHIFT,
    });
    return;
  }
  // a result means the kernel had the whole job, even if the last acknowledgement has not reached the sender (it was lost, or is late): the download is over
  const d = this.downloads.find((x) => x.key.id === p.key);
  if (d) {
    this.downloads = this.downloads.filter((x) => x !== d);
    this.rx.push(d.key);
    this.netCount.downloaded++;
  }
  const k = this.rx.find((x) => x.id === p.key) ?? this.spool.find((x) => x.id === p.key);
  if (!k || this.uploads.some((t) => t.key.id === k.id)) {
    return; // a result nobody waits for
  }
  if (this.rx.includes(k)) {
    this.rx = this.rx.filter((x) => x !== k);
    this.spool.push(k);
  }
  this.restores = this.restores.filter((t) => t.key.id !== k.id);
  k.result = resultText(p.words);
  k.doneAt = this.baseTick;
  this.closeWindow(k);
  this.uploads.push({ key: k, totalMB: jobSizes(k.cls, k.type, k.scale).upMB, doneMB: 0, waiting: true });
}

/**
 * A download whose job the kernel has queued whole is on the drive (the driver wrote every segment to the spool before it queued the job): it joins the spool, whatever the last acknowledgements
 * are doing and whatever the link does next. That ends the transfer, with its flow, even if an acknowledgement is still on its way.
 */
export function adoptReceived(this: Game): void {
  if (this.rx.length === 0 && this.downloads.length === 0) {
    return;
  }
  const jobs = this.kernelJobs();
  const whole = (k: Key): boolean => jobs.some((x) => x.net && x.key === k.id && x.state >= JobState.Queued);
  for (const t of [...this.downloads]) {
    if (!whole(t.key)) {
      continue;
    }
    this.downloads = this.downloads.filter((x) => x !== t);
    this.spool.push(t.key);
    this.netCount.downloaded++;
  }
  for (const k of [...this.rx]) {
    if (!whole(k)) {
      continue;
    }
    this.rx = this.rx.filter((x) => x !== k);
    this.spool.push(k);
  }
}

/**
 * The host's side of the NIC feed, after the machine ran this tick: a spooled job the kernel does not know (a boot wiped its table, docs/NETWORK.md "Power loss") is replayed through the NIC
 * from the spool. The kernel's driver does the work: the segments go to the ring, it writes them to the spool blocks again and queues the job.
 */
export function feedKernel(this: Game): void {
  if (!this.kernelUp() || !this.linkUsable) {
    return;
  }
  const jobs = this.kernelJobs();
  this.restores = this.restores.filter(
    (t) => !jobs.some((j) => j.net && j.key === t.key.id && j.state >= JobState.Queued),
  ); // the kernel has it: the replay is over
  for (const k of this.spool) {
    if (
      jobs.some((j) => j.key === k.id) ||
      this.uploads.some((t) => t.key.id === k.id) ||
      this.restores.some((t) => t.key.id === k.id)
    ) {
      continue;
    }
    this.restores.push(newDownload(this, k, true));
  }
}

/**
 * Power loss or reboot (docs/NETWORK.md "Power loss"): everything in RAM is gone, the spool on the drive survives. Downloads in progress and finished downloads still in the receive window go back
 * to the offers (attempts + 1), uploads are lost (the spooled job runs again), the NIC's FIFO is empty. Spooled jobs stay: the kernel takes them again after the next boot (`feedKernel`).
 */
export function loseRam(this: Game): void {
  this.loseTransfers();
}

/** Downloads, finished downloads in the receive window and uploads are RAM: lost when the link or the machine goes. */
export function loseTransfers(this: Game): void {
  const lost = [...this.downloads.map((t) => t.key), ...this.rx];
  for (const k of lost) {
    k.attempts++;
    this.offersQ.giveBack(k);
  }
  this.netCount.lost += lost.length + this.uploads.length;
  this.downloads = [];
  this.rx = [];
  this.uploads = [];
  this.restores = [];
  this.wireQ = []; // what was on the wire is gone with the link
  this.wireAcks = [];
  this.netRtt = null; // and so is what the senders had learned of its round trip
  this.nic.flush();
}

export function transferSnaps(this: Game): TransferSnap[] {
  const out: TransferSnap[] = [];
  const add = (t: Transfer, dir: 'down' | 'up'): void => {
    const rate =
      (dir === 'down'
        ? this.link.bw.downMbps / Math.max(1, this.downloads.filter((x) => x.flow?.sending ?? true).length)
        : this.link.bw.upMbps / Math.max(1, this.activeUploads().length)) / 8;
    out.push({
      jobId: t.key.id,
      label: `#${String(t.key.jobNo).padStart(2, '0')} ${t.key.type}`,
      dir,
      totalMB: t.totalMB,
      doneMB: t.doneMB,
      percent: Math.min(100, Math.round((100 * t.doneMB) / t.totalMB)),
      etaTicks: rate > 0 ? Math.ceil((t.totalMB - t.doneMB) / rate) : -1,
      persisted: false,
      ...(dir === 'down' && t.flow ? { flow: flowSnap(t.flow) } : {}),
    });
  };
  for (const t of this.downloads) {
    if (t.flow?.sending ?? true) {
      add(t, 'down'); // one that has put every segment on the wire is the kernel's now (`stageOf`: ingesting)
    }
  }
  for (const t of this.activeUploads()) {
    add(t, 'up');
  }
  return out;
}

export function netSnap(this: Game, jobs: KernelJob[]): NetSnap {
  const l = this.computeLink();
  const fb = this.networkLinked ? (this.usbFallback() ? 'fallback' : this.linkUsable ? 'retired' : 'waiting') : 'off';
  return {
    state: l.state,
    reason: l.reason,
    port: { ...l.port },
    router: l.router && {
      id: l.router.id,
      name: l.router.name,
      mbps: l.router.mbps,
      clients: l.router.clients,
      visual: l.router.visual,
    },
    isp: l.isp && {
      id: l.isp.id,
      name: l.isp.name,
      downMbps: l.isp.downMbps,
      upMbps: l.isp.upMbps,
      clients: l.isp.clients,
    },
    bandwidth: { ...l.bw },
    transfers: this.transferSnaps(),
    uploadsWaiting: this.uploads.filter((t) => t.waiting).length,
    offers: this.offersQ.waiting().map((k) => this.keySnap(k, jobs)),
    spooled: this.spool.map((k) => this.keySnap(k, jobs)),
    usbRetired: this.networkLinked,
    usbFallback: {
      state: fb,
      deadTicks: this.deadTicks,
      startsIn: fb === 'waiting' ? Math.max(0, this.cfg.usbFallbackTicks - this.deadTicks) : null,
      keyRateMul: fb === 'fallback' ? this.cfg.usbFallbackMul : fb === 'waiting' ? 0 : 1,
    },
    retiredKeys: this.tray.waiting().filter((k) => k.retired).length,
    counters: { ...this.netCount },
    frames: { rx: Math.round(this.netFrames.rx), tx: Math.round(this.netFrames.tx) },
    stack: stackSnap(this),
  };
}

/** A download's transport as the snapshot has it. */
function flowSnap(f: Flow): FlowSnap {
  return {
    segs: f.segs,
    acked: f.acked,
    inflight: f.inflight,
    window: f.window,
    resent: f.stats.resent,
    timeouts: f.stats.timeouts,
    rto: f.rto,
  };
}

/** The transport's counters, the loss now, the round trip the senders measured and the NIC's buffers and rings. */
function stackSnap(g: Game): NetStackSnap {
  const v = g.nic.view();
  return {
    ...g.netWire,
    loss: g.wireLoss(),
    rtt: g.netRtt?.sampled ? { srtt: g.netRtt.srtt, rttvar: g.netRtt.rttvar, rto: g.netRtt.rto } : null,
    nic: {
      enabled: v.enabled,
      fifo: v.fifo,
      fifoSegs: v.fifoSegs,
      rxUsed: g.nic.rxPending,
      rxSlots: v.rxSlots,
      txUsed: g.nic.txPending,
      txSlots: v.txSlots,
      rx: v.rx,
      drops: v.drops,
      tx: v.tx,
      dmaWords: v.dmaWords,
      irqs: v.irqs,
    },
  };
}
