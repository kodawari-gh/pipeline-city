// What a fan's cord is made of (machine3d.ts, the fans' cords): its rig from where it is fixed, and its plug in a fan header on the board.
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { at, fanPlug, hangPts } from '../wires3d';
import { nth } from './keys';
import type { CableRig, Env, FanCordPlan, Inside, Look, RopeEnd } from './types';

/** One fan's cord: its plan, the cords' look, the deck a loose plug lies on and the hub's ends in the slot. */
export interface Cord {
  p: FanCordPlan;
  look: Look;
  c: Inside;
  hubEnds: RopeEnd[];
}

/** Where a cord is fixed, what it keeps clear of and how it hangs. */
interface Run {
  fixed: RopeEnd;
  env: Env;
  o: { slack: number; extra: number; n: number };
}

type Rest = Pick<CableRig, 'model' | 'seat' | 'engage' | 'extra' | 'power'>;

/** A fan's cord's rig: fixed at `fixed`, the rest (its plug, seat and power) as `rest` says. */
export const cord = (k: Cord, { fixed, env, o }: Run, rest: Rest): CableRig => ({
  id: k.p.id,
  name: 'its fan header',
  target: null,
  look: k.look,
  env,
  fixed: [fixed],
  canSeat: true,
  deck: k.c.deck,
  seated: (ex) => [hangPts(fixed, nth(ex, 0), k.look, env, o)],
  n: o.n,
  stiff: 0.5,
  lead: k.look.r * 2.5,
  ...rest,
  power: { out: true, ...rest.power },
});

/** A fan's plug on its board header, pushed in from the glass side. */
export const header = ({ p, c }: Cord): Pick<CableRig, 'model' | 'seat' | 'engage'> => ({
  model: () => {
    const h = fanPlug(p.header, c.T.mul);
    return { root: h.root, strands: [h.end] };
  },
  seat: { at: at(p.header.x + p.header.w / 2, p.header.y + p.header.h / 2, BOARD_Z + 150), axis: [0, 0, 1] },
  engage: 70,
});
