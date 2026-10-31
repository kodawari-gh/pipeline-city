import { Container, Graphics } from 'pixi.js';
import { MONITOR_POWER, PC_CORD_X, PC_POWER, type Rect } from './layout';
import { roundedPath } from './routes';
import type { CordScene, SceneInfo } from '@/core/render/interact';
import type { RoomGeo } from '../../room/render/room';
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
}

/** The two cords of a room: the pure geometry (tested). */
export function cordPlan(geo: RoomGeo): Record<CordKind, CordPlan> {
  const s = geo.socket, p = s.plate, jog = p.y - 330;
  const pcStart: Pt = [PC_POWER.x - 6 - 330 + 10, PC_POWER.y];
  const mon = MONITOR_POWER;
  return {
    pcmains: { kind: 'pcmains', route: [pcStart, [PC_CORD_X, PC_POWER.y]], outlet: [s.pc.x, s.pc.y], rest: [s.pc.x + 380, p.y + p.h + 1050] },
    monmains: { kind: 'monmains', route: [[mon.x, mon.y - 200], [mon.x, jog], [s.mon.x, jog]], outlet: [s.mon.x, s.mon.y], rest: [s.mon.x - 380, p.y + p.h + 1050] },
  };
}

/** The whole route of a cord with its plug centred at `at`: the plan's route, then down into the plug's boot. */
export function cordRoute(plan: CordPlan, at: Pt): Pt[] {
  return [...plan.route, [at[0], at[1] - CORD_END]];
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
  private T!: Theme;
  private plan: Record<CordKind, CordPlan> | null = null;
  private key = '';
  private last: { connected: Record<CordKind, boolean>; held: { kind: CordKind; at: Pt } | null } | null = null;
  /** Changes whenever a cord's state or a plug's place does (the power lens rebuilds its model on it). */
  get stateKey() { return this.key; }

  constructor() { this.behind.addChild(this.gb); this.root.addChild(this.gf); }

  /** A new room (theme, case tier): the plan is rebuilt and everything redrawn. */
  setRoom(T: Theme, geo: RoomGeo) { this.T = T; this.plan = cordPlan(geo); this.key = ''; }

  /**
   * Draw the cords for this state and fill the shared scene (`scene.cords`, the `socket` and the cord rects). `connected` is what the
   * game (or the player's drop, until the game confirms it) says; `held` is the cord in the hand and where its plug is. Returns whether it redrew.
   */
  sync(connected: Record<CordKind, boolean>, held: { kind: CordKind; at: Pt } | null, scene: SceneInfo, plate: Rect): boolean {
    const plan = this.plan;
    if (!plan) return false;
    const key = CORD_KINDS.map((k) => (held?.kind === k ? `h${Math.round(held.at[0])},${Math.round(held.at[1])}` : connected[k] ? 'c' : 'l')).join('|');
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
    gb.clear(); gf.clear();
    for (const k of CORD_KINDS) {
      const pl = plan[k], isHeld = held?.kind === k, at: Pt = isHeld ? held!.at : connected[k] ? pl.outlet : pl.rest;
      this.cord(isHeld ? gf : gb, cordRoute(pl, at), T);
      this.plug(gf, at, T, connected[k] && !isHeld);
    }
  }

  private cord(g: Graphics, route: Pt[], T: Theme, w = 70) {
    const rim = T.dark ? '#7d8bb0' : '#8d99b4', sleeve = T.dark ? '#0a0d15' : '#232a38';
    const pts = roundedPath(route, 170);
    const line = (dx = 0, dy = 0) => { g.moveTo(pts[0]![0] + dx, pts[0]![1] + dy); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0] + dx, pts[i]![1] + dy); };
    line(10, 14); g.stroke({ width: w + 6, color: '#000000', alpha: 0.28, cap: 'round', join: 'round' });
    line(); g.stroke({ width: w + 10, color: rim, alpha: T.dark ? 0.32 : 0.0, cap: 'round', join: 'round' });
    line(); g.stroke({ width: w, color: sleeve, cap: 'round', join: 'round' });
    line(-w * 0.22, 0); g.stroke({ width: w * 0.12, color: '#ffffff', alpha: T.dark ? 0.16 : 0.12, cap: 'round', join: 'round' });
  }

  /** The wall plug seen from its back: the same drawing the baked room used to carry (a body with grip ridges and the boot the cord enters). */
  private plug(g: Graphics, at: Pt, T: Theme, seated: boolean) {
    const [x, y] = at, body = T.dark ? '#141a26' : '#262d3a', rim = T.dark ? '#5b6a94' : '#6b7794';
    const lift = seated ? 0 : 1; // a plug that is out stands a little proud: a longer shadow
    g.roundRect(x - 270 + 14 + 10 * lift, y - 280 + 20 + 16 * lift, 540, 560, 70).fill({ color: '#000000', alpha: 0.3 });
    g.roundRect(x - 270, y - 280, 540, 560, 70).fill({ color: body }).stroke({ width: 8, color: rim, alpha: 0.8 });
    g.roundRect(x - 220, y - 240, 440, 70, 30).fill({ color: '#ffffff', alpha: T.dark ? 0.08 : 0.2 });
    for (let k = 0; k < 4; k++) g.rect(x - 200, y - 80 + k * 90, 400, 18).fill({ color: '#ffffff', alpha: 0.08 });
    g.roundRect(x - 90, y - 330, 180, 90, 30).fill({ color: body }).stroke({ width: 6, color: rim, alpha: 0.6 }); // the boot
  }
}
