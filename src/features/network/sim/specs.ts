// Network parts as data (docs/NETWORK.md): routers (external props), ISP plans (a one-off account purchase), the job
// sizes per class, the disk's network sink rate and the effective bandwidth rule. NIC cards are device specs
// (board/specs.ts, kind "nic"). ALL NUMBERS ARE PLACEHOLDERS.

export interface RouterSpec {
  id: string;
  tier: number;
  name: string;
  mbps: number;
  clients: number;
  price: number;
  visual: string;
  /** The chance the router loses a segment it forwards (docs/NETSTACK.md 3.5): a cheap one has small buffers and a slow forwarding path. */
  loss: number;
}

export interface IspSpec {
  id: string;
  tier: number;
  name: string;
  downMbps: number;
  upMbps: number;
  clients: number;
  price: number;
  /** The chance the plan's line loses a segment: the basic plans are noisy, a backbone is not. */
  loss: number;
}

export const ROUTER_SPECS: readonly RouterSpec[] = [
  { id: 'router1', tier: 1, name: 'Home router', mbps: 100, clients: 2, price: 60, visual: 'router-home', loss: 0.02 },
  {
    id: 'router2',
    tier: 2,
    name: 'Gigabit router',
    mbps: 1000,
    clients: 4,
    price: 200,
    visual: 'router-gbe',
    loss: 0.005,
  },
  {
    id: 'router3',
    tier: 3,
    name: '10G switch-router',
    mbps: 10000,
    clients: 8,
    price: 700,
    visual: 'router-10g',
    loss: 0.001,
  },
  {
    id: 'router4',
    tier: 4,
    name: 'Edge router',
    mbps: 40000,
    clients: 16,
    price: 2500,
    visual: 'router-core',
    loss: 0.001,
  },
];

export const ISP_SPECS: readonly IspSpec[] = [
  { id: 'isp1', tier: 1, name: 'Basic DSL', downMbps: 50, upMbps: 10, clients: 2, price: 150, loss: 0.02 },
  { id: 'isp2', tier: 2, name: 'Cable', downMbps: 200, upMbps: 50, clients: 4, price: 500, loss: 0.005 },
  { id: 'isp3', tier: 3, name: 'Fibre', downMbps: 1000, upMbps: 300, clients: 8, price: 1500, loss: 0.001 },
  { id: 'isp4', tier: 4, name: 'Business fibre', downMbps: 5000, upMbps: 1500, clients: 16, price: 5000, loss: 0.001 },
  { id: 'isp5', tier: 5, name: 'Backbone', downMbps: 20000, upMbps: 10000, clients: 32, price: 15000, loss: 0.001 },
];

/**
 * The depth of each port's input FIFO, in segments (the chip's packet buffer; docs/NETSTACK.md 3.2): the key is the card's spec id, `board` is the jack on the motherboard. A deeper one rides out
 * a kernel that is busy running a program (the ring is the kernel's 4 slots, the FIFO is on top of it), so a faster card drops fewer segments when the line outruns the CPU.
 */
export const NIC_FIFO: Readonly<Record<string, number>> = { board: 2, nic1: 4, nic2: 8, nic3: 16 };

/** The FIFO depth of the port the cable is in: a card by its spec id, the motherboard's jack for `null`. */
export const fifoSegsOf = (spec: string | null): number => NIC_FIFO[spec ?? 'board'] ?? NIC_FIFO['board']!;

export const getRouterSpec = (id: string): RouterSpec | undefined => ROUTER_SPECS.find((r) => r.id === id);
export const getIspSpec = (id: string): IspSpec | undefined => ISP_SPECS.find((r) => r.id === id);
export const routerByTier = (tier: number): RouterSpec | undefined => ROUTER_SPECS.find((r) => r.tier === tier);
export const ispByTier = (tier: number): IspSpec | undefined => ISP_SPECS.find((r) => r.tier === tier);

/** How fast the OS drive takes the spool writes (game MB scale Mbit/s), by storage spec id. */
export const DISK_NET_MBPS: Readonly<Record<string, number>> = { hdd0: 80, ssd1: 400, nvme2: 2000, raid2: 2000 };

/** Download / upload size (game MB) of a job: by class id; plain `cli` depends on the template type (checksum is bigger). */
/** What each kind of network job moves (game MB): the request that arrives and the answer that goes back. A kind's plan tier follows from these: its slower leg takes about 25 ticks on a Basic DSL, so bigger ones want Cable (tier 2) or Fibre (tier 3). */
export const WEB_SIZES: Readonly<Record<string, { downMB: number; upMB: number }>> = {
  page: { downMB: 4, upMB: 25 },
  api: { downMB: 1, upMB: 1 },
  dns: { downMB: 0.5, upMB: 0.5 },
  form: { downMB: 8, upMB: 4 },
  search: { downMB: 20, upMB: 30 },
  upload: { downMB: 300, upMB: 5 },
  image: { downMB: 40, upMB: 40 },
  video: { downMB: 5, upMB: 600 },
};

export function jobSizes(cls: string, type: string, scale: number): { downMB: number; upMB: number } {
  if (cls === 'web' && WEB_SIZES[type]) return WEB_SIZES[type]!;
  switch (cls) {
    case 'scan':
      return { downMB: 75 * scale, upMB: 2.5 * scale };
    case 'db':
      return { downMB: 400, upMB: 80 };
    case 'web':
      return { downMB: 4, upMB: 25 };
    case 'secure':
      return { downMB: 100, upMB: 10 };
    case 'gpu':
      return { downMB: 2000, upMB: 600 };
    case 'npu':
      return { downMB: 1200, upMB: 40 };
    case 'hpc':
      return { downMB: 3000, upMB: 200 };
    default:
      return { downMB: type === 'checksum' ? 30 : 24, upMB: 2 };
  }
}

export type Binding = 'port' | 'router' | 'isp' | 'disk';

export interface Bandwidth {
  downMbps: number;
  upMbps: number;
  clients: number;
  binding: Binding | null;
}

/** Effective bandwidth: down = min(port, router, isp down, disk); up = min(port, router, isp up); clients = min(router, isp). */
export function bandwidth(
  portMbps: number,
  router: RouterSpec | null,
  isp: IspSpec | null,
  diskMbps: number,
): Bandwidth {
  if (!router || !isp || portMbps <= 0) return { downMbps: 0, upMbps: 0, clients: 0, binding: null };
  const lim: [Binding, number][] = [
    ['port', portMbps],
    ['router', router.mbps],
    ['isp', isp.downMbps],
    ['disk', diskMbps],
  ];
  let best = lim[0]!;
  for (const l of lim) if (l[1] < best[1]) best = l;
  return {
    downMbps: best[1],
    upMbps: Math.min(portMbps, router.mbps, isp.upMbps),
    clients: Math.min(router.clients, isp.clients),
    binding: best[0],
  };
}

/** Link tuning (placeholders). */
export const NET = {
  /** RAM the network stack needs on top of the OS's own: none. The board's jack does the work and the OS fetches packets when it wants. */
  minRamBytes: 0,
  /** Dead-link ticks before USB keys come back, and their rate while they do. */
  usbFallbackTicks: 300,
  usbFallbackMul: 1 / 3,
  /** Offers whose age falls in the same band of this many ticks are admitted web first, then oldest first; an older band always goes before a younger one. */
  ageBandTicks: 60,
  /** What a frame on the wire carries (an Ethernet frame's payload, the MTU), in bytes: the frames the port sends and receives are counted from the bytes the transfers move. */
  frameBytes: 1500,
  /** The receiver acknowledges every second data frame (a delayed ACK): the frames the other way for the data that flows. */
  ackEvery: 2,
  /** The round trip of the wire alone, in ticks: the first estimate of a download's transport. The machine adds its own time to answer (the kernel's driver sends the acknowledgements). */
  rttTicks: 1,
} as const;
