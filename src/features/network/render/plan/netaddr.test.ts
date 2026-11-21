import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/game/game';
import type { TransferSnap } from '@/worker/game/types';
import { dev, snap } from '@/core/ui/testdata';
import { frameOn, hash32, ifaceOf, ipStr, ipv4, isIp, isMac, maskOf, netAddrs, serviceOf } from './netaddr';

const ROUTERS = [
  { id: 'router1', name: 'Home router', mbps: 100, clients: 2, visual: 'router-home' },
  { id: 'router2', name: 'Gigabit router', mbps: 1000, clients: 4, visual: 'router-gigabit' },
  { id: 'router3', name: '10G switch-router', mbps: 10000, clients: 8, visual: 'router-10g' },
  { id: 'router4', name: 'Core router', mbps: 40000, clients: 16, visual: 'router-core' },
] as const;
const flow = (jobId: number, dir: 'down' | 'up', label: string): TransferSnap => ({ jobId, label, dir, totalMB: 100, doneMB: 10, percent: 10, etaTicks: 4, persisted: false });

/** A running machine over the router of `tier`, the cable in `port` (the board's jack, a card's or none), a plan on the line (or none) and the transfers `flows`. */
function game(tier = 1, o: { port?: 'board' | 'nic' | null; plan?: boolean; on?: boolean; flows?: TransferSnap[] } = {}): Snapshot {
  const { port = 'board', plan = true, on = true, flows = [] } = o, base = snap();
  return snap({
    powered: on, power: { ...base.power, tripped: false }, board: { ...base.board, features: { ...base.board.features, ethernetMbps: 1000 } },
    devices: [dev({ id: 'nic9', spec: 'nic1', kind: 'nic', name: 'GbE card', slot: 'pcie1' })],
    net: {
      ...base.net!, state: port ? 'link-up' : 'no-cable', reason: null, router: ROUTERS[tier - 1]!,
      port: port === 'board' ? { kind: 'board', deviceId: null, mbps: 1000 } : port === 'nic' ? { kind: 'nic', deviceId: 'nic9', mbps: 1000 } : { kind: null, deviceId: null, mbps: 0 },
      isp: plan ? { id: 'isp3', name: 'Cable', downMbps: 200, upMbps: 50, clients: 4 } : null, transfers: flows,
    },
  });
}

describe('the small arithmetic', () => {
  it('hashes a text to the same number every time, and different texts to different ones', () => {
    expect(hash32('a')).toBe(hash32('a'));
    expect(hash32('a')).not.toBe(hash32('b'));
    expect(hash32('')).toBe(0x811c9dc5);
  });

  it('writes IPv4 addresses and masks', () => {
    expect(ipStr(ipv4(192, 168, 1, 100))).toBe('192.168.1.100');
    expect(ipStr(ipv4(10, 0, 0, 1) + 300)).toBe('10.0.1.45');
    expect([24, 22, 16, 0, 32].map(maskOf)).toEqual(['255.255.255.0', '255.255.252.0', '255.255.0.0', '0.0.0.0', '255.255.255.255']);
  });

  it('knows a MAC address and an IP address from other text', () => {
    expect(isMac('02:52:4C:01:00:01')).toBe(true);
    expect(isMac('02:52:4c:01:00:01')).toBe(false);
    expect(isMac('02:52:4C:01:00')).toBe(false);
    expect(isIp('192.168.0.1')).toBe(true);
    expect(isIp('192.168.0.256')).toBe(false);
    expect(isIp('192.168.0')).toBe(false);
  });

  it('says a DNS job speaks UDP on port 53 and any other job HTTPS on TCP 443', () => {
    expect(serviceOf('#7 dns')).toEqual({ proto: 'UDP', port: 53, name: 'DNS' });
    expect(serviceOf('#8 hash')).toEqual({ proto: 'TCP', port: 443, name: 'HTTPS' });
    expect(serviceOf('nonsense')).toEqual({ proto: 'TCP', port: 443, name: 'HTTPS' });
  });
});

describe('the addresses of the game', () => {
  it('has none without a network block, and the same object for the same snapshot', () => {
    expect(netAddrs(null)).toBeNull();
    expect(netAddrs(undefined)).toBeNull();
    const s = game(1);
    expect(netAddrs(s)).toBe(netAddrs(s));
  });

  it('makes a bigger LAN for each faster router, the router at the first address and the pool from 100', () => {
    const lans = [1, 2, 3, 4].map((t) => netAddrs(game(t))!.lan!);
    expect(lans.map((l) => `${l.ip}/${l.prefix}`)).toEqual(['192.168.0.1/24', '192.168.1.1/24', '10.10.0.1/22', '10.0.0.1/16']);
    expect(lans.map((l) => l.mask)).toEqual(['255.255.255.0', '255.255.255.0', '255.255.252.0', '255.255.0.0']);
    expect(lans.map((l) => l.net)).toEqual(['192.168.0.0', '192.168.1.0', '10.10.0.0', '10.0.0.0']);
    expect(lans.map((l) => l.broadcast)).toEqual(['192.168.0.255', '192.168.1.255', '10.10.3.255', '10.0.255.255']);
    expect(lans.map((l) => l.pool)).toEqual([
      { first: '192.168.0.100', last: '192.168.0.199' }, { first: '192.168.1.100', last: '192.168.1.199' }, { first: '10.10.0.100', last: '10.10.0.199' }, { first: '10.0.0.100', last: '10.0.0.199' },
    ]);
    for (const l of lans) { expect(isIp(l.ip)).toBe(true); expect(isMac(l.mac)).toBe(true); expect(l.lease).toBe('24 h'); }
  });

  it('gives the PC the first address of the pool, its gateway and its name server being the router, while its link is up', () => {
    const a = netAddrs(game(3))!;
    expect(a.host).toEqual({ iface: 'eth0', mac: a.pc!.mac, ip: '10.10.0.100', prefix: 22, mask: '255.255.252.0', gateway: '10.10.0.1', dns: '10.10.0.1', lease: '24 h' });
    expect(a.pc!.ip).toBe('10.10.0.100');
    expect(a.arp.host).toEqual([{ ip: '10.10.0.1', mac: a.lan!.mac, what: 'the router' }]);
    expect(a.arp.lan).toEqual([{ ip: '10.10.0.100', mac: a.host!.mac, what: 'the PC' }]);
  });

  it('gives no lease with no cable, the machine off or no router; no public address with no plan', () => {
    expect(netAddrs(game(2, { port: null }))!.host).toBeNull();
    expect(netAddrs(game(2, { port: null }))!.pc).toBeNull();
    expect(netAddrs(game(2, { on: false }))!.host).toBeNull();
    const noRouter = snap({ net: { ...snap().net!, router: null } });
    expect(netAddrs(noRouter)!.lan).toBeNull();
    expect(netAddrs(noRouter)!.wan).toBeNull();
    expect(netAddrs(noRouter)!.router).toBeNull();
    const d = netAddrs(game(2, { plan: false }))!;
    expect(d.wan).toBeNull();
    expect(d.router!.wan).toBe('02:52:4C:02:00:01');
    expect(d.arp.wan).toEqual([]);
    expect(d.host!.ip).toBe('192.168.1.100');
  });

  it('puts the WAN side in a documentation block, the plan\'s gateway at 1 and its name servers at 53 and 54', () => {
    const w = netAddrs(game(2))!.wan!;
    expect(w.ip).toMatch(/^203\.0\.113\.(10[1-9]|1[1-9]\d|200)$/);
    expect(w.prefix).toBe(24);
    expect(w.mask).toBe('255.255.255.0');
    expect(w.gateway.ip).toBe('203.0.113.1');
    expect(w.dns).toEqual(['203.0.113.53', '203.0.113.54']);
    expect(isMac(w.gateway.mac)).toBe(true);
    expect(netAddrs(game(2))!.arp.wan).toEqual([w.gateway]);
    // (a plan of another tier gets another address)
    const other = snap({ ...game(2), net: { ...game(2).net!, isp: { id: 'isp1', name: 'Dial-up', downMbps: 1, upMbps: 1, clients: 1 } } });
    expect(netAddrs(other)!.wan!.ip).not.toBe(w.ip);
  });

  it('names the router\'s two jacks, the plan\'s gateway and the board with MAC addresses in the locally administered range, one for each', () => {
    const a = netAddrs(game(4))!;
    const all = [a.router!.wan, a.router!.lan, a.wan!.gateway.mac, a.pc!.mac, ...a.ifaces.map((i) => i.mac)];
    for (const m of all) { expect(isMac(m), m).toBe(true); }
    expect(a.router).toEqual({ wan: '02:52:4C:04:00:01', lan: '02:52:4C:04:00:02' });
    expect(a.lan!.mac).toBe(a.router!.lan);
    expect(a.wan!.mac).toBe(a.router!.wan);
    expect(new Set([a.router!.wan, a.router!.lan, a.wan!.gateway.mac, a.pc!.mac]).size).toBe(4);
    // (the two of the router and the gateway's are in the locally administered range: the second hex digit is 2)
    for (const m of [a.router!.wan, a.router!.lan, a.wan!.gateway.mac]) expect(m[1]).toBe('2');
  });

  it('lists the PC\'s jacks (the board\'s, then the cards\') and gives the address to the one the cable is in', () => {
    const board = netAddrs(game(1, { port: 'board' }))!, nic = netAddrs(game(1, { port: 'nic' }))!;
    expect(board.ifaces.map((i) => i.id)).toEqual(['eth0', 'eth1']);
    expect(board.ifaces.map((i) => i.plugged)).toEqual([true, false]);
    expect(board.ifaces.map((i) => i.ip)).toEqual(['192.168.0.100', null]);
    expect(nic.ifaces.map((i) => i.plugged)).toEqual([false, true]);
    expect(nic.pc!.id).toBe('eth1');
    // (a card's MAC is the one burnt in its flash)
    expect(nic.pc!.mac).toBe('00:1B:21:3A:7C:4F');
    expect(nic.host!.mac).toBe('00:1B:21:3A:7C:4F');
    expect(ifaceOf(nic, 'nic9')!.id).toBe('eth1');
    expect(ifaceOf(nic, 'board')!.id).toBe('eth0');
    expect(ifaceOf(nic, 'nope')).toBeUndefined();
    expect(ifaceOf(null, 'board')).toBeUndefined();
  });
});

describe('the connections in flight', () => {
  const flows = [flow(5, 'down', '#5 hash'), flow(6, 'down', '#6 dns'), flow(4, 'up', '#4 log')];

  it('makes one for each transfer, from the PC\'s private address to the public one the router made of it and the server\'s', () => {
    const a = netAddrs(game(2, { flows }))!;
    expect(a.conns.map((c) => [c.jobId, c.dir])).toEqual([[5, 'down'], [6, 'down'], [4, 'up']]);
    for (const c of a.conns) {
      expect(c.lan.ip).toBe('192.168.1.100');
      expect(c.wan.ip).toBe(a.wan!.ip);
      expect(c.lan.port).toBeGreaterThanOrEqual(49152);
      expect(c.lan.port).toBeLessThan(65536);
      expect(c.wan.port).toBeGreaterThanOrEqual(1024);
      expect(c.wan.port).toBeLessThan(49152);
      expect(c.server.ip).toMatch(/^198\.51\.100\.\d+$/);
      expect(c.server.port).toBe(c.service.port);
    }
    expect(a.conns.map((c) => `${c.service.proto}/${c.service.port}`)).toEqual(['TCP/443', 'UDP/53', 'TCP/443']);
  });

  it('keeps each connection the same in every snapshot and apart from the others', () => {
    const a = netAddrs(game(2, { flows }))!, b = netAddrs(game(2, { flows: [flows[1]!, flows[0]!, flows[2]!] }))!;
    expect(b.conns.find((c) => c.jobId === 5)).toEqual(a.conns.find((c) => c.jobId === 5));
    expect(new Set(a.conns.map((c) => c.lan.port)).size).toBe(3);
    // (a job's download and upload are two connections)
    const both = netAddrs(game(2, { flows: [flow(5, 'down', '#5 hash'), flow(5, 'up', '#5 hash')] }))!;
    expect(both.conns[0]!.lan.port).not.toBe(both.conns[1]!.lan.port);
    expect(both.conns[0]!.server.ip).toBe(both.conns[1]!.server.ip);
  });

  it('has none with no lease or no public address', () => {
    expect(netAddrs(game(2, { flows, port: null }))!.conns).toEqual([]);
    expect(netAddrs(game(2, { flows, plan: false }))!.conns).toEqual([]);
  });

  it('writes the headers a frame carries on each wire: the MACs change at each wire, the IP addresses at the router only', () => {
    const a = netAddrs(game(2, { flows }))!, c = a.conns[0]!;
    const lanIn = frameOn(a, c, 'lan', true)!, wanIn = frameOn(a, c, 'wan', true)!, lanOut = frameOn(a, c, 'lan', false)!, wanOut = frameOn(a, c, 'wan', false)!;
    // a download's data, on the WAN wire: from the plan's gateway to the router's WAN jack, from the server to the public address
    expect([wanIn.srcMac, wanIn.dstMac]).toEqual([a.wan!.gateway.mac, a.router!.wan]);
    expect([wanIn.src, wanIn.dst]).toEqual([c.server, c.wan]);
    // then on the LAN wire: from the router's LAN side to the PC, from the server to the PC's private address
    expect([lanIn.srcMac, lanIn.dstMac]).toEqual([a.router!.lan, a.host!.mac]);
    expect([lanIn.src, lanIn.dst]).toEqual([c.server, c.lan]);
    // an upload goes the other way
    expect([lanOut.srcMac, lanOut.dstMac]).toEqual([a.host!.mac, a.router!.lan]);
    expect([lanOut.src, lanOut.dst]).toEqual([c.lan, c.server]);
    expect([wanOut.srcMac, wanOut.dstMac]).toEqual([a.router!.wan, a.wan!.gateway.mac]);
    expect([wanOut.src, wanOut.dst]).toEqual([c.wan, c.server]);
    expect(frameOn(netAddrs(game(2, { flows, port: null }))!, c, 'lan', true)).toBeNull();
  });
});
