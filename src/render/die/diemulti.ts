// The CPU die of the game (docs/DIE.md "Core tiles"). A single-core CPU is one `PlanView`. A multicore CPU is the shared part (edge ring, shared L2,
// system bus) as one `PlanView` and a `PlanView` per core tile, each replaying its own hardware core's cycles, so every core runs live and zooming in
// opens up the insides of each (a tile's zoom is the die's times its scale). Zoomed out, each tile wears a wash in the tint of the job thread it runs
// with its pipeline as a row of cells, so the whole chip reads at a glance; the wash fades as the tile's insides become readable.

import { Container, Graphics, Text } from 'pixi.js';
import type { CoresSnap } from '../../sim/game/pipesnap';
import type { Snapshot } from '../../sim/protocol';
import { box, MONO, mix } from '../ink';
import type { Theme } from '../theme';
import type { CpuPlan } from './cpuplan';
import { splitPlan, type CoreTile } from './coreplan';
import { CoreRateTracker, type CoreRate } from './corestats';
import { washModels } from './coretiles';
import { PlanView, type MemoryTouch } from './dieview';
import { DEVICE_LOD, deviceLod, seenZoom, smooth, type LodRect } from '../lod';

/** The tile's insides take over from the wash between these zooms of the tile (the die's zoom times the tile's scale). */
const WASH_FROM = 0.45, WASH_TO = 0.75;

export class DieView {
  readonly root = new Container();
  T!: Theme;
  private mem: ((e: MemoryTouch) => void) | null = null;
  private shared = new PlanView();
  private cores: { view: PlanView; tile: CoreTile }[] = [];
  private tilesAt = new Container();
  /** The wash of each tile (its own container, so a tile far from the centre of the view fades by its own distance). */
  private washLayer = new Container();
  /** The core badges and borders of the tiles: they stay when the wash has faded, so a core you zoomed into still says which it is. */
  private tagLayer = new Container();
  private washes: { box: Container; g: Graphics; texts: Container; tag: Container; badge: Graphics; tagTexts: Container; ring: Graphics }[] = [];
  /** How much of itself each tile keeps in the core view (1: all; a tile away from the centre of the view fades out when only the core in focus should show). */
  private keep: number[] = [];
  /** How much of its wash each tile still wears (1: all). */
  private washA: number[] = [];
  private view: LodRect | null = null;
  private rateOf = new CoreRateTracker();
  private rate: CoreRate[] = [];
  /** For each hardware core (tile), the logical core its reaches for RAM are put down to. */
  private logical: number[] = [];
  private sig = '';
  private z = 1;
  private zSeen = 1;
  private plan: CpuPlan | null = null;

  constructor() {
    this.root.addChild(this.shared.root, this.tilesAt, this.washLayer, this.tagLayer);
  }

  /** Told every time a core reaches out to RAM, for the memory sticks (set by board.ts). */
  get onMemory() { return this.mem; }
  set onMemory(f: ((e: MemoryTouch) => void) | null) {
    this.mem = f;
    this.shared.onMemory = f;
    this.cores.forEach((c, k) => { c.view.onMemory = this.tileMem(k); });
  }

  /** A tile's reaches for RAM, told with the logical core they came from (a hardware core with threads reports the first one: the thread is not in the replay). */
  private tileMem(k: number): ((e: MemoryTouch) => void) | null {
    if (!this.mem) return null;
    return (e) => this.mem?.({ ...e, core: this.logical[k] ?? k });
  }

  /** Told when a core takes an interrupt (set by board.ts). */
  private irq: ((line: number) => void) | null = null;
  get onInterrupt() { return this.irq; }
  set onInterrupt(f: ((line: number) => void) | null) {
    this.irq = f;
    this.shared.onInterrupt = f;
    for (const c of this.cores) c.view.onInterrupt = f;
  }

  /** A load or store reached a register of a unit on the die (the interrupt controller, timer, MPU, MMU): its block and wire light (the units are shared by the cores). */
  poke(unit: 'intc' | 'timer' | 'mpu' | 'mmu', write: boolean, now: number) { this.shared.poke(unit, write, now); }

  setPlan(T: Theme, plan: CpuPlan) {
    this.T = T;
    this.plan = plan;
    this.dropCores();
    const sp = splitPlan(plan);
    if (!sp) { this.shared.setPlan(T, plan); this.shared.scrubLead = true; this.setZoom(this.z, this.zSeen, this.view); return; }
    this.shared.scrubLead = false;
    this.shared.setPlan(T, sp.shared);
    for (const tile of sp.tiles) {
      const view = new PlanView();
      view.legendOn = false;
      view.scrubLead = false;
      view.onInterrupt = this.irq;
      view.setPlan(T, tile.plan, tile.motion);
      this.tilesAt.addChild(view.root);
      this.cores.push({ view, tile });
      view.onMemory = this.tileMem(this.cores.length - 1);
    }
    this.setZoom(this.z, this.zSeen, this.view);
  }

  clear() {
    this.plan = null;
    this.dropCores();
    this.shared.clear();
  }

  private dropCores() {
    for (const c of this.cores) { c.view.clear(); c.view.root.destroy({ children: true }); }
    this.cores = [];
    for (const w of this.washes) { w.box.destroy({ children: true }); w.tag.destroy({ children: true }); }
    this.washes = []; this.washA = []; this.keep = [];
    this.rateOf = new CoreRateTracker(); this.rate = [];
    this.sig = '';
  }

  /**
   * `seen` is the zoom of the die as a whole (the shared part reads it). With the `view`, each core tile reads the zoom by its own distance from
   * the view centre, and its wash and its insides trade places on it: the insides show only as the wash goes (and are not drawn while it covers
   * them), so the two never overlap. Deeper than `DEVICE_LOD.die.core` the core view takes over: the shared part and every tile but the one under
   * the view centre fade out, so what is left is the one core.
   */
  setZoom(z: number, seen = z, view: LodRect | null = this.view) {
    this.z = z; this.zSeen = seen; this.view = view;
    // each tile's zoom by its own distance from the view centre; the core view starts from the best-placed one, so zooming on a core off the middle of the die still gets there
    const seenOf = this.cores.map((c) => (view ? seenZoom(z, deviceLod(c.tile.rect, view).focus) : seen));
    const [c0, c1] = DEVICE_LOD.die.core, coreView = smooth(c0, c1, Math.max(seen, ...seenOf));
    this.shared.setZoom(z, seen);
    this.shared.root.alpha = 1 - coreView;
    this.shared.root.visible = coreView < 0.99;
    this.cores.forEach((c, k) => {
      const s = seenOf[k]!;
      c.view.setZoom(z * c.tile.scale, s * c.tile.scale);
      const a = 1 - smooth(WASH_FROM, WASH_TO, s * c.tile.scale);
      this.washA[k] = a;
      // the tile the view centre is over keeps itself; the others fade as the core view comes in
      this.keep[k] = view ? 1 - coreView * smooth(0, 0.08, this.centreDist(c.tile.rect, view)) : 1;
      c.view.root.alpha = (1 - a) * this.keep[k]!;
      c.view.root.visible = c.view.root.alpha > 0.01;
      this.wearWash(k);
    });
  }

  /** How far the view centre is from the rectangle (0 inside it), in half-diagonals of the view. */
  private centreDist(r: LodRect, view: LodRect): number {
    const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    const dx = Math.max(r.x - cx, 0, cx - (r.x + r.w)), dy = Math.max(r.y - cy, 0, cy - (r.y + r.h));
    return Math.hypot(dx, dy) / (Math.hypot(view.w, view.h) / 2 || 1);
  }

  /** The wash and the tags (border, badges, selection ring) of tile `k`, made when first drawn. */
  private washAt(k: number) {
    let w = this.washes[k];
    if (!w) {
      const box = new Container(), g = new Graphics(), texts = new Container();
      box.addChild(g, texts);
      this.washLayer.addChild(box);
      const tag = new Container(), badge = new Graphics(), tagTexts = new Container(), ring = new Graphics();
      tag.addChild(badge, tagTexts, ring);
      this.tagLayer.addChild(tag);
      w = this.washes[k] = { box, g, texts, tag, badge, tagTexts, ring };
    }
    return w;
  }

  /** Apply how much wash tile `k` wears (the tint fades with it, the big labels and cells faster, so they are gone before the insides read) and how much of the tile the core view keeps. */
  private wearWash(k: number): void {
    const w = this.washes[k], a = this.washA[k] ?? 1, keep = this.keep[k] ?? 1;
    if (!w) return;
    w.g.alpha = a; w.texts.alpha = a * a;
    w.box.alpha = keep;
    w.box.visible = a * keep > 0.01;
    w.tag.alpha = keep;
    w.tag.visible = keep > 0.01;
  }

  /** A new snapshot: each core tile's replay gets its hardware core's cycles (a single-core die gets `pipe`). */
  update(s: Snapshot | null, _simple: boolean, _now: number) {
    if (this.cores.length === 0) { this.shared.update(s?.pipe ?? null); return; }
    const cs = s?.cores;
    const sel = cs ? cs.live[cs.selected]?.hw ?? 0 : 0;
    this.cores.forEach((c, k) => { c.view.scrubLead = k === sel; c.view.update(cs?.tiles[k] ?? null); });
    this.rate = this.rateOf.update(cs?.stats);
    this.logical = [];
    for (const l of cs?.live ?? []) if (this.logical[l.hw] === undefined || (l.job !== 0 && !l.parked)) this.logical[l.hw] = l.core;
    this.drawWash(cs);
  }

  frame(now: number, paused = false, draw = true) {
    if (this.cores.length === 0) { this.shared.frame(now, paused, draw); return; }
    for (const c of this.cores) c.view.frame(now, paused, draw && c.view.root.visible);
  }

  /** The tint, the logical cores and the pipeline cells over each tile (redrawn when one of them changes). */
  private drawWash(cs: CoresSnap | undefined) {
    const T = this.T;
    const ws = cs ? washModels(cs, T.dark, this.rate) : [];
    const q8 = (v: number) => Math.round(v * 8);
    const sig = ws.map((w) => w.hw + (w.selected ? '*' : '') + w.models.map((m) => [m.tint, m.parked ? 1 : 0, m.sub].join(':')).join('/') + w.models[0]!.cells.join('.') + Math.round(w.models[0]!.fill * 8)
      + '~' + q8(w.models[0]!.ipc) + ':' + q8(w.models[0]!.stall) + (T.dark ? 'd' : 'l')).join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    for (const x of this.washes) {
      x.g.clear(); x.badge.clear(); x.ring.clear();
      for (const t of x.texts.removeChildren()) t.destroy();
      for (const t of x.tagTexts.removeChildren()) t.destroy();
    }
    for (const w of ws) {
      const tile = this.cores[w.hw]?.tile;
      if (!tile) continue;
      const q = tile.rect, n = w.models.length, lead = w.models[0]!, wash = this.washAt(w.hw), g = wash.g, b = wash.badge, r = wash.ring;
      const asleep = (m: typeof lead) => m.parked && !m.tint;
      // the tile as a recessed panel in the die's own style: a tinted bed, a hairline frame, one column per logical core under a small header
      const inset = Math.max(6, q.w * 0.012), pw = q.w - 2 * inset, ph = q.h - 2 * inset, rad = Math.max(4, q.w * 0.012);
      box(g, q.x + inset, q.y + inset, pw, ph, rad, { fill: mix(T.die, T.bg, 0.35), fa: 1 });
      w.models.forEach((m, i) => {
        const x = q.x + inset + (pw * i) / n, ww = pw / n;
        box(g, x + inset * 0.5, q.y + inset * 1.5, ww - inset, ph - inset, rad, { fill: m.tint ?? T.line, fa: m.tint ? 0.2 : 0.07, stroke: m.tint ?? T.line, lw: Math.max(1.5, q.w * 0.0035), sa: m.tint ? 0.55 : 0.25 });
        if (i > 0) g.rect(x - 0.5, q.y + inset * 3, 1.5, ph * 0.5).fill({ color: T.line, alpha: 0.5 });
        const big = Math.max(24, Math.min(64, q.h * 0.13 / (n > 2 ? 1.4 : 1)));
        const head = new Text({ text: m.label, style: { fontFamily: MONO, fontSize: big, fontWeight: '700', fill: m.tint ? T.ink : T.mute, letterSpacing: big * 0.06 }, resolution: 2 });
        head.anchor.set(0.5, 0.5); head.position.set(x + ww / 2, q.y + q.h * 0.2);
        const sub = new Text({ text: (asleep(m) ? 'zz ' : '') + m.sub, style: { fontFamily: MONO, fontSize: big * 0.46, fontWeight: '600', fill: T.mute, letterSpacing: big * 0.05 }, resolution: 2 });
        sub.anchor.set(0.5, 0.5); sub.position.set(x + ww / 2, q.y + q.h * 0.2 + big * 0.85);
        if (asleep(m)) { head.alpha = 0.6; sub.alpha = 0.6; }
        wash.texts.addChild(head, sub);
      });
      // the pipeline: a recessed track with a cell per stage (or unit), the reorder buffer fill under it
      const cells = lead.cells, cn = Math.max(1, cells.length), tx = q.x + q.w * 0.07, tw = q.w * 0.86, cg = tw * 0.012;
      const cw = (tw - cg * (cn - 1)) / cn, ch = Math.min(q.h * 0.1, cw * 0.8), cy = q.y + q.h * 0.58;
      box(g, tx - cg * 2, cy - ch * 0.35, tw + cg * 4, ch * 1.7 + (lead.fill > 0 ? ch * 0.35 : 0), rad, { fill: T.bg, fa: 0.55, stroke: T.line, lw: 1.5, sa: 0.5 });
      cells.forEach((cls, i) => {
        const c = cls === null ? T.line : cls === 'sys' ? T.mute : T[cls], x = tx + i * (cw + cg);
        box(g, x, cy, cw, ch, ch * 0.18, { fill: c, fa: cls === null ? 0.18 : 0.9 });
        if (cls !== null) box(g, x, cy, cw, ch, ch * 0.18, { stroke: T.ink, lw: 1.2, sa: 0.18 });
      });
      if (lead.fill > 0) { g.rect(tx, cy + ch * 1.25, tw, ch * 0.18).fill({ color: T.line, alpha: 0.3 }); g.rect(tx, cy + ch * 1.25, tw * lead.fill, ch * 0.18).fill({ color: T.mul }); }
      // the rate bar: the instructions per cycle in the core's colour (of the tile's width), the cycles lost to stalls in red from the other end
      const bw = tw, by = q.y + q.h * 0.8, bh = Math.max(5, q.h * 0.035), lanes = Math.max(1, cs?.tiles[w.hw]?.width ?? 1);
      box(g, tx, by, bw, bh, bh / 2, { fill: T.line, fa: 0.3 });
      if (!asleep(lead)) {
        box(g, tx, by, Math.max(bh, bw * Math.min(1, lead.ipc / lanes)), bh, bh / 2, { fill: lead.color, fa: 1 });
        const sw = bw * Math.min(1, lead.stall);
        if (sw > bh) box(g, tx + bw - sw, by, sw, bh, bh / 2, { fill: T.br, fa: 0.85 });
      }
      const rate = new Text({ text: 'IPC ' + lead.ipc.toFixed(2) + '   STALL ' + Math.round(lead.stall * 100) + '%', style: { fontFamily: MONO, fontSize: Math.max(14, q.h * 0.05), fontWeight: '600', fill: T.mute, letterSpacing: 1 }, resolution: 2 });
      rate.anchor.set(0, 0); rate.position.set(tx, by + bh * 1.6);
      if (asleep(lead)) rate.alpha = 0.5;
      wash.texts.addChild(rate);
      // the core badges and the border stay when the wash has faded: a core you zoomed into still says which it is
      const lw = Math.max(2, q.w * 0.004);
      b.rect(q.x, q.y, q.w, q.h).stroke({ color: lead.color, width: lw, alpha: asleep(lead) ? 0.35 : 0.9 });
      const bs = Math.max(16, Math.min(56, q.h * 0.07)), bwid = bs * 2.1, gap = bs * 0.2;
      w.models.forEach((m, i) => {
        const bx = q.x + lw + i * (bwid + gap), byy = q.y + lw;
        b.roundRect(bx, byy, bwid, bs * 1.2, bs * 0.25).fill({ color: m.color, alpha: asleep(m) ? 0.45 : 1 });
        const t = new Text({ text: m.label, style: { fontFamily: MONO, fontSize: bs, fontWeight: '700', fill: T.dark ? '#0b0d12' : '#ffffff' }, resolution: 2 });
        t.anchor.set(0.5, 0.5); t.position.set(bx + bwid / 2, byy + bs * 0.6);
        wash.tagTexts.addChild(t);
      });
      if (w.selected) box(r, q.x, q.y, q.w, q.h, 6, { stroke: T.ink, lw: Math.max(3, q.w * 0.008), sa: 0.9 });
    }
    this.washes.forEach((_, k) => this.wearWash(k));
  }
}
