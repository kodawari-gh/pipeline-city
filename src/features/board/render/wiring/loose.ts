/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import { hangCable } from '@/core/render/cable';
import { IO_X } from '../layout/boardlayout';
import { GEO, PORT_Y, PSU_PORTS, VIDEO_RUN_Y, VIDEO_SOCKET } from '../layout/layout';
import { CABLE_HIDE } from './cables';
import type { Cable, CableKind, Plug } from './cables';
import { mkLane, nth } from './lane';
import type { Lane, Pt } from './lane';

// ---------------------------------------------------------------- loose (unplugged) cables

/** The end of each cable the player moves: the board end of the PSU cables, the board (HDMI) end of the video cable. */
export const movablePlug = (c: Cable): Plug => (c.kind === 'video' ? c.a : c.b);

export interface Loose {
  /** Stub from the fixed end (PSU socket / monitor port) to the loose plug. */
  path: Lane;
  /** The loose plug lying at rest. */
  plug: Plug;
  /** Where the cable is fixed (PSU socket top, monitor side port) and the direction it leaves that fixed end. */
  anchor: Pt;
  anchorDir: Pt;
}

/** Scale of a loose plug relative to the fully seated one (the 24-pin plug is huge next to the PSU). */
const LOOSE_SCALE = 0.54;

/** The roof of the PSU is where a loose lead lies: its plug's clearance above it, and the left to right order of the plugs on it (nearest the sockets first). */
const LOOSE_FLOOR = 6;
const LOOSE_ORDER: readonly CableKind[] = ['cpu', 'atx', 'pcie', 'pcie2', 'pcie3', 'pcie4'];

/** A loose plug's width: its seated plug's, scaled (`LOOSE_SCALE`). */
const looseWidth = (_k: CableKind, seated: number): number => Math.round(seated * LOOSE_SCALE);

/** The width of the seated plug of a PSU cable of kind `k`. */
function seatedWidth(k: CableKind): number {
  if (k === 'atx') {
    return GEO.atx.h - 60;
  }
  return k === 'cpu' ? GEO.cpw.w - 60 : 96;
}

/** The video cable unplugged: it still comes out of the monitor (it is built in), hangs down behind it and lies along the back edge of the desk, the plug at its end. */
function looseVideo(): Loose {
  const sx = VIDEO_SOCKET.x,
    sy = VIDEO_SOCKET.y + CABLE_HIDE,
    y = VIDEO_RUN_Y - 65 - 4;
  const plug: Plug = { x: IO_X + 30, y, dx: -1, dy: 0, w: 130, l: 220, pins: [1, 1] };
  const end: Pt = [plug.x - plug.l + 8, y],
    d = Math.hypot(end[0] - sx, end[1] - sy);
  return {
    path: mkLane(hangCable([sx, sy], [0, 1], end, { len: d * 1.1 + 500, stub: 160, n: 48, floor: VIDEO_RUN_Y - 38 })),
    plug,
    anchor: [sx, sy],
    anchorDir: [0, 1],
  };
}

/** x of the loose plug of kind `kind` on the PSU's roof: the plugs stand side by side west of the sockets in the order of `LOOSE_ORDER`. */
function loosePlugX(kind: CableKind): number {
  let px = nth(PSU_PORTS.pcie, 0) - 200;
  for (const k of LOOSE_ORDER) {
    const kw = looseWidth(k, seatedWidth(k));
    px -= kw / 2;
    if (k === kind) {
      break;
    }
    px -= kw / 2 + 40;
  }
  return px;
}

/** Where an unplugged cable's loose plug rests: the PSU cables in the gutter by the PSU, the HDMI cable near the monitor. */
export function looseCable(c: Cable): Loose {
  if (c.kind === 'video') {
    return looseVideo();
  }
  // the lead leaves its socket upward, arcs over and falls onto the roof of the PSU: the plug stands there on its pin face (the cable leaving
  // it upward); the cable lies along the roof where it has slack
  const { x } = c.a,
    w = looseWidth(c.kind, movablePlug(c).w),
    l = 150;
  const px = loosePlugX(c.kind);
  const py = PORT_Y - LOOSE_FLOOR;
  const plug: Plug = { x: px, y: py, dx: 0, dy: -1, w, l, pins: movablePlug(c).pins };
  const anchor: Pt = [x, PORT_Y - 130 + 20],
    end: Pt = [px, py - l + 8];
  const d = Math.hypot(end[0] - anchor[0], end[1] - anchor[1]);
  return {
    path: mkLane(
      hangCable(anchor, [0, -1], end, {
        len: d * 1.18 + 160,
        stub: 110,
        n: 40,
        floor: PORT_Y - LOOSE_FLOOR - c.w * 0.31,
      }),
    ),
    plug,
    anchor,
    anchorDir: [0, -1],
  };
}
