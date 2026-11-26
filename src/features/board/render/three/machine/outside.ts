// What the cords out of the case are built with (machine3d.ts, `buildRoomCords`): the desk and what stands on it, the monitor's seats, the
// desk's grommet the mains cords drop through, and the studio's wall when the stage has one.
import { CASE_FRONT as FRONT, CASE_Z, DESK_TOP, MONITOR_Z } from '@/features/room/render/three/roomplan';
import { monitorPlan, monitorSeats } from '@/features/room/render/three/monitor3d';
import { CASE, FOOT, MONITOR } from '../../layout/layout';
import { routerSolid, routerTier } from '../studiowall3d';
import { slab } from './bodies';
import { standing } from './keys';
import type { Env, Look, MachineParts, MonitorPlan, RoomGeo, RopePlane, Snapshot, StageWall } from './types';

/** The cords out of the case's build context. */
export interface Outside {
  s: Snapshot;
  geo: RoomGeo;
  has: (id: string) => boolean;
  on: (id: string) => boolean;
  deskTop: number;
  under: number;
  caseBox: Env['solids'][number];
  mp: MonitorPlan;
  seats: ReturnType<typeof monitorSeats>;
  /** The desk's top and the wall behind it, with the case and the monitor on it. */
  room: Env;
  deck: RopePlane;
  /** A mains cord is a real IEC lead's, 6 mm thick; the video cable. */
  cord: Look;
  video: Look;
  /** The desk's grommet the mains cords drop through, behind the case's west side. */
  dg: { x: number; z: number };
  w: StageWall | null;
  /** The studio's wall: its floor and its face are the cords' planes, the router and the case their solids. */
  stage: Env | null;
}

/** The studio's wall's room for the cords, or null in the room. */
function stageOf(o: Pick<Outside, 's' | 'w' | 'deskTop' | 'caseBox'>): Env | null {
  const { w } = o;
  return w
    ? {
        planes: [
          { n: [0, 1, 0], d: o.deskTop },
          { n: [0, 0, 1], d: w.plan.face.z + 60 },
        ],
        solids: [o.caseBox, routerSolid(w.plan, routerTier(o.s.net?.router?.id))],
      }
    : null;
}

/** The context of `buildRoomCords` for the snapshot `s`. */
export function outsideOf(m: MachineParts, s: Snapshot, geo: RoomGeo): Outside {
  const alive = standing(s),
    has = (id: string): boolean => alive.some((c) => c.id === id),
    on = (id: string): boolean => alive.some((c) => c.id === id && c.connected);
  const deskTop = -geo.ys,
    under = -(geo.ys + DESK_TOP);
  const caseBox = slab({ x: CASE.x, y: CASE.y, w: CASE.w, h: CASE.h + FOOT }, CASE_Z, FRONT);
  const mp = monitorPlan(MONITOR, geo.ys, MONITOR_Z),
    seats = monitorSeats(MONITOR, MONITOR_Z),
    monitor = [mp.panel, mp.hump, mp.boss].map((b) => slab(b.r, b.z0, b.z1));
  const deck: RopePlane = { n: [0, 1, 0], d: deskTop },
    room: Env = { planes: [deck, { n: [0, 0, 1], d: 40 }], solids: [caseBox, ...monitor] };
  const cord: Look = { r: 70, base: '#18181b', accent: null },
    video: Look = { r: 34, base: '#1d1f24', accent: null };
  const dg = { x: CASE.x - 900, z: 1300 },
    w = m.wall;
  const o = { s, geo, has, on, deskTop, under, caseBox, mp, seats, room, deck, cord, video, dg, w };
  return { ...o, stage: stageOf(o) };
}
