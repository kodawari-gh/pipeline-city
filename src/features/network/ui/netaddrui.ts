// USB fallback and address models for the network panel (docs/UI.md "Network").

import type { Snapshot } from '@/worker/game/game';
import { isProxied, natLine, netAddrs } from '../render/plan/netaddr';
import * as uiLogic from '@/core/ui/logic';

export interface UsbModel {
  state: 'retired' | 'waiting' | 'fallback';
  text: string;
  detail: string | null;
  level: uiLogic.ChipLevel;
  countdown: number | null;
}

/** One place on the path that has an address: its name, its IP address (null: none now), its MAC and the words that say where the address comes from. */
export interface AddrRow {
  id: 'pc' | 'lan' | 'wan' | 'gateway';
  label: string;
  ip: string | null;
  mac: string;
  note: string;
}
/** One line of the router's NAT table: the job, what it speaks, the server's end, the two ports the router swaps (the PC's and its own) and the whole line for a tooltip. */
export interface NatRow {
  key: string;
  label: string;
  proto: 'TCP' | 'UDP';
  server: string;
  ports: string;
  line: string;
}
/** The addresses of the panel (`netAddrs`): the places on the path from the PC to the ISP, and the NAT table of the jobs in flight. Both are empty with nothing to name. */
export interface AddrModel {
  rows: AddrRow[];
  nat: NatRow[];
}

export function usbModel(s: Snapshot): UsbModel | null {
  const f = s.net.usbFallback;
  switch (f.state) {
    case 'off': {
      return null;
    }
    case 'retired': {
      return {
        state: 'retired',
        text: 'USB keys retired',
        level: 'idle',
        countdown: null,
        detail:
          s.net.retiredKeys > 0
            ? `${s.net.retiredKeys} leftover key${s.net.retiredKeys === 1 ? '' : 's'} expire without penalty`
            : 'clients send jobs over the wire now',
      };
    }
    case 'waiting': {
      return {
        state: 'waiting',
        text: f.startsIn === null ? 'Keys return soon' : `Keys return in ${uiLogic.fmtTicks(f.startsIn)}`,
        level: 'warn',
        countdown: f.startsIn,
        detail: 'the link is down; after 5 minutes clients send keys again at a third of the rate',
      };
    }
    case 'fallback': {
      return {
        state: 'fallback',
        text: 'Keys are back at 1/3 rate',
        level: 'warn',
        countdown: null,
        detail: 'offers are paused until the link is up',
      };
    }
    default: {
      return null;
    }
  }
}

/** Why the PC has no IP address while its cable is in a jack: the first thing the link law (`linkOf`) lacks. */
function noAddressWhy(s: Snapshot): string {
  if (!s.net.router) {
    return 'no router to give it an address';
  }
  if (!s.powered || s.power.tripped) {
    return 'the machine is off: the address comes with the link';
  }
  return 'the port does not work: the address comes with the link';
}

/**
 * The addresses of the panel, in the order data goes: the PC (the jack the cable is in), the router's LAN side, its WAN side and the ISP's gateway. A place that does not stand (no
 * router, no plan, no cable) has no row. The PC has its MAC as soon as the cable is in a jack; its IP address only while the link is up.
 */
function pcAddrRow(
  pc: NonNullable<NonNullable<ReturnType<typeof netAddrs>>['pc']>,
  a: NonNullable<ReturnType<typeof netAddrs>>,
  s: Snapshot,
): AddrRow {
  return {
    id: 'pc',
    label: `PC · ${pc.id}`,
    ip: a.host ? `${a.host.ip}/${a.host.prefix}` : null,
    mac: pc.mac,
    note: a.host
      ? `The router's DHCP gave it this address for ${a.host.lease}. Gateway and name server ${a.host.gateway}, mask ${a.host.mask}.`
      : noAddressWhy(s),
  };
}

function addrRows(a: NonNullable<ReturnType<typeof netAddrs>>, s: Snapshot): AddrRow[] {
  const rows: AddrRow[] = [];
  if (a.pc) {
    rows.push(pcAddrRow(a.pc, a, s));
  }
  if (a.lan) {
    rows.push({
      id: 'lan',
      label: 'Router · LAN',
      ip: `${a.lan.ip}/${a.lan.prefix}`,
      mac: a.lan.mac,
      note: `The PC's gateway and name server. Its DHCP gives out ${a.lan.pool.first} to ${a.lan.pool.last} for ${a.lan.lease}.`,
    });
  }
  if (a.wan) {
    rows.push(
      {
        id: 'wan',
        label: 'Router · WAN',
        ip: `${a.wan.ip}/${a.wan.prefix}`,
        mac: a.wan.mac,
        note: "The public address the plan gave. NAT swaps the PC's address and port for this one on the way out.",
      },
      {
        id: 'gateway',
        label: 'ISP gateway',
        ip: a.wan.gateway.ip,
        mac: a.wan.gateway.mac,
        note: `The first hop on the plan's line. Name servers ${a.wan.dns.join(' and ')}: the router asks them for the PC.`,
      },
    );
  }
  return rows;
}

function natRows(a: NonNullable<ReturnType<typeof netAddrs>>): NatRow[] {
  return a.conns.map((c) => ({
    key: `${c.jobId}${c.dir}`,
    label: `${c.dir === 'down' ? 'down' : 'up'} ${c.label}`,
    proto: c.service.proto,
    server: `${c.server.ip}:${c.server.port}`,
    // (a DNS query stops at the router's resolver: the router asks the name server itself, from its own port)
    ports: isProxied(c)
      ? `PC :${c.lan.port} > router :${c.peer.port} | router :${c.wan.port} > name server`
      : `PC :${c.lan.port} > router :${c.wan.port}`,
    line: natLine(c),
  }));
}

export function addressModel(s: Snapshot): AddrModel {
  const a = netAddrs(s);
  if (!a) {
    return { rows: [], nat: [] };
  }
  return { rows: addrRows(a, s), nat: natRows(a) };
}
