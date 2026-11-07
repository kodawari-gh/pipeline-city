// The heatsinks over the board's VRMs (specs `vrm-sink`, `ram-sink`), built into a group in board space: the live board and the showcase share it.
import type { Group } from 'three';
import type { Theme } from '@/core/render/theme';
import { rectBox, rod, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { GEO, RAM_SINK, VRM_SINK } from '../layout/layout';
import { sinkFanRect, vrmSinkArt } from '../devices';
import { hexNum, skinOf } from '../skins';
import { brushed, outlinePts, shapeOf, slab, tiled } from './casekit3d';

/** What the caller needs to fit the sink's fan: its spot (null where the sink has none), the foot's top and the fins' top, both as z. */
export interface SinkFit { spot: RectLike | null; foot: number; top: number }

/**
 * The sink as a real regulator sink: a solid anodised block on a thermal pad over the power stages, chamfered at its ends, a brushed plate on its
 * face toward the socket, the drawing's fin rails (`vrmSinkArt`) machined out of its top (taller and fewer on the big sink), its heat pipe arched
 * over them. A fan's spot at the east end stays low: the block stops short of it and a foot carries the fan.
 */
export function sinkBody(g: Group, T: Theme, kind: 'vrm-sink' | 'ram-sink', visual: string): SinkFit {
  const r = kind === 'vrm-sink' ? VRM_SINK : RAM_SINK, p = vrmSinkArt(T, visual, r), big = visual === 'vrm-sink-big', spot = p.fan ? sinkFanRect(r) : null;
  p.root.destroy({ children: true }); p.fan?.destroy({ children: true });
  // (in the board's finish, as the maker would match it: skins.ts)
  const sk = skinOf(GEO.tier), base = BOARD_Z + 180, body = base + 190, foot = base + 30, top = BOARD_Z + (big ? 720 : 560), block = spot ? { ...r, w: spot.x - 14 - r.x } : r;
  const anod = mat(hexNum(sk.sink), { metalness: 0.5, roughness: 0.46, map: tiled(brushed(), 6, 1) });
  g.add(rectBox({ x: r.x + 24, y: r.y + 24, w: r.w - 48, h: r.h - 48 }, base - 8, base, mat(0x8e98a8, { roughness: 0.85 })));
  g.add(slab(shapeOf(outlinePts(block, 0, [44, 44, 44, 44])), base, body, anod, 8));
  if (spot) g.add(slab(shapeOf(outlinePts(r, 0, [44, 44, 44, 44])), base, foot, anod, 6));
  if (sk.insert) g.add(rectBox({ x: block.x + 60, y: r.y + r.h - 2, w: block.w - 120, h: 6 }, base + 34, body - 30, mat(hexNum(sk.insert), { metalness: 0.6, roughness: 0.38, map: tiled(brushed(), 8, 1) })));
  for (const f of p.fins ?? []) { const t = Math.max(12, f.h * 0.5); g.add(softBox({ x: f.x + 20, y: f.y + (f.h - t) / 2, w: f.w - 40, h: t }, body - 10, top, anod, 6)); }
  if (p.pipe) {
    const px = p.pipe.x + p.pipe.w / 2, cu = mat(0xb87a4a, { metalness: 0.8, roughness: 0.36 }), ya = -(p.pipe.y + 20), yb = -(p.pipe.y + p.pipe.h - 20);
    g.add(rod([px, ya, base + 40], [px, ya, top + 30], 15, cu, 12), rod([px, ya, top + 30], [px, yb, top + 30], 15, cu, 12), rod([px, yb, top + 30], [px, yb, base + 40], 15, cu, 12));
  }
  return { spot, foot, top };
}
