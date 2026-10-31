import { Container, Graphics } from 'pixi.js';
import { MONITOR_POWER, PC_CORD_X, PC_POWER, type Rect } from '../layout/layout';
import { drape, hangCable, paintCable, paintClip, type Clip, startFall, stepFall, type Fall } from '@/core/render/cable';
import type { CordScene, SceneInfo } from '@/core/render/interact';
import type { RoomGeo } from '@/features/room/render/shell/room';
import { deskGeo } from '@/features/room/render/shell/persp';
import { HOLES, facePoly, plugPoly } from '@/features/room/render/shell/swiss';
import type { Theme } from '@/core/render/theme';

// The two cords from the wall: the PC's (from the inlet in the case's rear wall) and the monitor's (built into it). Each ends in a plug that
// seats in its outlet of the wall socket under the desk, or lies loose below it: the player drags it in (docs/render/room/room.md "The wall cords").
// The cord's body runs behind the desk, like the ISP lead, so it lives in the room's back layer (`behind`); the plugs, and a cord that is
// in the hand, are drawn above everything (`root`).

export type CordKind = 'pcmains' | 'monmains';
export const CORD_KINDS: readonly CordKind[] = ['pcmains', 'monmains'];
export type Pt = [number, number];

/** The plug's body, seen from its back as it sits in the wall: 540 wide, 560 tall, the cord's boot above it. */
export const PLUG_W = 540, PLUG_H = 560, BOOT_UP = 330, CORD_END = 310;
/** How close (world units) the plug's centre must be to its outlet for the drop to seat it. */
export const SEAT_R = 300;

/** The plug's grab rect (its body and its boot) with its centre at `p`. */
export const plugRect = (p: Pt): Rect => ({ x: p[0] - PLUG_W / 2, y: p[1] - BOOT_UP, w: PLUG_W, h: BOOT_UP + PLUG_H / 2 });

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
  const s = geo.socket, p = s.plate, jog = p.y - 330;
  const pcStart: Pt = [PC_POWER.x - 6 - 330 + 10, PC_POWER.y], frontY = Math.max(p.y - 1300, deskGeo(geo.persp, geo.ys, geo.floor).yBottom);
  const mon = MONITOR_POWER;
  return {
    pcmains: { kind: 'pcmains', route: [pcStart, [PC_CORD_X, PC_POWER.y]], outlet: [s.pc.x, s.pc.y], rest: [s.pc.x + 380, p.y + p.h + 1050], frontY },
    monmains: { kind: 'monmains', route: [[mon.x, mon.y - 200], [mon.x, jog], [s.mon.x, jog]], outlet: [s.mon.x, s.mon.y], rest: [s.mon.x - 380, p.y + p.h + 1050], frontY },
  };
}

/** The whole route of a cord with its plug centred at `at`: the plan's route, then down into the plug's boot. */
export function cordRoute(plan: CordPlan, at: Pt): Pt[] {
  return [...plan.route, [at[0], at[1] - CORD_END]];
}

/** How long the loose part of a cord is: from where its run ends to its plug at rest, with slack (it hangs between them, and a plug that falls swings on it). */
export const cordSlack = (plan: CordPlan) => {
  const a = plan.route[plan.route.length - 1]!, b: Pt = [plan.rest[0], plan.rest[1] - CORD_END];
  return Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.15 + 260;
};

/**
 * The cord's drawn path with its plug centred at `at`: seated, the plan's route straight down into the boot; otherwise the route's run, then the
 * rest of the cord hanging from where the run ends to the boot, as long as `cordSlack` says.
 */
export function cordPath(plan: CordPlan, at: Pt, seated: boolean): Pt[] { return cordDrape(plan, at, seated).path; }

/** A clip at the middle of every long straight run of a route (not on the first or the last 400 units): where the cord is pinned to the wall. */
const runClips = (route: Pt[], min = 1500): Pt[] => route.slice(1).flatMap((q, i): Pt[] => {
  const p = route[i]!, l = Math.hypot(q[0] - p[0], q[1] - p[1]);
  return l >= min ? [[(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as Pt] : [];
});

/** The cord as `cordPath` draws it, and the wall clips that hold it: every corner is a round bend, a long run is clipped and sags a little between clips. */
export function cordDrape(plan: CordPlan, at: Pt, seated: boolean): { path: Pt[]; clips: Clip[] } {
  if (seated) { const r = cordRoute(plan, at); return drape(r, { radius: 450, sag: 0.04, clips: runClips(r) }); }
  const head = drape(plan.route, { radius: 450, sag: 0.04, clips: runClips(plan.route) }), n = head.path.length, a = head.path[n - 1]!, b = head.path[n - 2] ?? a, l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  const boot: Pt = [at[0], at[1] - CORD_END];
  return { path: [...head.path, ...hangCable(a, [(a[0] - b[0]) / l, (a[1] - b[1]) / l], boot, { len: cordSlack(plan), stub: 160, n: 36 }).slice(1)], clips: head.clips };
}

export interface CordHit { id: string; rect: Rect }

export class CordsView {
  /** The cords' bodies: board.ts puts this in the room's back layer (the desk covers them). */
  readonly behind = new Container();
  /** The plugs, and the cord in the hand: above the room. */
  readonly root = new Container();
  hits: CordHit[] = [];
  private gb = new Graphics();
  private gf = new Graphics();
  /** The stretch of a seated cord by the socket, over the wall socket's plate but cut off at the desk's lower edge (the cord comes out from under the desk). */
  private gm = new Graphics();
  private mask = new Graphics();
  private T!: Theme;
  private plan: Record<CordKind, CordPlan> | null = null;
  private key = '';
  /** Plugs let go in the air fall and swing on their cord until they lie at rest. */
  private falls = new Map<CordKind, Fall>();
  private prevHeld: { kind: CordKind; at: Pt } | null = null;
  private last: { connected: Record<CordKind, boolean>; held: { kind: CordKind; at: Pt } | null } | null = null;
  /** Changes whenever a cord's state or a plug's place does (the power lens rebuilds its model on it). */
  get stateKey() { return this.key; }

  constructor() { this.behind.addChild(this.gb); this.root.addChild(this.gm, this.mask, this.gf); this.gm.mask = this.mask; }

  /** A new room (theme, case tier): the plan is rebuilt and everything redrawn. */
  setRoom(T: Theme, geo: RoomGeo) { this.T = T; this.plan = cordPlan(geo); this.key = ''; this.mask.clear().rect(-1e6, this.plan.pcmains.frontY, 2e6, 1e6).fill({ color: '#ffffff' }); this.falls.clear(); this.prevHeld = null; }

  /** Advance the plugs that fell out of the hand (call every frame; it redraws only while one moves). */
  tick(dt: number) {
    if (!this.falls.size || !this.plan || !this.last) return;
    for (const [k, f] of this.falls) {
      const pl = this.plan[k];
      stepFall(f, dt, pl.route[pl.route.length - 1]!, cordSlack(pl) + CORD_END, pl.rest);
      if (f.done) this.falls.delete(k);
    }
    this.draw(this.last.connected, this.last.held);
  }

  /**
   * Draw the cords for this state and fill the shared scene (`scene.cords`, the `socket` and the cord rects). `connected` is what the
   * game (or the player's drop, until the game confirms it) says; `held` is the cord in the hand and where its plug is. Returns whether it redrew.
   */
  sync(connected: Record<CordKind, boolean>, held: { kind: CordKind; at: Pt } | null, scene: SceneInfo, plate: Rect): boolean {
    const plan = this.plan;
    if (!plan) return false;
    if (this.prevHeld && this.prevHeld.kind !== held?.kind && !connected[this.prevHeld.kind]) this.falls.set(this.prevHeld.kind, startFall(this.prevHeld.at));
    for (const k of CORD_KINDS) if (connected[k] || held?.kind === k) this.falls.delete(k);
    this.prevHeld = held ? { kind: held.kind, at: [held.at[0], held.at[1]] } : null;
    const key = this.falls.size + '|' + CORD_KINDS.map((k) => (held?.kind === k ? `h${Math.round(held.at[0])},${Math.round(held.at[1])}` : connected[k] ? 'c' : 'l')).join('|');
    scene.rects.set('socket', plate);
    scene.cords = CORD_KINDS.map((k) => {
      const pl = plan[k], isHeld = held?.kind === k, at: Pt = isHeld ? held!.at : connected[k] ? pl.outlet : pl.rest;
      return { kind: k, connected: connected[k] && !isHeld, held: isHeld, plug: plugRect(at), centre: at, outlet: pl.outlet, outletRect: { x: pl.outlet[0] - 300, y: pl.outlet[1] - 300, w: 600, h: 600 }, rest: pl.rest, seatR: SEAT_R } satisfies CordScene;
    });
    this.hits = scene.cords.map((c) => ({ id: 'cable.' + c.kind, rect: c.plug }));
    this.last = { connected: { ...connected }, held };
    if (key === this.key) return false;
    this.key = key;
    this.draw(connected, held);
    return true;
  }

  /** The cords as the power lens needs them: where each plug is and the cord from its machine to it. */
  lensCords(): { kind: CordKind; connected: boolean; plugAt: Pt; route: Pt[]; outlet: Pt }[] {
    if (!this.plan || !this.last) return [];
    const { connected, held } = this.last;
    return CORD_KINDS.map((k) => {
      const pl = this.plan![k], isHeld = held?.kind === k, at: Pt = isHeld ? held!.at : connected[k] ? pl.outlet : pl.rest;
      return { kind: k, connected: connected[k] && !isHeld, plugAt: at, route: cordRoute(pl, at), outlet: pl.outlet };
    });
  }

  private draw(connected: Record<CordKind, boolean>, held: { kind: CordKind; at: Pt } | null) {
    const plan = this.plan!, T = this.T, gb = this.gb, gf = this.gf;
    gb.clear(); gf.clear(); this.gm.clear();
    for (const k of CORD_KINDS) {
      const pl = plan[k], isHeld = held?.kind === k, fall = this.falls.get(k), seated = connected[k] && !isHeld;
      const at: Pt = isHeld ? held!.at : connected[k] ? pl.outlet : fall ? fall.p : pl.rest;
      const d = cordDrape(pl, at, seated), body = isHeld ? gf : gb;
      // the stretch by the socket is drawn over the plate (the plug is in front of it, so is the cord that leaves it); the rest runs behind the desk
      const cut = d.path.findIndex((q) => q[1] >= pl.frontY - 300);
      this.cord(body, d.path, T);
      if (!isHeld && cut > 0) this.cord(this.gm, d.path.slice(cut - 1), T);
      for (const c of d.clips) paintClip(c.at[1] >= pl.frontY ? this.gm : body, T, c.at, c.dir, 70);
      this.plug(gf, at, T, seated);
    }
  }

  private cord(g: Graphics, pts: Pt[], T: Theme, w = 70, outer = true) {
    paintCable(g, T, pts, { w, accent: T.mute, wall: true, shadow: outer, halo: outer });
  }

  /** The wall plug seen from its back: the same drawing the baked room used to carry (a body with grip ridges and the boot the cord enters). */
  private plug(g: Graphics, at: Pt, T: Theme, seated: boolean) {
    const [x, y] = at, body = T.dark ? '#141a26' : '#262d3a', rim = T.dark ? '#5b6a94' : '#6b7794';
    const lift = seated ? 0 : 1; // a plug that is out stands a little proud: a longer shadow
    // a Swiss plug (type J), white (`swiss.ts`). Seated, it is seen from behind: the cap with the cord boot at its top (the screw that holds the cover) over the pin face
    // that fills the outlet's recess. Out (lying, hanging, in the hand) it shows its pin face: the shield with three round pins, a black sleeve at the base of each and a bright tip.
    const white = T.dark ? '#dcdde2' : '#f4f3ee', shade = T.dark ? '#a9adba' : '#cfd0d6';
    if (seated) {
      g.poly(plugPoly(x + 14, y + 20)).fill({ color: '#000000', alpha: 0.3 });
      g.poly(plugPoly(x, y)).fill({ color: white }).stroke({ width: 6, color: shade, alpha: 0.95 });
      g.poly(plugPoly(x, y - 6)).stroke({ width: 3, color: '#ffffff', alpha: 0.6 });
      g.poly(facePoly(x, y)).stroke({ width: 3, color: shade, alpha: 0.7 }); // where the cap meets the pin face
      g.circle(x, y - 150, 24).fill({ color: shade }).stroke({ width: 3, color: '#ffffff', alpha: 0.5 }); // the cover screw
      g.moveTo(x - 14, y - 150).lineTo(x + 14, y - 150).stroke({ width: 4, color: '#5b6272', alpha: 0.9 });
    } else {
      g.poly(facePoly(x + 24, y + 36)).fill({ color: '#000000', alpha: 0.3 });
      g.poly(plugPoly(x, y)).fill({ color: shade, alpha: 0.9 }); // the cap seen from the side, behind the face
      g.poly(facePoly(x, y)).fill({ color: white }).stroke({ width: 5, color: shade, alpha: 0.95 });
      g.poly(facePoly(x, y - 4)).stroke({ width: 3, color: '#ffffff', alpha: 0.6 });
      for (const [dx, dy] of HOLES) {
        g.circle(x + dx + 6, y + dy + 9, 24).fill({ color: '#000000', alpha: 0.3 });
        g.circle(x + dx, y + dy, 24).fill({ color: '#16181f' }); // the insulating sleeve
        g.circle(x + dx, y + dy, 13).fill({ color: '#c9ced8' }).stroke({ width: 2, color: '#7e8594' });
        g.circle(x + dx - 4, y + dy - 5, 5).fill({ color: '#ffffff', alpha: 0.9 });
      }
    }
    g.roundRect(x - 90, y - 340, 180, 120, 36).fill({ color: white }).stroke({ width: 6, color: shade, alpha: 0.9 }); // the boot the cord enters
  }
}
