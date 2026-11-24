import { MONITOR_POWER, PC_CORD_X, PC_POWER, type Rect } from '../layout/layout';
import { drape, hangCable, type Clip } from '@/core/render/cable';
import type { RoomGeo } from '@/features/room/render/shell/room';
import { deskGeo } from '@/features/room/render/shell/persp';

// The two cords from the wall: the PC's (from the inlet in the case's rear wall) and the monitor's (built into it). Each ends in a plug that
// seats in its outlet of the wall socket under the desk, or lies loose below it: the player drags it in (docs/render/room/room.md "The wall cords").
// The cord's body runs behind the desk, like the ISP lead, so it lives in the room's back layer (`behind`); the plugs, and a cord that is
// in the hand, are drawn above everything (`root`).

export type CordKind = 'pcmains' | 'monmains';
export const CORD_KINDS: readonly CordKind[] = ['pcmains', 'monmains'];
export type Pt = [number, number];

/** The plug's body, seen from its back as it sits in the wall: 540 wide, 560 tall, the cord's boot above it. */
const PLUG_W = 540,
  PLUG_H = 560,
  BOOT_UP = 330;
export const CORD_END = 310;
/** How close (world units) the plug's centre must be to its outlet for the drop to seat it. */
export const SEAT_R = 300;

/** The plug's grab rect (its body and its boot) with its centre at `p`. */
export const plugRect = (p: Pt): Rect => ({
  x: p[0] - PLUG_W / 2,
  y: p[1] - BOOT_UP,
  w: PLUG_W,
  h: BOOT_UP + PLUG_H / 2,
});

export interface CordPlan {
  kind: CordKind;
  /** Where the cord leaves the machine (behind the case's inlet, or out from behind the monitor) and the first bend. */
  route: Pt[];
  /** The outlet the plug seats in. */
  outlet: Pt;
  /** Where the plug lies when it is not in the wall. */
  rest: Pt;
  /** Below this y (under the desk, by the socket) the cord is drawn over the wall socket's plate, not behind it: it hangs in front of the wall and the plug is in front of the plate. */
  frontY: number;
}

/** The two cords of a room: the pure geometry (tested). */
export function cordPlan(geo: RoomGeo): Record<CordKind, CordPlan> {
  const s = geo.socket,
    p = s.plate,
    jog = p.y - 330;
  const pcStart: Pt = [PC_POWER.x - 6 - 330 + 10, PC_POWER.y],
    frontY = Math.max(p.y - 1300, deskGeo(geo.persp, geo.ys, geo.floor).yBottom);
  const mon = MONITOR_POWER;
  return {
    pcmains: {
      kind: 'pcmains',
      route: [pcStart, [PC_CORD_X, PC_POWER.y]],
      outlet: [s.pc.x, s.pc.y],
      rest: [s.pc.x + 380, p.y + p.h + 1050],
      frontY,
    },
    monmains: {
      kind: 'monmains',
      route: [
        [mon.x, mon.y - 200],
        [mon.x, jog],
        [s.mon.x, jog],
      ],
      outlet: [s.mon.x, s.mon.y],
      rest: [s.mon.x - 380, p.y + p.h + 1050],
      frontY,
    },
  };
}

/** The whole route of a cord with its plug centred at `at`: the plan's route, then down into the plug's boot. */
export function cordRoute(plan: CordPlan, at: Pt): Pt[] {
  return [...plan.route, [at[0], at[1] - CORD_END]];
}

/** How long the loose part of a cord is: from where its run ends to its plug at rest, with slack (it hangs between them, and a plug that falls swings on it). */
export const cordSlack = (plan: CordPlan) => {
  const a = plan.route[plan.route.length - 1]!,
    b: Pt = [plan.rest[0], plan.rest[1] - CORD_END];
  return Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.15 + 260;
};

/**
 * The cord's drawn path with its plug centred at `at`: seated, the plan's route straight down into the boot; otherwise the route's run, then the
 * rest of the cord hanging from where the run ends to the boot, as long as `cordSlack` says.
 */
export function cordPath(plan: CordPlan, at: Pt, seated: boolean): Pt[] {
  return cordDrape(plan, at, seated).path;
}

/** A clip at the middle of every long straight run of a route (not on the first or the last 400 units): where the cord is pinned to the wall. */
const runClips = (route: Pt[], min = 1500): Pt[] =>
  route.slice(1).flatMap((q, i): Pt[] => {
    const p = route[i]!,
      l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return l >= min ? [[(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as Pt] : [];
  });

/** The cord as `cordPath` draws it, and the wall clips that hold it: every corner is a round bend, a long run is clipped and sags a little between clips. */
function cordDrape(plan: CordPlan, at: Pt, seated: boolean): { path: Pt[]; clips: Clip[] } {
  if (seated) {
    const r = cordRoute(plan, at);
    return drape(r, { radius: 450, sag: 0.04, clips: runClips(r) });
  }
  const head = drape(plan.route, { radius: 450, sag: 0.04, clips: runClips(plan.route) }),
    n = head.path.length,
    a = head.path[n - 1]!,
    b = head.path[n - 2] ?? a,
    l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  const boot: Pt = [at[0], at[1] - CORD_END];
  return {
    path: [
      ...head.path,
      ...hangCable(a, [(a[0] - b[0]) / l, (a[1] - b[1]) / l], boot, { len: cordSlack(plan), stub: 160, n: 36 }).slice(
        1,
      ),
    ],
    clips: head.clips,
  };
}
