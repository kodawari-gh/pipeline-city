// Game feature: the network link (docs/NETWORK.md): the uplink port, the link state table, utilisation, USB-key retirement.
// Methods mixed into `Game` (see game.ts). Re-exported from network.ts.

import * as boardSim from '../../board/sim';
import { JobState } from '@/core/sim/memmap';
import { bandwidth, DISK_NET_MBPS, ispByTier, NET, routerByTier } from '.';
import type { Game } from '@/worker/game/game';
import type { Key, Link } from '@/worker/game/internal';
import type { LinkState } from '@/worker/game/types';

function hasLan(lan: string | null | undefined): boolean {
  return lan !== null && lan !== undefined && lan !== '';
}

function nicDeviceMbps(d: boardSim.InstalledDevice): number {
  const spec = boardSim.deviceSpec(d);
  if (!('mbps' in spec) || typeof spec.mbps !== 'number') {
    return 0;
  }
  return spec.mbps;
}

/** The uplink port the cable is in: its speed (a hot NIC runs at half), or none. */
export function portInfo(this: Game): Link['port'] {
  if (!hasLan(this.lan)) {
    return { kind: null, deviceId: null, mbps: 0 };
  }
  if (this.lan === 'board') {
    return {
      kind: 'board',
      deviceId: null,
      mbps: this.board.burnt === true ? 0 : (boardSim.BOARD_TIERS[this.board.tier]?.features.ethernetMbps ?? 0),
    };
  }
  const d = this.board.devices.find((x) => x.id === this.lan);
  if (d === undefined || d.burnt === true) {
    return { kind: 'nic', deviceId: this.lan, mbps: 0 };
  }
  const half = (this.thermal.state(d.id)?.throttle ?? 1) < 1;
  return { kind: 'nic', deviceId: d.id, mbps: nicDeviceMbps(d) * (half ? 0.5 : 1) };
}

/** Evaluate the link state table (docs/NETWORK.md "Link states") and the effective bandwidth. */
function makeLink(opts: {
  game: Game;
  port: Link['port'];
  router: Link['router'];
  isp: Link['isp'];
  state: LinkState;
  reason: string | null;
  bwOn?: boolean;
}): Link {
  const { game: g, port, router, isp, state, reason, bwOn = false } = opts;
  const { os } = g;
  const osDev = os === undefined || os === null ? undefined : g.board.devices.find((d) => d.id === os.deviceId);
  const disk = osDev ? (DISK_NET_MBPS[osDev.spec] ?? 80) : 0;
  return {
    state,
    reason,
    port,
    router,
    isp,
    bw: bwOn
      ? bandwidth({ portMbps: port.mbps, router, isp, diskMbps: disk })
      : { downMbps: 0, upMbps: 0, clients: 0, binding: null },
  };
}

interface LinkParts {
  game: Game;
  port: ReturnType<Game['portInfo']>;
  router: NonNullable<ReturnType<typeof routerByTier>> | null;
  isp: NonNullable<ReturnType<typeof ispByTier>> | null;
}

function makePartLink(opts: LinkParts & { state: LinkState; reason: string | null; bwOn?: boolean }): Link {
  return makeLink({
    game: opts.game,
    port: opts.port,
    router: opts.router,
    isp: opts.isp,
    state: opts.state,
    reason: opts.reason,
    bwOn: opts.bwOn ?? false,
  });
}

function linkPartsMissing(opts: LinkParts): Link | null {
  const { game: g, router, isp } = opts;
  if (!router || !isp) {
    return makePartLink({
      ...opts,
      state: 'no-device',
      reason: isp ? 'no router: install one next to the monitor' : 'no ISP plan: buy one',
    });
  }
  if (!hasLan(g.lan)) {
    return makePartLink({
      ...opts,
      state: 'no-cable',
      reason: 'plug the ethernet cable from the board jack into the router',
    });
  }
  if (!g.os) {
    return makePartLink({ ...opts, state: 'no-os', reason: 'needs an OS: the network runs inside it' });
  }
  const ram = g.installedRamBytes();
  if (ram < NET.minRamBytes) {
    return makePartLink({
      ...opts,
      state: 'no-os',
      reason: `needs ${NET.minRamBytes / 1024}K of RAM, only ${ram / 1024}K installed`,
    });
  }
  if (g.os.queueSlots < 1) {
    return makePartLink({ ...opts, state: 'no-os', reason: 'no free space on the OS drive for a spool slot' });
  }
  return null;
}

function linkHeldDown(opts: LinkParts): Link | null {
  const { game: g, port } = opts;
  if (port.mbps <= 0) {
    return makePartLink({
      ...opts,
      state: 'down',
      reason: g.lan === 'board' ? 'the board is dead' : 'the network card is burnt out',
      bwOn: true,
    });
  }
  if (!g.powered) {
    return makePartLink({ ...opts, state: 'down', reason: 'the machine is off', bwOn: true });
  }
  const fault = g.fault();
  if ((fault !== null && fault !== '') || g.postError) {
    return makePartLink({
      ...opts,
      state: 'down',
      reason: fault !== null && fault !== '' ? fault : 'the machine failed POST',
      bwOn: true,
    });
  }
  const phase = g.currentPhase();
  if (phase !== 'idle-os' && phase !== 'ingesting' && phase !== 'running-os' && phase !== 'flashing') {
    return makePartLink({ ...opts, state: 'down', reason: 'the OS is starting', bwOn: true });
  }
  return null;
}

function linkSaturated(g: Game, up: Link): Link | null {
  const waiting = g.offersQ.waiting().some((k) => g.runnable(k, g.capsWith(true)));
  const slotsFull = g.activeTransfers() >= up.bw.clients;
  const { os } = g;
  if (slotsFull || (waiting && os !== undefined && os !== null && g.reserved() >= os.queueSlots)) {
    return { ...up, state: 'saturated', reason: slotsFull ? 'every client slot is busy' : 'the spool is full' };
  }
  return null;
}

export function computeLink(this: Game): Link {
  const parts: LinkParts = {
    game: this,
    port: this.portInfo(),
    router: routerByTier(this.routerTier) ?? null,
    isp: ispByTier(this.ispTier) ?? null,
  };
  const blocked = linkPartsMissing(parts) ?? linkHeldDown(parts);
  if (blocked) {
    return blocked;
  }
  const up = makePartLink({ ...parts, state: 'link-up', reason: null, bwOn: true });
  return linkSaturated(this, up) ?? up;
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
    const hot = id !== null && id !== undefined && id !== '' ? this.thermal.state(id) : undefined;
    keep *=
      (1 - (this.link.isp?.loss ?? 0)) *
      (1 - (this.link.router?.loss ?? 0)) *
      (1 - (hot?.unstable === true ? hot.errProb : 0));
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
