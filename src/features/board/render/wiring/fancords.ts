import { fanMounts, hubHeaders } from '@/features/room/render/desk/props/case';
import * as layout from '../layout/layout';
import type { Pt } from './routes';

// The fans' cables (docs/render/board.md "Fan cables"): the CPU cooler's, the two heatsink fans', the fan hub's control cable and one cable per
// case fan. Each is fixed at its fan (or at the hub) and ends in a plug that seats on its header, or lies loose beside it: the player drags it in,
// like the wall cords (`cords.ts`), and the sim only lets the machine run its fan while the plug is in (docs/ASSEMBLY.md).

export interface FanCordPlan {
  /** The sim's cable id: `cpufan`, `vrmfan`, `ramfan`, `sysfan`, `fan:<mount>`. */
  id: string;
  /** Where the cord is fixed (the fan, the hub's input or the slot in the tray) and the way it leaves that end. */
  anchor: Pt;
  anchorDir: Pt;
  /** The header's seat (the plug's centre when it is in) and the size of the plug. */
  seat: Pt;
  plug: { w: number; h: number };
  /** The cord as it runs when the plug is seated: from the anchor to the seat. */
  route: Pt[];
  /** Where the plug lies when it is out. */
  rest: Pt;
  /** The header the plug seats on (highlight ring). */
  header: layout.Rect;
  /** How close (world units) the plug's centre must be to the seat for a drop to seat it. */
  seatR: number;
  /** The plug on the fixed end, if that end shows one. */
  endPlug: layout.Rect | null;
  /** Sleeve width. */
  width: number;
}

const hdrRect = (name: string): layout.Rect | null => {
  const h = layout.GEO.hdrs.find((q) => q.name === name);
  return h ? { x: h.x, y: h.y, w: h.cols * 52 + 24, h: h.rows * 52 + 24 } : null;
};
const mid = (r: layout.Rect): Pt => [r.x + r.w / 2, r.y + r.h / 2];

/** Every fan cable the current layout can have (the pure geometry, tested): the view draws the ones the machine lists. */
export function fanCordPlans(): FanCordPlan[] {
  const out: FanCordPlan[] = [];
  // the CPU cooler: straight east from the CPU_FAN header to the cooler's west edge
  const cf = hdrRect('CPU_FAN');
  if (cf) {
    const seat = mid(cf),
      x1 = layout.COOLER.x + 70;
    out.push({
      id: 'cpufan',
      anchor: [x1, seat[1]],
      anchorDir: [-1, 0],
      seat,
      plug: { w: cf.w + 16, h: cf.h + 16 },
      route: [[x1, seat[1]], seat],
      rest: [seat[0], seat[1] + 380],
      header: cf,
      seatR: 200,
      endPlug: { x: x1 - 30, y: seat[1] - 28, w: 64, h: 56 },
      width: 24,
    });
  }
  // the heatsink fans: out of the fan's frame on the side toward its header (the header stands clear of the fan), along to above the header
  // and down onto it
  for (const which of ['vrm', 'ram'] as const) {
    const h = hdrRect(which === 'vrm' ? 'VRM_FAN' : 'RAM_FAN');
    if (!h) {
      continue;
    }
    const f = which === 'vrm' ? layout.GEO.vrmFan : layout.GEO.dFan,
      west = h.x < f.x,
      sx = h.x + h.w / 2,
      ay = Math.min(Math.max(h.y - 60, f.y + 120), f.y + f.h - 120);
    const anchor: Pt = [west ? f.x + 20 : f.x + f.w - 20, ay],
      seat = mid(h);
    out.push({
      id: which === 'vrm' ? 'vrmfan' : 'ramfan',
      anchor,
      anchorDir: [west ? -1 : 1, 0],
      seat,
      plug: { w: h.w + 16, h: h.h + 16 },
      route: [anchor, [sx, ay], [sx, h.y + 6]],
      rest: [seat[0] + (west ? -330 : 330), seat[1]],
      header: h,
      seatR: 190,
      endPlug: null,
      width: 22,
    });
  }
  // the fan hub's control cable: from the SYS_FAN header down over the board's south edge, east and up into the hub's input header
  const sf = hdrRect('SYS_FAN');
  if (sf) {
    const cx = sf.x + sf.w / 2,
      south = layout.CASE_BD.y + layout.CASE_BD.h,
      hx = layout.FAN_HUB.x + 90,
      anchor: Pt = [hx, layout.FAN_HUB.y + 4],
      seat = mid(sf);
    out.push({
      id: 'sysfan',
      anchor,
      anchorDir: [0, -1],
      seat,
      plug: { w: sf.w + 16, h: sf.h + 16 },
      route: [anchor, [hx, south + 130], [cx, south + 130], [cx, sf.y + sf.h + 6]],
      rest: [cx, sf.y + sf.h + 330],
      header: sf,
      seatR: 190,
      endPlug: { x: hx - 36, y: layout.FAN_HUB.y - 24, w: 72, h: 44 },
      width: 24,
    });
  }
  // one cable per case fan: from the slot in the tray down to its header on the hub (the plug rests lifted above it)
  const hubs = hubHeaders();
  fanMounts().forEach((m, i) => {
    const p = hubs[i];
    if (!p) {
      return;
    }
    const anchor: Pt = [p.x, layout.FAN_SLOT.y + layout.FAN_SLOT.h * 0.5],
      seat: Pt = [p.x, p.y - 6];
    out.push({
      id: `fan:${m.id}`,
      anchor,
      anchorDir: [0, 1],
      seat,
      plug: { w: 72, h: 48 },
      route: [anchor, seat],
      rest: [p.x, p.y - 112],
      header: { x: p.x - 40, y: p.y + 8, w: 80, h: 44 },
      seatR: 60,
      endPlug: null,
      width: 20,
    });
  });
  return out;
}

/** How long the cord is: its plug at rest, a little slack more (it hangs from the anchor to the plug, and a plug that falls swings on this length). */
export const cordLen = (p: FanCordPlan) => Math.hypot(p.rest[0] - p.anchor[0], p.rest[1] - p.anchor[1]) * 1.12 + 120;
