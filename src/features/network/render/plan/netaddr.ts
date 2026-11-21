// The addresses of the network, for the views and the words (docs/render/net.md "Addresses"). The game's sim moves bytes between the machine and the job servers; it does not name
// anyone. So the names are made here, and they are made, never rolled: each is a function of the parts that stand (the board or the card whose jack has the cable, the router, the
// plan) and of the jobs in flight, so the same game shows the same addresses in every view, every frame and after a load. Each MAC is in the locally administered range (the second
// hex digit 2: no real maker owns it); the card's is burnt in (`macOf`), the initials of its invented maker (RL) after the 02. The IP addresses are private (RFC 1918) on the LAN and in the documentation blocks
// (RFC 5737) beyond it, so no address in the game belongs to a real host. What the PC has, the router's DHCP gave it: it has an address while its link is up (`linkOf`, the jacks' law),
// and the router's ARP table and the PC's hold one another's. Pure (no Pixi, no DOM): `netAddrs(snapshot)` is the one reading; the NIC's and the router's views, the hover words, the
// network panel and the lens take it.
import type { Snapshot } from '@/worker/protocol';
import { getSpec, type NicSpec } from '../../../board/sim/specs';
import { getIspSpec, getRouterSpec } from '../../sim/specs';
import { linkOf } from '../jackleds';
import { macOf } from '../nic/nicmac';

/** An address and a port: one end of a connection. */
export interface Endpoint { ip: string; port: number }

/** What a job's connection speaks: the protocol, the port the server listens on and its name. */
export interface Service { proto: 'TCP' | 'UDP'; port: number; name: string }

/** An entry of an ARP table: an IP address, the MAC address it was answered with, and whose it is in words. */
export interface Neighbour { ip: string; mac: string; what: string }

/** One of the PC's network jacks: the board's (`eth0`) or a card's (`eth1`..), its own MAC, and the IP address while the cable is in it and the link is up. */
export interface Iface {
  id: string;
  /** The `connectCable("lan", port)` argument: `board` or the card's device id. */
  port: string;
  mac: string;
  plugged: boolean;
  ip: string | null;
}

/** What the router's DHCP gives the PC while its link is up. */
export interface Host { iface: string; mac: string; ip: string; prefix: number; mask: string; gateway: string; dns: string; lease: string }

/** The router's LAN side: its address (the PC's gateway), the network it makes, the pool it hands out and its MAC. */
export interface Lan { ip: string; prefix: number; mask: string; net: string; broadcast: string; mac: string; pool: { first: string; last: string }; lease: string }

/** The router's WAN side: the public address the plan gives, the ISP's gateway beyond it, and the ISP's name servers. */
export interface Wan { ip: string; prefix: number; mask: string; mac: string; gateway: Neighbour; dns: string[] }

/**
 * One connection of a job in flight, at its places: the PC's end on the LAN, the router's end on the WAN (what NAT made of it), and the server's. `peer` is whom the PC addresses on the
 * LAN wire. It is the server itself, except for DNS: the PC asks its resolver, the router (the name server DHCP gave it), and the router asks the ISP's name server from its own address.
 */
export interface Conn { jobId: number; dir: 'down' | 'up'; label: string; service: Service; lan: Endpoint; wan: Endpoint; peer: Endpoint; server: Endpoint }

export interface NetAddrs {
  /** The PC's jacks, the board's first, then the cards in slot order. */
  ifaces: Iface[];
  /** The jack the cable is in, or null. */
  pc: Iface | null;
  /** What the PC was given, while its link is up (a router, the cable in a jack and the power on). */
  host: Host | null;
  lan: Lan | null;
  /** The router's own two MAC addresses (its WAN jack's and its LAN side's), whenever a router stands. */
  router: { wan: string; lan: string } | null;
  /** With a router and a plan on the line. */
  wan: Wan | null;
  /** The connections of the transfers in flight: with the PC's link up, one for each. */
  conns: Conn[];
  /** The ARP tables: the PC's, the router's on the LAN side and on the WAN side. */
  arp: { host: Neighbour[]; lan: Neighbour[]; wan: Neighbour[] };
}

// ---------------------------------------------------------------- the small arithmetic

/** FNV-1a: the same text gives the same number. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const hex2 = (n: number): string => (n & 255).toString(16).toUpperCase().padStart(2, '0');
/** A MAC address from its six bytes. */
export const macOfBytes = (b: readonly number[]): string => b.map(hex2).join(':');
/** An IPv4 address from the four bytes (a 32 bit number is split in four). */
export const ipv4 = (a: number, b: number, c: number, d: number): number => (((a * 256 + b) * 256 + c) * 256 + d) >>> 0;
export const ipStr = (n: number): string => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
const maskBits = (prefix: number): number => (prefix <= 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);
/** The dotted mask of a prefix length (24: 255.255.255.0). */
export const maskOf = (prefix: number): string => ipStr(maskBits(prefix));

/** Is this text a MAC address? (Six pairs of hex digits, colons between.) */
export const isMac = (s: string): boolean => /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(s);
/** Is this text a dotted IPv4 address? */
export const isIp = (s: string): boolean => { const p = s.split('.'); return p.length === 4 && p.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255); };

// ---------------------------------------------------------------- what the game's parts are called

/**
 * The LAN each router makes, by tier: a home router a /24, the faster ones larger (the 10G switch-router a /22, the edge router a /16). The router takes the first address, the
 * DHCP pool starts at 100.
 */
const LAN: Record<number, { base: number; prefix: number }> = {
  1: { base: ipv4(192, 168, 0, 0), prefix: 24 },
  2: { base: ipv4(192, 168, 1, 0), prefix: 24 },
  3: { base: ipv4(10, 10, 0, 0), prefix: 22 },
  4: { base: ipv4(10, 0, 0, 0), prefix: 16 },
};
/** The lease the router's DHCP gives, in words. */
export const LEASE = '24 h';
/** The ISP's side of the line: one documentation block (RFC 5737 TEST-NET-3): the gateway at 1, the name servers at 53 and 54, the plans' customers above 100. */
const ISP_NET = ipv4(203, 0, 113, 0);
/** The job servers: another documentation block (TEST-NET-2). */
const SERVER_NET = ipv4(198, 51, 100, 0);

/** The router's two MACs, by tier: the maker's initials (RL) after the locally administered 02, the tier, then 01 for the WAN jack and 02 for the LAN jack. */
export const routerMac = (tier: number, lan: boolean): string => macOfBytes([0x02, 0x52, 0x4c, tier, 0x00, lan ? 2 : 1]);
/** The ISP gateway's MAC, by the plan's tier (the initials ISP). */
const gatewayMac = (tier: number): string => macOfBytes([0x02, 0x49, 0x53, 0x50, 0x00, tier]);
/** The board's own jack: the initials HAKO's board, its tier. */
const boardMac = (tier: number): string => macOfBytes([0x02, 0x48, 0x41, 0x4b, tier, 0x01]);

/** The services a job's connection speaks to, by the job's type (the word after the number in its label): DNS jobs are UDP on 53, all others HTTPS on 443. */
const SERVICES: Record<string, Service> = { dns: { proto: 'UDP', port: 53, name: 'DNS' } };
const HTTPS: Service = { proto: 'TCP', port: 443, name: 'HTTPS' };
export const serviceOf = (label: string): Service => SERVICES[/^#\d+\s+(\S+)/.exec(label)?.[1] ?? ''] ?? HTTPS;

/** The PC's jacks in the order the game numbers them: the board's `eth0` when it has one, then each card in slot order as `eth1`.. (as `jackIds` of the words). */
function jacksOf(s: Snapshot): { id: string; port: string; mac: string }[] {
  const num = (slot: string) => Number(/(\d+)$/.exec(slot)?.[1] ?? 0);
  const out: { id: string; port: string; mac: string }[] = [];
  // (a cable in the board's jack is proof enough that it has one)
  if (s.board.features.ethernetMbps > 0 || s.net?.port.kind === 'board') out.push({ id: 'eth0', port: 'board', mac: boardMac(s.board.tier) });
  s.devices.filter((d) => d.kind === 'nic').sort((a, b) => num(a.slot) - num(b.slot)).forEach((d, i) => {
    const spec = getSpec(d.spec) as NicSpec | undefined;
    out.push({ id: `eth${i + 1}`, port: d.id, mac: macOf(spec?.visual ?? 'nic-gbe') });
  });
  return out;
}

const cache = new WeakMap<object, NetAddrs>();

/** The addresses of the game in this snapshot, or null with no network block. The same snapshot gives the same object. */
export function netAddrs(s: Snapshot | null | undefined): NetAddrs | null {
  if (!s || !s.net) return null;
  const hit = cache.get(s);
  if (hit) return hit;
  const n = s.net, link = linkOf(s), spec = n.router ? getRouterSpec(n.router.id) : undefined, tier = spec?.tier ?? (n.router ? Number(/\d+$/.exec(n.router.id)?.[0]) || 1 : 0);
  const lan: Lan | null = n.router ? (() => {
    const plan = LAN[tier] ?? LAN[1]!, mask = maskBits(plan.prefix), net = (plan.base & mask) >>> 0;
    return {
      ip: ipStr(net + 1), prefix: plan.prefix, mask: ipStr(mask), net: ipStr(net), broadcast: ipStr((net | ~mask) >>> 0), mac: routerMac(tier, true),
      pool: { first: ipStr(net + 100), last: ipStr(net + 199) }, lease: LEASE,
    };
  })() : null;
  const ispSpec = n.isp ? getIspSpec(n.isp.id) : undefined, ispTier = ispSpec?.tier ?? (n.isp ? Number(/\d+$/.exec(n.isp.id)?.[0]) || 1 : 0);
  const wan: Wan | null = n.router && n.isp ? {
    ip: ipStr(ISP_NET + 101 + (hash32(n.isp.id) % 100)), prefix: 24, mask: maskOf(24), mac: routerMac(tier, false),
    gateway: { ip: ipStr(ISP_NET + 1), mac: gatewayMac(ispTier), what: 'the ISP gateway' }, dns: [ipStr(ISP_NET + 53), ipStr(ISP_NET + 54)],
  } : null;
  const jacks = jacksOf(s), pcJack = n.port.kind === null ? undefined : jacks.find((j) => j.port === (n.port.kind === 'board' ? 'board' : n.port.deviceId));
  const hostIp = lan && link.pc ? lan.pool.first : null;
  const ifaces: Iface[] = jacks.map((j) => ({ id: j.id, port: j.port, mac: j.mac, plugged: j === pcJack, ip: j === pcJack ? hostIp : null }));
  const pc = ifaces.find((i) => i.plugged) ?? null;
  const host: Host | null = lan && pc && hostIp ? { iface: pc.id, mac: pc.mac, ip: hostIp, prefix: lan.prefix, mask: lan.mask, gateway: lan.ip, dns: lan.ip, lease: LEASE } : null;
  const conns: Conn[] = host && wan ? n.transfers.map((t) => {
    const service = serviceOf(t.label), key = `${t.jobId}|${t.dir}`;
    // (a DNS job asks the PC's name server, the router; the router asks the first name server of the plan. Any other job speaks to its own server.)
    const server: Endpoint = service.name === 'DNS' ? { ip: wan.dns[0]!, port: service.port } : { ip: ipStr(SERVER_NET + 2 + (hash32(`srv|${t.jobId}`) % 250)), port: service.port };
    return {
      jobId: t.jobId, dir: t.dir, label: t.label, service,
      lan: { ip: host.ip, port: 49152 + (hash32(`${key}|lan`) % 16384) }, wan: { ip: wan.ip, port: 1024 + (hash32(`${key}|wan`) % 48000) },
      peer: service.name === 'DNS' ? { ip: host.dns, port: service.port } : server, server,
    };
  }) : [];
  const out: NetAddrs = {
    ifaces, pc, host, lan, wan, conns,
    router: n.router ? { wan: routerMac(tier, false), lan: routerMac(tier, true) } : null,
    arp: {
      host: host && lan ? [{ ip: lan.ip, mac: lan.mac, what: 'the router' }] : [],
      lan: host ? [{ ip: host.ip, mac: host.mac, what: 'the PC' }] : [],
      wan: wan ? [wan.gateway] : [],
    },
  };
  cache.set(s, out);
  return out;
}

/** The interface of a network card (by its device id) or the board's jack (`board`), or undefined. */
export const ifaceOf = (a: NetAddrs | null, port: string): Iface | undefined => a?.ifaces.find((i) => i.port === port);

/**
 * The headers a connection's frames carry on one wire, for a frame going `toward` the PC (a download's data) or away from it: the Ethernet addresses of the two jacks that wire joins, the IP
 * addresses (the PC's private one on the LAN, the router's public one on the WAN: the NAT) and the ports. The MACs change at each wire, the IPs at the router only.
 */
export interface Frame { srcMac: string; dstMac: string; src: Endpoint; dst: Endpoint }
export function frameOn(a: NetAddrs, c: Conn, wire: 'lan' | 'wan', toward: boolean): Frame | null {
  if (!a.host || !a.lan || !a.wan) return null;
  const mine = wire === 'lan' ? c.lan : c.wan, far = wire === 'lan' ? c.peer : c.server, near = wire === 'lan' ? { mac: a.host.mac, peer: a.lan.mac } : { mac: a.wan.mac, peer: a.wan.gateway.mac };
  // (the near end is the PC on the LAN wire and the router's WAN jack on the other; the far end is the router's LAN jack, and the ISP's gateway)
  return toward
    ? { srcMac: near.peer, dstMac: near.mac, src: far, dst: mine }
    : { srcMac: near.mac, dstMac: near.peer, src: mine, dst: far };
}

/** Is the connection answered by the router (the PC's resolver), which asks its own question beyond? DNS is. */
export const isProxied = (c: Conn): boolean => c.peer.ip !== c.server.ip;

/**
 * A connection of the NAT table as one line: the protocol, the PC's address and port, the public address and port the router made of it, and the server's. A proxied one (DNS) names the
 * router's resolver the PC asked before the router's own question: the PC's end, then the router, then the router's WAN end and the name server.
 */
export const natLine = (c: Conn): string => isProxied(c)
  ? `${c.service.proto} ${c.lan.ip}:${c.lan.port} > ${c.peer.ip}:${c.peer.port} | ${c.wan.ip}:${c.wan.port} > ${c.server.ip}:${c.server.port}`
  : `${c.service.proto} ${c.lan.ip}:${c.lan.port} > ${c.wan.ip}:${c.wan.port} > ${c.server.ip}:${c.server.port}`;
