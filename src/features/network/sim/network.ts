// Game feature: the network (docs/NETWORK.md). The link state table, downloads and uploads, retiring the USB keys, the NIC
// feed into the kernel, what a power loss does to it all, and the network snapshot. Every export is a `Game` method (see game.ts).

import { BOARD_TIERS, deviceSpec, type NicSpec } from "../../board/sim";
import { generate } from "../../jobs/sim/gen";
import { JOB_ROW, JobState, NIC_FLAG_REPLAY, NIC_SEG_WORDS } from "@/core/sim/memmap";
import { bandwidth, DISK_NET_MBPS, ispByTier, jobSizes, NET, pickOffer, routerByTier } from ".";
import type { NicPacket, NicSegment } from "./nic";
import type { Game } from "@/worker/game/game";
import type { Key, KernelJob, Link, Transfer } from "@/worker/game/internal";
import { needsMet } from "../../economy/sim/levels";
import type { LinkState, NetSnap, TransferSnap } from "@/worker/game/types";

/** The uplink port the cable is in: its speed (a hot NIC runs at half), or none. */
export function portInfo(this: Game): Link["port"] {
  if (!this.lan) return { kind: null, deviceId: null, mbps: 0 };
  if (this.lan === "board") return { kind: "board", deviceId: null, mbps: this.board.burnt ? 0 : BOARD_TIERS[this.board.tier]!.features.ethernetMbps };
  const d = this.board.devices.find((x) => x.id === this.lan);
  if (!d || d.burnt) return { kind: "nic", deviceId: this.lan, mbps: 0 };
  const half = (this.thermal.state(d.id)?.throttle ?? 1) < 1;
  return { kind: "nic", deviceId: d.id, mbps: (deviceSpec(d) as NicSpec).mbps * (half ? 0.5 : 1) };
}

/** Evaluate the link state table (docs/NETWORK.md "Link states") and the effective bandwidth. */
export function computeLink(this: Game): Link {
  const router = routerByTier(this.routerTier) ?? null;
  const isp = ispByTier(this.ispTier) ?? null;
  const port = this.portInfo();
  const mk = (state: LinkState, reason: string | null, bwOn = false): Link => {
    const osDev = this.os && this.board.devices.find((d) => d.id === this.os!.deviceId);
    const disk = osDev ? (DISK_NET_MBPS[osDev.spec] ?? 80) : 0;
    return { state, reason, port, router, isp, bw: bwOn ? bandwidth(port.mbps, router, isp, disk) : { downMbps: 0, upMbps: 0, clients: 0, binding: null } };
  };
  if (!router || !isp) return mk("no-device", !isp ? "no ISP plan: buy one" : "no router: install one next to the monitor");
  if (!this.lan) return mk("no-cable", "plug the ethernet cable from the board jack into the router");
  if (!this.os) return mk("no-os", "needs an OS: the network runs inside it");
  const ram = this.installedRamBytes();
  if (ram < NET.minRamBytes) return mk("no-os", `needs ${NET.minRamBytes / 1024}K of RAM, only ${ram / 1024}K installed`);
  if (this.os.queueSlots < 1) return mk("no-os", "no free space on the OS drive for a spool slot");
  if (port.mbps <= 0) return mk("down", this.lan === "board" ? "the board is dead" : "the network card is burnt out", true);
  if (!this.powered) return mk("down", "the machine is off", true);
  const fault = this.fault();
  if (fault || this.postError) return mk("down", fault ?? "the machine failed POST", true);
  const phase = this.currentPhase();
  if (phase !== "idle-os" && phase !== "ingesting" && phase !== "running-os" && phase !== "flashing") return mk("down", "the OS is starting", true);
  const up = mk("link-up", null, true);
  const waiting = this.offersQ.waiting().some((k) => this.runnable(k, this.capsWith(true)));
  const slotsFull = this.activeTransfers() >= up.bw.clients;
  if (slotsFull || (waiting && this.reserved() >= this.os.queueSlots)) {
    return { ...up, state: "saturated", reason: slotsFull ? "every client slot is busy" : "the spool is full" };
  }
  return up;
}

/**
 * How much of the uplink port's speed the transfers use now (0..1), the busier way of the two (a port is full duplex). A moving transfer fills the limit that binds, so a
 * 40G card behind a 50 Mbit plan is at a tiny share of its speed, not at full load: its watts and its heat follow this (`thermal.step`, kind `nic`).
 */
export function netUtilisation(this: Game): number {
  const port = this.link.port.mbps;
  if (port <= 0) return 0;
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
  return k.done || this.kernelJobs().some((j) => j.key === k.id && (j.state === JobState.Result || j.state === JobState.Sending));
}

/**
 * Retire the USB keys the client left behind (docs/NETWORK.md "Retired keys"): every tray key and every key the OS
 * holds, plus the key in the port, that has no result waiting. Their client went online, so they stop counting for
 * reputation and expire without a penalty; they can still be served until their deadline.
 */
export function retireUsbKeys(this: Game): void {
  if (!this.cfg.retireUsbKeys) return;
  for (const k of [...this.tray.waiting(), ...(this.plugged ? [this.plugged] : [])]) {
    if (!this.resultWaiting(k)) k.retired = true;
  }
  this.note("net", "the USB keys left behind are retired: they no longer hold reputation");
}

/** The kernel can take the NIC feed now (booted, not in a POST error). */
export function kernelUp(this: Game): boolean {
  const phase = this.currentPhase();
  return phase === "idle-os" || phase === "ingesting" || phase === "running-os" || phase === "flashing";
}

/** One base tick of the network after the machine ran: link state, retirement, transfers, and the feed into the kernel. */
export function netTick(this: Game): void {
  this.link = this.computeLink();
  const usable = this.linkUsable;
  // The link arrives (first time, or back after a dead spell): the USB keys the client left behind retire.
  if (usable && !this.linkWasUsable) this.retireUsbKeys();
  this.linkWasUsable = usable;
  if (usable) {
    if (!this.progress.linkUp) this.note("net", `link up: ${this.link.bw.downMbps} Mbit down, ${this.link.bw.upMbps} up (limited by ${this.link.bw.binding})`);
    this.progress.linkUp = true;
    this.networkLinked = true;
    this.deadTicks = 0;
  } else if (this.networkLinked) {
    this.deadTicks++;
  }
  this.nic.linkUp = usable;
  this.adoptReceived(); // what the kernel has whole is kept, whatever the link does next
  if (!usable) this.loseTransfers();
  else this.runTransfers();
  this.feedKernel();
}

/** Uploads that hold a client slot and move bytes. */
export function activeUploads(this: Game): Transfer[] {
  return this.uploads.filter((t) => !t.waiting);
}

/** Transfers holding a client slot, of both directions (the router's and the plan's `clients` cap this). */
export function activeTransfers(this: Game): number {
  return this.downloads.length + this.activeUploads().length;
}

/** The megabytes a transfer really moves this tick: its share, but no more than is left (the last tick of a transfer is a part of one). */
const moved = (t: Transfer, share: number): number => Math.max(0, Math.min(share, t.totalMB - t.doneMB));

/**
 * Count the frames of `mb` megabytes of payload that cross the uplink port the way `dir` says (`rx`: into the machine, `tx`: out of it): the data frames
 * on the way they flow, and the acknowledgements the receiver sends back on the other way, one for `NET.ackEvery` data frames. The port's statistics are
 * these, and the jacks' activity lights follow them (`network/render/jackleds.ts`). Fractions stay in the totals, so a whole transfer counts exactly.
 */
function countFrames(f: { rx: number; tx: number }, mb: number, dir: "rx" | "tx"): void {
  const data = (mb * 1e6) / NET.frameBytes;
  f[dir] += data;
  f[dir === "rx" ? "tx" : "rx"] += data / NET.ackEvery;
}

/** Start downloads for waiting offers and move the bytes of every transfer. */
export function runTransfers(this: Game): void {
  const bw = this.link.bw;
  const slots = this.os?.queueSlots ?? 0;
  const caps = this.capsWith(true);
  // A client slot serves one transfer of either direction. Results waiting to go out take the free slots first (they are paid work), in the order they were read out.
  for (const t of this.uploads) {
    if (this.activeTransfers() >= bw.clients) break;
    if (t.waiting) t.waiting = false;
  }
  while (this.activeTransfers() < bw.clients && this.reserved() < slots) {
    const next = pickOffer(this.offersQ.waiting(), this.baseTick, NET.ageBandTicks, (k) => needsMet(k.needs, caps).ok);
    if (!next) break;
    this.offersQ.take(next.id);
    next.pluggedAt = this.baseTick;
    next.c0 = this.countersNow();
    delete next.ranAt;
    delete next.reloaded; // a returned offer starts over: it runs when the kernel begins it
    const z = jobSizes(next.cls, next.type, next.scale);
    this.downloads.push({ key: next, totalMB: z.downMB, doneMB: 0, ...programSegments(this.jobWords(next)) });
  }
  // The bytes cross the wire, shared among the downloads still moving. The program's segments reach the NIC as the bytes cover them (`wirePull`).
  const moving = this.downloads.filter((t) => t.doneMB < t.totalMB);
  if (moving.length > 0) {
    const each = bw.downMbps / 8 / moving.length;
    for (const t of moving) { countFrames(this.netFrames, moved(t, each), "rx"); t.doneMB += each; }
  }
  // A download is whole when every byte has crossed the wire and the NIC has taken every segment: the rest is the kernel's work (the receive window, until it has queued the job).
  for (const t of this.downloads.filter((x) => x.doneMB >= x.totalMB && (x.next ?? 0) >= (x.segs ?? 0))) {
    this.downloads = this.downloads.filter((x) => x !== t);
    this.rx.push(t.key);
    this.netCount.downloaded++;
  }
  const sending = this.activeUploads();
  if (sending.length > 0) {
    const each = bw.upMbps / 8 / sending.length;
    for (const t of sending) { countFrames(this.netFrames, moved(t, each), "tx"); t.doneMB += each; }
    for (const t of sending.filter((x) => x.doneMB >= x.totalMB)) {
      this.uploads = this.uploads.filter((x) => x !== t);
      this.spool = this.spool.filter((k) => k.id !== t.key.id); // delivery is the receipt: the spool slot is free
      this.netCount.uploaded++;
      this.netCount.delivered++;
      t.key.done = true;
      this.progress.firstNetJob = true;
      this.progress.firstOsJob = true;
      this.deliver(t.key, "delivered over the network");
    }
  }
}

/** A program cut into the segments the NIC takes: one spool block (`NIC_SEG_WORDS` words) each. */
const programSegments = (words: Uint32Array): Pick<Transfer, "words" | "segs" | "next"> => ({ words, segs: Math.max(1, Math.ceil(words.length / NIC_SEG_WORDS)), next: 0 });

/** The program of a job as a client sends it: generated from the job's template and seed (a USB key carries the same one). */
export function jobWords(this: Game, key: Key): Uint32Array {
  return generate(key.template, key.seed, { row: JOB_ROW, scale: key.scale, hosted: true, gpu: this.gpuTarget(), npu: this.npuTarget() }).program;
}

/** The text the result words of a job make: the bytes up to the first NUL, trailing blanks cut (what `kernelResult` reads out of the job table). */
function resultText(words: Uint32Array): string {
  let s = "";
  for (const w of words) {
    for (let i = 0; i < 4; i++) {
      const b = (w >>> (8 * i)) & 0xff;
      if (b === 0) return s.trimEnd();
      s += String.fromCharCode(b);
    }
  }
  return s.trimEnd();
}

/**
 * The wire's side of the NIC's receive path (`Nic.pull`, called from the NIC's own clock): the next segment of a program that is due. Spooled jobs the kernel has to take again come first
 * (nothing crosses the wire for them), then the downloads in the order they started. A segment is due when the bytes that have crossed the wire cover it.
 */
export function wirePull(this: Game): NicSegment | null {
  for (const list of [this.restores, this.downloads]) {
    for (const t of list) {
      const { words, segs } = t;
      if (!words || segs === undefined || t.next === undefined) continue;
      const due = t.replay || t.doneMB >= t.totalMB ? segs : Math.floor((segs * t.doneMB) / t.totalMB);
      if (t.next >= due) continue;
      const seq = t.next++;
      return { key: t.key.id, seq, count: segs, total: words.length, words: words.subarray(seq * NIC_SEG_WORDS, (seq + 1) * NIC_SEG_WORDS), flags: t.replay ? NIC_FLAG_REPLAY : 0 };
    }
  }
  return null;
}

/**
 * The wire's side of the NIC's transmit path (`Nic.onTransmit`, from the NIC's clock): a packet the kernel wrote into the transmit ring and the NIC read by DMA. A result packet of a network job
 * goes out as an upload that waits for a client slot (`runTransfers`). An acknowledgement carries no words: there is no sender to tell yet.
 */
export function wireSend(this: Game, p: NicPacket): void {
  if (p.words.length === 0) return;
  const k = this.rx.find((x) => x.id === p.key) ?? this.spool.find((x) => x.id === p.key);
  if (!k || this.uploads.some((t) => t.key.id === k.id)) return; // a result nobody waits for
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

/** A download whose job the kernel has queued whole leaves the receive window for the spool: the program is on the drive. */
export function adoptReceived(this: Game): void {
  if (this.rx.length === 0) return;
  const jobs = this.kernelJobs();
  for (const k of [...this.rx]) {
    const j = jobs.find((x) => x.net && x.key === k.id);
    if (j && j.state >= JobState.Queued) {
      this.rx = this.rx.filter((x) => x !== k);
      this.spool.push(k);
    }
  }
}

/**
 * The host's side of the NIC feed, after the machine ran this tick: a spooled job the kernel does not know (a boot wiped its table, docs/NETWORK.md "Power loss") is replayed through the NIC
 * from the spool. The kernel's driver does the work: the segments go to the ring, it writes them to the spool blocks again and queues the job.
 */
export function feedKernel(this: Game): void {
  if (!this.kernelUp() || !this.linkUsable) return;
  const jobs = this.kernelJobs();
  this.restores = this.restores.filter((t) => !jobs.some((j) => j.net && j.key === t.key.id && j.state >= JobState.Queued)); // the kernel has it: the replay is over
  for (const k of this.spool) {
    if (jobs.some((j) => j.key === k.id) || this.uploads.some((t) => t.key.id === k.id) || this.restores.some((t) => t.key.id === k.id)) continue;
    this.restores.push({ key: k, totalMB: 0, doneMB: 0, replay: true, ...programSegments(this.jobWords(k)) });
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
  this.nic.flush();
}

export function transferSnaps(this: Game): TransferSnap[] {
  const out: TransferSnap[] = [];
  const add = (t: Transfer, dir: "down" | "up"): void => {
    const rate = (dir === "down" ? this.link.bw.downMbps / Math.max(1, this.downloads.length) : this.link.bw.upMbps / Math.max(1, this.activeUploads().length)) / 8;
    out.push({
      jobId: t.key.id, label: `#${String(t.key.jobNo).padStart(2, "0")} ${t.key.type}`, dir, totalMB: t.totalMB, doneMB: t.doneMB,
      percent: Math.min(100, Math.round((100 * t.doneMB) / t.totalMB)), etaTicks: rate > 0 ? Math.ceil((t.totalMB - t.doneMB) / rate) : -1, persisted: false,
    });
  };
  for (const t of this.downloads) add(t, "down");
  for (const t of this.activeUploads()) add(t, "up");
  return out;
}

export function netSnap(this: Game, jobs: KernelJob[]): NetSnap {
  const l = this.computeLink();
  const fb = this.networkLinked ? (this.usbFallback() ? "fallback" : this.linkUsable ? "retired" : "waiting") : "off";
  return {
    state: l.state, reason: l.reason, port: { ...l.port },
    router: l.router && { id: l.router.id, name: l.router.name, mbps: l.router.mbps, clients: l.router.clients, visual: l.router.visual },
    isp: l.isp && { id: l.isp.id, name: l.isp.name, downMbps: l.isp.downMbps, upMbps: l.isp.upMbps, clients: l.isp.clients },
    bandwidth: { ...l.bw }, transfers: this.transferSnaps(), uploadsWaiting: this.uploads.filter((t) => t.waiting).length,
    offers: this.offersQ.waiting().map((k) => this.keySnap(k, jobs)),
    spooled: this.spool.map((k) => this.keySnap(k, jobs)),
    usbRetired: this.networkLinked,
    usbFallback: {
      state: fb, deadTicks: this.deadTicks, startsIn: fb === "waiting" ? Math.max(0, this.cfg.usbFallbackTicks - this.deadTicks) : null,
      keyRateMul: fb === "fallback" ? this.cfg.usbFallbackMul : fb === "waiting" ? 0 : 1,
    },
    retiredKeys: this.tray.waiting().filter((k) => k.retired).length,
    counters: { ...this.netCount },
    frames: { rx: Math.round(this.netFrames.rx), tx: Math.round(this.netFrames.tx) },
  };
}
