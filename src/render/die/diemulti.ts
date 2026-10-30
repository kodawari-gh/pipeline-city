// The CPU die of the game (docs/DIE.md "Core tiles"). A single-core CPU is one `PlanView`. A multicore CPU is the shared part (edge ring, shared L2,
// system bus) as one `PlanView` and a `PlanView` per core tile, each replaying its own hardware core's cycles, so every core runs live and zooming in
// opens up the insides of each (a tile's zoom is the die's times its scale). Zoomed out, each tile wears a wash in the tint of the job thread it runs
// with its pipeline as a row of cells, so the whole chip reads at a glance; the wash fades as the tile's insides become readable.

import { Container, Graphics, Text } from 'pixi.js';
import type { CoresSnap } from '../../sim/game/pipesnap';
import type { OooStages, TileCell } from './coretiles';
import type { Snapshot } from '../../sim/protocol';
import { box, MONO, mix } from '../ink';
import type { Theme } from '../theme';
import type { CpuPlan } from './cpuplan';
import { splitPlan, type CoreTile } from './coreplan';
import { CoreRateTracker, type CoreRate } from './corestats';
import { washModels } from './coretiles';
import { PlanView, type MemoryTouch } from './dieview';
import { uncoreInput, type UncoreUnit } from './uncore';
import { traceOpen } from '../../game/scrub';
import { effect } from '@preact/signals';
import { DEVICE_LOD, deviceLod, seenZoom, smooth, type LodRect } from '../lod';

/** The tile's insides take over from the wash between these zooms of the tile (the die's zoom times the tile's scale). */
const WASH_FROM = 0.55, WASH_TO = 0.85;

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
  private ringOn = false;
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
    // the ring marks the core the Trace panel follows: it shows only while the panel is open
    effect(() => { const on = traceOpen.value; for (const w of this.washes) w.ring.visible = on; this.ringOn = on; });
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

  /** A core's access reached an outer unit of the die (the memory controller, the shared L2, PCIe, USB, the display): its block shows it. */
  touchUnit(unit: UncoreUnit, write: boolean, now: number, addr = 0) { this.shared.touchUnit(unit, write, now, addr); }

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
      ring.visible = this.ringOn;
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
  update(s: Snapshot | null, _simple: boolean, now: number) {
    this.shared.setUncore(uncoreInput(s), now);
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

  /**
   * An out-of-order core as the usage of each structure: a row per structure (fetch queue, decode, scheduler, reorder buffer), a slot per entry in the
   * colour of the instruction in it (a finished reorder-buffer entry bright, a waiting one dim), the occupancy and the reason it is stuck at the end of
   * the row; under them the four units, each filling as its instruction goes through its latency.
   */
  private drawOoo(wash: { g: Graphics; texts: Container }, o: OooStages, q: LodRect, tx: number, tw: number, T: Theme, rad: number, asleep: boolean): void {
    const g = wash.g, row = q.h * 0.072, fs = Math.max(9, row * 0.62), labelW = tw * 0.2, barX = tx + labelW, tagW = tw * 0.27, barW = tw - labelW - tagW;
    const txt = (text: string, x: number, y: number, color: string, right = false, alpha = 1) => {
      const t = new Text({ text, style: { fontFamily: MONO, fontSize: fs, fontWeight: '600', fill: color, letterSpacing: 0.5 }, resolution: 2 });
      t.anchor.set(right ? 1 : 0, 0.5); t.position.set(x, y); t.alpha = asleep ? alpha * 0.5 : alpha;
      wash.texts.addChild(t);
    };
    const colour = (cls: TileCell) => (cls === null ? T.mute : cls === 'sys' ? T.mute : T[cls]);
    let y = q.y + q.h * 0.4;
    box(g, tx - 4, y - row * 0.2, tw + 8, row * 5.5, rad, { fill: T.bg, fa: 0.5, stroke: T.line, lw: 1.5, sa: 0.5 });
    for (const gau of o.gauges) {
      const h = row * 0.62, cy = y + row * 0.5;
      txt(gau.name, tx + 6, cy, T.mute);
      box(g, barX, cy - h / 2, barW, h, h * 0.25, { fill: T.line, fa: 0.25 });
      const n = gau.cap <= 24 ? gau.cap : 0;
      if (n > 0) {
        const sw = barW / n;
        gau.slots.slice(0, n).forEach((s, i) => box(g, barX + i * sw + 1, cy - h / 2 + 1, Math.max(1, sw - 2), h - 2, 2, { fill: colour(s.cls), fa: s.done ? 0.95 : 0.55 }));
      } else {
        g.roundRect(barX, cy - h / 2, barW * Math.min(1, gau.used / gau.cap), h, h * 0.25).fill({ color: T.mul, alpha: 0.7 });
      }
      txt(gau.used + '/' + gau.cap, barX + barW + 6, cy, gau.used >= gau.cap ? T.br : T.ink, false, 0.9);
      if (gau.stall) txt(gau.stall, tx + tw, cy, T.br, true);
      y += row;
    }
    // the units: a cell each, filling as the instruction works through its latency
    const uw = tw / o.units.length;
    o.units.forEach((u, i) => {
      const x = tx + i * uw, w = uw - 6, h = row * 0.62, cy = y + row * 0.3;
      box(g, x, cy - h / 2, w, h, h * 0.25, { fill: T.line, fa: 0.25 });
      if (u.cls !== null) box(g, x, cy - h / 2, Math.max(h * 0.5, w * Math.max(0.12, u.progress)), h, h * 0.25, { fill: colour(u.cls), fa: 0.9 });
      txt(u.name, x + 5, cy, u.cls === null ? T.mute : '#0b0d12', false, u.cls === null ? 0.7 : 0.9);
    });
  }

  /** The tint, the logical cores and the pipeline cells over each tile (redrawn when one of them changes). */
  private drawWash(cs: CoresSnap | undefined) {
    const T = this.T;
    const ws = cs ? washModels(cs, T.dark, this.rate) : [];
    const q8 = (v: number) => Math.round(v * 8);
    const sig = ws.map((w) => w.hw + (w.selected ? '*' : '') + w.models.map((m) => [m.tint, m.parked ? 1 : 0, m.sub].join(':')).join('/') + w.models[0]!.cells.join('.') + Math.round(w.models[0]!.fill * 8)
      + (w.models[0]!.ooo ? w.models[0]!.ooo.gauges.map((x) => x.used + (x.stall ?? '') + x.slots.map((c) => (c.cls ?? '-') + (c.done ? 1 : 0)).join('')).join(',') + w.models[0]!.ooo.units.map((u) => (u.cls ?? '-') + q8(u.progress)).join('') : '')
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
      if (!lead.ooo) box(g, tx - cg * 2, cy - ch * 0.35, tw + cg * 4, ch * 1.7 + (lead.fill > 0 ? ch * 0.35 : 0), rad, { fill: T.bg, fa: 0.55, stroke: T.line, lw: 1.5, sa: 0.5 });
      // the captions say what the picture is: a cell lights in the colour of the instruction in that stage (dark: a bubble), the bars are rates
      const fs = Math.max(12, q.h * 0.042), cap = (text: string, x: number, y: number, color: string, right = false) => {
        const t = new Text({ text, style: { fontFamily: MONO, fontSize: fs, fontWeight: '600', fill: color, letterSpacing: 1 }, resolution: 2 });
        t.anchor.set(right ? 1 : 0, 0); t.position.set(x, y);
        if (asleep(lead)) t.alpha = 0.5;
        wash.texts.addChild(t);
      };
      if (lead.ooo) this.drawOoo(wash, lead.ooo, q, tx, tw, T, rad, asleep(lead));
      else {
        const inorder = this.plan?.arch === 'inorder' && cn === 5, stageNames = ['F', 'D', 'X', 'M', 'W'];
        cap(inorder ? 'PIPELINE  FETCH > WRITE-BACK' : 'EXECUTION UNITS', tx, cy - ch * 0.35 - fs * 1.5, T.mute);
        cells.forEach((cls, i) => {
          const c = cls === null ? T.line : cls === 'sys' ? T.mute : T[cls], x = tx + i * (cw + cg);
          box(g, x, cy, cw, ch, ch * 0.18, { fill: c, fa: cls === null ? 0.18 : 0.9 });
          if (cls !== null) box(g, x, cy, cw, ch, ch * 0.18, { stroke: T.ink, lw: 1.2, sa: 0.18 });
          if (inorder) {
            const t = new Text({ text: stageNames[i]!, style: { fontFamily: MONO, fontSize: ch * 0.55, fontWeight: '700', fill: cls === null ? T.mute : '#0b0d12' }, resolution: 2 });
            t.anchor.set(0.5, 0.5); t.position.set(x + cw / 2, cy + ch / 2); t.alpha = cls === null ? 0.5 : 0.8;
            wash.texts.addChild(t);
          }
        });
        if (lead.fill > 0) {
          g.rect(tx, cy + ch * 1.25, tw, ch * 0.18).fill({ color: T.line, alpha: 0.3 }); g.rect(tx, cy + ch * 1.25, tw * lead.fill, ch * 0.18).fill({ color: T.mul });
          cap('REORDER BUFFER ' + Math.round(lead.fill * 100) + '%', tx + tw, cy + ch * 1.25 + ch * 0.3, T.mul, true);
        }
      }
      // the rate bar: the instructions per cycle in the core's colour (of the tile's width), the cycles lost to stalls in red from the other end
      const bw = tw, by = q.y + q.h * 0.8, bh = Math.max(5, q.h * 0.035), lanes = Math.max(1, cs?.tiles[w.hw]?.width ?? 1);
      box(g, tx, by, bw, bh, bh / 2, { fill: T.line, fa: 0.3 });
      if (!asleep(lead)) {
        box(g, tx, by, Math.max(bh, bw * Math.min(1, lead.ipc / lanes)), bh, bh / 2, { fill: lead.color, fa: 1 });
        const sw = bw * Math.min(1, lead.stall);
        if (sw > bh) box(g, tx + bw - sw, by, sw, bh, bh / 2, { fill: T.br, fa: 0.85 });
      }
      cap('IPC ' + lead.ipc.toFixed(2) + ' (work done per cycle)', tx, by + bh * 1.6, lead.color);
      cap('STALLED ' + Math.round(lead.stall * 100) + '%', tx + tw, by + bh * 1.6 + fs * 1.4, T.br, true);
      // the core badges and the border stay when the wash has faded: a core you zoomed into still says which it is
      const lw = Math.max(2, q.w * 0.004);
      b.roundRect(q.x, q.y, q.w, q.h, rad).stroke({ color: lead.color, width: lw, alpha: asleep(lead) ? 0.35 : 0.9 });
      if (w.selected) { const o = lw * 2.5; box(r, q.x - o, q.y - o, q.w + 2 * o, q.h + 2 * o, rad + o, { stroke: T.ink, lw: lw * 1.2, sa: 0.85 }); }
    }
    this.washes.forEach((_, k) => this.wearWash(k));
  }
}
