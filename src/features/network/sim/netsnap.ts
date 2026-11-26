// Game feature: the network snapshot (docs/NETWORK.md).
// Methods mixed into `Game` (see game.ts). Re-exported from network.ts.

import type { Game } from '@/worker/game/game';
import type { KernelJob, Transfer } from '@/worker/game/internal';
import type { Flow } from './transport';
import type { FlowSnap, NetSnap, NetStackSnap, TransferSnap } from '@/worker/game/types';

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

function usbKeyState(g: Game): NetSnap['usbFallback']['state'] {
  if (!g.networkLinked) {
    return 'off';
  }
  if (g.usbFallback()) {
    return 'fallback';
  }
  if (g.linkUsable) {
    return 'retired';
  }
  return 'waiting';
}

function usbKeyRateMul(state: NetSnap['usbFallback']['state'], fallbackMul: number): number {
  if (state === 'fallback') {
    return fallbackMul;
  }
  if (state === 'waiting') {
    return 0;
  }
  return 1;
}

export function netSnap(this: Game, jobs: KernelJob[]): NetSnap {
  const l = this.computeLink();
  const fb = usbKeyState(this);
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
    uploadsWaiting: this.uploads.filter((t) => t.waiting === true).length,
    offers: this.offersQ.waiting().map((k) => this.keySnap(k, jobs)),
    spooled: this.spool.map((k) => this.keySnap(k, jobs)),
    usbRetired: this.networkLinked,
    usbFallback: {
      state: fb,
      deadTicks: this.deadTicks,
      startsIn: fb === 'waiting' ? Math.max(0, this.cfg.usbFallbackTicks - this.deadTicks) : null,
      keyRateMul: usbKeyRateMul(fb, this.cfg.usbFallbackMul),
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
    rtt: g.netRtt?.sampled === true ? { srtt: g.netRtt.srtt, rttvar: g.netRtt.rttvar, rto: g.netRtt.rto } : null,
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
