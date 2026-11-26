// Words for the network ids (docs/NETWORK.md, docs/render/net.md "Network"): router, wall, cable.lan, the jacks and the
// router and plan specs. Pure. It imports nothing from logic.ts (logic.ts imports this), so the formatters live here.

import * as boardSpecs from '../../board/sim/specs';
import type { Snapshot } from '@/worker/game/game';
import { getIspSpec, getRouterSpec } from '../sim/specs';
import * as netaddr from '../render/plan/netaddr';
import type { Description } from '@/core/ui/regions';
import { fmtMbit } from './fmt';
import { describeNicId } from './nicdesc';
import { describeRouterId } from './routerdesc';

export { fmtMbit };

/** The nerd line every network description ends with: what bandwidth is and how the effective speed is found. */
export const BANDWIDTH_NERD =
  'Bandwidth is how many megabits move per second (Mbit/s; a game MB is 8 Mbit). Effective speed is the slowest link of port, router, plan and the drive. Clients at once is the smaller of router and plan.';

/** The jack ids: `eth0` is the board's, `eth1`.. are network cards in PCIe slot order. */
export const isJackId = (id: string): boolean => /^eth\d+$/u.test(id);

/** The network cards in PCIe slot order (the lowest slot is `eth1`). */
export function nicsInOrder(s: Snapshot) {
  const num = (slot: string) => Number(/(?<num>\d+)$/u.exec(slot)?.[1] ?? 0);
  return s.devices.filter((d) => d.kind === 'nic').sort((a, b) => num(a.slot) - num(b.slot));
}

/** The `connectCable("lan", port)` argument for a jack id (`board` or the card's device id), or null for an unknown jack. */
export function jackPort(
  s: Snapshot,
  id: string,
): { port: string; mbps: number; label: string; burnt: boolean } | null {
  const m = /^eth(?<num>\d+)$/u.exec(id);
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  if (n === 0) {
    const mbps = s.board.features.ethernetMbps;
    return mbps > 0 ? { port: 'board', mbps, label: 'Board jack', burnt: s.board.burnt } : null;
  }
  const d = nicsInOrder(s)[n - 1];
  if (!d) {
    return null;
  }
  const spec = boardSpecs.getSpec(d.spec) as boardSpecs.NicSpec | undefined;
  return { port: d.id, mbps: spec?.mbps ?? 0, label: `${d.name} jack`, burnt: d.burnt };
}

const PLAN_NOTE = 'You buy a plan once, there is no bill. A better plan replaces it (no refund).';

/** The router's two sides as words: the LAN address and the MAC of each side (the WAN only with a plan on the line). Empty with no router. */
function routerAddrs(a: netaddr.NetAddrs | null): string {
  if (!a?.lan) {
    return '';
  }
  const wan = a.wan ? `, WAN ${a.wan.ip}/${a.wan.prefix} (MAC ${a.wan.mac})` : '';
  return ` Addresses: LAN ${a.lan.ip}/${a.lan.prefix} (MAC ${a.lan.mac})${wan}.`;
}

/** What a jack of the PC has as words: its MAC address, and its IP address while the cable is in it and the link is up. */

function ifaceAddrWords(i: netaddr.Iface): string {
  if (!i.plugged) {
    return 'the cable is not in it: no IP address';
  }
  if (i.ip !== null && i.ip !== '') {
    return `IP ${i.ip} (the router's DHCP gave it)`;
  }
  return 'no IP address until the link is up';
}

function lanPortWhere(kind: string | undefined): string | null {
  if (kind === 'board') {
    return 'the board jack';
  }
  if (kind === 'nic') {
    return 'a network card';
  }
  return null;
}

function jackAddrs(i: netaddr.Iface | undefined): string {
  if (!i) {
    return '';
  }
  return ` | MAC ${i.mac} | ${ifaceAddrWords(i)}`;
}

/** Description of a network id, or null when the id is not one of ours. */
interface NetDescCtx {
  net: Snapshot['net'] | undefined;
  a: ReturnType<typeof netaddr.netAddrs>;
  s: Snapshot | null | undefined;
}

function describeNetRouter(ctx: NetDescCtx): Description {
  const r = ctx.net?.router;
  if (!r) {
    return {
      title: 'Router spot',
      plain:
        'An empty spot next to the monitor. Drag a router from the inventory here: it works with the computer on and needs no power from your supply.',
      nerd: `Routers: 100 Mbit / 2 clients up to 40 Gbit / 16 clients. ${BANDWIDTH_NERD}`,
    };
  }
  return {
    title: r.name,
    plain:
      'Your router. It stands next to the monitor with its own power, so it stays on when the computer is off. It caps how fast the network port can run and how many clients can send you work at once. It gives your machine its address (DHCP) and swaps your private address for its public one on the way out (NAT).',
    nerd: `${r.mbps} Mbit/s port speed, ${r.clients} clients at once, wall powered.${routerAddrs(ctx.a)} ${BANDWIDTH_NERD}`,
  };
}

function describeNetWall(ctx: NetDescCtx): Description {
  const plan = ctx.net?.isp;
  if (!plan) {
    return {
      title: 'Internet socket',
      plain: `No internet plan yet. Click to see the plans: the plan sets how fast jobs arrive and results leave, and how many clients can reach you. ${PLAN_NOTE}`,
      nerd: `Plans: 50 / 10 Mbit/s and 2 clients (DSL) up to 20 / 10 Gbit/s and 32 clients. ${BANDWIDTH_NERD}`,
    };
  }
  const line = ctx.a?.wan
    ? ` The line: the ISP's gateway ${ctx.a.wan.gateway.ip} (MAC ${ctx.a.wan.gateway.mac}), name servers ${ctx.a.wan.dns.join(' and ')}, your router's public address ${ctx.a.wan.ip}.`
    : '';
  return {
    title: plan.name,
    plain: `Your internet plan, wired to the router. It sets how fast jobs arrive and results leave, and how many clients can reach you at once. ${PLAN_NOTE}`,
    nerd: `${plan.downMbps} Mbit/s down, ${plan.upMbps} Mbit/s up, ${plan.clients} clients at once.${line} ${BANDWIDTH_NERD}`,
  };
}

function describeNetCable(ctx: NetDescCtx): Description {
  const port = ctx.net?.port;
  const where = lanPortWhere(port?.kind ?? undefined);
  const end = ctx.a?.pc
    ? ` The PC's end: ${ctx.a.pc.id}, MAC ${ctx.a.pc.mac}${ctx.a.pc.ip !== null && ctx.a.pc.ip !== '' ? `, IP ${ctx.a.pc.ip}` : ', no IP address until the link is up'}.`
    : '';
  return {
    title: 'Ethernet cable',
    plain: `The cable between the router and a network jack on your machine.${where !== null && where !== '' ? ` It is plugged into ${where}.` : ' Drag its plug onto a jack.'} Unlike the other cables you can plug and unplug it while the computer is on.`,
    nerd: `Uplink ${port && port.mbps > 0 ? `${port.mbps} Mbit/s` : 'none'}. The speed of the jack it is in counts as the port speed.${end} ${BANDWIDTH_NERD}`,
  };
}

function describeNetBoardJack(ctx: NetDescCtx): Description {
  const mbps = ctx.s ? ctx.s.board.features.ethernetMbps : 0;
  return {
    title: 'Board network jack',
    plain:
      mbps > 0
        ? "The motherboard's own network jack. Plug the ethernet cable into it to reach the router; no extra card is needed. Every jack has its own MAC address, the name the router knows it by."
        : 'This board has no network jack. Buy a bigger board, or a network card for an expansion slot.',
    nerd: `${mbps > 0 ? `${mbps} Mbit/s` : 'no jack on this tier'}${mbps > 0 ? jackAddrs(netaddr.ifaceOf(ctx.a, 'board')) : ''}; the Basic and Mainstream boards have 100, the Enthusiast board 1000. ${BANDWIDTH_NERD}`,
  };
}

function describeNetCardJack(id: string, ctx: NetDescCtx): Description {
  const j = ctx.s ? jackPort(ctx.s, id) : null;
  return {
    title: j ? j.label : 'Network card jack',
    plain:
      "The jack on a network card. Plug the ethernet cable into it: the card's speed then replaces the board jack's speed. The card's MAC address is burnt into its flash.",
    nerd: `${j ? `${j.mbps} Mbit/s${jackAddrs(netaddr.ifaceOf(ctx.a, j.port))}` : 'card speed'}; a card above its throttle temperature runs at half speed. ${BANDWIDTH_NERD}`,
  };
}

function describeNetJack(id: string, ctx: NetDescCtx): Description | null {
  if (!isJackId(id)) {
    return null;
  }
  if (id === 'eth0') {
    return describeNetBoardJack(ctx);
  }
  return describeNetCardJack(id, ctx);
}

function describeNetCatalog(id: string): Description | null {
  const router = getRouterSpec(id);
  if (router) {
    return {
      title: router.name,
      plain:
        'A router for the spot next to the monitor. It has its own power, goes in with the computer on, and decides how fast and how many clients you can serve.',
      nerd: `tier ${router.tier} | ${router.mbps} Mbit/s port speed, ${router.clients} clients at once | wall powered, no heat | ${BANDWIDTH_NERD}`,
    };
  }
  const isp = getIspSpec(id);
  if (!isp) {
    return null;
  }
  return {
    title: `${isp.name} plan`,
    plain: `An internet plan, applied the moment you buy it. It sets how fast jobs arrive and results leave and how many clients can reach you. ${PLAN_NOTE}`,
    nerd: `tier ${isp.tier} | ${isp.downMbps} Mbit/s down, ${isp.upMbps} Mbit/s up, ${isp.clients} clients at once | ${BANDWIDTH_NERD}`,
  };
}

const DESCRIBE_NET: Record<string, (ctx: NetDescCtx) => Description> = {
  router: describeNetRouter,
  wall: describeNetWall,
  'cable.lan': describeNetCable,
};

export function describeNet(id: string, s?: Snapshot | null): Description | null {
  const part = describeNicId(id, s) ?? describeRouterId(id, s);
  if (part) {
    return part;
  }
  const ctx: NetDescCtx = { net: s?.net, a: netaddr.netAddrs(s), s };
  return DESCRIBE_NET[id]?.(ctx) ?? describeNetJack(id, ctx) ?? describeNetCatalog(id);
}
