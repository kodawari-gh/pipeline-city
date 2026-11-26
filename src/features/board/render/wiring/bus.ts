/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import type { TierGeo } from '../layout/boardlayout';
import { dimmPowerPad } from '../layout/pins';
import { crossings, nth, pointAt } from './lane';
import type { Lane } from './lane';

/** x (from a phase block's left edge) of its output stub, where the core-voltage run starts (CPU VRM, see `vrmPhaseArt`), and the memory regulator's output and input stubs (`dramPhaseArt`). */
export const VRM_OUT_X = 265,
  DRAM_OUT_X = 124,
  DRAM_IN_X = 52;

/** Lanes in an NVMe bundle. */
export const NVME_LANES = 3;

export type BusKind =
  | 'mem'
  | 'nvme'
  | 'dmi'
  | 'pcie'
  | 'sata'
  | 'usb'
  | 'video'
  | 'dp'
  | 'svid'
  | 'pwmc'
  | 'spi'
  | 'hdr'
  | 'rtc'
  | 'pwr12'
  | 'pwrcpu'
  | 'vcore'
  | 'vdimm'
  | 'audio'
  | 'lan'
  | 'hda'
  | 'phyl'
  | 'lpc'
  | 'dbg'
  | 'rgb'
  | 'fanc'
  | 'pwrpcie'
  | 'clk';

/** Buses that may dive under what they cross (a via at each end of the hop), in rank order: a lane of a later bus hops over a lane of an earlier one. */
export const HOP_BUSES: readonly BusKind[] = ['pwmc', 'hda', 'phyl', 'lpc', 'rgb', 'fanc', 'pwrpcie'];

export interface Bus {
  id: BusKind;
  /** Lanes from the first end to the second. */
  lanes: Lane[];
  /** Lane stroke width in world units. */
  w: number;
  /** Width of the pad a lane ends on (default: twice the stroke). */
  pad?: number;
  /** Branches (one per DIMM) that light together with the main run when `tap(i)` is installed. */
  taps?: { key: string; lanes: Lane[] }[];
  /** The lanes that must arrive together (one memory channel, one M.2, one slot's lanes...): their lengths match. */
  groups?: Lane[][];
  /** Differential pairs: each lane is drawn as two tight strands (the fast serial buses). */
  pair?: boolean;
  /** The header trunk, by header: the trunk lane and that header's own tap (not length-matched, so not `groups`). */
  heads?: { name: string; lanes: Lane[] }[];
}

/** x where the memory rail ends: past the bank's last socket and past the last phase's output, so every output lands on the rail. */
export const vdimmEnd = (g: TierGeo): number => {
  const last = nth(g.dimm, -1);
  return Math.max(last.rect.x + last.rect.w - 20, nth(g.dPhases, -1).x + DRAM_OUT_X + 24);
};
/** x where the memory rail starts: at the first socket's drop (and no later than the first phase's output). */
export const vdimmStart = (g: TierGeo): number =>
  Math.min(dimmPowerPad(nth(g.dimm, 0).rect)[0], nth(g.dPhases, 0).x + DRAM_OUT_X) - 8;

interface Owned {
  b: Bus;
  l: Lane;
}

/** The hop rank of a bus (-1: it never hops). */
const rank = (id: BusKind): number => HOP_BUSES.indexOf(id);

/** The stretch of lane `l` (of bus `b`) around each place it crosses lane `o.l`, wide enough to clear that trace and the via rings. */
function cutsAcross({ b, l }: Owned, o: Owned): [number, number][] {
  // clear of the crossed trace and of the via ring, measured along the lane: a slanted crossing needs a longer hop
  const r0 = o.b.w / 2 + Math.max(11, b.w * 0.6) + 20;
  const cuts: [number, number][] = [];
  for (const c of crossings(l, o.l)) {
    if (o.l.hops?.some(([a, z]) => c.t > a && c.t < z) === true) {
      continue; // (that lane is on an inner layer there)
    }
    const p = pointAt(l, c.s - 1),
      q = pointAt(l, c.s + 1),
      u = pointAt(o.l, c.t - 1),
      v = pointAt(o.l, c.t + 1);
    const sin =
      Math.abs((q[0] - p[0]) * (v[1] - u[1]) - (q[1] - p[1]) * (v[0] - u[0])) /
      (Math.hypot(q[0] - p[0], q[1] - p[1]) * Math.hypot(v[0] - u[0], v[1] - u[1]) || 1);
    const r = r0 / Math.max(0.5, sin);
    cuts.push([c.s - r, c.s + r]);
  }
  return cuts;
}

/** Merge the cuts (sorted by start) into hops: cuts closer than 36 join, and no hop comes nearer than 18 to an end of the lane. */
function mergeCuts(cuts: [number, number][], len: number): [number, number][] {
  const hops: [number, number][] = [];
  for (const c of cuts) {
    const last = hops.at(-1);
    if (last && c[0] - last[1] < 36) {
      last[1] = Math.max(last[1], c[1]);
    } else {
      hops.push([Math.max(18, c[0]), Math.min(len - 18, c[1])]);
    }
  }
  return hops;
}

/** Mark the stretches where a lane of a `HOP_BUSES` bus crosses another lane: it dives under (a via at each end, `hop` clear of the crossed trace). */
export function addHops(buses: Bus[]): void {
  const all: Owned[] = buses.flatMap((b) =>
    [...b.lanes, ...(b.taps ? b.taps.flatMap((t) => t.lanes) : [])].map((l) => ({ b, l })),
  );
  for (const own of all) {
    const { b, l } = own;
    if (rank(b.id) < 0) {
      continue;
    }
    const cuts: [number, number][] = [];
    for (const o of all) {
      if (o.l === l || o.b === b || (rank(o.b.id) >= 0 && rank(o.b.id) > rank(b.id))) {
        continue;
      }
      cuts.push(...cutsAcross(own, o));
    }
    const hops = mergeCuts(
      cuts.toSorted((x, y) => x[0] - y[0]),
      l.len,
    );
    if (hops.length > 0) {
      l.hops = hops;
    }
  }
}

/** The socket's edges around the package: west (`px`), east (`qx`), south (`qy`) and north (`py`). */
export interface Edges {
  px: number;
  qx: number;
  qy: number;
  py: number;
}
