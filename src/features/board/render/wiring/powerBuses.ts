/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import type { TierGeo } from '../layout/boardlayout';
import { PKG } from '../layout/layout';
import { atx12v, atx12vSlots, cpuPowerPins, dimmPowerPad, m2Tie, pcieFeed, slotTie } from '../layout/pins';
import { DRAM_IN_X, DRAM_OUT_X, VRM_OUT_X, vdimmEnd, vdimmStart } from './bus';
import type { Bus, Edges } from './bus';
import { bundle, chamfer, mk } from './bundle';
import { mkLane, nth } from './lane';
import type { Lane, Pt } from './lane';

/** How far in from the package's corners the core-voltage runs land on its north edge. */
const VCORE_IN = 90;

/** 8-pin CPU 12 V: a comb: the four pins' runs drop onto the input rail, which runs east over every phase. */
export function cpuPowerBus(g: TierGeo): Bus {
  const pins = cpuPowerPins(g.cpw),
    last = nth(g.vrmPhases, -1),
    ye = g.vrmRailY,
    [x0, y0] = nth(pins, 0);
  const rail: Pt[] = [
    [x0, y0],
    [x0, ye],
    [last.x + last.w - 30, ye],
  ];
  const lanes: Lane[] = [mkLane(chamfer(rail, 60), 0)];
  for (let i = 1; i < pins.length; i++) {
    const [x] = nth(pins, i);
    lanes.push(
      mkLane(
        [
          [x, y0],
          [x, ye],
        ],
        i * 31,
      ),
    );
  }
  return { id: 'pwrcpu', w: 30, lanes };
}

/**
 * Core voltage: one run per phase from its output stub down into the package's north edge, the runs spread evenly along the edge (a
 * phase beyond it steps in on a 45 degree leg that ends just above it, so the runs funnel in without crossing).
 */
export function vcoreBus(g: TierGeo, { py }: Edges): Bus {
  const lanes: Lane[] = [],
    n = g.vrmPhases.length,
    span = PKG.w - 2 * VCORE_IN;
  for (const [i, r] of g.vrmPhases.entries()) {
    const x = r.x + VRM_OUT_X,
      lx = PKG.x + VCORE_IN + (span * (i + 0.5)) / n,
      dx = Math.abs(x - lx),
      yb = py - 40;
    const route: Pt[] =
      dx < 1
        ? [
            [x, r.y + r.h - 4],
            [x, py + 8],
          ]
        : [
            [x, r.y + r.h - 4],
            [x, yb - dx],
            [lx, yb],
            [lx, py + 8],
          ];
    lanes.push(mkLane(route, i * 20));
  }
  return { id: 'vcore', lanes, w: 46 };
}

/** 24-pin 12 V: straight west from the connector's top pin to the memory regulator's input rail (the connector sits level with it). */
export function atxPowerBus(g: TierGeo): Bus {
  const pin = atx12v(g.atx),
    xw = nth(g.dPhases, 0).x + DRAM_IN_X;
  return mk('pwr12', [pin, [xw, pin[1]]], { n: 1, spacing: 0, w: 36, c: 0 });
}

/** Memory voltage: the regulator's output rail along the north ends of the sockets, a drop into every DIMM. */
export function vdimmBus(g: TierGeo): Bus {
  const y = g.vdimmY;
  const lanes: Lane[] = [];
  const rail: Pt[] = [
    [vdimmStart(g), y],
    [vdimmEnd(g), y],
  ];
  for (const pts of bundle(rail, { n: 2, spacing: 34, c: 60 })) {
    lanes.push(mkLane(pts, lanes.length * 31));
  }
  // outputs of the phases down to the rail
  for (const [i, r] of g.dPhases.entries()) {
    const x = r.x + DRAM_OUT_X;
    lanes.push(
      mkLane(
        [
          [x, r.y + r.h - 4],
          [x, y - 17],
        ],
        90 + i * 20,
      ),
    );
  }
  const taps = g.dimm.map((d, i) => {
    const [cx, ey] = dimmPowerPad(d.rect);
    const drop: Pt[] = [
      [cx, y],
      [cx, ey],
    ];
    return { key: `dimm${i}`, lanes: [mkLane(drop, i * 13)] };
  });
  return { id: 'vdimm', w: 26, lanes, taps };
}

/**
 * The slot supply: the 24-pin's lowest 12 V pin, west to the strip beside the connector, down that strip to the x16 slot's level, west under the
 * sockets and lanes it meets (it dives under them) and up into the tab at the slot's latch end. The cards' aux power does not come this way: the
 * PSU's leads plug into the cards themselves. Lane 0 is that run; the others branch off it at a trunk just west of the M.2 housings: one
 * per further slot (west along the gap above its card, then down into its power patch) and one per M.2 socket (into its patch), in that order.
 */
export function slotPowerBus(g: TierGeo): Bus[] {
  const [slot0] = g.pcie;
  if (!slot0) {
    return [];
  }
  const a = atx12vSlots(g.atx),
    f = pcieFeed(slot0),
    xv = g.atx.x - 40,
    xt = 1100;
  // the run west leaves the slot's level, but not through the chipset or the SATA lanes: where the chipset stands at that level it passes above it
  const yc0 = f[1] + 35,
    over = yc0 >= g.chip.y && yc0 <= g.chip.y + g.chip.h,
    yc = over ? g.chip.y - 60 : yc0,
    xs = f[0] + (over ? 45 : 90);
  const run: Pt[] = [a, [xv, a[1]], [xv, yc], [xs, yc], [xs, f[1]], f];
  const lanes: Lane[] = [mkLane(chamfer(run, over ? 24 : 70), 0)];
  const trunk: Pt[] = [a, [xv, a[1]], [xv, yc], [xt, yc]];
  for (const [k, r] of g.pcie.entries()) {
    if (k === 0) {
      continue;
    }
    const t = slotTie(r, k),
      yh = Math.min(r.y - 300, g.chip.y - 60),
      tx = t.x + t.w / 2;
    lanes.push(mkLane(chamfer([...trunk, [xt, yh], [tx, yh], [tx, t.y]], 30), k * 17));
  }
  for (const [k, m] of g.m2.entries()) {
    const t = m2Tie(m),
      ty = t.y + t.h / 2;
    lanes.push(mkLane(chamfer([...trunk, [xt, ty], [t.x, ty]], 70), (g.pcie.length + k) * 17));
  }
  return [{ id: 'pwrpcie', w: 22, lanes }];
}
