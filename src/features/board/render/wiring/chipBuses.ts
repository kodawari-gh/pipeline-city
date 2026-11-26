/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import type { TierGeo } from '../layout/boardlayout';
import { ioPort } from '../layout/boardlayout';
import { PKG } from '../layout/layout';
import { LEG_PITCH, cellSide, cellTop, headerPin, ioPads, legRun, legsOf, pkgPads, xtalPads } from '../layout/pins';
import type { Bus } from './bus';
import { chamfer, mean, mk } from './bundle';
import { mkLane, nth } from './lane';
import type { Lane, Pt } from './lane';

/** The pin header called `name`. */
function header(g: TierGeo, name: string): TierGeo['hdrs'][number] {
  const h = g.hdrs.find((q) => q.name === name);
  if (h === undefined) {
    throw new Error(`the board has no ${name} header`);
  }
  return h;
}

/**
 * The I/O hub's links: the Ethernet PHY's four middle east legs and the audio codec's go down to the hub's north legs, the PHY's to the
 * left four, the codec's to the right four (they dive under the display lanes they cross).
 */
export function hubBuses(g: TierGeo): Bus[] {
  const hubN = legsOf(g.hub, 'n'),
    [, top] = nth(hubN, 0),
    cl = legRun(g.codec, 'e', 4),
    cy = mean(cl, 1),
    xc = mean(hubN.slice(4), 0);
  const hda: Pt[] = [
    [nth(cl, 0)[0], cy],
    [xc, cy],
    [xc, top],
  ];
  const out = [
    mk('hda', hda, {
      n: 4,
      spacing: LEG_PITCH,
      w: 8,
      c: 80,
      ends: { from: cl, to: hubN.slice(4), match: { w: 8, flare: 40, axis: 'h' } },
    }),
  ];
  if (g.phy) {
    const pl = legRun(g.phy, 'e', 4),
      py = mean(pl, 1),
      xp = mean(hubN.slice(0, 4), 0);
    const phyl: Pt[] = [
      [nth(pl, 0)[0], py],
      [xp, py],
      [xp, top],
    ];
    out.push(
      mk('phyl', phyl, {
        n: 4,
        spacing: LEG_PITCH,
        w: 8,
        c: 60,
        ends: { from: pl, to: hubN.slice(0, 4), match: { w: 8, flare: 40 } },
      }),
    );
  }
  return out;
}

/** The top board: four lanes from the chipset's south legs down onto the debug display, and the RGB strip's data lane from the ARGB header. */
export function topBuses(g: TierGeo): Bus[] {
  const out: Bus[] = [];
  const { dbg, rgb } = g;
  if (dbg) {
    const legs = legRun(g.chip, 's', 4, -7);
    out.push({ id: 'dbg', w: 8, lanes: legs.map((q, k) => mkLane([q, [q[0], dbg.y]], k * 17)) });
  }
  if (rgb) {
    const h = header(g, 'ARGB'),
      pin = headerPin(h.x, h.y, 1, 0),
      route: Pt[] = [pin, [pin[0], rgb.y - 36], [rgb.x, rgb.y - 36], [rgb.x, rgb.y + rgb.h / 2]];
    out.push({ id: 'rgb', w: 8, lanes: [mkLane(chamfer(route, 24), 0)] });
  }
  return out;
}

/** The index of the leg nearest x, of those not `used` yet (the first one on a tie). */
function nearestLeg(legs: Pt[], x: number, used: Set<number>): number {
  let k = 0,
    best = 1e9;
  for (const [n, q] of legs.entries()) {
    const d = Math.abs(q[0] - x);
    if (!used.has(n) && d < best) {
      best = d;
      k = n;
    }
  }
  return k;
}

/** The CR2032: two lanes from the chipset's south legs down onto its top rim (the RTC), two from its side to the clear-CMOS jumper beside it. */
export function rtcBus(g: TierGeo): Bus {
  const bt = g.bat,
    cx = bt.x + bt.w / 2,
    j = header(g, 'CLR_CMOS'),
    west = j.x < cx,
    legs = legsOf(g.chip, 's'),
    used = new Set<number>(),
    lanes: Lane[] = [];
  for (const [i, dx] of [-34, 34].entries()) {
    const e = cellTop(bt, dx),
      k = nearestLeg(legs, e[0], used);
    used.add(k);
    const leg = nth(legs, k),
      d = e[0] - leg[0],
      y1 = leg[1] + 14;
    const route = Math.abs(d) < 0.5 ? [leg, e] : chamfer([leg, [leg[0], y1], [e[0], y1 + Math.abs(d)], e], 0);
    lanes.push(mkLane(route, i * 17));
  }
  for (const i of [0, 1]) {
    const p = headerPin(j.x, j.y, 0, i);
    lanes.push(mkLane([cellSide(bt, p[1] - (bt.y + bt.h / 2), west), p], i * 17 + 9));
  }
  return { id: 'rtc', w: 8, lanes };
}

/** The four lanes of a fan header: from `legs` along `route` onto its pins. */
const fanBus = (route: Pt[], legs: Pt[], pins: Pt[]): Bus =>
  mk('fanc', route, { n: 4, spacing: LEG_PITCH, w: 8, c: 0, ends: { from: legs, to: pins, lead: 40 } });

/**
 * The fan headers: the CPU fan's four lanes from the I/O hub's south legs (the cooler's cable plugs into it); then the heatsink fans' headers, each a
 * vertical row beside its controller on the side away from its phases: four lanes from the controller's legs on that side (the CPU regulator's west
 * legs; the memory regulator's west or east ones).
 */
export function fanBuses(g: TierGeo): Bus[] {
  const h = header(g, 'CPU_FAN'),
    legs = legsOf(g.hub, 's').slice(4),
    pins = [0, 1, 2, 3].map((i) => headerPin(h.x, h.y, i, 0)),
    xc = mean(legs, 0);
  const out = [
    fanBus(
      [
        [xc, nth(legs, 0)[1]],
        [xc, nth(pins, 0)[1]],
      ],
      legs,
      pins,
    ),
  ];
  for (const [name, ctl, side] of [
    ['VRM_FAN', g.pwm, 'w'],
    ['RAM_FAN', g.dpwm, g.dpwmWest ? 'w' : 'e'],
  ] as const) {
    const v = header(g, name),
      sl = legRun(ctl, side, 4),
      sp = [0, 1, 2, 3].map((j) => headerPin(v.x, v.y, 0, j)),
      yc = mean(sl, 1);
    out.push(
      fanBus(
        [
          [nth(sl, 0)[0], yc],
          [nth(sp, 0)[0], yc],
        ],
        sl,
        sp,
      ),
    );
  }
  return out;
}

/** A crystal's lane up onto its package pin: one 45 degree step onto it (the crystal stands west of the PCIe pins). */
const xtalUp = (p: Pt, q: Pt): Pt[] => [p, [p[0], p[1] - 12], [q[0], p[1] - 12 - Math.abs(q[0] - p[0])], q];

/** The reference crystals: the CPU's (two lanes up onto pins of its south row) and the chipset's (two lanes down onto its last north legs, east of the DMI lanes). */
export function clkBus(g: TierGeo): Bus {
  const cp = xtalPads(g.xtalCpu, 'n'),
    cpins = pkgPads(PKG, 's', mean(cp, 0), 2),
    pp = xtalPads(g.xtalPch, 's', 13),
    pl = legsOf(g.chip, 'n').slice(-2);
  return {
    id: 'clk',
    w: 8,
    lanes: [
      ...cp.map((p, k) => mkLane(xtalUp(p, nth(cpins, k)), k * 17)),
      ...pp.map((p, k) => mkLane([p, nth(pl, k)], k * 17 + 9)),
    ],
  };
}

/** Audio: the codec's west legs (the 1st, 4th and 7th) straight to the pads behind the three jacks (decoration: they never light). */
export function audioBus(g: TierGeo): Bus {
  const cw = legsOf(g.codec, 'w', 7),
    lanes: Lane[] = [];
  for (const [k, id] of ['line-out', 'line-in', 'mic'].entries()) {
    const pad = nth(ioPads(ioPort(id), 1), 0);
    lanes.push(mkLane([nth(cw, k * 3), pad], k * 17));
  }
  return { id: 'audio', w: 8, lanes };
}

/** Ethernet: the PHY's four middle legs straight to the pads behind the RJ45 (decoration: they never light). */
export function lanBus(g: TierGeo): Bus[] {
  if (!g.phy) {
    return [];
  }
  const legs = legRun(g.phy, 'w', 4),
    pads = ioPads(ioPort('eth'), 4);
  const route: Pt[] = [
    [nth(legs, 0)[0], mean(legs, 1)],
    [nth(pads, 0)[0], mean(legs, 1)],
  ];
  return [mk('lan', route, { n: 4, spacing: LEG_PITCH, w: 8, c: 0, ends: { from: legs, to: pads } })];
}
