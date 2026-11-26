import { ioPort } from '../layout/boardlayout';
import { PKG } from '../layout/layout';
import { LEG_PITCH, SATA_LANES, ioPads, legRun, m2Pads, pkgPads, sataPads } from '../layout/pins';
import { NVME_LANES } from './bus';
import { bundleOn, mean, mk } from './bundle';
import { mkLane, nth } from './lane';
import type { Bus, Edges, Lane, Pt, TierGeo } from './types';

/**
 * The columns that leave the south edge of the package, west to east: the CPU's clock (from its crystal), the PCIe pins (32 pairs, on the outer row for the first
 * slot, on the inner rows for the others the CPU feeds), DMI (steps east onto the chipset's north legs), then one NVMe column per M.2 (the lowest M.2 in the
 * westmost column, so none crosses another). Every PCIe slot ends before the DMI column.
 */
const DMI_X = 240,
  NVME_DX = 90;
/** x of NVMe column `j` (0 the westmost), on its own pads of the package's south edge. */
const nvmeX = (j: number): number => 340 + NVME_DX * j;
/** The spacing of an NVMe bundle's lanes, and the lanes in the DMI link. */
const NVME_SPACING = 22,
  DMI_LANES = 6;

/**
 * NVMe: one bundle per M.2 (all below the CPU) down a column of its own from the CPU's south edge, east along the M.2's row to the middle
 * contacts of its socket: the lowest M.2 in the westmost column, so none crosses another.
 */
export function nvmeBus(g: TierGeo, { qy }: Edges): Bus[] {
  const lanes: Lane[] = [],
    n = g.m2.length;
  for (const [k, m] of g.m2.entries()) {
    const y = m.y + m.h / 2,
      pads = m2Pads(m),
      x = nvmeX(n - 1 - k);
    const centre: Pt[] = [
      [x, qy],
      [x, y],
      [nth(pads, 0)[0], y],
    ];
    for (const pts of bundleOn(
      centre,
      { n: NVME_LANES, spacing: NVME_SPACING, c: 100 },
      { from: pkgPads(PKG, 's', x, NVME_LANES), to: pads, match: { w: 10, flare: 36, side: 'high', axis: 'h' } },
    )) {
      lanes.push(mkLane(pts, lanes.length * 37));
    }
  }
  return lanes.length > 0 ? [{ id: 'nvme', w: 10, lanes }] : [];
}

/** DMI: CPU south edge down, east of the PCIe slots' ends and west of the NVMe columns, then (under the lowest M.2) one 45 degree step east onto the chipset's north legs. */
export function dmiBus(g: TierGeo, { qy }: Edges): Bus {
  const legs = legRun(g.chip, 'n', DMI_LANES),
    cx = mean(legs, 0),
    [, ly] = nth(legs, 0),
    dx = cx - DMI_X;
  const route: Pt[] =
    Math.abs(dx) < 1
      ? [
          [DMI_X, qy],
          [DMI_X, ly],
        ]
      : [
          [DMI_X, qy],
          [DMI_X, ly - 60 - Math.abs(dx)],
          [cx, ly - 60],
          [cx, ly],
        ];
  return mk('dmi', route, {
    n: DMI_LANES,
    spacing: LEG_PITCH,
    w: 9,
    c: 0,
    ends: { from: pkgPads(PKG, 's', DMI_X, DMI_LANES), to: legs, match: { w: 9, flare: 32, side: 'low', margin: 20 } },
  });
}

/**
 * USB: four lanes from the CPU's west edge to the hub's east legs; from its west legs two lanes per port fan out (all the same way)
 * to the pads on the shield plate, level with each port.
 */
export function usbBus(g: TierGeo, { px }: Edges): Bus {
  const { hub } = g,
    up = legRun(hub, 'e', 4),
    lanes: Lane[] = [];
  const trunk: Pt[] = [
    [px, 0],
    [nth(up, 0)[0], 0],
  ];
  for (const pts of bundleOn(
    trunk,
    { n: 4, spacing: LEG_PITCH, c: 0 },
    { from: pkgPads(PKG, 'w', 0, 4), to: up, match: { w: 9, flare: 34 } },
  )) {
    lanes.push(mkLane(pts, lanes.length * 37));
  }
  const legs = legRun(hub, 'w', 2 * g.usb);
  for (let p = 0; p < g.usb; p++) {
    const own = legs.slice(2 * p, 2 * p + 2),
      yc = mean(own, 1),
      pads = ioPads(ioPort(`usb${p}`), 2);
    const centre: Pt[] = [
      [nth(own, 0)[0], yc],
      [nth(pads, 0)[0], yc],
    ];
    for (const pts of bundleOn(centre, { n: 2, spacing: LEG_PITCH, c: 0 }, { from: own, to: pads, lead: 60 })) {
      lanes.push(mkLane(pts, lanes.length * 37));
    }
  }
  return { id: 'usb', w: 9, lanes };
}

/** The centre line of SATA port `p`'s bundle: from `x0` at its legs' height `yc`, a 45 degree leg that ends at `xe`, along the port's row onto its pads. */
function sataRoute(p: TierGeo['sata'][number], { x0, yc, xe }: { x0: number; yc: number; xe: number }): Pt[] {
  const y = p.y + p.h / 2,
    d = y - yc,
    [px] = nth(sataPads(p), 0);
  return Math.abs(d) < 1
    ? [
        [x0, y],
        [px, y],
      ]
    : [
        [x0, yc],
        [xe - Math.abs(d), yc],
        [xe, y],
        [px, y],
      ];
}

/**
 * SATA: a bundle per port from the chipset's east legs (one run of contiguous legs, three per port) to the pads on the port's west
 * side, fanning out on 45 degree legs that all end at the same x (the outer ports start theirs first), so nothing crosses and the run
 * across the board is straight, along the port's row (the drive cables continue from there).
 */
export function sataBus(g: TierGeo): Bus[] {
  if (g.sata.length === 0) {
    return [];
  }
  const lanes: Lane[] = [],
    legs = legRun(g.chip, 'e', g.sata.length * SATA_LANES),
    [x0] = nth(legs, 0);
  const yc = (i: number): number => nth(legs, i * SATA_LANES + 1)[1];
  const dmax = Math.max(0, ...g.sata.map((p, i) => Math.abs(p.y + p.h / 2 - yc(i))));
  const xe = x0 + 60 + dmax;
  for (const [i, p] of g.sata.entries()) {
    const own = legs.slice(i * SATA_LANES, (i + 1) * SATA_LANES),
      route = sataRoute(p, { x0, yc: yc(i), xe });
    for (const pts of bundleOn(route, { n: SATA_LANES, spacing: LEG_PITCH, c: 0 }, { from: own, to: sataPads(p) })) {
      lanes.push(mkLane(pts, i * 29 + lanes.length * 37));
    }
  }
  return [{ id: 'sata', w: 9, lanes }];
}
