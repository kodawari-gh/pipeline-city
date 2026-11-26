/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import type { TierGeo } from '../layout/boardlayout';
import { PKG } from '../layout/layout';
import { BEV, toothFor, toothPts } from '../layout/match';
import { dimmPinX, pkgPads } from '../layout/pins';
import type { Bus } from './bus';
import { mkLane, nth } from './lane';
import type { Lane, Pt } from './lane';

/** How tall a memory lane's teeth may stand (the lane above keeps them lower), the room they leave under that lane, and where they end short of the bank. */
const MEM_TOOTH_MAX = 70,
  MEM_CLEAR = 20,
  MEM_ZIG_END = 34;
/** A memory lane dives this far west of the bank and comes up this far short of its own pin column. */
const MEM_DIVE = 18,
  MEM_RISE = 26;
/** A tooth's base, its flat top and the space between teeth. */
const TOOTH_B0 = 5,
  TOOTH_FLAT = 6,
  TOOTH_SPACE = 6;

/** One memory lane: stick `i`, row `r`, from its pad on the package to its pin (x1, y1); it runs east to `xs`, its 45 degree leg ends at `xe`, and it is `base` long before its teeth. */
interface MemLane {
  i: number;
  r: number;
  pad: Pt;
  y0: number;
  y1: number;
  x1: number;
  xs: number;
  xe: number;
  base: number;
}

/** Every memory lane, its 45 degree leg placed and its length before teeth (`base`) measured. */
function memLanes(g: TierGeo, xMin: number): MemLane[] {
  const all = g.dimm.flatMap((d, i) =>
    nth(g.memLand, i).map((y1, r): MemLane => {
      const from = nth(nth(g.memFrom, i), r),
        pad = nth(pkgPads(PKG, 'e', from, 1), 0);
      return { i, r, pad, y0: pad[1], y1, x1: dimmPinX(d.rect), xs: xMin, xe: xMin, base: 0 };
    }),
  );
  // the 45 degree legs: parallel, 30 apart along x + y (going up) or x - y (going down), so they keep their distance
  let c = -Infinity;
  for (const q of all.filter((m) => m.y1 < m.y0 - 0.5).toSorted((a, b) => a.y0 - b.y0)) {
    q.xs = Math.max(xMin, c + 30 - q.y0);
    c = q.xs + q.y0;
  }
  c = -Infinity;
  for (const q of all.filter((m) => m.y1 > m.y0 + 0.5).toSorted((a, b) => b.y0 - a.y0)) {
    q.xs = Math.max(xMin, c + 30 + q.y0);
    c = q.xs - q.y0;
  }
  for (const q of all) {
    const dy = Math.abs(q.y1 - q.y0);
    q.xe = q.xs + dy;
    q.base = q.xs - q.pad[0] + dy * Math.SQRT2 + q.x1 - q.xe;
  }
  return all;
}

/** The teeth that make up `e` of length on lane `q`, in the room `room` under the lane above, ending just short of the bank at `x0`. */
function teeth(q: MemLane, { e, room, x0 }: { e: number; room: number; x0: number }): Pt[] {
  const m = Math.max(1, Math.ceil(e / (2 * room - 1.5 * BEV) - 1e-9)),
    { A, b } = toothFor(e / m, TOOTH_B0, room),
    pitch = 4 * b + TOOTH_FLAT + TOOTH_SPACE;
  const a0 = x0 - MEM_ZIG_END - (m * pitch - TOOTH_SPACE),
    P = (t: number, h: number): Pt => [a0 + t, q.y1 - h];
  const pts: Pt[] = [];
  for (let j = 0; j < m; j++) {
    pts.push(...toothPts(P, j * pitch, 0, b, A, TOOTH_FLAT));
  }
  return pts;
}

/** The lane of `q`: pad, east run, 45 degree leg, teeth for the length it lacks (`e`), pin; a lane to a stick behind others dives under the sockets. */
function memLane(q: MemLane, { e, above, x0 }: { e: number; above: MemLane | undefined; x0: number }): Lane {
  const pts: Pt[] = [q.pad, [q.xs, q.y0]];
  if (q.xe > q.xs + 0.5) {
    pts.push([q.xe, q.y1]);
  }
  if (e > 0.4) {
    const room = Math.min(MEM_TOOTH_MAX, above ? q.y1 - above.y1 - MEM_CLEAR : MEM_TOOTH_MAX);
    pts.push(...teeth(q, { e, room, x0 }));
  }
  pts.push([q.x1, q.y1]);
  const l = mkLane(
    pts.filter((p, j) => j === 0 || Math.hypot(p[0] - nth(pts, j - 1)[0], p[1] - nth(pts, j - 1)[1]) > 1e-6),
    q.r * 37 + q.i * 11,
  );
  if (q.i > 0) {
    l.hops = [[l.len - (q.x1 - (x0 - MEM_DIVE)), l.len - MEM_RISE]];
  }
  return l;
}

/**
 * The memory bus: a tap per stick, a lane in every row. A lane leaves its pin on the CPU's east edge, runs east, climbs or drops at 45 degrees to its height on
 * the bank and runs east onto its stick's pin column. The lanes fan out without crossing: going up the highest lane bends first, going down the lowest. Every
 * lane is as long as the longest: a nearer stick's lane makes up the rest in a row of teeth that ends just short of the bank, the zigzags a real board's memory
 * lanes carry. A lane to a stick behind others dives at the bank and comes up at its own socket: under the sockets it runs on an inner layer.
 */
export function memBus(g: TierGeo, qx: number): Bus {
  const x0 = nth(g.dimm, 0).rect.x;
  const all = memLanes(g, qx + 30);
  const longest = Math.max(...all.map((q) => q.base));
  // from the top of the bank down: a lane's teeth stand in the room under the lane above it
  const byY = all.toSorted((a, b) => a.y1 - b.y1);
  const taps = g.dimm.map((_, i) => ({ key: `dimm${i}`, lanes: [] as Lane[] }));
  for (const [k, q] of byY.entries()) {
    nth(taps, q.i).lanes[q.r] = memLane(q, { e: longest - q.base, above: byY[k - 1], x0 });
  }
  return { id: 'mem', w: 9, pad: 13, lanes: [], taps };
}
