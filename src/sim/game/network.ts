// Game feature: the network (docs/NETWORK.md). The link state table, downloads and uploads, retiring the USB keys, the NIC
// feed into the kernel, what a power loss does to it all, and the network snapshot. Every export is a `Game` method (see game.ts).

import { BOARD_TIERS, deviceSpec, type NicSpec } from "../board";
import { generate } from "../gen";
import { JOB_ROW, JobState } from "../isa/memmap";
import { bandwidth, DISK_NET_MBPS, ispByTier, jobSizes, NET, pickOffer, routerByTier } from "../net";
import type { PchKey } from "../pch";
import type { Game } from "./game";
import type { Key, KernelJob, Link, Transfer } from "./internal";
import { needsMet } from "./levels";
import type { LinkState, NetSnap, TransferSnap } from "./types";

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

/** Spool slots in use: spooled jobs, the key in the port if ingested, and downloads (reserved at start). */
export function reserved(this: Game): number {
  return this.spool.length + this.rx.length + this.downloads.length + (this.pluggedIngested() ? 1 : 0);
}

export function usbFallback(this: Game): boolean {
  return this.networkLinked && this.deadTicks >= this.cfg.usbFallbackTicks;
}

/** A job whose result is ready (the key holds it, or the kernel has it in its result state). */
export function resultWaiting(this: Game, k: Key): boolean {
  return k.done || this.kernelJobs().some((j) => j.key === k.id && j.state === JobState.Result);
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

/** Whether the feed has work for the port: a finished download or a spooled job the kernel does not know yet. */
export function feedWaiting(this: Game): boolean {
  const jobs = this.kernelJobs();
  const unknown = (k: Key): boolean => !jobs.some((j) => j.key === k.id);
  const uploading = (k: Key): boolean => this.uploads.some((t) => t.key.id === k.id);
  return this.rx.some(unknown) || this.spool.some((k) => unknown(k) && !uploading(k));
}

/** The USB key that blocks the virtual NIC key, or null (docs/NETWORK.md "Snapshot": `portBusyKey`). */
export function portBusy(this: Game): number | null {
  return this.plugged && this.kernelUp() && this.feedWaiting() ? this.plugged.id : null;
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
    this.downloads.push({ key: next, totalMB: z.downMB, doneMB: 0 });
  }
  if (this.downloads.length > 0) {
    const each = bw.downMbps / 8 / this.downloads.length;
    for (const t of this.downloads) t.doneMB += each;
    for (const t of this.downloads.filter((x) => x.doneMB >= x.totalMB)) {
      this.downloads = this.downloads.filter((x) => x !== t);
      this.rx.push(t.key);
      this.netCount.downloaded++;
    }
  }
  const sending = this.activeUploads();
  if (sending.length > 0) {
    const each = bw.upMbps / 8 / sending.length;
    for (const t of sending) t.doneMB += each;
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

export function dropNetKey(this: Game): void {
  if (!this.netKey) return;
  this.netKey = null;
  this.pch.unplug();
  this.restoreUsbTimings();
}

export function restoreUsbTimings(this: Game): void {
  const boot = this.osPort();
  this.pch.enumTicks = boot ? this.cfg.usbEnumTicks : 0;
  this.pch.flashTicks = boot ? this.cfg.usbFlashTicks : 0;
}

/** Put a job on the virtual USB key (the NIC feed): the kernel ingests it, or flashes its result, with no waits. */
export function netPlug(this: Game, key: Key, kind: "ingest" | "flash", fromRx: boolean): void {
  const program = generate(key.template, key.seed, { row: JOB_ROW, scale: key.scale, hosted: true, gpu: this.gpuTarget(), npu: this.npuTarget() }).program;
  const pk: PchKey = { id: key.id, program, done: false, result: "" };
  this.pch.enumTicks = 0;
  this.pch.flashTicks = 0;
  this.pch.plug(pk);
  this.netKey = { key, kind, pch: pk, since: this.baseTick, fromRx };
}

/**
 * The OS side of the NIC (needs the kernel up): finished downloads are written to the spool (the kernel ingests them from
 * the virtual key), spooled jobs that the kernel does not know (after a boot) are re-ingested in order,
 * and a finished result is read out and uploaded. Everything is real kernel work (CPU and drive), no USB waits.
 */
export function feedKernel(this: Game): void {
  if (!this.kernelUp()) {
    this.dropNetKey();
    return;
  }
  const jobs = this.kernelJobs();
  const known = (id: number): KernelJob | undefined => jobs.find((j) => j.key === id);
  // A finished result is read straight out of the kernel's table into the NIC tx window (the card does the DMA: no USB
  // port, no kernel loop pass), then the slot is free and the upload starts.
  if (this.linkUsable) {
    for (const k of this.spool) {
      const j = known(k.id);
      if (!j || j.state !== JobState.Result || this.uploads.some((t) => t.key.id === k.id)) continue;
      k.result = this.kernelResult(j.slot);
      k.doneAt = this.baseTick;
      this.closeWindow(k);
      this.freeKernelSlot(k.id);
      this.uploads.push({ key: k, totalMB: jobSizes(k.cls, k.type, k.scale).upMB, doneMB: 0, waiting: true });
    }
  }
  const nk = this.netKey;
  if (nk) {
    if (nk.kind === "ingest" && known(nk.key.id)) {
      if (nk.fromRx) {
        this.rx = this.rx.filter((k) => k.id !== nk.key.id);
        this.spool.push(nk.key);
      }
      this.dropNetKey();
    } else if (nk.kind === "flash" && nk.pch.done) {
      const key = nk.key;
      key.result = nk.pch.result;
      key.doneAt = this.baseTick;
      this.closeWindow(key);
      this.dropNetKey();
      this.freeKernelSlot(key.id);
      this.uploads.push({ key, totalMB: jobSizes(key.cls, key.type, key.scale).upMB, doneMB: 0, waiting: true });
    } else if (this.baseTick - nk.since > 300) {
      this.dropNetKey(); // the kernel did not take it (no slot): try again later
      this.netCooldown = 30;
    }
    return;
  }
  if (this.plugged || this.netCooldown-- > 0) return;
  const uploading = (k: Key): boolean => this.uploads.some((t) => t.key.id === k.id);
  const rx = this.rx[0];
  if (rx && !known(rx.id)) return this.netPlug(rx, "ingest", true);
  const again = this.spool.find((k) => !uploading(k) && !known(k.id));
  if (again) this.netPlug(again, "ingest", false);
}

/**
 * Power loss or reboot (docs/NETWORK.md "Power loss"): everything in RAM is gone, the spool on the drive survives.
 * Downloads in progress and finished downloads still in the rx window go back to the offers (attempts + 1), uploads
 * are lost (the spooled job runs again), the virtual USB key of the NIC feed is dropped. Spooled
 * jobs stay: the kernel re-ingests them after the next boot.
 */
export function loseRam(this: Game): void {
  this.dropNetKey();
  this.loseTransfers();
}

/** Downloads, finished downloads in the rx window and uploads are RAM: lost when the link or the machine goes. */
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
    portBusyKey: this.portBusy(),
    counters: { ...this.netCount },
  };
}
