// Game feature: the network wire and the kernel feed (docs/NETSTACK.md).
// Methods mixed into `Game` (see game.ts). Re-exported from network.ts.

import { generate } from '../../jobs/sim/gen';
import { JOB_ROW, JobState, NIC_ACK_NEXT_MASK, NIC_STAMP_SHIFT } from '@/core/sim/memmap';
import { jobSizes } from '.';
import type { NicPacket, NicSegment } from './nic';
import type { Game } from '@/worker/game/game';
import type { Key } from '@/worker/game/internal';
import { newDownload } from './netxfer';

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
      s += String.fromCodePoint(b);
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
  const keptDownloads = [];
  for (const t of this.downloads) {
    if (!whole(t.key)) {
      keptDownloads.push(t);
      continue;
    }
    this.spool.push(t.key);
    this.netCount.downloaded++;
  }
  this.downloads = keptDownloads;
  const keptRx = [];
  for (const k of this.rx) {
    if (!whole(k)) {
      keptRx.push(k);
      continue;
    }
    this.spool.push(k);
  }
  this.rx = keptRx;
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
