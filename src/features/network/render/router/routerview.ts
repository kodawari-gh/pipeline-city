import { Container, Graphics } from 'pixi.js';
import type { Snapshot } from '@/worker/protocol';
import { box } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';
import { DEVICE_LOD, deviceLod, seenZoom, type CardLod } from '@/core/render/lod/lod';
import { cardText } from '@/core/render/lod/lodcard';
import { CellTexts, drawPackets, drawTrails, packetOn, type Packet, type Trail } from '../../../cpu/render/die/diepulse';
import { FrameMeter } from '../plan/netmeter';
import type { Rect } from '../plan/netplan';
import { ROUTER_KIND_COLOR } from './routerart';
import { routerGlyphArea, routerLive } from './routerglyph';
import type { RouterGeo } from './routerlayout';
import type { RouterBlock } from './routerplan';
import { BLOCKS, routerRoute, type RouterDir } from './routerroute';
import { routerShow } from './routershow';

// The router, alive (docs/render/net.md "Inside the NIC and the router"). Like the card's view (nic/nicview.ts) it runs only what moves; the still router is the panel's baked art
// (routerart.ts). Over the plan it lights the blocks the frames go through, runs a packet along the router's own wires for the frames the link carries (routerroute.ts: in from the WAN
// jack to the LAN jack, and out the other way), puts the numbers in the blocks (the rates, the clients in service, the transfers in flight, the speeds), and lights the rows the
// symbols give (routerglyph.ts). Everything comes from the snapshot (routershow.ts): a router with no link on one side shows a dark line and no packet; nothing runs by itself.

const TEXT_Z = DEVICE_LOD.router.text;
/** The largest live text (plan units): the plan is drawn at the card's density, so its numbers are the card's. */
const TEXT_CAP = 22;

/** The router has no rival for the counters' budget: it always holds its slot. */
const TOP: ReadonlySet<string> = new Set(['router']);

/** The router of a new scene. */
export interface RouterScene { geo: RouterGeo }

interface RouterLayer {
  geo: RouterGeo;
  /** The plan, at its place in the world and at the plan scale. */
  root: Container;
  glowG: Graphics;
  litG: Graphics;
  texts: Container;
  trailG: Graphics;
  packetG: Graphics;
  cellTexts: Map<string, CellTexts>;
  packets: Packet[];
  trails: Map<string, Trail>;
  glow: Map<string, number>;
  /** When the next packet of each way leaves (ms of the view's clock). */
  next: Record<RouterDir, number>;
  areas: { b: RouterBlock; a: Rect }[];
}

export class RouterView {
  readonly root = new Container();
  private T: Theme | null = null;
  private layer: RouterLayer | null = null;
  private zoom = 1;
  private readonly meter = new FrameMeter();
  private snap: Snapshot | null | undefined = undefined;
  /** The view's own clock (ms of game time): packets and lights run on it, and it holds while the game is paused. */
  private now = 0;

  constructor() {
    this.root.visible = false;
  }

  /** The router of a new scene (none: no router stands). */
  setScene(T: Theme, scene: RouterScene | null): void {
    this.T = T;
    if (this.layer) for (const ct of this.layer.cellTexts.values()) ct.clear();
    for (const ch of this.root.removeChildren()) ch.destroy({ children: true });
    this.layer = scene ? this.build(scene) : null;
    this.root.visible = !!this.layer;
  }

  private build(s: RouterScene): RouterLayer {
    const geo = s.geo, root = new Container(), bounds = new Graphics();
    root.position.set(geo.origin.x, geo.origin.y);
    root.scale.set(geo.scale);
    // (the view's place is read from its bounds: an invisible rectangle over the plan gives them before anything is lit)
    bounds.rect(0, 0, geo.plan.die.w, geo.plan.die.h).fill({ color: 0x000000, alpha: 0 });
    const glowG = new Graphics(), litG = new Graphics(), texts = new Container(), trailG = new Graphics(), packetG = new Graphics();
    root.addChild(bounds, glowG, litG, texts, trailG, packetG);
    this.root.addChild(root);
    const areas = geo.plan.blocks.flatMap((b) => { const a = routerGlyphArea(b); return a ? [{ b, a }] : []; });
    return { geo, root, glowG, litG, texts, trailG, packetG, cellTexts: new Map(), packets: [], trails: new Map(), glow: new Map(), next: { rx: 0, tx: 0 }, areas };
  }

  /** The zoom the panel is seen at (screen pixels per world unit). */
  setZoom(z: number): void {
    this.zoom = z;
  }

  /** The newest snapshot: the frame meter reads its counters. */
  update(s: Snapshot | null | undefined): void {
    if (s === this.snap) return;
    this.snap = s;
    this.meter.feed(s);
  }

  /** Per frame. `dt`: game seconds since the last frame (0 while paused: nothing moves). `lod`: the view (world), so a router out of view is not drawn. */
  frame(dt: number, inner: boolean, paused = false, lod?: Pick<CardLod, 'view'>): void {
    const c = this.layer;
    this.root.visible = inner && !!c;
    if (!c || !this.root.visible || !this.T) return;
    this.now += (paused ? 0 : dt) * 1000;
    const T = this.T, pl = lod?.view ? deviceLod(c.geo.face, lod.view, undefined, true) : { onScreen: true, focus: 1 };
    c.root.visible = pl.onScreen;
    if (!pl.onScreen) return;
    const z = seenZoom(this.zoom, pl.focus), { showText, ta } = cardText(z, lod ? { view: lod.view, top: TOP } : undefined, 'router', TEXT_Z, DEVICE_LOD.router.detail);
    c.texts.visible = showText;
    c.texts.alpha = ta;
    const show = routerShow(this.snap, this.meter, this.now);
    if (!show) { c.packets = []; c.trails.clear(); c.litG.clear(); c.glowG.clear(); c.trailG.clear(); c.packetG.clear(); for (const ct of c.cellTexts.values()) ct.hideFrom(0); return; }
    const flow = show.pc && show.wan;
    this.fly(T, c, flow ? { rx: show.rxAct, tx: show.txAct } : { rx: 0, tx: 0 });
    // the blocks the frames go through glow while they do
    const want = new Map<string, number>();
    if (flow) for (const dir of ['rx', 'tx'] as RouterDir[]) { const act = dir === 'rx' ? show.rxAct : show.txAct; if (act > 0) for (const id of BLOCKS[dir]) want.set(id, Math.max(want.get(id) ?? 0, act)); }
    for (const [id, v] of want) c.glow.set(id, (c.glow.get(id) ?? 0) + (v - (c.glow.get(id) ?? 0)) * 0.25);
    for (const [id, v] of c.glow) if (!want.has(id)) { const n = v * 0.9; if (n < 0.02) c.glow.delete(id); else c.glow.set(id, n); }
    const byId = new Map(c.geo.plan.blocks.map((b) => [b.id, b]));
    c.glowG.clear();
    for (const [id, v] of c.glow) {
      const b = byId.get(id);
      if (b) { const col = T[ROUTER_KIND_COLOR[b.kind] === 'mute' ? 'alu' : ROUTER_KIND_COLOR[b.kind]]; box(c.glowG, b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3, { fill: col, fa: 0.012 * v, stroke: col, lw: 2, sa: 0.4 * v }); }
    }
    // the symbols' lit parts and numbers
    c.litG.clear();
    const used = new Set<string>();
    for (const { b, a } of c.areas) {
      const live = routerLive(b, a, show, c.geo.plan.input);
      for (const l of live.lit) box(c.litG, l.rect.x, l.rect.y, l.rect.w, l.rect.h, 1.5, { fill: T[l.color], fa: l.a });
      let ct = c.cellTexts.get(b.id);
      if (!ct) { ct = new CellTexts(c.texts); c.cellTexts.set(b.id, ct); }
      used.add(b.id);
      live.texts.forEach((x, n) => ct!.line(n, x.top, x.rect, x.ink ? T.ink : T.on, x.fit, TEXT_CAP));
      ct.hideFrom(live.texts.length);
    }
    for (const [id, ct] of c.cellTexts) if (!used.has(id)) ct.hideFrom(0);
    drawTrails(c.trailG, c.trails, this.now, 1);
    c.packets = drawPackets(c.packetG, c.packets, this.now, 1, T.ink);
  }

  /**
   * Send a packet along each way that carries frames: the busier the lane (`busy` of the frames a tick, a log scale), the closer the packets follow each other. A way with no frames
   * sends none, so a quiet link shows no motion; the ones sent keep a trail that fades.
   */
  private fly(T: Theme, c: RouterLayer, act: Record<RouterDir, number>): void {
    for (const dir of ['rx', 'tx'] as RouterDir[]) {
      const a = act[dir];
      if (a <= 0) { c.next[dir] = this.now; continue; }
      if (this.now < c.next[dir] || c.packets.length > 28) continue;
      c.next[dir] = this.now + 1800 - 1500 * a;
      const route = routerRoute(c.geo.plan, dir), total = 1500 - 700 * a, sp = (total * 0.9) / route.length, dur = Math.max(sp * 1.1, 220);
      route.forEach((h, i) => {
        const { packet, trail } = packetOn({ id: h.link.id, lanes: h.link.lanes, pts: h.link.pts }, h.reverse, this.now + i * sp, dur, dir === 'rx' ? T.alu : T.mul);
        c.packets.push(packet);
        c.trails.set(`${h.link.id}:${dir}`, trail);
      });
    }
  }
}
