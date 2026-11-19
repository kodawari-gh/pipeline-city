// The coolant's way through the machine as straight runs (docs/render/air.md "The water"): from the pump's cold plate up the hot hose to the radiator, in along
// the near tank, through the lanes of the core to the far tank, back along the other lanes to the near tank's other port, down the cold hose to the pump. Each
// run carries the loop coordinate `s` (length along the loop) at both its ends, so one function (`waterAt`) says how hot the water is anywhere on it: the
// water is hot from the plate to the core, cools along its lanes, is cold from the core back to the plate and heats again across the plate.
// Pure: no Three, so a test builds the net from the real hoses and the radiator's flow (`radiatorFlow`).
import type { V3 } from './grid';

/** One straight run of the water: its two ends, the loop coordinate at each, its radius, and a phase that keeps parallel lanes from pulsing in step. */
export interface WaterRun { a: V3; b: V3; sa: number; sb: number; r: number; ph: number }

export interface WaterNet {
  runs: WaterRun[];
  /** Where the water's temperature changes: loop coordinates (rising) and, at each, the share of the way from the cold side (0) to the hot (1). */
  stops: number[];
  level: number[];
  /** The loop's length. */
  length: number;
}

/** What the net needs of the radiator (`radiatorFlow` of cooler3d.ts): its tubes' ends, its two ports, the way a fitting points, and the core's half thickness. */
export interface WaterRad { tubes: readonly { a: V3; b: V3 }[]; ports: readonly V3[]; inward: V3; reach: number; half: number }

/** What it needs of the pump: where its ports are north of its middle, and the depth of its cold plate (world). */
export interface WaterBlock { portY: number; plate: number }

/** The radii of the water (world units): in a hose (its sleeve is 140), in a lane of the core, in a tank, in the pump. */
export const WATER_R = { hose: 100, lane: 120, tank: 90, block: 95 } as const;

/** How many straight runs each span of a hose's line is cut into: a bend of the hose turns by a few degrees at each joint, so the strips meet without a notch. */
const HOSE_CUTS = 8;

const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const copy = (p: V3): V3 => [p[0], p[1], p[2]];

/** A line of points smoothed: each span cut into `per` pieces along a Catmull-Rom curve through them (the ends stay put). */
export function smooth(pts: readonly V3[], per = 3): V3[] {
  if (pts.length < 3) return pts.map(copy);
  const at = (i: number): V3 => pts[Math.max(0, Math.min(pts.length - 1, i))]!, out: V3[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t, c = (j: 0 | 1 | 2): number =>
        0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t3);
      out.push([c(0), c(1), c(2)]);
    }
  }
  out.push(copy(pts[pts.length - 1]!));
  return out;
}

/** The depths where the lanes of a group run (spread over its tubes' depths), and the middle of the group. */
function lanesOf(tubes: readonly { a: V3 }[]): { zs: number[]; lo: number; hi: number; mid: number } {
  const z = tubes.map((t) => t.a[2]), lo = Math.min(...z), hi = Math.max(...z), mid = (lo + hi) / 2;
  return { zs: [lo + (hi - lo) * 0.12, mid, lo + (hi - lo) * 0.88], lo, hi, mid };
}

/**
 * The water's net from the two hoses (each from the pump's end to the radiator's, the hot one first) and the radiator's flow. The water goes in along one half
 * of the core, a half of its thickness inboard of the middle plane, turns in the far tank and comes back along the other half, outboard (seen from the glass
 * the lanes lie edge on, one over another: set apart across the core, the heat the water gives up shows along it). Null: not a loop.
 */
export function waterNet(hoses: readonly (readonly V3[])[], rad: WaterRad | null | undefined, block: WaterBlock): WaterNet | null {
  const [hot, cold] = hoses;
  if (!hot || !cold || hot.length < 2 || cold.length < 2 || !rad || rad.tubes.length < 1 || rad.ports.length < 2) return null;
  const runs: WaterRun[] = [], stops: number[] = [], level: number[] = [];
  const knot = (s: number, l: number): void => { stops.push(s); level.push(l); };
  // a run along `pts` from the loop coordinate `s0`; returns the coordinate at its end
  const run = (pts: readonly V3[], s0: number, r: number, ph = 0): number => {
    let s = s0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!, d = dist(a, b);
      if (d < 1) continue;
      runs.push({ a: copy(a), b: copy(b), sa: s, sb: s + d, r, ph });
      s += d;
    }
    return s;
  };
  // the pump: in at the cold port, down to the plate, across it (the water takes the processor's heat there), up and out at the hot port
  const c0 = cold[0]!, h0 = hot[0]!, R = WATER_R;
  const pc: V3 = [c0[0], block.portY, c0[2]], ph: V3 = [h0[0], block.portY, h0[2]], qc: V3 = [c0[0], 0, block.plate], qh: V3 = [h0[0], 0, block.plate];
  knot(0, 0);
  let s = run([c0, pc, qc], 0, R.block);
  knot(s, 0);
  s = run([qc, qh], s, R.block);
  knot(s, 1);
  s = run([qh, ph, h0], s, R.block);
  // the hot hose to the radiator
  const hotLine = smooth(hot, HOSE_CUTS), coldLine = smooth([...cold].reverse(), HOSE_CUTS);
  s = run(hotLine, s, R.hose);
  // the radiator: the tubes in the near half of its depth take the water in, the others bring it back
  const { tubes, ports, inward, half } = rad, zm = (ports[0]![2] + ports[1]![2]) / 2;
  let ins = tubes.filter((t) => t.a[2] < zm), outs = tubes.filter((t) => t.a[2] >= zm);
  if (!ins.length || !outs.length) {
    const k = Math.max(1, Math.min(tubes.length - 1, Math.floor(tubes.length / 2)));
    ins = tubes.slice(0, k);
    outs = tubes.length > 1 ? tubes.slice(k) : tubes.slice(0);
  }
  const zi = lanesOf(ins), zo = lanesOf(outs), off = half * 0.5, A = tubes[0]!.a, B = tubes[0]!.b;
  const place = (p: V3, side: 1 | -1, z: number): V3 => [p[0] + inward[0] * off * side, p[1] + inward[1] * off * side, z];
  const nIn = (z: number): V3 => place(A, 1, z), fIn = (z: number): V3 => place(B, 1, z), nOut = (z: number): V3 => place(A, -1, z), fOut = (z: number): V3 => place(B, -1, z);
  const reach = dist(nIn(0), fIn(0)), hi = (zi.hi - zi.lo) / 2, ho = (zo.hi - zo.lo) / 2;
  // in at the near tank's middle, spread along the tank to the lanes
  const end = hotLine[hotLine.length - 1]!, endC = coldLine[0]!;
  s = run([end, nIn(zi.mid)], s, R.tank);
  run([nIn(zi.mid), nIn(zi.lo)], s, R.tank);
  run([nIn(zi.mid), nIn(zi.hi)], s, R.tank);
  const s1 = s + hi;
  knot(s1, 1);
  zi.zs.forEach((z, k) => run([nIn(z), fIn(z)], s1, R.lane, 0.31 * k));
  // the far tank: the lanes' water gathers, turns across the core and spreads to the other lanes
  const s2 = s1 + reach;
  knot(s2, 0.5);
  run([fIn(zi.lo), fIn(zi.mid)], s2, R.tank);
  run([fIn(zi.hi), fIn(zi.mid)], s2, R.tank);
  const s3 = run([fIn(zi.mid), fOut(zo.mid)], s2 + hi, R.tank);
  run([fOut(zo.mid), fOut(zo.lo)], s3, R.tank);
  run([fOut(zo.mid), fOut(zo.hi)], s3, R.tank);
  const s4 = s3 + ho;
  knot(s4, 0.5);
  zo.zs.forEach((z, k) => run([fOut(z), nOut(z)], s4, R.lane, 0.31 * k + 0.15));
  // back at the near tank: it gathers at the other port and leaves by the cold hose
  const s5 = s4 + reach;
  knot(s5, 0);
  run([nOut(zo.lo), nOut(zo.mid)], s5, R.tank);
  run([nOut(zo.hi), nOut(zo.mid)], s5, R.tank);
  s = run([nOut(zo.mid), endC], s5 + ho, R.tank);
  s = run(coldLine, s, R.hose);
  knot(s, 0);
  return { runs, stops, level, length: s };
}

/** The share of the way from cold (0) to hot (1) the water is at loop coordinate `s`. */
export function levelAt(net: Pick<WaterNet, 'stops' | 'level'>, s: number): number {
  const { stops, level } = net, n = stops.length;
  if (n === 0) return 0;
  if (s <= stops[0]!) return level[0]!;
  for (let i = 1; i < n; i++) if (s < stops[i]!) return level[i - 1]! + (level[i]! - level[i - 1]!) * ((s - stops[i - 1]!) / Math.max(1e-3, stops[i]! - stops[i - 1]!));
  return level[n - 1]!;
}

/** The water's temperature at loop coordinate `s`, C: `hotC` where it leaves the pump, `coldC` where it comes back. */
export function waterAt(net: Pick<WaterNet, 'stops' | 'level'>, s: number, hotC: number, coldC: number): number {
  return coldC + levelAt(net, s) * (hotC - coldC);
}
