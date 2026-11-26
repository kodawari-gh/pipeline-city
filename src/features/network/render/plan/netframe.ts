// Frame headers and NAT lines for a connection (docs/render/net.md "Addresses").

import type { Conn, NetAddrs } from './netaddr';

/**
 * The headers a connection's frames carry on one wire, for a frame going `toward` the PC (a download's data) or away from it: the Ethernet addresses of the two jacks that wire joins, the IP
 * addresses (the PC's private one on the LAN, the router's public one on the WAN: the NAT) and the ports. The MACs change at each wire, the IPs at the router only.
 */
export interface Frame {
  srcMac: string;
  dstMac: string;
  src: Endpoint;
  dst: Endpoint;
}

interface Endpoint {
  ip: string;
  port: number;
}

export function frameOn(opts: { addrs: NetAddrs; conn: Conn; wire: 'lan' | 'wan'; toward: boolean }): Frame | null {
  const { addrs: a, conn: c, wire, toward } = opts;
  if (!a.host || !a.lan || !a.wan) {
    return null;
  }
  const mine = wire === 'lan' ? c.lan : c.wan,
    far = wire === 'lan' ? c.peer : c.server,
    near = wire === 'lan' ? { mac: a.host.mac, peer: a.lan.mac } : { mac: a.wan.mac, peer: a.wan.gateway.mac };
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
export const natLine = (c: Conn): string =>
  isProxied(c)
    ? `${c.service.proto} ${c.lan.ip}:${c.lan.port} > ${c.peer.ip}:${c.peer.port} | ${c.wan.ip}:${c.wan.port} > ${c.server.ip}:${c.server.port}`
    : `${c.service.proto} ${c.lan.ip}:${c.lan.port} > ${c.wan.ip}:${c.wan.port} > ${c.server.ip}:${c.server.port}`;
