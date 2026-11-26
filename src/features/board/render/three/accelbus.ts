// Which bus of a graphics card or an AI card a route of the die's plan runs on (the copper's lit runs, `accelcopper.ts`): the host link (`pcie` on a GPU, `host` on an AI card: the slot's receive lines) or the card
// memory (`dram`, `cardmem`: the memory bus), and which way. Pure: the die's views tell the board's live layer the hops they send packets along (`GpuView.onTraffic`), this reads them.

/** A hop of a route: a link between two blocks, run against its direction or with it. */
export interface BusHop {
  link: { from: string; to: string };
  reverse: boolean;
}
export type Bus = 'host' | 'mem';

const HOST = new Set(['pcie', 'host']),
  MEM = new Set(['dram', 'cardmem']);

/**
 * The buses a route crosses, each with its way: `host` 1 inward (from the fingers to the die), `mem` 1 toward the memory die. A link that leaves a host block runs inward, one that reaches a memory block runs
 * toward the memory; a hop run `reverse` the other way.
 */
export function busesOf(hops: readonly BusHop[]): Map<Bus, 1 | -1> {
  const out = new Map<Bus, 1 | -1>();
  for (const h of hops) {
    const flip = h.reverse ? -1 : 1;
    if (HOST.has(h.link.from)) {
      out.set('host', flip as 1 | -1);
    } else if (HOST.has(h.link.to)) {
      out.set('host', -flip as 1 | -1);
    }
    if (MEM.has(h.link.to)) {
      out.set('mem', flip as 1 | -1);
    } else if (MEM.has(h.link.from)) {
      out.set('mem', -flip as 1 | -1);
    }
  }
  return out;
}
