// What the router SoC's die view shows each frame (`RouterShow`): the snapshot as it is, nothing invented (docs/render/net.md "Inside the NIC and the router"). The router has no heat
// and no power meter in the game: it stands on the wall's power and keeps no state but its place in the chain, so what it can show is what passes through it. The two links are
// `linkOf`'s (the jacks' law, jackleds.ts): the LAN jack has a partner when the PC is on and the cable is in; the WAN jack when a plan is on the line. The frames are the sim's
// counters (`NetSnap.frames`: the PC's uplink port, which is the router's whole traffic: every frame the router forwards goes to or from it) as a rate (`FrameMeter`); the clients it
// serves are the transfers in flight (`NetSnap.transfers`), against the slots it has (the smaller of the router's and the plan's clients). Pure (no Pixi): the glyphs read it
// (routerglyph.ts) and the tests build it.
import type { Snapshot } from '@/worker/protocol';
import { getRouterSpec, type Binding } from '../../sim/specs';
import { linkOf } from '../jackleds';
import { netAddrs, type NetAddrs } from '../plan/netaddr';
import { busy, fmtSpeed, lineFrames, loadOf, type FrameMeter } from '../plan/netmeter';

/** A transfer in flight through the router: its job's name and how far it is. */
interface RouterFlow {
  label: string;
  percent: number;
  jobId: number;
  dir: 'down' | 'up';
}

export interface RouterShow {
  tier: number;
  name: string;
  /** The router's own speed (Mbit/s) and the clients it serves at once (`NetSnap.router`). */
  ratedMbps: number;
  clientsMax: number;
  /** The LAN jack has a partner (the PC is on, its port works, the cable is in), the WAN jack has one (a plan is on the line), and whether a cable is in the PC's port at all. */
  pc: boolean;
  wan: boolean;
  plugged: boolean;
  /** The sim's link state and its reason (`NetSnap.state`, `reason`). */
  state: string;
  reason: string | null;
  /** The plan on the line: its name and speeds (0 with no plan), and the speed the LAN jack runs at (the slower of the PC's port and the router; 0 with no link). */
  ispName: string | null;
  downMbps: number;
  upMbps: number;
  lanMbps: number;
  /** Frames a tick the router forwards each way now (`FrameMeter`), since the game started, the share of the router's own rate (0 to 1) and how busy the lanes look (a log scale). 0 with no link on both sides. */
  rx: number;
  tx: number;
  rxTotal: number;
  txTotal: number;
  rxLoad: number;
  txLoad: number;
  rxAct: number;
  txAct: number;
  /** The downloads and the uploads in flight: each is a client in service. */
  downs: RouterFlow[];
  ups: RouterFlow[];
  /** The clients in service (the transfers in flight) and the slots the router and the plan give. */
  used: number;
  slots: number;
  /** Which limit sets the speed (`NetSnap.bandwidth.binding`) and the speed that gives. */
  binding: Binding | null;
  limitMbps: number;
  /** The addresses the game gives (`netaddr.ts`): the LAN and WAN sides, what the PC was given, the connections in flight; null with no network. */
  addr: NetAddrs | null;
  /** The visual clock (ms): the motion runs on it. */
  ms: number;
}

/** What limits the speed now, in words: the router's own, the plan's, the drive's or the port's. */
export function limitWords(s: Pick<RouterShow, 'binding' | 'limitMbps'>): string {
  const sp = fmtSpeed(s.limitMbps);
  switch (s.binding) {
    case 'router':
      return `the router, ${sp}`;
    case 'isp':
      return `the plan, ${sp}`;
    case 'disk':
      return `the drive, ${sp}`;
    case 'port':
      return `the PC's port, ${sp}`;
    default:
      return 'none';
  }
}

/** The router in the snapshot as the view shows it, or null when no router stands. */
export function routerShow(
  s: Snapshot | null | undefined,
  meter: Pick<FrameMeter, 'rx' | 'tx'>,
  ms: number,
): RouterShow | null {
  const net = s?.net,
    r = net?.router;
  if (!s || !net || !r) return null;
  const spec = getRouterSpec(r.id),
    tier = spec?.tier ?? (Number(/\d+$/.exec(r.id)?.[0]) || 1),
    link = linkOf(s),
    flow = link.pc && link.wan,
    line = lineFrames(r.mbps);
  const rx = flow ? meter.rx : 0,
    tx = flow ? meter.tx : 0,
    isp = net.isp;
  const flows = (dir: 'down' | 'up'): RouterFlow[] =>
    net.transfers
      .filter((t) => t.dir === dir)
      .map((t) => ({ label: t.label, percent: t.percent, jobId: t.jobId, dir: t.dir }));
  return {
    tier,
    name: r.name,
    ratedMbps: r.mbps,
    clientsMax: r.clients,
    pc: link.pc,
    wan: link.wan,
    plugged: net.port.kind !== null,
    state: net.state,
    reason: net.reason,
    ispName: isp?.name ?? null,
    downMbps: isp?.downMbps ?? 0,
    upMbps: isp?.upMbps ?? 0,
    lanMbps: link.pc ? Math.min(net.port.mbps, r.mbps) : 0,
    rx,
    tx,
    rxTotal: net.frames.rx,
    txTotal: net.frames.tx,
    rxLoad: loadOf(rx, line),
    txLoad: loadOf(tx, line),
    rxAct: busy(rx, line),
    txAct: busy(tx, line),
    downs: flows('down'),
    ups: flows('up'),
    used: net.transfers.length,
    slots: Math.min(r.clients, isp?.clients ?? r.clients),
    binding: net.bandwidth.binding,
    limitMbps: net.bandwidth.downMbps,
    addr: netAddrs(s),
    ms,
  };
}
