// Address-model types for the network views and words (docs/render/net.md "Addresses").

/** An address and a port: one end of a connection. */
export interface Endpoint {
  ip: string;
  port: number;
}

/** What a job's connection speaks: the protocol, the port the server listens on and its name. */
export interface Service {
  proto: 'TCP' | 'UDP';
  port: number;
  name: string;
}

/** An entry of an ARP table: an IP address, the MAC address it was answered with, and whose it is in words. */
interface Neighbour {
  ip: string;
  mac: string;
  what: string;
}

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
export interface Host {
  iface: string;
  mac: string;
  ip: string;
  prefix: number;
  mask: string;
  gateway: string;
  dns: string;
  lease: string;
}

/** The router's LAN side: its address (the PC's gateway), the network it makes, the pool it hands out and its MAC. */
export interface Lan {
  ip: string;
  prefix: number;
  mask: string;
  net: string;
  broadcast: string;
  mac: string;
  pool: { first: string; last: string };
  lease: string;
}

/** The router's WAN side: the public address the plan gives, the ISP's gateway beyond it, and the ISP's name servers. */
export interface Wan {
  ip: string;
  prefix: number;
  mask: string;
  mac: string;
  gateway: Neighbour;
  dns: string[];
}

/**
 * One connection of a job in flight, at its places: the PC's end on the LAN, the router's end on the WAN (what NAT made of it), and the server's. `peer` is whom the PC addresses on the
 * LAN wire. It is the server itself, except for DNS: the PC asks its resolver, the router (the name server DHCP gave it), and the router asks the ISP's name server from its own address.
 */
export interface Conn {
  jobId: number;
  dir: 'down' | 'up';
  label: string;
  service: Service;
  lan: Endpoint;
  wan: Endpoint;
  peer: Endpoint;
  server: Endpoint;
}

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
