import { PKG } from '../layout/layout';
import { LEG_PITCH, legsFrom, pkgPads, slotLanding } from '../layout/pins';
import { bundleOn, mean } from './bundle';
import { mkLane, nth } from './lane';
import type { Bus, Lane, Pt, TierGeo } from './types';

/** x where the PCIe pins start on the package's south edge (west of the DMI column, see `DMI_X`). */
const PCIE_X = -210;
/** The y where the first slot's lanes step west toward its pads, and the first of the lanes that dive for a slot further down; how far short of a slot a lane comes up (a second row is `PCIE_STAGGER` further). */
const PCIE_STEP_Y = 730,
  PCIE_DIVE_Y = 600,
  PCIE_UP = 200,
  PCIE_STAGGER = 40;
/** How far short of a slot a lane dives on its way under it, and how far past the slot it turns back. */
const SLOT_DIVE = 36,
  SLOT_PAST = 40;

type Rect = TierGeo['pcie'][number];
type Landing = ReturnType<typeof slotLanding>[number];

/** A lane that came down column `x` runs on past a slot's far edge `y` (`dir` its heading), turns back on four 45 degree legs and comes onto the pad `dx` along. */
function underSlot(x: number, y: number, { dir, dx, pad }: { dir: 1 | -1; dx: number; pad: Pt }): Pt[] {
  const s = Math.sign(dx),
    a = Math.abs(dx) * 0.3,
    b = Math.abs(dx) * 0.4,
    y1 = y + dir * SLOT_PAST;
  return [[x, y1], [x + s * a, y1 + dir * a], [x + s * (a + b), y1 + dir * a], [x + dx, y1], pad];
}

/** The arc length of a lane at its point `i`. */
const arcTo = (l: Lane, i: number): number => l.seg.slice(0, i).reduce((a, d) => a + d, 0);

/** The bus being built, and the slot's own lanes (`own`) and those that pass under it to its far side (`far`). */
interface Slot {
  lanes: Lane[];
  own: Lane[];
  far: Lane[];
}

/** Add lane `l` to the bus and to the slot (and to its far lanes when `far`). */
function addLane(s: Slot, l: Lane, far: boolean): void {
  s.lanes.push(l);
  s.own.push(l);
  if (far) {
    s.far.push(l);
  }
}

/** One lane of a slot the CPU feeds: from `pin` down its band, onto the pad (or under the slot to the far side); a lane of a lower slot (`row` > 0) dives at the CPU. */
function cpuLane(s: Slot, q: Landing, { pin, r, row, i }: { pin: Pt; r: Rect; row: number; i: number }): void {
  const y1 = row === 0 ? PCIE_STEP_Y : PCIE_DIVE_Y,
    up = r.y - PCIE_UP - (i % 2 === 0 ? 0 : PCIE_STAGGER);
  const pts: Pt[] = [pin, [pin[0], y1], [q.x, y1 + Math.abs(pin[0] - q.x)]];
  if (row !== 0) {
    pts.push([q.x, up]);
  }
  const at = pts.length - 1;
  if (q.far) {
    pts.push([q.x, r.y - SLOT_DIVE], ...underSlot(q.x, r.y + r.h, { dir: 1, dx: q.dx, pad: q.pad }));
  } else {
    pts.push(q.pad);
  }
  const l = mkLane(pts, s.lanes.length * 37),
    hops: [number, number][] = row === 0 ? [] : [[6, arcTo(l, at)]];
  if (q.far) {
    hops.push([arcTo(l, at + 1), arcTo(l, pts.length - 2)]);
  }
  if (hops.length > 0) {
    l.hops = hops;
  }
  addLane(s, l, q.far);
}

/** The lanes of a slot the CPU feeds, from the package's south pins (row `row`: the first slot on the outer row). */
function cpuSlot(s: Slot, r: Rect, { pairs, row }: { pairs: number; row: number }): void {
  const pins = pkgPads(PKG, 's', PCIE_X, pairs, 1, row);
  for (const [i, q] of slotLanding(r, pairs, 'n').entries()) {
    cpuLane(s, q, { pin: nth(pins, i), r, row, i });
  }
}

/** The lanes of a x4 slot the chipset feeds: from its west legs (`at` the first leg), west under the slots and onto the slot from its nearer side. */
function chipSlot(s: Slot, r: Rect, { g, pairs, at }: { g: TierGeo; pairs: number; at: number }): void {
  const legs = legsFrom(g.chip, 'w', at, pairs),
    yc = mean(legs, 1),
    near = yc > r.y + r.h / 2 ? 's' : 'n',
    dir = near === 's' ? -1 : 1;
  const land = slotLanding(r, pairs, near),
    ny = near === 's' ? r.y + r.h : r.y,
    fy = near === 's' ? r.y : r.y + r.h,
    ends = land.map((q): Pt => [q.x, ny]),
    xl = mean(ends, 0);
  const centre: Pt[] = [
    [nth(legs, 0)[0], yc],
    [xl, yc],
    [xl, ny],
  ];
  const match = { w: 9, flare: 30, axis: 'h', side: 'low' } as const;
  for (const pts of bundleOn(centre, { n: pairs, spacing: LEG_PITCH, c: 60 }, { from: legs, to: ends, match })) {
    const end = nth(pts, -1),
      q = land.find((p) => Math.abs(p.x - end[0]) < 0.5);
    if (q === undefined) {
      throw new Error('a slot lane ends on no pad');
    }
    if (!q.far) {
      addLane(s, mkLane(pts, s.lanes.length * 37), false);
      continue;
    }
    const l = mkLane([...pts, ...underSlot(q.x, fy, { dir, dx: q.dx, pad: q.pad })], s.lanes.length * 37);
    l.hops = [[arcTo(l, pts.length - 1) - SLOT_DIVE, arcTo(l, l.pts.length - 2)]];
    addLane(s, l, true);
  }
}

/**
 * PCIe: every slot has its real pairs (`pcieLinks`), half landing on the side of the slot they come from, half on the other, as send and receive do. A slot the
 * CPU feeds gets them from the package's south pins, the first slot's on the outer row. They run down in a band 20 apart and step west onto their pads; those
 * for the far side dive just short of the slot, pass under it and come up beyond it. A slot further down lies behind the ones above it: its lanes dive at the
 * CPU, on inner rows, and come up in staggered rows of vias above it. A x4 slot's lanes leave the chipset's west legs, run west under the slots and turn onto it.
 */
export function pcieBus(g: TierGeo): Bus {
  const lanes: Lane[] = [],
    groups: Lane[][] = [],
    heads: { name: string; lanes: Lane[] }[] = [];
  let row = 0,
    west = 0;
  for (const [k, r] of g.pcie.entries()) {
    const { pairs, cpu } = nth(g.pcieLinks, k),
      s: Slot = { lanes, own: [], far: [] };
    if (cpu) {
      cpuSlot(s, r, { pairs, row });
      row++;
    } else {
      chipSlot(s, r, { g, pairs, at: nth(g.west.slots, west) });
      west++;
    }
    groups.push(
      s.own.filter((l) => !s.far.includes(l)),
      s.far,
    );
    heads.push({ name: `pcie${k}`, lanes: s.own });
  }
  return { id: 'pcie', w: 9, pad: 12, lanes, groups, heads };
}
