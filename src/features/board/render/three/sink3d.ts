// The heatsinks over the board's VRMs (specs `vrm-sink`, `ram-sink`), built into a group in board space: the live board and the showcase share it.
import { BoxGeometry, Vector2, type Group } from 'three';
import type { Theme } from '@/core/render/theme';
import { drum, instanced, rectBox, rod, softBox, type RectLike } from '@/core/render/three/geometry';
import { lowDetail } from '@/core/render/three/detail';
import { KEEP_SPEC, mat } from '@/core/render/three/materials';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { GEO, RAM_SINK, VRM_SINK } from '../layout/layout';
import { SINK_FAN_RIM } from '../layout/boardlayout';
import { sinkFanRect, vrmSinkArt } from '../devices';
import { hexNum, skinOf } from '../skins';
import { brushed, outlinePts, shapeOf, slab, tiled } from './casekit3d';
import { fanDepth } from './fans3d';

/** What the caller needs to fit the sink's fan: its square in the housing (null where the sink has none), the fan's underside and the sink's top, as z. */
export interface SinkFit { spot: RectLike | null; foot: number; top: number }

/**
 * The heights over the board: the thermal pad on the power stages (40 tall), the foot that stands on it, the block over the chokes (150 tall: it
 * clears them), the fins' root. The fins' tops: passive, big.
 */
const Z = { pad: BOARD_Z + 40, foot: BOARD_Z + 70, block: BOARD_Z + 200, root: BOARD_Z + 300 } as const;
const TOP = { fins: BOARD_Z + 560, big: BOARD_Z + 720 } as const;
/**
 * The fan sink's housing: its underside (clear of the memory sockets' latches, 301 over the board), the floor its fins stand on, the fan's
 * underside, the cover's underside and its top (under the tower cooler's fans, at BOARD_Z + 780).
 */
const HEAD = { base: BOARD_Z + 330, floor: BOARD_Z + 370, fan: BOARD_Z + 488, cover: BOARD_Z + 722, top: BOARD_Z + 742 } as const;
/** The housing's two side walls, its fins' pitch and thickness. */
const WALL = 18, HEAD_PITCH = 46, HEAD_FIN = 12;
/** The depth of a sink fan's middle (its cable leaves its frame there). */
export const SINK_FAN_MID = HEAD.fan + fanDepth(40) / 2;
/** Across each sink, from its north edge: the strip of power stages its foot stands on. */
const FOOT = { 'vrm-sink': [12, 162], 'ram-sink': [4, 110] } as const;

/** The two screws through the board: in each sink's end phases, where the phase art leaves room (`vrmPhaseArt`, `dramPhaseArt`), under its foot. */
function screwSpots(kind: 'vrm-sink' | 'ram-sink'): [number, number][] {
  const ps = kind === 'vrm-sink' ? GEO.vrmPhases : GEO.dPhases, a = ps[0], b = ps[ps.length - 1];
  if (!a || !b) return [];
  return kind === 'vrm-sink' ? [[a.x + 295, a.y + 105], [b.x + 295, b.y + 105]] : [[a.x + 192, a.y + 75], [b.x + 192, b.y + 75]];
}

/**
 * The sink as a real regulator sink: an anodised casting screwed on from behind the board (a nylon washer under each screw's head, a boss round
 * it). Its foot stands on a thermal pad on the power stages; the block over it clears the chokes; the drawing's fin rails (`vrmSinkArt`) are
 * machined out of its top (taller and fewer on the big sink, its heat pipe arched over them), a brushed plate on its face toward the socket.
 * The fan sink carries a housing of the same casting over its fan's square (`spot`), as boards with an active regulator sink have it: a block
 * of finer fins between two side walls, the 40 mm fan sunk on them blowing down, a cover over it with a round grille; the air leaves along
 * the fin channels, open at both ends.
 */
export function sinkBody(g: Group, T: Theme, kind: 'vrm-sink' | 'ram-sink', visual: string): SinkFit {
  const r = kind === 'vrm-sink' ? VRM_SINK : RAM_SINK, fan = visual === 'vrm-sink-fan', big = visual === 'vrm-sink-big';
  const spot = fan ? sinkFanRect(kind) : null, p = vrmSinkArt(T, visual, r, spot ?? undefined);
  p.root.destroy({ children: true }); p.fan?.destroy({ children: true }); p.over?.destroy({ children: true });
  // (in the board's finish, as the maker would match it: skins.ts)
  // (the fan sink's rails stand as tall as its housing, flush under the cover's plate)
  const sk = skinOf(GEO.tier), top = big ? TOP.big : fan ? HEAD.cover : TOP.fins;
  const H = spot && { x: spot.x - SINK_FAN_RIM, y: spot.y - SINK_FAN_RIM, w: spot.w + 2 * SINK_FAN_RIM, h: spot.h + 2 * SINK_FAN_RIM };
  const anod = mat(hexNum(sk.sink), { metalness: 0.5, roughness: 0.46, map: tiled(brushed(), 6, 1) });
  // (Low: the casting and its fins keep High's PBR, as the silver is the room's reflection: a Lambert of this dark colour draws near black)
  if (lowDetail()) anod.userData[KEEP_SPEC] = true;
  const [f0, f1] = FOOT[kind], foot = { x: r.x + 10, y: r.y + f0, w: r.w - 20, h: f1 - f0 };
  g.add(rectBox({ x: foot.x + 14, y: foot.y + 8, w: foot.w - 28, h: foot.h - 16 }, Z.pad, Z.foot, mat(0x8e98a8, { roughness: 0.85 })));
  g.add(slab(shapeOf(outlinePts(foot, 0, [24, 24, 24, 24])), Z.foot, Z.block + 2, anod, 6));
  g.add(slab(shapeOf(outlinePts(r, 0, [44, 44, 44, 44])), Z.block, Z.root, anod, 8));
  if (sk.insert) g.add(rectBox({ x: r.x + 60, y: r.y + r.h - 2, w: r.w - 120, h: 6 }, Z.block + 20, Z.root - 20, mat(hexNum(sk.insert), { metalness: 0.6, roughness: 0.38, map: tiled(brushed(), 8, 1) })));
  for (const f of p.fins ?? []) {
    // (under the fan's housing the rails stop at its underside)
    const t = Math.max(12, f.h * 0.5), y = f.y + (f.h - t) / 2, a = f.x + 4, b = f.x + f.w - 4;
    const runs: [number, number, number][] = H
      ? [[a, Math.min(b, H.x), top], [Math.max(a, H.x + H.w), b, top], [Math.max(a, H.x), Math.min(b, H.x + H.w), HEAD.base + 2]]
      : [[a, b, top]];
    for (const [x0, x1, z1] of runs) if (x1 - x0 > 20) g.add(softBox({ x: x0, y, w: x1 - x0, h: t }, Z.root - 10, z1, anod, 6));
  }
  if (p.pipe) {
    const px = p.pipe.x + p.pipe.w / 2, cu = mat(0xb87a4a, { metalness: 0.8, roughness: 0.36 }), ya = -(p.pipe.y + 20), yb = -(p.pipe.y + p.pipe.h - 20);
    g.add(rod([px, ya, Z.root - 20], [px, ya, top + 30], 15, cu, 12), rod([px, ya, top + 30], [px, yb, top + 30], 15, cu, 12), rod([px, yb, top + 30], [px, yb, Z.root - 20], 15, cu, 12));
  }
  // the screws: a boss of the casting on a nylon washer on the board, the shaft through it, a washer and the head behind
  const steel = mat(0x8c939c, { metalness: 0.8, roughness: 0.32 }), nylon = mat(0xd6d1c2, { roughness: 0.7 });
  for (const [x, y] of screwSpots(kind)) {
    g.add(drum(x, y, BOARD_Z, BOARD_Z + 8, 46, nylon, 20), drum(x, y, BOARD_Z + 8, Z.foot + 2, 38, anod, 20));
    g.add(drum(x, y, BOARD_Z - 72, BOARD_Z + 8, 20, steel, 12), drum(x, y, BOARD_Z - 72, BOARD_Z - 64, 50, nylon, 20), drum(x, y, BOARD_Z - 102, BOARD_Z - 72, 44, steel, 20));
  }
  if (!spot || !H) return { spot, foot: Z.root, top };
  // the housing: its floor on the rails, a wall down each side (north and south), the fins between them along the rails' channels, the cover
  const cx = spot.x + spot.w / 2, cy = spot.y + spot.h / 2, R = spot.w * 0.46;
  const circle = (rad: number, n = 64) => Array.from({ length: n }, (_, k) => new Vector2(cx + Math.cos((k / n) * Math.PI * 2) * rad, -cy + Math.sin((k / n) * Math.PI * 2) * rad));
  g.add(slab(shapeOf(outlinePts(H, 60)), HEAD.base, HEAD.floor, anod, 6));
  for (const y of [H.y, H.y + H.h - WALL]) g.add(softBox({ x: H.x, y, w: H.w, h: WALL }, HEAD.floor - 4, HEAD.cover + 2, anod, 6));
  const n = Math.floor((H.h - 2 * WALL - HEAD_FIN) / HEAD_PITCH), y0 = H.y + (H.h - (n - 1) * HEAD_PITCH) / 2, fh = HEAD.fan - 8 - HEAD.floor;
  g.add(instanced(new BoxGeometry(H.w - 16, HEAD_FIN, fh), anod, Array.from({ length: n }, (_, k) => ({ x: H.x + H.w / 2, y: -(y0 + k * HEAD_PITCH), z: HEAD.floor + fh / 2 }))));
  g.add(slab(shapeOf(outlinePts(H, 60), [circle(R)]), HEAD.cover, HEAD.top, anod, 6));
  // the grille in the cover's opening: four spokes from its rim to a round badge, a ring halfway (flush under the cover's face)
  const zg = HEAD.top - 10, spoke = R * 0.72, at = R * 0.28 + spoke / 2;
  g.add(instanced(new BoxGeometry(spoke, 22, 16), anod, [1, 3, 5, 7].map((k) => ({ x: cx + Math.cos((k * Math.PI) / 4) * at, y: -cy + Math.sin((k * Math.PI) / 4) * at, z: zg, rz: (k * Math.PI) / 4 }))));
  g.add(slab(shapeOf(circle(R * 0.64 + 9), [circle(R * 0.64 - 9)]), zg - 8, zg + 8, anod));
  g.add(drum(cx, cy, zg - 12, HEAD.top + 4, R * 0.3, anod, 40), drum(cx, cy, HEAD.top + 4, HEAD.top + 7, R * 0.2, mat(0x9aa2b4, { metalness: 0.8, roughness: 0.3 }), 40));
  return { spot, foot: HEAD.fan, top: HEAD.top };
}
