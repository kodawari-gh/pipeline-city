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
import { washModels } from './coretiles';
import { PlanView, type MemoryTouch } from './dieview';

/** The tile's insides take over from the wash between these zooms of the tile (the die's zoom times the tile's scale). */
const WASH_FROM = 0.3, WASH_TO = 0.6;
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export class DieView {
  readonly root = new Container();
  T!: Theme;
  private mem: ((e: MemoryTouch) => void) | null = null;
  private shared = new PlanView();
  private cores: { view: PlanView; tile: CoreTile }[] = [];
  private tilesAt = new Container();
  private wash = new Graphics();
  private ring = new Graphics();
  private washTexts = new Container();
  private sig = '';
  private z = 1;
  private plan: CpuPlan | null = null;

  constructor() {
    this.root.addChild(this.shared.root, this.tilesAt, this.wash, this.washTexts, this.ring);
  }

  /** Told every time a core reaches out to RAM, for the memory sticks (set by board.ts). */
  get onMemory() { return this.mem; }
  set onMemory(f: ((e: MemoryTouch) => void) | null) {
    this.mem = f;
    this.shared.onMemory = f;
    for (const c of this.cores) c.view.onMemory = f;
  }

  setPlan(T: Theme, plan: CpuPlan) {
    this.T = T;
    this.plan = plan;
    this.dropCores();
    const sp = splitPlan(plan);
    if (!sp) { this.shared.setPlan(T, plan); this.shared.scrubLead = true; this.setZoom(this.z); return; }
    this.shared.scrubLead = false;
    this.shared.setPlan(T, sp.shared);
    for (const tile of sp.tiles) {
      const view = new PlanView();
      view.legendOn = false;
      view.scrubLead = false;
      view.onMemory = this.mem;
      view.setPlan(T, tile.plan);
      this.tilesAt.addChild(view.root);
      this.cores.push({ view, tile });
    }
    this.setZoom(this.z);
  }

  clear() {
    this.plan = null;
    this.dropCores();
    this.shared.clear();
  }

  private dropCores() {
    for (const c of this.cores) { c.view.clear(); c.view.root.destroy({ children: true }); }
    this.cores = [];
    this.wash.clear(); this.ring.clear();
    for (const t of this.washTexts.removeChildren()) t.destroy();
    this.sig = '';
  }

  setZoom(z: number) {
    this.z = z;
    this.shared.setZoom(z);
    for (const c of this.cores) c.view.setZoom(z * c.tile.scale);
    // the wash fades out as the tile's own zoom reaches the point where its insides read
    const e = this.cores[0] ? z * this.cores[0].tile.scale : 1;
    const a = 1 - smooth(WASH_FROM, WASH_TO, e);
    this.wash.alpha = a; this.washTexts.alpha = a;
    this.wash.visible = this.washTexts.visible = a > 0.01;
  }

  /** A new snapshot: each core tile's replay gets its hardware core's cycles (a single-core die gets `pipe`). */
  update(s: Snapshot | null, _simple: boolean, _now: number) {
    if (this.cores.length === 0) { this.shared.update(s?.pipe ?? null); return; }
    const cs = s?.cores;
    const sel = cs ? cs.live[cs.selected]?.hw ?? 0 : 0;
    this.cores.forEach((c, k) => { c.view.scrubLead = k === sel; c.view.update(cs?.tiles[k] ?? null); });
    this.drawWash(cs);
  }

  frame(now: number, paused = false) {
    if (this.cores.length === 0) { this.shared.frame(now, paused); return; }
    for (const c of this.cores) c.view.frame(now, paused);
  }

  /** The tint, the logical cores and the pipeline cells over each tile (redrawn when one of them changes). */
  private drawWash(cs: CoresSnap | undefined) {
    const T = this.T;
    const ws = cs ? washModels(cs, T.dark) : [];
    const sig = ws.map((w) => w.hw + (w.selected ? '*' : '') + w.models.map((m) => [m.tint, m.parked ? 1 : 0, m.sub].join(':')).join('/') + w.models[0]!.cells.join('.') + Math.round(w.models[0]!.fill * 8)).join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    const g = this.wash, r = this.ring;
    g.clear(); r.clear();
    for (const t of this.washTexts.removeChildren()) t.destroy();
    for (const w of ws) {
      const tile = this.cores[w.hw]?.tile;
      if (!tile) continue;
      const q = tile.rect, n = w.models.length;
      w.models.forEach((m, i) => {
        // the logical cores of a hardware core share its tile: side by side, each in its own thread's tint
        const x = q.x + (q.w * i) / n, ww = q.w / n;
        g.rect(x, q.y, ww, q.h).fill({ color: mix(T.die, m.tint ?? T.line, m.tint ? 0.55 : 0.18) });
        const fs = Math.max(30, Math.min(120, q.h * 0.2 / (n > 2 ? 1.4 : 1)));
        const t = new Text({ text: m.label + '\n' + m.sub, style: { fontFamily: MONO, fontSize: fs, fontWeight: '700', fill: m.tint ? T.ink : T.mute, align: 'center' }, resolution: 2 });
        t.anchor.set(0.5, 0.5); t.position.set(x + ww / 2, q.y + q.h * 0.3);
        this.washTexts.addChild(t);
      });
      const cells = w.models[0]!.cells, cn = Math.max(1, cells.length), cw = (q.w * 0.84) / cn, ch = Math.min(q.h * 0.14, cw * 0.9), cy = q.y + q.h * 0.66;
      cells.forEach((cls, i) => {
        const c = cls === null ? T.line : cls === 'sys' ? T.mute : T[cls];
        g.roundRect(q.x + q.w * 0.08 + i * cw + cw * 0.06, cy, cw * 0.88, ch, ch * 0.2).fill({ color: c, alpha: cls === null ? 0.3 : 1 });
      });
      if (w.models[0]!.fill > 0) g.rect(q.x + q.w * 0.08, cy + ch * 1.3, q.w * 0.84 * w.models[0]!.fill, ch * 0.2).fill({ color: T.mul });
      if (w.selected) box(r, q.x, q.y, q.w, q.h, 6, { stroke: T.ink, lw: Math.max(3, q.w * 0.008), sa: 0.9 });
    }
  }
}
