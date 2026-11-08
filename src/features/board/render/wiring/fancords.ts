import { Container, Graphics } from 'pixi.js';
import type { CordScene, SceneInfo } from '@/core/render/interact';
import { fanMounts, hubHeaders, plugBox } from '@/features/room/render/desk/props/case';
import { paintCable, startFall, stepFall, type Fall } from '@/core/render/cable';
import type { Theme } from '@/core/render/theme';
import { CASE_BD, COOLER, FAN_HUB, FAN_SLOT, GEO, type Rect } from '../layout/layout';
import { cordShape, type Shape } from '@/core/render/shape';
import { roundedPath, rubberBand, type Pt } from './routes';

// The fans' cables (docs/render/board.md "Fan cables"): the CPU cooler's, the two heatsink fans', the fan hub's control cable and one cable per
// case fan. Each is fixed at its fan (or at the hub) and ends in a plug that seats on its header, or lies loose beside it: the player drags it in,
// like the wall cords (`cords.ts`), and the sim only lets the machine run its fan while the plug is in (docs/ASSEMBLY.md).

export interface FanCordPlan {
  /** The sim's cable id: `cpufan`, `vrmfan`, `ramfan`, `sysfan`, `fan:<mount>`. */
  id: string;
  /** Where the cord is fixed (the fan, the hub's input or the slot in the tray) and the way it leaves that end. */
  anchor: Pt;
  anchorDir: Pt;
  /** The header's seat (the plug's centre when it is in) and the size of the plug. */
  seat: Pt;
  plug: { w: number; h: number };
  /** The cord as it runs when the plug is seated: from the anchor to the seat. */
  route: Pt[];
  /** Where the plug lies when it is out. */
  rest: Pt;
  /** The header the plug seats on (highlight ring). */
  header: Rect;
  /** How close (world units) the plug's centre must be to the seat for a drop to seat it. */
  seatR: number;
  /** The plug on the fixed end, if that end shows one. */
  endPlug: Rect | null;
  /** Sleeve width. */
  width: number;
}

const hdrRect = (name: string): Rect | null => {
  const h = GEO.hdrs.find((q) => q.name === name);
  return h ? { x: h.x, y: h.y, w: h.cols * 52 + 24, h: h.rows * 52 + 24 } : null;
};
const mid = (r: Rect): Pt => [r.x + r.w / 2, r.y + r.h / 2];

/** Every fan cable the current layout can have (the pure geometry, tested): the view draws the ones the machine lists. */
export function fanCordPlans(): FanCordPlan[] {
  const out: FanCordPlan[] = [];
  // the CPU cooler: straight east from the CPU_FAN header to the cooler's west edge
  const cf = hdrRect('CPU_FAN');
  if (cf) {
    const seat = mid(cf), x1 = COOLER.x + 70;
    out.push({ id: 'cpufan', anchor: [x1, seat[1]], anchorDir: [-1, 0], seat, plug: { w: cf.w + 16, h: cf.h + 16 }, route: [[x1, seat[1]], seat], rest: [seat[0], seat[1] + 380], header: cf, seatR: 200, endPlug: { x: x1 - 30, y: seat[1] - 28, w: 64, h: 56 }, width: 24 });
  }
  // the heatsink fans: out of the fan's frame on the side toward its header (the header stands clear of the fan), along to above the header
  // and down onto it
  for (const which of ['vrm', 'ram'] as const) {
    const h = hdrRect(which === 'vrm' ? 'VRM_FAN' : 'RAM_FAN');
    if (!h) continue;
    const f = which === 'vrm' ? GEO.vrmFan : GEO.dFan, west = h.x < f.x, sx = h.x + h.w / 2, ay = Math.min(Math.max(h.y - 60, f.y + 120), f.y + f.h - 120);
    const anchor: Pt = [west ? f.x + 20 : f.x + f.w - 20, ay], seat = mid(h);
    out.push({ id: which === 'vrm' ? 'vrmfan' : 'ramfan', anchor, anchorDir: [west ? -1 : 1, 0], seat, plug: { w: h.w + 16, h: h.h + 16 }, route: [anchor, [sx, ay], [sx, h.y + 6]],
      rest: [seat[0] + (west ? -330 : 330), seat[1]], header: h, seatR: 190, endPlug: null, width: 22 });
  }
  // the fan hub's control cable: from the SYS_FAN header down over the board's south edge, east and up into the hub's input header
  const sf = hdrRect('SYS_FAN');
  if (sf) {
    const cx = sf.x + sf.w / 2, south = CASE_BD.y + CASE_BD.h, hx = FAN_HUB.x + 90, anchor: Pt = [hx, FAN_HUB.y + 4], seat = mid(sf);
    out.push({ id: 'sysfan', anchor, anchorDir: [0, -1], seat, plug: { w: sf.w + 16, h: sf.h + 16 }, route: [anchor, [hx, south + 130], [cx, south + 130], [cx, sf.y + sf.h + 6]], rest: [cx, sf.y + sf.h + 330],
      header: sf, seatR: 190, endPlug: { x: hx - 36, y: FAN_HUB.y - 24, w: 72, h: 44 }, width: 24 });
  }
  // one cable per case fan: from the slot in the tray down to its header on the hub (the plug rests lifted above it)
  const hubs = hubHeaders();
  fanMounts().forEach((m, i) => {
    const p = hubs[i];
    if (!p) return;
    const anchor: Pt = [p.x, FAN_SLOT.y + FAN_SLOT.h * 0.5], seat: Pt = [p.x, p.y - 6];
    out.push({ id: `fan:${m.id}`, anchor, anchorDir: [0, 1], seat, plug: { w: 72, h: 48 }, route: [anchor, seat], rest: [p.x, p.y - 112], header: { x: p.x - 40, y: p.y + 8, w: 80, h: 44 }, seatR: 60, endPlug: null, width: 20 });
  });
  return out;
}

/** How long the cord is: its plug at rest, a little slack more (it hangs from the anchor to the plug, and a plug that falls swings on this length). */
export const cordLen = (p: FanCordPlan) => Math.hypot(p.rest[0] - p.anchor[0], p.rest[1] - p.anchor[1]) * 1.12 + 120;

/** The grab rect of a plug whose centre is at `at`. */
const plugRectAt = (pl: FanCordPlan, at: Pt): Rect => ({ x: at[0] - pl.plug.w / 2 - 30, y: at[1] - pl.plug.h / 2 - 30, w: pl.plug.w + 60, h: pl.plug.h + 60 });

export interface FanCordHit { id: string; rect: Rect; shape?: Shape }

export class FanCordsView {
  readonly root = new Container();
  hits: FanCordHit[] = [];
  /** Each cord's silhouette (the cord and its plug), made as it is drawn. */
  private shapes = new Map<string, Shape>();
  private gc = new Graphics();
  private gp = new Container();
  private T!: Theme;
  private plans: FanCordPlan[] = [];
  private key = '';
  /** Plugs let go in the air: they fall and swing on their cord until they lie at rest (`stepFall`). */
  private falls = new Map<string, Fall>();
  private prevHeld: { kind: string; at: Pt } | null = null;
  private cur: { list: FanCordPlan[]; present: Map<string, boolean> } | null = null;

  constructor() { this.root.addChild(this.gc, this.gp); }

  /** A new room (theme, case tier, board tier): the plans are rebuilt and everything redrawn. */
  setRoom(T: Theme) { this.T = T; this.plans = fanCordPlans(); this.key = ''; this.falls.clear(); this.prevHeld = null; }

  /** Advance the plugs that fell out of the hand (call every frame; it redraws only while one moves). */
  tick(dt: number) {
    if (!this.falls.size || !this.cur) return;
    for (const [id, f] of this.falls) {
      const p = this.plans.find((q) => q.id === id);
      if (!p) { this.falls.delete(id); continue; }
      stepFall(f, dt, p.anchor, cordLen(p), p.rest);
      if (f.done) this.falls.delete(id);
    }
    this.draw(this.cur.list, this.cur.present, this.prevHeld);
  }

  get ids(): string[] { return this.plans.map((p) => 'cable.' + p.id); }

  /**
   * Draw the cords the machine lists (`present`: cable id to whether its plug is in, as the game, or the player's drop until it confirms, says) and
   * return them as the pointer sees them. `held` is the plug in the hand and where it is.
   */
  sync(present: Map<string, boolean>, held: { kind: string; at: Pt } | null, force = false): { cords: CordScene[]; redrew: boolean } {
    const list = this.plans.filter((p) => present.has(p.id));
    // a plug let go away from its header falls; one that is picked up (or seated) stops falling
    if (this.prevHeld && this.prevHeld.kind !== held?.kind && !present.get(this.prevHeld.kind) && list.some((p) => p.id === this.prevHeld!.kind)) this.falls.set(this.prevHeld.kind, startFall(this.prevHeld.at));
    for (const id of [...this.falls.keys()]) if (present.get(id) || held?.kind === id) this.falls.delete(id);
    this.prevHeld = held ? { kind: held.kind, at: [held.at[0], held.at[1]] } : null;
    this.cur = { list, present };
    const cords = list.map((p): CordScene => {
      const isHeld = held?.kind === p.id, connected = !!present.get(p.id) && !isHeld, at: Pt = isHeld ? held!.at : connected ? p.seat : p.rest;
      return { kind: p.id, connected, held: isHeld, plug: plugRectAt(p, at), centre: at, outlet: p.seat, outletRect: { x: p.header.x - 20, y: p.header.y - 20, w: p.header.w + 40, h: p.header.h + 40 }, rest: p.rest, seatR: p.seatR };
    });
    this.hits = cords.map((c) => ({ id: 'cable.' + c.kind, rect: c.plug, shape: this.shapes.get('cable.' + c.kind) }));
    const key = this.T.dark + '|' + this.falls.size + '|' + list.map((p) => (held?.kind === p.id ? `h${Math.round(held.at[0])},${Math.round(held.at[1])}` : present.get(p.id) ? 'c' : 'l') + p.id).join('|');
    if (key === this.key && !force) return { cords, redrew: false };
    this.key = key;
    this.draw(list, present, held);
    this.hits = cords.map((c) => ({ id: 'cable.' + c.kind, rect: c.plug, shape: this.shapes.get('cable.' + c.kind) }));
    return { cords, redrew: true };
  }

  private draw(list: FanCordPlan[], present: Map<string, boolean>, held: { kind: string; at: Pt } | null) {
    const T = this.T, g = this.gc;
    g.clear();
    this.gp.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const p of list) {
      const isHeld = held?.kind === p.id, connected = !!present.get(p.id) && !isHeld, fall = this.falls.get(p.id);
      const at: Pt = isHeld ? held!.at : connected ? p.seat : fall ? fall.p : p.rest;
      const path = connected ? roundedPath(p.route, 70, 30) : rubberBand(p.anchor, p.anchorDir, at, 36, cordLen(p));
      paintCable(g, T, path, { w: p.width, accent: T.mul });
      this.shapes.set('cable.' + p.id, cordShape(path, p.width, { x: at[0] - p.plug.w / 2, y: at[1] - p.plug.h / 2, w: p.plug.w, h: p.plug.h }));
      if (p.endPlug) plugBox(g, T, p.endPlug.x, p.endPlug.y, p.endPlug.w, p.endPlug.h, T.mul);
      // the plug on the header end: square on its seat, tilted where it lies or hangs in the hand
      const pg = new Graphics();
      pg.position.set(at[0], at[1]);
      plugBox(pg, T, -p.plug.w / 2, -p.plug.h / 2, p.plug.w, p.plug.h, T.mul);
      if (!connected) pg.rotation = fall ? fall.rot : 0.3;
      this.gp.addChild(pg);
    }
  }
}
