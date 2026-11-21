import type { NicLink, NicPlan } from './nicplan';

// The way a frame goes through the card, as the wires of its floorplan (the card's counterpart of tpm/tpmroute.ts and gpu/gpuroute.ts). A frame that comes in goes
// from the jack through the magnetics and the PHY to the MAC, into the receive queue, over the DMA engine and the PCIe core out to the host; a frame to send goes the
// other way, from the host through the PCIe core and the DMA engine to the transmit queue, the MAC, the PHY and the magnetics out of the jack. Pure geometry on the
// plan, so it is testable; the card's view sends packets along it (nicview.ts) at the rate of the frames the port really carries.

/** One wire on the way, and whether the packet runs it against its direction. */
export interface NicHop { link: NicLink; reverse: boolean }

export type NicDir = 'rx' | 'tx';

/** The wires of each way, in the order a frame meets them (`true`: the wire is run from its `to` end to its `from` end). */
const WAYS: Record<NicDir, [id: string, reverse: boolean][]> = {
  rx: [['jack-mag', false], ['mag-phy', false], ['phy-mac', false], ['mac-rxq', false], ['rxq-dma', false], ['dma-pcie', false], ['pcie-host', false]],
  tx: [['pcie-host', true], ['dma-pcie', true], ['txq-dma', true], ['mac-txq', true], ['phy-mac', true], ['mag-phy', true], ['jack-mag', true]],
};

/** The blocks each way goes through, in order (the glow of the view follows them). */
export const BLOCKS: Record<NicDir, string[]> = {
  rx: ['jack', 'mag', 'phy', 'mac', 'rxq', 'dma', 'pcie'],
  tx: ['pcie', 'dma', 'txq', 'mac', 'phy', 'mag', 'jack'],
};

/** The links a frame running the way `dir` takes, in order. */
export function nicRoute(plan: Pick<NicPlan, 'links'>, dir: NicDir): NicHop[] {
  const out: NicHop[] = [];
  for (const [id, reverse] of WAYS[dir]) { const link = plan.links.find((l) => l.id === id); if (link) out.push({ link, reverse }); }
  return out;
}
