// What the NIC's detailed view shows each frame (`NicShow`): the snapshot as it is, nothing invented. The cable is in this card's jack or it is not; the link is
// up (a PHY needs the cable, the router's power and the PC's: `linkOf` of the jack lights) or it is not; the frames the port carries are the sim's counters
// (`NetSnap.frames`) as a rate (`FrameMeter`); the transfers in flight are the sim's (`NetSnap.transfers`); the heat is the card's own (`DeviceSnap.tempC`,
// `throttle`, `powerW`). Pure (no Pixi): the glyphs read it (nicglyph.ts) and the tests build it.
import type { Snapshot } from '@/worker/protocol';
import * as specs from '../../../board/sim/specs';
import type { Binding } from '../../sim/specs';
import { linkOf } from '../jackleds';
import * as netmeter from '../plan/netmeter';
import { BOARD_NIC } from './nicplan';

/** A transfer in flight on the card: its job's name and how far it is. */
interface NicFlow {
  label: string;
  percent: number;
}

export interface NicShow {
  /** The machine is on and its power is not tripped: the card has power. */
  powered: boolean;
  /** The ethernet cable is in this card's jack, and whether the link has a partner (the router is up and the PC is on). */
  plugged: boolean;
  link: boolean;
  /** The sim's link state and its reason (`NetSnap.state`, `reason`). */
  state: string;
  reason: string | null;
  /** The link speed now in Mbit/s (a hot card runs at half; 0 with no link), and the card's own speed. */
  mbps: number;
  rated: number;
  burnt: boolean;
  hot: boolean;
  tempC: number;
  /** The card's heat limits (its spec's `thermal`): where it throttles to half speed, goes unstable and is damaged. */
  throttleC: number;
  unstableC: number;
  damageC: number;
  /** What it draws now and at its least and most (`DeviceSnap.powerW`, the spec's `idleW` and `loadW`). */
  powerW: number;
  idleW: number;
  loadW: number;
  /** Frames a tick the port receives and sends now (`FrameMeter`), the frames since the game started, the share of the line rate (0 to 1) and how busy the lane looks (a log scale). */
  rx: number;
  tx: number;
  rxTotal: number;
  txTotal: number;
  rxLoad: number;
  txLoad: number;
  rxAct: number;
  txAct: number;
  /** The downloads and the uploads in flight, the results waiting for a client slot, and the jobs waiting at the ISP side. */
  downs: NicFlow[];
  ups: NicFlow[];
  waiting: number;
  offers: number;
  /** Which limit sets the speed (`NetSnap.bandwidth.binding`) and the speed that gives. */
  binding: Binding | null;
  limitMbps: number;
  /** Jobs received and sent over the network since the game started. */
  downloaded: number;
  uploaded: number;
  /** The buffers of the card's port (`NetSnap.stack.nic`, the sim's own numbers; all 0 and no driver when the cable is not in this card): the segments in the chip's input FIFO, the slots of each ring in use, the segments the kernel dropped, the words the DMA engine moved, and whether the driver runs. How many cells each has is the plan's (`NicPlanInput.fifo`, `NIC_RX_SLOTS`, `NIC_TX_SLOTS`). */
  fifo: number;
  rxUsed: number;
  txUsed: number;
  drops: number;
  dmaWords: number;
  driver: boolean;
  /** The visual clock (ms): the motion runs on it. */
  ms: number;
}

/** What differs from one port to the next: whether the cable is in it, its own speed and state, its heat. */
interface Port {
  plugged: boolean;
  rated: number;
  burnt: boolean;
  hot: boolean;
  tempC: number;
  throttleC: number;
  unstableC: number;
  damageC: number;
  powerW: number;
  idleW: number;
  loadW: number;
}

/** The port of the card in header slot `slot` (`BOARD_NIC`: the chip on the motherboard, which has no heat of its own in the sim) or null when the snapshot has none. */
function portOf(s: Snapshot, slot: string): Port | null {
  const { net } = s;
  if (slot === BOARD_NIC) {
    const rated = s.board.features.ethernetMbps;
    return rated > 0
      ? {
          plugged: net?.port.kind === 'board',
          rated,
          burnt: s.board.burnt,
          hot: false,
          tempC: 0,
          throttleC: 0,
          unstableC: 0,
          damageC: 0,
          powerW: 0,
          idleW: 0,
          loadW: 0,
        }
      : null;
  }
  const dev = s.devices.find((d) => d.slot === slot && d.kind === 'nic');
  if (!dev) {
    return null;
  }
  const spec = specs.getSpec(dev.spec) as specs.NicSpec | undefined;
  return {
    plugged: net?.port.kind === 'nic' && net.port.deviceId === dev.id,
    rated: spec?.mbps ?? 0,
    burnt: dev.burnt,
    hot: dev.throttle < 1,
    tempC: dev.tempC,
    throttleC: spec?.thermal.throttleC ?? 0,
    unstableC: spec?.thermal.unstableC ?? 0,
    damageC: spec?.thermal.damageC ?? 0,
    powerW: dev.powerW,
    idleW: spec?.idleW ?? 0,
    loadW: spec?.loadW ?? 0,
  };
}

/** The card in header slot `slot` of the snapshot as the view shows it (or the chip on the motherboard, `BOARD_NIC`), or null when the snapshot has no such card. */
function nicFlows(opts: { net: Snapshot['net'] | undefined; plugged: boolean; dir: 'down' | 'up' }): NicFlow[] {
  const { net, plugged, dir } = opts;
  if (!plugged) {
    return [];
  }
  return (net?.transfers ?? []).filter((t) => t.dir === dir).map((t) => ({ label: t.label, percent: t.percent }));
}

function orZero(on: boolean, n: number | undefined): number {
  return on ? (n ?? 0) : 0;
}

type PortSnap = NonNullable<ReturnType<typeof portOf>>;

function nicShowPort(opts: {
  s: Snapshot;
  p: PortSnap;
  plugged: boolean;
  link: boolean;
  mbps: number;
}): Pick<
  NicShow,
  | 'powered'
  | 'plugged'
  | 'link'
  | 'state'
  | 'reason'
  | 'mbps'
  | 'rated'
  | 'burnt'
  | 'hot'
  | 'tempC'
  | 'throttleC'
  | 'unstableC'
  | 'damageC'
  | 'powerW'
  | 'idleW'
  | 'loadW'
> {
  const { s, p, plugged, link, mbps } = opts;
  const { net } = s;
  return {
    powered: s.powered && !s.power.tripped,
    plugged,
    link,
    state: net?.state ?? 'no-device',
    reason: net?.reason ?? null,
    mbps,
    rated: p.rated,
    burnt: p.burnt,
    hot: p.hot,
    tempC: p.tempC,
    throttleC: p.throttleC,
    unstableC: p.unstableC,
    damageC: p.damageC,
    powerW: p.powerW,
    idleW: p.idleW,
    loadW: p.loadW,
  };
}

function nicShowTraffic(opts: {
  net: Snapshot['net'];
  plugged: boolean;
  rx: number;
  tx: number;
  line: number;
}): Pick<
  NicShow,
  | 'rx'
  | 'tx'
  | 'rxTotal'
  | 'txTotal'
  | 'rxLoad'
  | 'txLoad'
  | 'rxAct'
  | 'txAct'
  | 'downs'
  | 'ups'
  | 'waiting'
  | 'offers'
  | 'binding'
  | 'limitMbps'
  | 'downloaded'
  | 'uploaded'
> {
  const { net, plugged, rx, tx, line } = opts;
  return {
    rx,
    tx,
    rxTotal: orZero(plugged, net?.frames.rx),
    txTotal: orZero(plugged, net?.frames.tx),
    rxLoad: netmeter.loadOf(rx, line),
    txLoad: netmeter.loadOf(tx, line),
    rxAct: netmeter.busy(rx, line),
    txAct: netmeter.busy(tx, line),
    downs: nicFlows({ net, plugged, dir: 'down' }),
    ups: nicFlows({ net, plugged, dir: 'up' }),
    waiting: orZero(plugged, net?.uploadsWaiting),
    offers: orZero(plugged, net?.offers.length),
    binding: plugged ? (net?.bandwidth.binding ?? null) : null,
    limitMbps: orZero(plugged, net?.bandwidth.downMbps),
    downloaded: orZero(plugged, net?.counters.downloaded),
    uploaded: orZero(plugged, net?.counters.uploaded),
  };
}

function nicShowBuffers(
  mine: NonNullable<Snapshot['net']>['stack']['nic'] | undefined,
): Pick<NicShow, 'fifo' | 'rxUsed' | 'txUsed' | 'drops' | 'dmaWords' | 'driver'> {
  return {
    fifo: mine?.fifo ?? 0,
    rxUsed: mine?.rxUsed ?? 0,
    txUsed: mine?.txUsed ?? 0,
    drops: mine?.drops ?? 0,
    dmaWords: mine?.dmaWords ?? 0,
    driver: mine?.enabled ?? false,
  };
}

function nicShowOf(opts: {
  s: Snapshot;
  p: PortSnap;
  meter: Pick<netmeter.FrameMeter, 'rx' | 'tx'>;
  ms: number;
}): NicShow {
  const { s, p, meter, ms } = opts;
  const { net } = s,
    { plugged } = p,
    link = plugged && linkOf(s).pc;
  const mbps = link ? net!.port.mbps : 0,
    line = netmeter.lineFrames(mbps),
    rx = link ? meter.rx : 0,
    tx = link ? meter.tx : 0;
  // (the sim has one NIC device: its buffers are this port's only while the cable is in it)
  const mine = plugged ? net?.stack.nic : undefined;
  return {
    ...nicShowPort({ s, p, plugged, link, mbps }),
    ...nicShowTraffic({ net, plugged, rx, tx, line }),
    ...nicShowBuffers(mine),
    ms,
  };
}

export function nicShow(opts: {
  snap: Snapshot | null | undefined;
  slot: string;
  meter: Pick<netmeter.FrameMeter, 'rx' | 'tx'>;
  ms: number;
}): NicShow | null {
  const { snap: s, slot, meter, ms } = opts;
  const p = s ? portOf(s, slot) : null;
  if (!s || !p) {
    return null;
  }
  return nicShowOf({ s, p, meter, ms });
}
