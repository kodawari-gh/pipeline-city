import { Container, Graphics } from 'pixi.js';
import type { NpuSnap } from '../../sim/game/types';
import { NpuOp } from '../../sim/isa/memmap';
import { box } from '../ink';
import type { Theme } from '../theme';
import { CellTexts, drawPackets, drawTrails, packetOn, type Packet, type Trail } from '../die/diepulse';
import type { Pt, Rect } from '../die/cpuplan';
import { npuFar, npuNear, NPU_KIND_COLOR } from '../npu/npuart';
import { npuGlyphArea, npuLive, type NpuShow } from '../npu/npuglyph';
import { NpuPlayer, REPLAY_HOP_MS, replayStepMs } from '../npu/npuplayer';
import { npuRoute } from '../npu/npuroute';
import type { NpuBlock } from '../npu/npuplan';
import { npuCover } from './accelart';
import { npuGeo, type NpuGeo } from './npulayout';

// The AI cards of the board, alive (docs/ACCEL.md "NPU internal view"). Seen from afar a card is a lid over its die. Zoomed in, the lid fades away like a
// graphics card's shroud and the die shows through, drawn in the CPU die's style (npu/npuart.ts): the control registers with the words the CPU wrote, the
// descriptor queue with the row being run, the tile registers filling, the array of multiply-accumulate cells with the data pulsing right and down and
// the sums they hold, the bias and relu stage, the ruler of card memory with the windows a step reads and writes. A descriptor runs as packets along
// the die's own routed wires (npu/npuroute.ts); a launch that finished before the player looked is replayed in slow motion (npu/npuplayer.ts).

// Zoom levels (board scale; the die is 1200 to 1600 units across): the lid fades 0.4 -> 0.7, the traces and symbols come with it, the names at 0.75, the
// second lines and the sums in the cells at 1.5.
const FADE_FROM = 0.4, FADE_TO = 0.7, TEXT_Z = 0.75, DETAIL_Z = 1.5;
/** How long a hop of a live launch's packet takes (ms): the card's own phases are far shorter than a frame. */
const LIVE_HOP_MS = 420;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface NpuScene { slot: string; visual: string; origin: { x: number; y: number } }

interface CardView {
  slot: string;
  geo: NpuGeo;
  root: Container;
  /** The die in card units (1 : 1) and the lid over it. */
  die: Container;
  cover: Container;
  glowG: Graphics;
  litG: Graphics;
  texts: Container;
  trailG: Graphics;
  packetG: Graphics;
  names: Container;
  subs: Container;
  cellTexts: Map<string, CellTexts>;
  packets: Packet[];
  trails: Map<string, Trail>;
  glow: Map<string, { v: number; color: string }>;
  /** The step last sent along the wires (launch, phase, descriptor), so a packet leaves once. */
  sent: string;
  /** The glyph areas of the blocks, in die units. */
  areas: { b: NpuBlock; a: Rect }[];
  player: NpuPlayer;
  /** The look last drawn while the card sits idle, so a still card costs nothing. */
  sig: string;
}

export class NpuCardView {
  readonly root = new Container();
  private T: Theme | null = null;
  private cards: CardView[] = [];
  private zoom = 1;
  /** The replay's own clock (ms): packets and lights run on it. */
  private now = 0;
  private lastWall = 0;

  constructor() {
    this.root.visible = false;
  }

  /** The cards of a new scene. */
  setScene(T: Theme, scene: NpuScene[]): void {
    this.T = T;
    for (const c of this.cards) for (const ct of c.cellTexts.values()) ct.clear();
    for (const ch of this.root.removeChildren()) ch.destroy({ children: true });
    this.cards = scene.map((s) => this.build(T, s));
    this.root.visible = this.cards.length > 0;
  }

  private build(T: Theme, s: NpuScene): CardView {
    const geo = npuGeo(s.visual), plan = geo.plan, root = new Container(), die = new Container(), plate = new Graphics();
    root.position.set(s.origin.x, s.origin.y);
    die.position.set(geo.origin.x, geo.origin.y);
    npuFar(plate, T, plan);
    const near = npuNear(T, plan);
    die.addChild(plate, near.wires, near.cells);
    const glowG = new Graphics(), litG = new Graphics(), texts = new Container(), trailG = new Graphics(), packetG = new Graphics();
    die.addChild(glowG, litG, texts, trailG, packetG, near.names, near.subs);
    const cover = npuCover(T, geo);
    root.addChild(die, cover);
    this.root.addChild(root);
    const areas = plan.blocks.flatMap((b) => { const a = npuGlyphArea(b); return a ? [{ b, a }] : []; });
    return {
      slot: s.slot, geo, root, die, cover, glowG, litG, texts, trailG, packetG, names: near.names, subs: near.subs, cellTexts: new Map(), packets: [], trails: new Map(),
      glow: new Map(), sent: '', areas, player: new NpuPlayer(), sig: '',
    };
  }

  setZoom(z: number): void {
    this.zoom = z;
  }

  /** The newest snapshot of the cards. */
  update(npus: NpuSnap[] | undefined): void {
    for (const c of this.cards) c.player.feed(npus?.find((x) => x.slot === c.slot));
  }

  /** Per frame. `inner` is false while the case's exterior covers the board (nothing to draw). */
  frame(dt: number, inner: boolean, paused = false): void {
    this.root.visible = inner && this.cards.length > 0;
    if (!this.root.visible || !this.T) return;
    // a paused game has no game time, but a replay still plays: it runs on the wall clock then
    const wall = performance.now(), wdt = Math.min(0.1, Math.max(0, (wall - this.lastWall) / 1000));
    this.lastWall = wall;
    const step = (paused ? wdt : dt) * 1000;
    this.now += step;
    const T = this.T, fade = smooth(FADE_FROM, FADE_TO, this.zoom);
    for (const c of this.cards) {
      c.player.advance(step);
      const show = c.player.show(this.now);
      c.cover.alpha = 1 - fade;
      c.die.alpha = fade;
      c.die.visible = fade > 0.02;
      if (!c.die.visible) continue;
      const showText = this.zoom >= TEXT_Z, showDetail = this.zoom >= DETAIL_Z;
      c.names.visible = c.texts.visible = showText;
      c.subs.visible = showDetail;
      // an idle card only needs a redraw when something it shows changes (the clock lane blinks every 160 ms)
      const still = !show || (show.phase === 'idle' && c.packets.length === 0 && c.trails.size === 0 && c.glow.size === 0);
      const sig = still ? `${show ? `${show.cycles}|${show.count}|${show.done ? 1 : 0}${show.error ? 1 : 0}|${show.tiles.map((t) => (t ? 1 : 0)).join('')}|${show.acc.reduce((n, x) => (n * 31 + x) | 0, 7)}` : '-'}|${Math.floor(this.now / 160)}|${showText ? 1 : 0}${showDetail ? 1 : 0}` : '';
      if (still && sig === c.sig) continue;
      c.sig = sig;
      this.animate(T, c, show);
    }
  }

  /** The colour of a descriptor's packets: loads amber, products purple, the bias cyan, the relu pink, stores green. */
  private stepColor(T: Theme, op: number): string {
    return op === NpuOp.Load ? T.ld : op === NpuOp.Bias ? T.alu : op === NpuOp.Relu ? T.br : op === NpuOp.Store ? T.st : T.mul;
  }

  /** Send the step the launch has reached along its route: a packet on each wire in turn, in its colour (once per launch, phase and descriptor). */
  private fly(c: CardView, show: NpuShow): void {
    const phase = show.phase;
    if (phase === 'idle') { c.sent = ''; return; }
    const key = `${c.player.token}:${phase}:${show.index}`;
    if (c.sent === key) return;
    c.sent = key;
    const T = this.T!, op = show.step?.op ?? 0;
    if (phase === 'run' && !show.step) return;
    const route = npuRoute(c.geo.plan, op, phase);
    if (route.length === 0) return;
    const color = phase === 'in' ? T.alu : phase === 'out' ? T.st : this.stepColor(T, op);
    const total = !show.replay ? LIVE_HOP_MS : phase === 'run' ? replayStepMs(show.step!) : REPLAY_HOP_MS, sp = (total * 0.9) / route.length, dur = Math.max(sp * 1.1, 200);
    route.forEach((h, i) => {
      const o = { id: h.link.id, lanes: h.link.lanes, pts: h.link.pts as Pt[] };
      const { packet, trail } = packetOn(o, h.reverse, this.now + i * sp, dur, color);
      c.packets.push(packet);
      c.trails.set(h.link.id, trail);
    });
  }

  /** The blocks the launch is in right now, and how strongly. */
  private active(show: NpuShow | null): Map<string, number> {
    const out = new Map<string, number>();
    if (!show || show.phase === 'idle') return out;
    if (show.phase === 'in' || show.phase === 'out') { out.set('host', 1); out.set('ctl', 1); if (show.phase === 'in') out.set('desc', 0.5); return out; }
    out.set('desc', 1);
    const op = show.step?.op ?? 0;
    const of = (...ids: string[]) => { for (const id of ids) out.set(id, 1); };
    if (op === NpuOp.Load) of('cardmem', 'tiles');
    else if (op === NpuOp.Matmul || op === NpuOp.Macc) of('tiles', 'array');
    else if (op === NpuOp.Bias) of('cardmem', 'post');
    else if (op === NpuOp.Relu) of('array', 'post');
    else if (op === NpuOp.Store) of('array', 'post', 'cardmem');
    else if (op === NpuOp.Layer) of('cardmem', 'tiles', 'array', 'post');
    return out;
  }

  /** The moving parts: packets on the wires, the glow of the blocks the launch is in, the lit parts and the numbers of the symbols. */
  private animate(T: Theme, c: CardView, show: NpuShow | null): void {
    const now = this.now;
    if (!show) { c.packets = []; c.trails.clear(); c.sent = ''; } else this.fly(c, show);
    const want = this.active(show), kind = (id: string) => c.geo.plan.blocks.find((b) => b.id === id)!.kind;
    for (const [id, k] of want) c.glow.set(id, { v: Math.min(1, (c.glow.get(id)?.v ?? 0) + 0.25 * k), color: T[NPU_KIND_COLOR[kind(id)]] });
    for (const [id, g] of c.glow) if (!want.has(id)) { g.v *= 0.9; if (g.v < 0.02) c.glow.delete(id); }
    const lit: { rect: Rect; color: string; a: number }[] = [], used = new Set<string>();
    if (show) {
      for (const { b, a } of c.areas) {
        const live = npuLive(b, a, show);
        for (const l of live.lit) if (l.a > 0) lit.push({ rect: l.rect, color: T[l.color], a: l.a });
        let ct = c.cellTexts.get(b.id);
        if (!ct) { ct = new CellTexts(c.texts); c.cellTexts.set(b.id, ct); }
        used.add(b.id);
        live.texts.forEach((x, n) => ct!.line(n, x.top, x.rect, x.ink ? T.ink : T.on, x.fit));
        ct.hideFrom(live.texts.length);
      }
    }
    for (const [id, ct] of c.cellTexts) if (!used.has(id)) ct.hideFrom(0);
    const byId = new Map(c.geo.plan.blocks.map((b) => [b.id, b]));
    const gg = c.glowG;
    gg.clear();
    for (const [id, g] of c.glow) {
      const b = byId.get(id);
      if (b) box(gg, b.rect.x, b.rect.y, b.rect.w, b.rect.h, 3, { fill: g.color, fa: 0.14 * g.v, stroke: g.color, lw: 2.5, sa: 0.55 * g.v });
    }
    c.litG.clear();
    for (const l of lit) box(c.litG, l.rect.x, l.rect.y, l.rect.w, l.rect.h, 1.5, { fill: l.color, fa: l.a });
    drawTrails(c.trailG, c.trails, now, 1);
    c.packets = drawPackets(c.packetG, c.packets, now, 1, T.ink);
  }
}
