import { Container, Graphics, type Text } from 'pixi.js';
import type { StorageSnap } from '@/worker/game/types';
import { box, label, mix } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';
import { DiskPlay } from './diskplay';
import type { Rect } from '../../cpu/render/cpuplan';
import { DEVICE_LOD, bandAlpha, onBand, seenZoom, smooth, type Candidate, type CardLod, type LodRect } from '@/core/render/lod';
import { accentOf, diskStatic, drawArch, drawBar, drawMap, type ArchLive, type DataCtx } from './diskart';
import { diskPlan, type DiskPlan } from './diskfloor';
import { cellsOf, counterRows, CELL_BLOCKS, dimmed, headTrack, ownerSlot, type Cell } from './diskplan';
import type { DriveKind } from './drives';
import { RectCache } from '@/core/render/lodrect';
import { cardCandidates, cardText } from '@/core/render/lodcard';

// The drives of the board with their insides (docs/render/lod.md, docs/OS.md "The filesystem ledger"). Zoomed out the casing shows (drives.ts) with a fill bar
// on it. Zoomed in the casing fades to a cutaway drawn in the CPU die's style: the capacity map, one cell per block group coloured by what it holds (OS,
// spool, programs, each client's datasets, lost, bad, free); deeper the architecture of the tier (a platter and a head arm that seeks to the block in use;
// a controller with one channel to four NAND dies; an NVMe with four channels to eight dies and queue lanes) with the wear of each group shaded on the dies;
// and, for the drives nearest the view centre (the shared counter budget), the extent list, a legend by owner, the wear and the queue. A drive that is not
// mounted shows its data dimmed; a burnt one shows every dataset lost. What the drive's commands make it do is replayed step by step: packets along the links, the blocks and the die cell at work, the arm seeking (diskplayer.ts).

const [FADE_FROM, FADE_TO] = DEVICE_LOD.disk.fade, TEXT_Z = DEVICE_LOD.disk.text, DETAIL_Z = DEVICE_LOD.disk.detail, ARCH_Z = DEVICE_LOD.disk.arch;
const TEXT_LINES = 26;

export interface DiskScene { slot: string; deviceId: string; kind: DriveKind; body: Rect }

interface DriveView {
  slot: string;
  deviceId: string;
  kind: DriveKind;
  body: Rect;
  plan: DiskPlan;
  root: Container;
  /** The fill bar of the far view, in the drive's local units. */
  bar: Graphics;
  /** The cutaway: the die-style floor and blocks, the capacity map, then the architecture over it. */
  cut: Container;
  mapG: Graphics;
  arch: Container;
  dataG: Graphics;
  trailG: Graphics;
  packetG: Graphics;
  names: Container;
  subs: Container;
  /** The counter tier: a backdrop, bars, and a pool of texts. */
  panel: Container;
  panelG: Graphics;
  texts: Text[];
  snap: StorageSnap | null;
  cells: Cell[];
  /** What the drive's commands make it do, replayed step by step (diskplay.ts, diskplayer.ts). */
  play: DiskPlay;
  liveG: Graphics;
  sig: string;
  panelSig: string;
}

export class DiskView {
  readonly root = new Container();
  private T: Theme | null = null;
  private drives: DriveView[] = [];
  private zoom = 1;
  private readonly rects = new RectCache();
  private now = 0;
  private lastWall = 0;

  constructor() {
    this.root.visible = false;
  }

  /** The drives of a new scene. */
  setScene(T: Theme, scene: DiskScene[]): void {
    this.T = T;
    for (const ch of this.root.removeChildren()) ch.destroy({ children: true });
    this.drives = scene.map((s) => this.build(T, s));
    this.root.visible = this.drives.length > 0;
  }

  private build(T: Theme, s: DiskScene): DriveView {
    const { w, h } = s.body, plan = diskPlan(s.kind, w, h, Math.ceil((s.kind === 'hdd' ? 96 : s.kind === 'ssd-sata' ? 64 : 128) * 1024 / 256 / CELL_BLOCKS));
    const root = new Container(), cut = new Container(), art = diskStatic(T, s.kind, plan), arch = new Container();
    root.position.set(s.body.x, s.body.y);
    // an invisible rectangle gives the node its bounds (the LoD places it by them)
    const hit = new Graphics().rect(0, 0, w, h).fill({ color: '#000000', alpha: 0 });
    const mapG = new Graphics(), dataG = new Graphics(), trailG = new Graphics(), packetG = new Graphics(), bar = new Graphics(), panel = new Container(), panelG = new Graphics();
    const liveG = new Graphics();
    arch.addChild(art.blocks, art.near.wires, dataG, liveG, trailG, packetG, art.near.names, art.near.subs);
    cut.addChild(art.far, mapG, arch);
    panel.addChild(panelG);
    const texts: Text[] = [];
    for (let i = 0; i < TEXT_LINES; i++) {
      const t = label('', 0, 0, Math.max(8, h * 0.05), T.ink, { anchor: [0, 0.5] });
      t.visible = false;
      texts.push(t);
      panel.addChild(t);
    }
    root.addChild(hit, bar, cut, panel);
    this.root.addChild(root);
    return {
      slot: s.slot, deviceId: s.deviceId, kind: s.kind, body: s.body, plan, root, bar, cut, mapG, arch, dataG, trailG, packetG, names: art.near.names, subs: art.near.subs, panel, panelG, texts,
      snap: null, cells: [], play: new DiskPlay(), liveG, sig: '', panelSig: '',
    };
  }

  setZoom(z: number): void {
    this.zoom = z;
  }

  /** The newest storage snapshots. */
  update(storage: readonly StorageSnap[] | undefined): void {
    for (const d of this.drives) {
      d.snap = storage?.find((s) => s.deviceId === d.deviceId) ?? null;
      if (d.snap) d.play.ingest(d.kind, d.plan, d.snap.cmds, d.snap.capacityBytes / 256, d.snap.headLba);
    }
  }

  /** The drives in view that want their counters, for the detail budget (live.ts). */
  candidates(view: LodRect): Candidate[] {
    return cardCandidates('disk', this.drives, this.rects, view, this.zoom, DETAIL_Z);
  }

  /** Per frame. `inner` is false while the case's exterior covers the board. A drive out of view is not drawn. */
  frame(dt: number, inner: boolean, paused = false, lod?: CardLod): void {
    this.root.visible = inner && this.drives.length > 0;
    if (!this.root.visible || !this.T) return;
    const wall = performance.now(), wdt = Math.min(0.1, Math.max(0, (wall - this.lastWall) / 1000));
    this.lastWall = wall;
    const step = (paused ? wdt : dt) * 1000;
    this.now += step;
    const T = this.T;
    for (const d of this.drives) {
      const pl = this.rects.place(d, d.root, lod?.view), on = pl.onScreen, z = seenZoom(this.zoom, pl.focus), fade = smooth(FADE_FROM, FADE_TO, z), arch = bandAlpha(z, onBand(ARCH_Z));
      d.root.visible = on;
      const s = d.snap;
      d.bar.alpha = 1 - fade;
      d.bar.visible = on && fade < 0.98 && !!s;
      d.cut.alpha = fade;
      d.cut.visible = on && fade > 0.02 && !!s;
      if (!on || !s) continue;
      const { ta, da, showText, showDetail } = cardText(z, lod, `disk:${d.slot}`, TEXT_Z, DETAIL_Z);
      // the map is the main picture until the architecture comes over it (a flash drive swaps its flat grid for the dies; a platter stays)
      d.mapG.alpha = d.plan.platter ? 1 : 1 - arch;
      d.arch.alpha = arch;
      d.arch.visible = arch > 0.02;
      d.names.visible = showText && arch > 0.02;
      d.names.alpha = ta * arch;
      d.subs.visible = showDetail && arch > 0.02;
      d.subs.alpha = da * arch;
      d.panel.visible = showDetail;
      d.panel.alpha = da;
      this.redraw(T, d, s, step, showDetail, arch > 0.02);
    }
  }

  private redraw(T: Theme, d: DriveView, s: StorageSnap, stepMs: number, detail: boolean, archOn: boolean): void {
    // the arm is where the commands put it
    const head = d.play.track;
    const dim = dimmed(s), runsSig = s.fs.runs.reduce((n, r) => (n * 31 + r.start * 7 + r.len * 3 + r.file + (r.filled ? 1 : 0) + r.kind.length) >>> 0, 17);
    const sig = `${runsSig}|${s.usedBytes}|${s.wearPct}|${s.badGroups}|${s.lostBlocks}|${s.burnt ? 1 : 0}|${dim ? 1 : 0}|${s.wear.length}|${Math.round(head * 20)}|${s.queued}|${s.busy ? 1 : 0}|${archOn ? 1 : 0}`;
    const x: DataCtx = { owners: new Map(s.fs.files.filter((f) => f.kind === 'dataset').map((f) => [f.id, ownerSlot(f.owner)])), dim, burnt: s.burnt };
    if (sig !== d.sig) {
      d.sig = sig;
      d.cells = cellsOf(s.fs.runs, s.capacityBytes / 256, s.wear);
      const live: ArchLive = { headLba: s.headLba, totalBlocks: s.capacityBytes / 256, track: head, queued: s.queued, depth: s.queueDepth, busy: s.busy };
      drawBar(d.bar, T, d.body.w, d.body.h, s.usedBytes, s.capacityBytes, s.burnt);
      drawMap(d.mapG, T, d.kind, d.plan, d.cells, x);
      drawArch(d.dataG, T, d.kind, d.plan, d.cells, x, live);
      if (s.burnt) this.cross(T, d);
    }
    if (archOn || d.play.busy) d.play.frame(stepMs, T, d.kind, d.plan, d.liveG, d.trailG, d.packetG);
    if (detail) this.counters(T, d, s);
  }

  /** A burnt drive: a red cross over the cutaway. */
  private cross(T: Theme, d: DriveView): void {
    const { w, h } = d.plan;
    d.mapG.moveTo(w * 0.2, h * 0.2).lineTo(w * 0.8, h * 0.8).moveTo(w * 0.8, h * 0.2).lineTo(w * 0.2, h * 0.8).stroke({ width: h * 0.04, color: T.bad, alpha: 0.85, cap: 'round' });
  }

  /** The counter tier: the extent list, the legend by owner, the wear and the queue. */
  private counters(T: Theme, d: DriveView, s: StorageSnap): void {
    const r = counterRows(s, 5), { w, h } = d.plan;
    const now = d.play.label(), sig = JSON.stringify(r) + (s.burnt ? 'b' : '') + now;
    if (sig === d.panelSig) return;
    d.panelSig = sig;
    const g = d.panelG, fs = Math.max(8, h * 0.05), lh = fs * 1.55, x0 = w * 0.05, x1 = w * 0.54;
    g.clear();
    box(g, 0, 0, w, h, Math.min(w, h) * 0.03, { fill: mix(T.die, '#000000', 0.45), fa: 0.97, stroke: mix(T.line, accentOf(T, d.kind), 0.6), lw: Math.max(1.2, h * 0.008) });
    let n = 0;
    const put = (str: string, x: number, y: number, color: string, size = fs, a = 1): void => {
      const t = d.texts[n++];
      if (!t) return;
      t.text = str;
      t.position.set(x, y);
      t.style.fontSize = size;
      t.style.fill = color;
      t.alpha = a;
      t.visible = true;
    };
    put(r.title, x0, h * 0.09, T.ink, fs * 1.25);
    put(r.state, w * 0.95 - r.state.length * fs * 0.6, h * 0.09, s.burnt ? T.bad : r.state.includes('unmounted') || r.state === 'unformatted' ? T.ld : T.st, fs);
    put('EXTENTS', x0, h * 0.2, T.mute, fs * 0.85);
    r.extents.forEach((e, i) => put(e, x0, h * 0.2 + lh * (i + 1), T.ink, fs, 0.95));
    if (r.moreExtents > 0) put(`+${r.moreExtents} more`, x0, h * 0.2 + lh * (r.extents.length + 1), T.mute, fs * 0.9);
    put('WHAT IS ON IT', x1, h * 0.2, T.mute, fs * 0.85);
    const col = (kind: string, slot: number): string => {
      const owned = [T.ld, T.br, mix(T.ld, T.bad, 0.5), mix(T.alu, T.mul, 0.5)];
      return kind === 'os' ? T.alu : kind === 'spool' ? T.st : kind === 'program' ? T.mul : kind === 'meta' ? T.mute : kind === 'lost' ? mix(T.bad, T.bg, 0.5) : kind === 'bad' ? T.bad : kind === 'free' ? mix(T.die, T.ink, 0.2) : owned[slot]!;
    };
    r.legend.slice(0, 5).forEach((l, i) => {
      const y = h * 0.2 + lh * (i + 1);
      g.roundRect(x1, y - fs * 0.4, fs * 0.8, fs * 0.8, 2).fill({ color: col(l.kind, l.slot) });
      put(`${l.label}  ${l.blocks}`, x1 + fs * 1.2, y, T.ink, fs, 0.95);
    });
    // the wear and the queue along the bottom
    const by = h * 0.7, bw = w * 0.3;
    put(r.wear.text, x0, by, T.mute, fs);
    g.roundRect(x0 + fs * 6, by - fs * 0.3, bw, fs * 0.6, fs * 0.3).fill({ color: '#000000', alpha: 0.45 });
    g.roundRect(x0 + fs * 6, by - fs * 0.3, Math.max(fs * 0.6, (bw * r.wear.pct) / 100), fs * 0.6, fs * 0.3).fill({ color: r.wear.pct > 60 ? T.bad : T.ld });
    put(r.queue.text, x0, by + lh, T.mute, fs);
    for (let q = 0; q < r.queue.lanes; q++) g.roundRect(x0 + fs * 6 + (q * bw) / r.queue.lanes, by + lh - fs * 0.3, bw / r.queue.lanes - 2, fs * 0.6, 2).fill({ color: q < r.queue.lit ? T.st : mix(T.die, T.st, 0.15) });
    put(r.health, x0, by + lh * 2.2, s.lostBlocks > 0 || s.badGroups > 0 ? T.ld : T.mute, fs * 0.9);
    put(now || 'idle', x0, by + lh * 3.4, now ? T.ink : T.mute, fs * 0.95);
    for (; n < d.texts.length; n++) d.texts[n]!.visible = false;
  }
}
