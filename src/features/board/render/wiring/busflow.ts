// Signals on the board's traces: when two parts talk, a short bright packet runs along the lanes between them, the trace it has gone
// along stays lit behind it, and the light dies away a moment after it arrives. Nothing is lit between messages. Pixi drawing only; which
// bus talks, when and in which direction is the caller's (live.ts).
// Kept cheap on purpose (the strokes are rebuilt for every drawing, and Pixi cuts each into triangles): two plain strokes a lane, a trail and a
// head, with square ends and mitred corners, no halo and no white core. Round caps and joins were the largest part of that cutting (docs/render/live.md "Performance").

import { Graphics } from 'pixi.js';
import { mix } from '@/core/render/ink';
import type { Lane, Pt } from './routes';

/** How fast a signal runs along a trace (world units per game ms), and the shortest and longest time one trip takes (ms). */
const SIGNAL_SPEED = 9;
export const MIN_MS = 170;
export const MAX_MS = 340;
/** How long a trace stays lit after the packet has arrived (ms). */
export const FADE_MS = 220;
/** Length of the packet's bright head along the trace (world units). */
const HEAD = 150;
const MAX_RUNS = 64;
/** A message lights at most this many lanes of a wide link (a x16 slot has 32): every drawing strokes each lit lane twice. */
export const MAX_LIT = 8;

/** One message on a set of parallel lanes. `dir` 1 runs from each lane's first point to its last, -1 the other way. */
interface Run {
  lanes: Lane[];
  dir: 1 | -1;
  color: string;
  bright: string;
  w: number;
  t0: number;
  dur: number;
}

/** How long one trip along `lanes` takes (ms): the longest lane at the signal's speed, between `MIN_MS` and `MAX_MS`. */
export const tripMs = (lanes: readonly Lane[]): number =>
  Math.max(MIN_MS, Math.min(MAX_MS, lanes.reduce((m, l) => Math.max(m, l.len), 0) / SIGNAL_SPEED));

/** The part of a lane between arc lengths `a` and `b` (clamped to the lane). */
export function slice(lane: Lane, a: number, b: number): Pt[] {
  a = Math.max(0, a);
  b = Math.min(lane.len, b);
  if (b - a < 0.5) return [];
  const out: Pt[] = [];
  let s = 0;
  for (let i = 0; i < lane.seg.length; i++) {
    const s0 = s,
      d = lane.seg[i]!;
    s += d;
    if (s <= a || s0 >= b) continue;
    const p = lane.pts[i]!,
      q = lane.pts[i + 1]!;
    const at = (x: number): Pt => {
      const f = d ? (x - s0) / d : 0;
      return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
    };
    if (!out.length) out.push(at(Math.max(a, s0)));
    out.push(at(Math.min(b, s))); // (the end of this stretch is the start of the next)
  }
  return out;
}

/** The parts of arc lengths `a..b` on the surface: where a lane dives (`Lane.hops`) nothing shows. */
function surfaced(lane: Lane, a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  let at = a;
  for (const [h0, h1] of lane.hops ?? []) {
    if (h1 <= at) continue;
    if (h0 >= b) break;
    if (h0 > at) out.push([at, h0]);
    at = h1;
  }
  if (at < b) out.push([at, b]);
  return out;
}

/** The packets in flight on one layer. */
export class BusFlow {
  readonly g = new Graphics();
  private runs: Run[] = [];

  constructor() {
    this.g.blendMode = 'add';
  }

  /** Start a message on `lanes` at game time `now` (+ `delay`). Returns how long the trip takes, so a next hop can start when this one ends. */
  send(lanes: Lane[], dir: number, color: string, now: number, w: number, delay = 0): number {
    const dur = tripMs(lanes),
      every = Math.ceil(lanes.length / MAX_LIT);
    this.runs.push({
      lanes: every > 1 ? lanes.filter((_, i) => (i + 1) % every === 0) : lanes,
      dir: dir < 0 ? -1 : 1,
      color,
      bright: mix(color, '#ffffff', 0.35),
      w,
      t0: now + delay,
      dur,
    });
    if (this.runs.length > MAX_RUNS) this.runs.shift();
    return dur;
  }

  clear() {
    this.runs.length = 0;
    this.g.clear();
  }

  get busy() {
    return this.runs.length > 0;
  }

  /** Draw the packets at game time `now`; `show` false (the interior is hidden) only lets them age. */
  frame(now: number, zoom: number, show: boolean): void {
    const g = this.g;
    g.clear();
    this.runs = this.runs.filter((r) => now < r.t0 + r.dur + FADE_MS);
    if (!show) return;
    const minW = 2.2 / Math.max(zoom, 0.05);
    for (const r of this.runs) {
      const age = now - r.t0;
      if (age < 0) continue;
      const u = Math.min(1, age / r.dur),
        fade = age > r.dur ? 1 - (age - r.dur) / FADE_MS : 1;
      const w = Math.max(r.w, minW);
      for (const lane of r.lanes) {
        const d = u * lane.len,
          head = Math.min(HEAD, lane.len * 0.3);
        const paint = (from: number, to: number, color: string, alpha: number) => {
          // travelled distance `from..to` counts from the lane's start when dir is 1, from its end when dir is -1
          for (const [a, b] of r.dir > 0 ? surfaced(lane, from, to) : surfaced(lane, lane.len - to, lane.len - from)) {
            const pts = slice(lane, a, b);
            if (pts.length < 2) continue;
            g.moveTo(pts[0]![0], pts[0]![1]);
            for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
            g.stroke({ width: w, color, alpha: alpha * fade });
          }
        };
        paint(0, d - head, r.color, 0.3);
        paint(d - head, d, r.bright, 0.9);
      }
    }
  }
}
