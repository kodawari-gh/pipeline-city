// What the NIC's detailed view shows each frame (`NicShow`): the snapshot as it is, nothing invented. The cable is in this card's jack or it is not; the link is
// up (a PHY needs the cable, the router's power and the PC's: `linkOf` of the jack lights) or it is not; the frames the port carries are the sim's counters
// (`NetSnap.frames`) as a rate (`FrameMeter`); the transfers in flight are the sim's (`NetSnap.transfers`); the heat is the card's own (`DeviceSnap.tempC`,
// `throttle`, `powerW`). Pure (no Pixi): the glyphs read it (nicglyph.ts) and the tests build it.
import type { Snapshot } from '@/worker/protocol';
import { getSpec, type NicSpec } from '../../../board/sim/specs';
import type { Binding } from '../../sim/specs';
import { linkOf } from '../jackleds';
import { busy, lineFrames, loadOf, type FrameMeter } from '../plan/netmeter';
import { BOARD_NIC } from './nicplan';

/** A transfer in flight on the card: its job's name and how far it is. */
export interface NicFlow { label: string; percent: number }

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
interface Port { plugged: boolean; rated: number; burnt: boolean; hot: boolean; tempC: number; throttleC: number; unstableC: number; damageC: number; powerW: number; idleW: number; loadW: number }

/** The port of the card in header slot `slot` (`BOARD_NIC`: the chip on the motherboard, which has no heat of its own in the sim) or null when the snapshot has none. */
function portOf(s: Snapshot, slot: string): Port | null {
  const net = s.net;
  if (slot === BOARD_NIC) {
    const rated = s.board.features.ethernetMbps;
    return rated > 0 ? { plugged: net?.port.kind === 'board', rated, burnt: s.board.burnt, hot: false, tempC: 0, throttleC: 0, unstableC: 0, damageC: 0, powerW: 0, idleW: 0, loadW: 0 } : null;
  }
  const dev = s.devices.find((d) => d.slot === slot && d.kind === 'nic');
  if (!dev) return null;
  const spec = getSpec(dev.spec) as NicSpec | undefined;
  return {
    plugged: net?.port.kind === 'nic' && net.port.deviceId === dev.id, rated: spec?.mbps ?? 0, burnt: dev.burnt, hot: dev.throttle < 1,
    tempC: dev.tempC, throttleC: spec?.thermal.throttleC ?? 0, unstableC: spec?.thermal.unstableC ?? 0, damageC: spec?.thermal.damageC ?? 0,
    powerW: dev.powerW, idleW: spec?.idleW ?? 0, loadW: spec?.loadW ?? 0,
  };
}

/** The card in header slot `slot` of the snapshot as the view shows it (or the chip on the motherboard, `BOARD_NIC`), or null when the snapshot has no such card. */
export function nicShow(s: Snapshot | null | undefined, slot: string, meter: Pick<FrameMeter, 'rx' | 'tx'>, ms: number): NicShow | null {
  const p = s ? portOf(s, slot) : null;
  if (!s || !p) return null;
  const net = s.net, { plugged, rated } = p, link = plugged && linkOf(s).pc;
  const mbps = link ? net!.port.mbps : 0, line = lineFrames(mbps), rx = link ? meter.rx : 0, tx = link ? meter.tx : 0;
  const flows = (dir: 'down' | 'up'): NicFlow[] => (plugged ? (net?.transfers ?? []).filter((t) => t.dir === dir).map((t) => ({ label: t.label, percent: t.percent })) : []);
  // (the sim has one NIC device: its buffers are this port's only while the cable is in it)
  const mine = plugged ? net?.stack.nic : undefined;
  return {
    powered: s.powered && !s.power.tripped, plugged, link, state: net?.state ?? 'no-device', reason: net?.reason ?? null, mbps, rated, burnt: p.burnt, hot: p.hot,
    tempC: p.tempC, throttleC: p.throttleC, unstableC: p.unstableC, damageC: p.damageC,
    powerW: p.powerW, idleW: p.idleW, loadW: p.loadW,
    rx, tx, rxTotal: plugged ? net?.frames.rx ?? 0 : 0, txTotal: plugged ? net?.frames.tx ?? 0 : 0, rxLoad: loadOf(rx, line), txLoad: loadOf(tx, line), rxAct: busy(rx, line), txAct: busy(tx, line),
    downs: flows('down'), ups: flows('up'), waiting: plugged ? net?.uploadsWaiting ?? 0 : 0, offers: plugged ? net?.offers.length ?? 0 : 0,
    binding: plugged ? net?.bandwidth.binding ?? null : null, limitMbps: plugged ? net?.bandwidth.downMbps ?? 0 : 0,
    downloaded: plugged ? net?.counters.downloaded ?? 0 : 0, uploaded: plugged ? net?.counters.uploaded ?? 0 : 0,
    fifo: mine?.fifo ?? 0, rxUsed: mine?.rxUsed ?? 0, txUsed: mine?.txUsed ?? 0, drops: mine?.drops ?? 0, dmaWords: mine?.dmaWords ?? 0, driver: mine?.enabled ?? false, ms,
  };
}
