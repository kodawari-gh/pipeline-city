// Words for the network ids (docs/NETWORK.md, docs/RENDER.md "Network"): router, wall, cable.lan, the jacks and the
// router and plan specs. Pure. It imports nothing from logic.ts (logic.ts imports this), so the formatters live here.

import { getSpec, type NicSpec } from '../sim/board/specs';
import type { Snapshot } from '../sim/game/game';
import { getIspSpec, getRouterSpec } from '../sim/net/specs';
import type { Description } from './regions';

/** Speed in words: 100 Mbit, 1 Gbit, 1.5 Gbit, 40 Gbit. (Per second is implied; tooltips say Mbit/s.) */
export function fmtMbit(n: number): string {
  if (!Number.isFinite(n)) return '-';
  if (n >= 1000) {
    const g = n / 1000;
    return `${Number.isInteger(g) ? g : g.toFixed(1)} Gbit`;
  }
  return `${Number.isInteger(n) ? n : n.toFixed(1)} Mbit`;
}

/** The nerd line every network description ends with: what bandwidth is and how the effective speed is found. */
export const BANDWIDTH_NERD = 'Bandwidth is how many megabits move per second (Mbit/s; a game MB is 8 Mbit). Effective speed is the slowest link of port, router, plan and the drive. Clients at once is the smaller of router and plan.';

/** The jack ids: `eth0` is the board's, `eth1`.. are network cards in PCIe slot order. */
export const isJackId = (id: string): boolean => /^eth\d+$/.test(id);

/** The ids of the jacks the machine has now: `eth0` when the board has one, then `eth1`.. for each card (the renderer's ids). */
export function jackIds(s: Snapshot): string[] {
  return [...(s.board.features.ethernetMbps > 0 ? ['eth0'] : []), ...nicsInOrder(s).map((_, i) => `eth${i + 1}`)];
}

/** The network cards in PCIe slot order (the lowest slot is `eth1`). */
export function nicsInOrder(s: Snapshot) {
  const num = (slot: string) => Number(/(\d+)$/.exec(slot)?.[1] ?? 0);
  return s.devices.filter((d) => d.kind === 'nic').sort((a, b) => num(a.slot) - num(b.slot));
}

/** The `connectCable("lan", port)` argument for a jack id (`board` or the card's device id), or null for an unknown jack. */
export function jackPort(s: Snapshot, id: string): { port: string; mbps: number; label: string; burnt: boolean } | null {
  const m = /^eth(\d+)$/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  if (n === 0) {
    const mbps = s.board.features.ethernetMbps;
    return mbps > 0 ? { port: 'board', mbps, label: 'Board jack', burnt: s.board.burnt } : null;
  }
  const d = nicsInOrder(s)[n - 1];
  if (!d) return null;
  const spec = getSpec(d.spec) as NicSpec | undefined;
  return { port: d.id, mbps: spec?.mbps ?? 0, label: `${d.name} jack`, burnt: d.burnt };
}

const PLAN_NOTE = 'You buy a plan once, there is no bill. A better plan replaces it (no refund).';

/** Description of a network id, or null when the id is not one of ours. */
export function describeNet(id: string, s?: Snapshot | null): Description | null {
  const net = s?.net;
  switch (id) {
    case 'router': {
      const r = net?.router;
      if (!r) {
        return {
          title: 'Router spot',
          plain: 'An empty spot next to the monitor. Drag a router from the inventory here: it works with the computer on and needs no power from your supply.',
          nerd: `Routers: 100 Mbit / 2 clients up to 40 Gbit / 16 clients. ${BANDWIDTH_NERD}`,
        };
      }
      return {
        title: r.name,
        plain: 'Your router. It stands next to the monitor with its own power, so it stays on when the computer is off. It caps how fast the network port can run and how many clients can send you work at once.',
        nerd: `${r.mbps} Mbit/s port speed, ${r.clients} clients at once, wall powered. ${BANDWIDTH_NERD}`,
      };
    }
    case 'wall': {
      const p = net?.isp;
      if (!p) {
        return {
          title: 'Internet socket',
          plain: `No internet plan yet. Click to see the plans: the plan sets how fast jobs arrive and results leave, and how many clients can reach you. ${PLAN_NOTE}`,
          nerd: `Plans: 50 / 10 Mbit/s and 2 clients (DSL) up to 20 / 10 Gbit/s and 32 clients. ${BANDWIDTH_NERD}`,
        };
      }
      return {
        title: p.name,
        plain: `Your internet plan, wired to the router. It sets how fast jobs arrive and results leave, and how many clients can reach you at once. ${PLAN_NOTE}`,
        nerd: `${p.downMbps} Mbit/s down, ${p.upMbps} Mbit/s up, ${p.clients} clients at once. ${BANDWIDTH_NERD}`,
      };
    }
    case 'cable.lan': {
      const port = net?.port;
      const where = port?.kind === 'board' ? 'the board jack' : port?.kind === 'nic' ? 'a network card' : null;
      return {
        title: 'Ethernet cable',
        plain: `The cable between the router and a network jack on your machine.${where ? ` It is plugged into ${where}.` : ' Drag its plug onto a jack.'} Unlike the other cables you can plug and unplug it while the computer is on.`,
        nerd: `Uplink ${port && port.mbps > 0 ? `${port.mbps} Mbit/s` : 'none'}. The speed of the jack it is in counts as the port speed. ${BANDWIDTH_NERD}`,
      };
    }
    default:
  }
  if (isJackId(id)) {
    if (id === 'eth0') {
      const mbps = s ? s.board.features.ethernetMbps : 0;
      return {
        title: 'Board network jack',
        plain: mbps > 0
          ? 'The motherboard\'s own network jack. Plug the ethernet cable into it to reach the router; no extra card is needed.'
          : 'This board has no network jack. Buy a bigger board, or a network card for an expansion slot.',
        nerd: `${mbps > 0 ? `${mbps} Mbit/s` : 'no jack on this tier'}; the Basic and Mainstream boards have 100, the Enthusiast board 1000. ${BANDWIDTH_NERD}`,
      };
    }
    const j = s ? jackPort(s, id) : null;
    return {
      title: j ? j.label : 'Network card jack',
      plain: 'The jack on a network card. Plug the ethernet cable into it: the card\'s speed then replaces the board jack\'s speed.',
      nerd: `${j ? `${j.mbps} Mbit/s` : 'card speed'}; a card above its throttle temperature runs at half speed. ${BANDWIDTH_NERD}`,
    };
  }
  const router = getRouterSpec(id);
  if (router) {
    return {
      title: router.name,
      plain: 'A router for the spot next to the monitor. It has its own power, goes in with the computer on, and decides how fast and how many clients you can serve.',
      nerd: `tier ${router.tier} | ${router.mbps} Mbit/s port speed, ${router.clients} clients at once | wall powered, no heat | ${BANDWIDTH_NERD}`,
    };
  }
  const isp = getIspSpec(id);
  if (isp) {
    return {
      title: `${isp.name} plan`,
      plain: `An internet plan, applied the moment you buy it. It sets how fast jobs arrive and results leave and how many clients can reach you. ${PLAN_NOTE}`,
      nerd: `tier ${isp.tier} | ${isp.downMbps} Mbit/s down, ${isp.upMbps} Mbit/s up, ${isp.clients} clients at once | ${BANDWIDTH_NERD}`,
    };
  }
  return null;
}
