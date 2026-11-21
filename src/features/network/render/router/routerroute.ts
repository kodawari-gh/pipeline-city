import type { RouterLink, RouterPlan } from './routerplan';

// The way a frame goes through the router's SoC, as the wires of its floorplan (the router's counterpart of nic/nicroute.ts). A frame that comes in goes from the WAN MAC to the forwarding
// engine, which finds the client it is for, then to the LAN switch, whose ports leave the chip; a frame to send goes the other way. Pure geometry on the plan, so it is testable; the
// die's view sends packets along it (routerview.ts) at the rate of the frames the link really carries.

/** One wire on the way, and whether the packet runs it against its direction. */
export interface RouterHop { link: RouterLink; reverse: boolean }

/** `rx`: a frame for the PC (a download, from the WAN to the LAN); `tx`: a frame from the PC (an upload, from the LAN to the WAN). */
export type RouterDir = 'rx' | 'tx';

/** The wires of each way, in the order a frame meets them (`true`: the wire is run from its `to` end to its `from` end). */
const WAYS: Record<RouterDir, [id: string, reverse: boolean][]> = {
  rx: [['wanmac-pkt', false], ['pkt-sw', false]],
  tx: [['pkt-sw', true], ['wanmac-pkt', true]],
};

/** The blocks each way goes through, in order (the glow of the view follows them). */
export const BLOCKS: Record<RouterDir, string[]> = {
  rx: ['wanmac', 'pkt', 'sw'],
  tx: ['sw', 'pkt', 'wanmac'],
};

/** The links a frame running the way `dir` takes, in order. */
export function routerRoute(plan: Pick<RouterPlan, 'links'>, dir: RouterDir): RouterHop[] {
  const out: RouterHop[] = [];
  for (const [id, reverse] of WAYS[dir]) { const link = plan.links.find((l) => l.id === id); if (link) out.push({ link, reverse }); }
  return out;
}
