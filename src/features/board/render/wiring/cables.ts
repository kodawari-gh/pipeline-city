import { drape, roundedPath } from '@/core/render/cable';
import { BR, GEO, PORT_Y, PSU_PORTS, VIDEO_RUN_Y, VIDEO_SOCKET, VIDEO_TRUNK_X, VIDEO_Y } from '../layout/layout';
import { mkLane, nth } from './lane';
import type { Cable, CableKind, PcieKind, PcieTarget, Plug, Pt } from './types';

// ---------------------------------------------------------------- cables (PSU to board, board to monitor)

const PCIE_KINDS: ReadonlySet<string> = new Set<PcieKind>(['pcie', 'pcie2', 'pcie3', 'pcie4']);
export const isPcieKind = (k: string): k is PcieKind => PCIE_KINDS.has(k);

/** The heights of the wall clips along a vertical run from `y0` to `y1` (world y): one about every 1500 units, clear of the bends at both ends. */
const runClipYs = (y0: number, y1: number): number[] => {
  const every = 1500,
    margin = 650;
  const a = Math.min(y0, y1) + margin,
    b = Math.max(y0, y1) - margin;
  if (b <= a) {
    return [];
  }
  const n = Math.max(1, Math.round((b - a) / every));
  return Array.from({ length: n }, (_, k) => Math.round(a + ((b - a) * (k + 0.5)) / n));
};

/** How far below the bezel's edge the video cable starts, so that its round end tucks up under the edge (nothing of the monitor's end shows). */
export const CABLE_HIDE = 40;

/** How tall the plug on a PSU socket stands. */
const PSU_PLUG_H = 150;

/** A PSU cable: the rounded `route` (corner radius `r`) of sleeve width `w` from its PSU plug `a` to its board plug `b`. */
const mkc = (kind: CableKind, route: Pt[], { w, a, b, r }: { w: number; a: Plug; b: Plug; r: number }): Cable => ({
  kind,
  path: mkLane(roundedPath(route, r)),
  w,
  a,
  b,
});

/** The plug on PSU socket `x` (its cable leaves upward): `w` wide, with `pins` columns and rows. */
const plugV = (x: number, w: number, pins: [number, number]): Plug => ({
  x,
  y: PORT_Y,
  dx: 0,
  dy: -1,
  w,
  l: PSU_PLUG_H,
  pins,
});

/** ATX 24-pin: up the gutter, left into the plug that sits on the board connector. */
function atxCable(): Cable {
  const g = GEO,
    x = PSU_PORTS.atx,
    y = g.atx.y + g.atx.h / 2,
    plugX = g.atx.x + 100;
  const route: Pt[] = [
    [x, PORT_Y - PSU_PLUG_H + 20],
    [x, y],
    [plugX + 240, y],
  ];
  return mkc('atx', route, {
    w: 120,
    a: plugV(x, 150, [12, 2]),
    b: { x: plugX, y, dx: 1, dy: 0, w: g.atx.h - 60, l: 270, pins: [12, 2] },
    r: 190,
  });
}

/** CPU 8-pin: up the gutter, west along the top of the case, down onto the connector (the plug's cable leaves upward). */
function cpuCable(): Cable {
  const g = GEO,
    x = PSU_PORTS.cpu,
    cx = g.cpw.x + g.cpw.w / 2,
    plugBottom = g.cpw.y + g.cpw.h - 30,
    plugL = 300,
    yTop = g.bd.y - 120;
  const route: Pt[] = [
    [x, PORT_Y - PSU_PLUG_H + 20],
    [x, yTop],
    [cx, yTop],
    [cx, plugBottom - plugL + 24],
  ];
  return mkc('cpu', route, {
    w: 84,
    a: plugV(x, 110, [4, 2]),
    b: { x: cx, y: plugBottom, dx: 0, dy: -1, w: g.cpw.w - 60, l: plugL, pins: [4, 2] },
    r: 150,
  });
}

/** A PCIe lead from PSU socket `x`, along the run at height `y`, down onto its card socket `t`. */
function pcieCable(t: PcieTarget, x: number, y: number): Cable {
  const plugBottom = t.top + 20,
    plugL = 240;
  const route: Pt[] = [
    [x, PORT_Y - PSU_PLUG_H + 20],
    [x, y],
    [t.x, y],
    [t.x, plugBottom - plugL + 24],
  ];
  return mkc(t.kind, route, {
    w: 58,
    a: plugV(x, 74, [3, 2]),
    b: { x: t.x, y: plugBottom, dx: 0, dy: -1, w: 96, l: plugL, pins: [3, 2] },
    r: 120,
  });
}

/** The height of the run over the board of the PCIe lead to `t`: above the card's socket, a second socket one step higher. */
const leadRun = (t: PcieTarget): number => t.top - 150 - 110 * t.plug;

/**
 * The PSU cables and the video cable. A PCIe lead is only drawn for a card socket that takes one (`pcie`: the cards' sockets, in lead order).
 * The 24-pin cable rises through the cable gutter and turns west into the east-edge connector; the 8-pin cable keeps
 * rising to the top of the case, runs west over the board (the way a real build routes it) and drops onto the connector at the top edge.
 * A PCIe lead goes up the gutter, west over the board at a level above the card's socket (the card's second socket one step higher, so its
 * lead clears the first) and down onto the socket. The PSU's sockets are dealt out from the innermost to the lowest run first, so no lead
 * has to cross another's rise.
 */
export function buildCables(pcie: readonly PcieTarget[] = []): Cable[] {
  const out: Cable[] = [atxCable(), cpuCable()];
  const byRun = pcie.toSorted((p, q) => leadRun(q) - leadRun(p));
  for (const [k, t] of byRun.entries()) {
    out.push(pcieCable(t, PSU_PORTS.pcie[k] ?? nth(PSU_PORTS.pcie, -1), leadRun(t)));
  }
  out.push(videoCableAt(VIDEO_Y));
  return out;
}

/**
 * The video cable with its PC end at height `y` of the rear plate: `VIDEO_Y` is the board's HDMI port, a card's display port is at `gpuPort(i).y + 60`.
 * It runs from there west into the gap, down it, under the monitor and up behind its bezel: the cable is built into the monitor (no socket, no plug on
 * that end), so it simply comes out from behind the bezel's bottom edge.
 */
function videoCableAt(y: number): Cable {
  const x0 = BR.io.x,
    sx = VIDEO_SOCKET.x,
    sy = VIDEO_SOCKET.y,
    l = 220;
  // out of the port, a sweeping bend down the trunk (clipped to the wall with the ethernet cable), along the back edge of the desk (where it lies), and up
  // behind the bezel (clipped once on the way up): every bend is round, and a straight run is where a clip holds it
  const clipAt = [
    ...runClipYs(y, VIDEO_RUN_Y).map((cy): Pt => [VIDEO_TRUNK_X, cy]),
    [sx, (VIDEO_RUN_Y + sy) / 2] as Pt,
  ];
  const { path, clips } = drape(
    [
      [x0 - 200, y],
      [VIDEO_TRUNK_X, y],
      [VIDEO_TRUNK_X, VIDEO_RUN_Y],
      [sx, VIDEO_RUN_Y],
      [sx, sy + CABLE_HIDE],
    ],
    { radius: 420, floor: VIDEO_RUN_Y, clips: clipAt },
  );
  return {
    kind: 'video',
    path: mkLane(path),
    clips,
    w: 76,
    a: { x: x0, y, dx: -1, dy: 0, w: 130, l: 220, pins: [1, 1] },
    b: { x: sx, y: sy, dx: 0, dy: 1, w: 130, l, pins: [1, 1] },
  };
}
