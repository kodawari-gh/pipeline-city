import type { RouterLink, RouterPlan } from './routerplan';

// The way a frame goes through the router, as the wires of its floorplan (the router's counterpart of nic/nicroute.ts). A frame that comes in goes from the WAN jack through the
// magnetics and the PHY to the forwarding engine, which finds the client it is for, then through the LAN switch, the LAN PHY and the magnetics out of the LAN jack to the PC; a
// frame to send goes the other way. Pure geometry on the plan, so it is testable; the router's view sends packets along it (routerview.ts) at the rate of the frames the link really carries.

/** One wire on the way, and whether the packet runs it against its direction. */
export interface RouterHop { link: RouterLink; reverse: boolean }

/** `rx`: a frame for the PC (a download, from the WAN to the LAN); `tx`: a frame from the PC (an upload, from the LAN to the WAN). */
export type RouterDir = 'rx' | 'tx';

/** The wires of each way, in the order a frame meets them (`true`: the wire is run from its `to` end to its `from` end). */
const WAYS: Record<RouterDir, [id: string, reverse: boolean][]> = {
  rx: [['wan-mag', false], ['wan-phy', false], ['wan-pkt', false], ['pkt-sw', false], ['sw-lan', false], ['lan-mag', false], ['lan-jack', false]],
  tx: [['lan-jack', true], ['lan-mag', true], ['sw-lan', true], ['pkt-sw', true], ['wan-pkt', true], ['wan-phy', true], ['wan-mag', true]],
};

/** The blocks each way goes through, in order (the glow of the view follows them). */
export const BLOCKS: Record<RouterDir, string[]> = {
  rx: ['wanjack', 'wanmag', 'wanphy', 'pkt', 'sw', 'lanphy', 'lanmag', 'lanjack'],
  tx: ['lanjack', 'lanmag', 'lanphy', 'sw', 'pkt', 'wanphy', 'wanmag', 'wanjack'],
};

/** The links a frame running the way `dir` takes, in order. */
export function routerRoute(plan: Pick<RouterPlan, 'links'>, dir: RouterDir): RouterHop[] {
  const out: RouterHop[] = [];
  for (const [id, reverse] of WAYS[dir]) { const link = plan.links.find((l) => l.id === id); if (link) out.push({ link, reverse }); }
  return out;
}
