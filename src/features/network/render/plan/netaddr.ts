// The addresses of the network, for the views and the words (docs/render/net.md "Addresses"). The game's sim moves bytes between the machine and the job servers; it does not name
// anyone. So the names are made here, and they are made, never rolled: each is a function of the parts that stand (the board or the card whose jack has the cable, the router, the
// plan) and of the jobs in flight, so the same game shows the same addresses in every view, every frame and after a load. Each MAC is in the locally administered range (the second
// hex digit 2: no real maker owns it); the card's is burnt in (`macOf`), the initials of its invented maker (RL) after the 02. The IP addresses are private (RFC 1918) on the LAN and in the documentation blocks
// (RFC 5737) beyond it, so no address in the game belongs to a real host. What the PC has, the router's DHCP gave it: it has an address while its link is up (`linkOf`, the jacks' law),
// and the router's ARP table and the PC's hold one another's. Pure (no Pixi, no DOM): `netAddrs(snapshot)` is the one reading; the NIC's and the router's views, the hover words, the
// network panel and the lens take it.
import type { Snapshot } from '@/worker/protocol';
import * as specs from '../../../board/sim/specs';
import { getIspSpec, getRouterSpec } from '../../sim/specs';
import { linkOf } from '../jackleds';
import { macOf } from '../nic/nicmac';
import {
  hash32,
  ipStr,
  maskOf,
  routerMac,
  maskBits,
  LAN,
  LEASE,
  ISP_NET,
  SERVER_NET,
  gatewayMac,
  boardMac,
} from './netip';
import type { Endpoint, Host, Iface, Lan, Wan, Conn, NetAddrs, Service } from './netaddrtypes';

export { hash32, ipv4, ipStr, maskOf, isMac, isIp, routerMac } from './netip';
export type { Service, Iface, Conn, NetAddrs } from './netaddrtypes';

/** The services a job's connection speaks to, by the job's type (the word after the number in its label): DNS jobs are UDP on 53, all others HTTPS on 443. */
const SERVICES: Record<string, Service> = { dns: { proto: 'UDP', port: 53, name: 'DNS' } };
const HTTPS: Service = { proto: 'TCP', port: 443, name: 'HTTPS' };
export const serviceOf = (label: string): Service =>
  SERVICES[/^#\d+\s+(?<name>\S+)/u.exec(label)?.groups?.['name'] ?? ''] ?? HTTPS;

/** The PC's jacks in the order the game numbers them: the board's `eth0` when it has one, then each card in slot order as `eth1`.. (as `jackIds` of the words). */
function jacksOf(s: Snapshot): { id: string; port: string; mac: string }[] {
  const num = (slot: string) => Number(/(?<num>\d+)$/u.exec(slot)?.groups?.['num'] ?? 0);
  const out: { id: string; port: string; mac: string }[] = [];
  // (a cable in the board's jack is proof enough that it has one)
  if (s.board.features.ethernetMbps > 0 || s.net?.port.kind === 'board') {
    out.push({ id: 'eth0', port: 'board', mac: boardMac(s.board.tier) });
  }
  s.devices
    .filter((d) => d.kind === 'nic')
    .sort((a, b) => num(a.slot) - num(b.slot))
    .forEach((d, i) => {
      const spec = specs.getSpec(d.spec) as specs.NicSpec | undefined;
      out.push({ id: `eth${i + 1}`, port: d.id, mac: macOf(spec?.visual ?? 'nic-gbe') });
    });
  return out;
}

const cache = new WeakMap<object, NetAddrs>();

/** The addresses of the game in this snapshot, or null with no network block. The same snapshot gives the same object. */

function idTier(id: string | undefined, specTier: number | undefined, fallback: number): number {
  return specTier ?? (id !== undefined && id !== '' ? Number(/\d+$/u.exec(id)?.[0]) || fallback : fallback);
}

function lanOf(tier: number): Lan {
  const plan = LAN[tier] ?? LAN[1]!,
    mask = maskBits(plan.prefix),
    net = (plan.base & mask) >>> 0;
  return {
    ip: ipStr(net + 1),
    prefix: plan.prefix,
    mask: ipStr(mask),
    net: ipStr(net),
    broadcast: ipStr((net | ~mask) >>> 0),
    mac: routerMac(tier, true),
    pool: { first: ipStr(net + 100), last: ipStr(net + 199) },
    lease: LEASE,
  };
}

function wanOf(opts: { ispId: string; tier: number; ispTier: number }): Wan {
  const { ispId, tier, ispTier } = opts;
  return {
    ip: ipStr(ISP_NET + 101 + (hash32(ispId) % 100)),
    prefix: 24,
    mask: maskOf(24),
    mac: routerMac(tier, false),
    gateway: { ip: ipStr(ISP_NET + 1), mac: gatewayMac(ispTier), what: 'the ISP gateway' },
    dns: [ipStr(ISP_NET + 53), ipStr(ISP_NET + 54)],
  };
}

function pcJackOf(
  n: NonNullable<Snapshot['net']>,
  jacks: { id: string; port: string; mac: string }[],
): { id: string; port: string; mac: string } | undefined {
  if (n.port.kind === null) {
    return undefined;
  }
  const port = n.port.kind === 'board' ? 'board' : n.port.deviceId;
  return jacks.find((j) => j.port === port);
}

function ifacesOf(
  jacks: { id: string; port: string; mac: string }[],
  pcJack: { id: string; port: string; mac: string } | undefined,
  hostIp: string | null,
): Iface[] {
  return jacks.map((j) => ({
    id: j.id,
    port: j.port,
    mac: j.mac,
    plugged: j === pcJack,
    ip: j === pcJack ? hostIp : null,
  }));
}

function hostOf(lan: Lan, pc: Iface, hostIp: string): Host {
  return {
    iface: pc.id,
    mac: pc.mac,
    ip: hostIp,
    prefix: lan.prefix,
    mask: lan.mask,
    gateway: lan.ip,
    dns: lan.ip,
    lease: LEASE,
  };
}

function connOf(opts: { t: NonNullable<Snapshot['net']>['transfers'][number]; host: Host; wan: Wan }): Conn {
  const { t, host, wan } = opts;
  const service = serviceOf(t.label),
    key = `${t.jobId}|${t.dir}`;
  // (a DNS job asks the PC's name server, the router; the router asks the first name server of the plan. Any other job speaks to its own server.)
  const server: Endpoint =
    service.name === 'DNS'
      ? { ip: wan.dns[0]!, port: service.port }
      : { ip: ipStr(SERVER_NET + 2 + (hash32(`srv|${t.jobId}`) % 250)), port: service.port };
  return {
    jobId: t.jobId,
    dir: t.dir,
    label: t.label,
    service,
    lan: { ip: host.ip, port: 49_152 + (hash32(`${key}|lan`) % 16_384) },
    wan: { ip: wan.ip, port: 1024 + (hash32(`${key}|wan`) % 48_000) },
    peer: service.name === 'DNS' ? { ip: host.dns, port: service.port } : server,
    server,
  };
}

function arpOf(host: Host | null, lan: Lan | null, wan: Wan | null): NetAddrs['arp'] {
  return {
    host: host && lan ? [{ ip: lan.ip, mac: lan.mac, what: 'the router' }] : [],
    lan: host ? [{ ip: host.ip, mac: host.mac, what: 'the PC' }] : [],
    wan: wan ? [wan.gateway] : [],
  };
}

function sidesOf(n: NonNullable<Snapshot['net']>, tier: number): { lan: Lan | null; wan: Wan | null } {
  const lan = n.router ? lanOf(tier) : null;
  if (!n.router || !n.isp) {
    return { lan, wan: null };
  }
  const ispSpec = getIspSpec(n.isp.id);
  const ispTier = idTier(n.isp.id, ispSpec?.tier, 1);
  return { lan, wan: wanOf({ ispId: n.isp.id, tier, ispTier }) };
}

function hostSide(opts: { s: Snapshot; n: NonNullable<Snapshot['net']>; lan: Lan | null }): {
  ifaces: Iface[];
  pc: Iface | null;
  host: Host | null;
} {
  const { s, n, lan } = opts;
  const jacks = jacksOf(s),
    pcJack = pcJackOf(n, jacks);
  const hostIp = lan && linkOf(s).pc ? lan.pool.first : null;
  const ifaces = ifacesOf(jacks, pcJack, hostIp);
  const pc = ifaces.find((i) => i.plugged) ?? null;
  const host = lan && pc && hostIp !== null && hostIp !== '' ? hostOf(lan, pc, hostIp) : null;
  return { ifaces, pc, host };
}

function buildNetAddrs(s: Snapshot, n: NonNullable<Snapshot['net']>): NetAddrs {
  const spec = n.router ? getRouterSpec(n.router.id) : undefined;
  const tier = idTier(n.router?.id, spec?.tier, n.router ? 1 : 0);
  const { lan, wan } = sidesOf(n, tier);
  const { ifaces, pc, host } = hostSide({ s, n, lan });
  const conns = host && wan ? n.transfers.map((t) => connOf({ t, host, wan })) : [];
  return {
    ifaces,
    pc,
    host,
    lan,
    wan,
    conns,
    router: n.router ? { wan: routerMac(tier, false), lan: routerMac(tier, true) } : null,
    arp: arpOf(host, lan, wan),
  };
}

export function netAddrs(s: Snapshot | null | undefined): NetAddrs | null {
  if (s === null || s === undefined) {
    return null;
  }
  const hit = cache.get(s);
  if (hit) {
    return hit;
  }
  const n = s.net;
  const built = buildNetAddrs(s, n);
  const out: NetAddrs = built;
  cache.set(s, out);
  return out;
}

/** The interface of a network card (by its device id) or the board's jack (`board`), or undefined. */
export const ifaceOf = (a: NetAddrs | null, port: string): Iface | undefined => a?.ifaces.find((i) => i.port === port);

export { frameOn, isProxied, natLine } from './netframe';
