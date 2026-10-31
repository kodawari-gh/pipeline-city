import { roundedPath, type Pt } from '@/core/render/cable';

// The Swiss (type J) outlet and plug share one outline: a flat top, corners at mid height and a short, chamfered bottom, all corners rounded.

/** A closed outline as flat polygon coordinates, rounded at every corner (`r`). */
function rounded(pts: Pt[], r: number): number[] {
  const n = pts.length, mid: Pt = [(pts[n - 1]![0] + pts[0]![0]) / 2, (pts[n - 1]![1] + pts[0]![1]) / 2];
  return roundedPath([mid, ...pts, mid], r, 14).flat();
}

/** The outlet's recess (the shape the plug's body sits in), centred at (cx, cy), `k` times the reference size (about 470 wide, 250 tall at k 1). */
export const recessPoly = (cx: number, cy: number, k: number) => rounded([[-150, -125], [150, -125], [235, -5], [120, 125], [-120, 125], [-235, -5]].map(([x, y]) => [cx + x! * k, cy + y! * k] as Pt), 55 * k);

/** The plug's body seen from its back, centred at (cx, cy): the same outline, taller (the grab area is about 520 by 560). */
export const plugPoly = (cx: number, cy: number) => rounded([[-170, -215], [170, -215], [250, -20], [140, 220], [-140, 220], [-250, -20]].map(([x, y]) => [cx + x!, cy + y!] as Pt), 70);

/** The three pin holes of an outlet relative to its centre: line and neutral side by side, the earth hole lower between them. */
export const HOLES: readonly Pt[] = [[-105, -20], [105, -20], [0, 62]];
