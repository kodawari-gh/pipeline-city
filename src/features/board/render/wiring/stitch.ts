import type { TierGeo } from '../layout/boardlayout';
import type { Rect } from '../layout/layout';
import { pointAt, type Lane, type Pt } from './routes';

// The ground stitching: the small vias a real board scatters through its plane, on a regular grid, wherever nothing else runs. A via is a hole through
// every layer, so it keeps off a lane on an inner layer too, off the parts and off the mounting holes. Pure geometry.

/** The grid's pitch, how far a via keeps from a lane, from a part and from a mounting hole's centre. */
export const STITCH_PITCH = 110, STITCH_LANE = 44, STITCH_PART = 24, STITCH_HOLE = 130;
/** The grid starts this far inside the board's edge. */
const EDGE = 130;

/** The rects a stitching via keeps off. */
function solids(g: TierGeo): Rect[] {
  const rs: Rect[] = [g.chip, g.hub, g.bat, g.codec, g.vrm, g.dvrm, g.atx, g.cpw, g.io, g.dpwm, g.bios, g.sio, g.xtalCpu, g.xtalPch, ...g.m2, ...g.sata];
  for (const r of [g.phy, g.hex, g.qr, g.dbg, g.rgb]) if (r) rs.push(r);
  // a slot with its landing (the capacitors, the vias above it, the pads under it), a socket with its latches, the CPU with its decoupling
  for (const r of g.pcie) rs.push({ x: r.x - 20, y: r.y - 300, w: r.w + 90, h: r.h + 380 });
  for (const d of g.dimm) rs.push({ x: d.rect.x - 30, y: d.rect.y - 70, w: d.rect.w + 60, h: d.rect.h + 140 });
  for (const h of g.hdrs) rs.push({ x: h.x, y: h.y, w: h.cols * 52 + 24, h: h.rows * 52 + 24 });
  rs.push({ x: -760, y: -660, w: 1520, h: 1320 });
  // the core-voltage pour has its own vias
  const a = g.vrmPhases[0]!, z = g.vrmPhases[g.vrmPhases.length - 1]!;
  rs.push({ x: a.x, y: a.y, w: z.x + z.w - a.x, h: -560 - a.y });
  return rs;
}

/** The vias of a board, given all its lanes (whatever layer they run on). */
export function stitchVias(g: TierGeo, lanes: readonly Lane[]): Pt[] {
  const size = STITCH_LANE * 2, key = (x: number, y: number) => `${Math.floor(x / size)},${Math.floor(y / size)}`;
  const near = new Map<string, Pt[]>();
  for (const l of lanes) for (let s = 0; s < l.len; s += STITCH_LANE / 2) {
    const p = pointAt(l, s), k = key(p[0], p[1]);
    (near.get(k) ?? near.set(k, []).get(k)!).push(p);
  }
  const clearOfLanes = (x: number, y: number) => {
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) for (const p of near.get(key(x + dx, y + dy)) ?? []) if (Math.hypot(p[0] - x, p[1] - y) < STITCH_LANE) return false;
    return true;
  };
  const rs = solids(g), out: Pt[] = [], d = STITCH_PART;
  for (let x = g.bd.x + EDGE; x < g.bd.x + g.bd.w - EDGE + 30; x += STITCH_PITCH) for (let y = g.bd.y + EDGE; y < g.bd.y + g.bd.h - EDGE + 30; y += STITCH_PITCH) {
    if (rs.some((r) => x > r.x - d && x < r.x + r.w + d && y > r.y - d && y < r.y + r.h + d)) continue;
    if (g.holes.some(([hx, hy]) => Math.hypot(hx - x, hy - y) < STITCH_HOLE)) continue;
    if (clearOfLanes(x, y)) out.push([x, y]);
  }
  return out;
}
