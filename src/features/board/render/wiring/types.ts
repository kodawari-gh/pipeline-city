// The types the wiring modules share: lanes, buses and cables. Types only, so a module imports its values and its types from different paths.
import type { Clip } from '@/core/render/cable';
import type { SerpOpts } from '../layout/match';

export type { TierGeo } from '../layout/boardlayout';

export type Pt = [number, number];

export interface Lane {
  pts: Pt[];
  seg: number[];
  len: number;
  ph: number;
  /** Stretches (arc length from, to) where the lane dives under what it crosses (a via at each end, nothing drawn between): only the buses of `HOP_BUSES` do. */
  hops?: [number, number][];
}

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

/** The socket's edges around the package: west (`px`), east (`qx`), south (`qy`) and north (`py`). */
export interface Edges {
  px: number;
  qx: number;
  qy: number;
  py: number;
}

/** A bundle's shape: n lanes, `spacing` apart, their corners chamfered with legs of `c`. */
export interface Run {
  n: number;
  spacing: number;
  c?: number;
}

/** Length matching of a bundle's lanes (`serpentine`): the stroke width and the room beside the bundle. */
type Match = Omit<SerpOpts, 'pitch'>;
/** Pads at the ends of a bundle (`from` at the first end, `to` at the last; none = free end), the straight `lead` into them and the length `match`. */
export interface Ends {
  from?: Pt[];
  to?: Pt[];
  lead?: number;
  match?: Match;
}

/** The PSU's PCIe leads are the cables `pcie`, `pcie2`, `pcie3` and `pcie4` (the sim's `PCIE_LEADS`): each plugs into one power socket of a card. */
export type PcieKind = 'pcie' | 'pcie2' | 'pcie3' | 'pcie4';
export type CableKind = 'atx' | 'cpu' | PcieKind | 'video';

/** Where a PCIe lead plugs in: the card's power socket (`x` its centre), the card's north edge (`top`), and which socket of the card it is (`plug`, 0 = the first). */
export interface PcieTarget {
  kind: PcieKind;
  x: number;
  top: number;
  plug: number;
}

export interface Cable {
  kind: CableKind;
  /** The wall clips that pin the cable (cables that run over the wall only). */
  clips?: Clip[];
  /** Cable centre line, dense and rounded (use for drawing, glow and hit rects). */
  path: Lane;
  /** Sleeve width. */
  w: number;
  /** Plug at the start (PSU / board end) and at the end. */
  a: Plug;
  b: Plug;
}

export interface Plug {
  x: number;
  y: number;
  /** Direction the cable leaves the plug, unit axis vector. */ dx: number;
  dy: number;
  w: number;
  l: number;
  pins: [number, number];
}
