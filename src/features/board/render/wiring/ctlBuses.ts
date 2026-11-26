import { ioPort } from '../layout/boardlayout';
import { PKG } from '../layout/layout';
import {
  LEG_PITCH,
  cpuStageCtl,
  dramStageCtl,
  headerPin,
  ioPads,
  legAt,
  legRun,
  legsFrom,
  legsOf,
  pkgPads,
} from '../layout/pins';
import { chamfer, mean, mk } from './bundle';
import { mkLane, nth } from './lane';
import type { Bus, Edges, Lane, Pt, TierGeo } from './types';

/** The package's west edge, north to south: the SVID lanes (from the regulator's controller), the display lanes (their run, and the x where
 * they climb to the rear I/O), the USB lanes (on the CPU's centre line, to the hub). */
const SVID_Y = -420,
  VIDEO_Y0 = -300,
  VIDEO_RAMP_X = -1500;

/** A ramp from the package's west edge `px`: west along row `y0` to `x0`, one 45 degree climb to the connector's row `y1`, west again onto `pad`. */
function ramp(px: number, { y0, y1, x0 }: { y0: number; y1: number; x0: number }, pad: Pt): Pt[] {
  return [
    [px, y0],
    [x0, y0],
    [x0 - (y0 - y1), y1],
    [pad[0], y1],
  ];
}

/**
 * Display: CPU west edge, west (above the USB lanes), up to the HDMI row, into the pads behind the port (the second output, when the
 * board has one, runs the same way below it and nests inside: it never lights). The ramp's climb lies west of the regulator's controller and its SVID lanes.
 */
export function videoBuses(g: TierGeo, { px }: Edges): Bus[] {
  const hdmi = ioPort('hdmi'),
    hp = ioPads(hdmi, 4),
    match = { w: 11, flare: 34, axis: 'h' } as const;
  const out: Bus[] = [
    mk('video', ramp(px, { y0: VIDEO_Y0, y1: hdmi.y, x0: VIDEO_RAMP_X }, nth(hp, 0)), {
      n: 4,
      spacing: LEG_PITCH,
      w: 11,
      c: 0,
      ends: { from: pkgPads(PKG, 'w', VIDEO_Y0, 4), to: hp, match },
    }),
  ];
  if (g.dp) {
    const dp = ioPort('dp'),
      dpp = ioPads(dp, 4),
      route = ramp(px, { y0: VIDEO_Y0 + 120, y1: dp.y, x0: VIDEO_RAMP_X - 80 }, nth(dpp, 0));
    out.push(
      mk('dp', route, {
        n: 4,
        spacing: LEG_PITCH,
        w: 11,
        c: 0,
        ends: { from: pkgPads(PKG, 'w', VIDEO_Y0 + 120, 4), to: dpp, match },
      }),
    );
  }
  return out;
}

/**
 * SVID: the CPU's voltage request to the regulator's controller: three lanes from the controller's south legs, down and east onto the
 * socket's west edge, above the display lanes (a controller beside or above the socket lands on its north edge instead). Decoration: it never lights.
 */
export function svidBus(g: TierGeo, { px, py }: Edges): Bus {
  const legs = legRun(g.pwm, 's', 3, 0, LEG_PITCH),
    cx = mean(legs, 0),
    [, ys] = nth(legs, 0);
  if (cx < px - 100) {
    const route: Pt[] = [
      [cx, ys],
      [cx, SVID_Y],
      [px, SVID_Y],
    ];
    return mk('svid', route, {
      n: 3,
      spacing: LEG_PITCH,
      w: 8,
      c: 100,
      ends: { from: legs, to: pkgPads(PKG, 'w', SVID_Y, 3) },
    });
  }
  const route: Pt[] = [
    [cx, ys],
    [cx, py],
  ];
  return mk('svid', route, {
    n: 3,
    spacing: LEG_PITCH,
    w: 8,
    c: 0,
    ends: { from: legs, to: pkgPads(PKG, 'n', Math.max(cx, px + 130), 3) },
  });
}

/**
 * The CPU regulator's controller: a lane from each controller leg to the control leg of its phase. The nearest phase's lane runs straight in
 * (when the controller stands beside the phases); every other leaves from the next leg, drops to a level of its own under the phases, and rises
 * in the gap before its phase, the lane of the farthest phase on the lowest level, so none crosses another (they dive under the phases'
 * power stubs: `HOP_BUSES`).
 */
export function cpuPwmBus(g: TierGeo): Bus {
  const ph = g.vrmPhases,
    legs = legsOf(g.pwm, 'e'),
    p0 = nth(ph, 0),
    yb = p0.y + p0.h + 40,
    lanes: Lane[] = [];
  for (const [k, r] of ph.entries()) {
    const leg = nth(legs, k),
      c = cpuStageCtl(r),
      gx = r.x - 20,
      xk = p0.x - 40 - 16 * (k - 1),
      yk = yb + 18 * (k - 1);
    const route: Pt[] =
      k === 0 ? [leg, [gx, leg[1]], [gx, c[1]], c] : [leg, [xk, leg[1]], [xk, yk], [gx, yk], [gx, c[1]], c];
    lanes.push(mkLane(chamfer(route, 14), k * 19 + 7));
  }
  return { id: 'pwmc', w: 8, lanes };
}

/** The memory regulator's controller: the same, from its legs on the phases' side (west or east of them). */
export function dramPwmBus(g: TierGeo): Bus {
  const dp = g.dPhases,
    west = g.dpwmWest,
    dl = legsOf(g.dpwm, west ? 'e' : 'w'),
    seq = west ? dp : dp.toReversed(),
    p0 = nth(dp, 0),
    yb = p0.y + p0.h + 18,
    lanes: Lane[] = [];
  for (const [k, r] of seq.entries()) {
    const leg = nth(dl, k),
      c = dramStageCtl(r),
      gx = r.x - 28,
      yk = yb + 10 * (west ? k - 1 : k);
    let route: Pt[];
    if (!west) {
      const xk = leg[0] - 22 - 14 * (seq.length - 1 - k);
      route = [leg, [xk, leg[1]], [xk, yk], [gx, yk], [gx, c[1]], c];
    } else if (k === 0) {
      route = [leg, [gx, leg[1]], [gx, c[1]], c];
    } else {
      const xk = p0.x - 40 - 14 * (k - 1);
      route = [leg, [xk, leg[1]], [xk, yk], [gx, yk], [gx, c[1]], c];
    }
    lanes.push(mkLane(chamfer(route, 12), k * 19 + 11));
  }
  return { id: 'pwmc', w: 8, lanes };
}

/** The BIOS flash on its SPI lanes: its east legs straight across to the chipset's west legs. */
export function spiBus(g: TierGeo): Bus {
  const a = legsOf(g.bios, 'e', 4, 26),
    b = legsFrom(g.chip, 'w', g.west.bios, 4);
  return { id: 'spi', w: 8, lanes: a.map((p, k) => mkLane([p, nth(b, k)], k * 17)) };
}

/** The I/O controller's four lanes straight east to the chipset's west legs. */
export function lpcBus(g: TierGeo): Bus {
  const a = legsOf(g.sio, 'e'),
    b = legsFrom(g.chip, 'w', g.west.sio, 4),
    ym = mean(a, 1);
  const route: Pt[] = [
    [nth(a, 0)[0], ym],
    [nth(b, 0)[0], ym],
  ];
  return mk('lpc', route, { n: 4, spacing: LEG_PITCH, w: 8, c: 0, ends: { from: a, to: b } });
}

/** The headers on the trunk: all but the clear-CMOS jumper and the fan headers, which have lanes of their own. */
const OFF_TRUNK = new Set(['CLR_CMOS', 'CPU_FAN', 'VRM_FAN', 'RAM_FAN']);

/** The header trunk: from the I/O controller's south leg west under the row of pin headers, with a tap up to each header's first pin of the bottom row. */
export function hdrBus(g: TierGeo): Bus {
  const leg = legAt(g.sio, 's', 1, 4, LEG_PITCH),
    row = g.hdrs.filter((h) => !OFF_TRUNK.has(h.name));
  const yb = Math.max(g.hdrY + 128 + 36, leg[1] + 30),
    pins = row.map((h) => headerPin(h.x, h.y, 0, h.rows - 1));
  const xw = Math.min(...pins.map((q) => q[0]));
  const lanes: Lane[] = [mkLane(chamfer([leg, [leg[0], yb], [xw, yb]], 24), 31)];
  for (const [i, q] of pins.entries()) {
    lanes.push(mkLane([[q[0], yb], q], i * 13 + 5));
  }
  // a message to one header runs the trunk and that header's tap only (`heads`), not every header's tap
  return {
    id: 'hdr',
    w: 8,
    lanes,
    heads: row.map((h, i) => ({ name: h.name, lanes: [nth(lanes, 0), nth(lanes, 1 + i)] })),
  };
}
