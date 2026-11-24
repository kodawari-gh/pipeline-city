// The NIC's lit copper (docs/render/net.md "Inside the NIC and the router"): the runs of the card's component side that its frames travel on, as the lanes the board's own `BusFlow` lights
// (wiring/busflow.ts), so a frame on the card's traces looks as one on the motherboard's. Pure: the geometry is `nicCopper`'s, nothing here draws.
// Two stretches are on the component side: the cable's four pairs from the first jack's contacts east to the controller (the way a frame comes in from the cable, and goes out to it), and the slot's
// receive pairs (side B's PET) from the gold fingers to the controller (the way the host's frames come in). The way back to the host (side A's PER, through its AC-coupling capacitors) runs on the
// solder side and dives to the controller by vias: it is not on this face, so no light shows there. Only the first jack has a cable (the 40G card's second one is left dark, as its lamps are).
// The lanes are in the drawing's own coordinates: the card's layout (y down, as the card is seen from its component side, which faces up when it lies flat), in the card's band of the shared
// drawing (`TRACE_BAND`).
import type { Rect } from '../layout/layout';
import { mkLane, type Lane, type Pt } from '../wiring/routes';
import type { NicCopper } from './niccopper';

/** Each card's band along x in the shared drawing (layout units), so two cards in a machine never share a picture. A card is under 3400 long. */
export const TRACE_BAND = 4000;

/** The nets that carry frames on this face: the first jack's pairs, and the slot's receive pairs. */
const MEDIA = /^J1MDI\d[+-]$/,
  HOST = /^PET\d[+-]$/;
/** How far the drawing reaches past the lanes (layout units): the lit stroke's half width and its fade. */
const MARGIN = 20;

export interface NicLanes {
  /** The first jack's pairs, each from its contact to the controller. */
  media: Lane[];
  /** The slot's receive pairs on the component side, each from its finger to the controller. */
  host: Lane[];
  /** The part of the drawing the lanes cover. */
  rect: Rect;
  /** What is added to a layout x to get the drawing's: the card's west end sits at its band's start. */
  off: number;
}

/**
 * The lit lanes of a card's copper in slot `slot`. A pair's two lines are two lanes (each runs its own way: they jog at their own columns). Each lane starts at its source: a jack's contact or
 * the middle of a gold finger, and ends at the controller's pad. A card with no such run (a bare outline) has none.
 */
export function nicLanes(cu: NicCopper, slot: number): NicLanes {
  const west = Math.min(...cu.outline.map((p) => p[0])),
    off = slot * TRACE_BAND - west;
  const to = (p: readonly [number, number]): Pt => [p[0] + off, p[1]];
  const lane = (pts: readonly (readonly [number, number])[]): Lane => mkLane(pts.map(to));
  // (a run is drawn from where it starts to where it ends: the jack's contact is west of the controller, a finger north of it)
  const media = cu.traces
    .filter((t) => t.layer === 'top' && MEDIA.test(t.net))
    .map((t) => (t.pts[0]![0] <= t.pts[t.pts.length - 1]![0] ? t.pts : [...t.pts].reverse()));
  const host = cu.traces
    .filter((t) => t.layer === 'top' && HOST.test(t.net))
    .map((t) => {
      const pts = t.pts[0]![1] <= t.pts[t.pts.length - 1]![1] ? t.pts : [...t.pts].reverse();
      // (on from the finger's middle: the gold the finger shows is the run's start)
      const finger = cu.pads.find((p) => p.edge && p.face === 'top' && p.net === t.net);
      return finger ? [finger.c, ...pts] : pts;
    });
  const lanes = { media: media.map(lane), host: host.map(lane) };
  const all = [...lanes.media, ...lanes.host].flatMap((l) => l.pts);
  if (!all.length) return { ...lanes, rect: { x: slot * TRACE_BAND, y: 0, w: 0, h: 0 }, off };
  const x0 = Math.min(...all.map((p) => p[0])) - MARGIN,
    y0 = Math.min(...all.map((p) => p[1])) - MARGIN,
    x1 = Math.max(...all.map((p) => p[0])) + MARGIN,
    y1 = Math.max(...all.map((p) => p[1])) + MARGIN;
  return { ...lanes, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, off };
}
