import { Container, Graphics, Text } from 'pixi.js';
import type { RamMap } from '../../sim/game/pipesnap';
import type { RamRegion } from '../../sim/game/ramregions';
import { label, mix } from '../ink';
import { opClass, type OpClass } from '../die/diemotion';
import { CHIPS_PER_STICK, PAGE, chipContent, chipLayout, lensRows, ownerMap, regionColor, sizeText, spanOutline, type ChipSlot, type Stick } from './ramlayout';
import { coreColor } from '../die/coretiles';
import { bubblesOf, coresText } from './rambubbles';
import type { Rect } from './layout';
import type { Theme } from '../theme';
import { DEVICE_LOD, SHOWN, bandAlpha, onBand } from '../lod';

// The memory sticks as a map of RAM (docs/DIE.md "Memory"). Every DRAM chip is a grid of cells, one per 256-byte page (a block of the drive):
// the colour is the owner (the boot ROM grey, the OS pale, each program by its type), the strength is how full the page is. Zoomed in, the
// regions are outlined, each stick shows how full it is, and a magnifier beside the address the CPU touches last reads the memory as text:
// the instructions of the code, the words of the data. Cells are drawn only when the memory changes, so the view costs next to nothing.

const TOUCH_MS = 700, MAX_TOUCHES = 8, MAX_CORE_TOUCHES = 48, MAX_BUBBLES = 6;
// the zoom levels are in lod.ts (`DEVICE_LOD.ram`): below `show` the traces are the picture, the view fades in over it
const SHOW_Z = DEVICE_LOD.ram.show, OUTLINE_Z = DEVICE_LOD.ram.outline, BAND_Z = DEVICE_LOD.ram.band, LENS_Z = DEVICE_LOD.ram.lens;
const LENS_ROWS = 9, LENS_W = 310, LINE = 11, NOTE_LINES = 2, LENS_H = 16 + LENS_ROWS * LINE + 8 + NOTE_LINES * 9 + 14;
const CLASS_KEY: [OpClass, string][] = [['alu', 'ALU'], ['ld', 'LOAD'], ['st', 'STORE'], ['mul', 'MUL'], ['br', 'BRANCH'], ['sys', 'SYSTEM']];

/** `core`: the logical core that reached for the address, on a multicore die (a single core has none: the cell lights, no bubble). */
interface Touch { addr: number; kind: string; color: string; t: number; core?: number }

interface ChipView { slot: ChipSlot }

/** Text broken into at most `lines` lines of `width` characters (the last one cut short with an ellipsis). */
/** A signature of the mapped pages, to redraw when a table changes. */
const vmSig = (m: RamMap): string => (m.vm ? m.vm.spaces.map((s) => `${s.table}:${s.pages.length}:${s.pages.reduce((a, b) => (a * 31 + b) | 0, 0)}`).join(',') : '');

/** What the page tables say about the page that holds `addr`: where each running program sees it (virtual address and what it may do with it), or the last fault. */
export function vmNote(m: RamMap, addr: number): string {
  if (!m.vm) return '';
  const frame = addr >>> 8, out: string[] = [];
  for (const sp of m.vm.spaces) {
    for (let i = 0; i < sp.pages.length; i += 3) {
      if (sp.pages[i + 1] !== frame) continue;
      const f = sp.pages[i + 2]!;
      out.push(`${sp.label}: virtual 0x${(sp.pages[i]! * 256).toString(16)} ${f & 1 ? 'R' : '-'}${f & 2 ? 'W' : '-'}${f & 4 ? 'X' : '-'}`);
    }
  }
  return out.slice(0, 2).join(' | ');
}

function wrap(text: string, width: number, lines: number): string {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) {
    if (cur && cur.length + 1 + w.length > width) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1]!.replace(/.{0,3}$/, '') + '…'; }
  return out.join('\n');
}

export class RamView {
  readonly root = new Container();
  private T: Theme | null = null;
  private chips: ChipView[] = [];
  private sticks: Stick[] = [];
  private rects: Rect[] = [];
  private map: RamMap | null = null;
  private prev: Uint8Array | null = null;
  private regionSig = '';
  private own: Uint8Array = new Uint8Array(0);
  private touches: Touch[] = [];
  private lastTouch: Touch | null = null;
  private zoom = 1;
  private touchDrawn = false;
  private imgVersion = 0;

  private readonly back = new Graphics();
  private readonly outG = new Graphics();
  private readonly names = new Container();
  private readonly touchG = new Graphics();
  /** The labels of the bubbles (pooled: a bubble's text is set while it lives). */
  private readonly bubbleLayer = new Container();
  private bubbleTexts: Text[] = [];
  private lensAt: { x: number; y: number } | null = null;
  private readonly lensG = new Graphics();
  /** Where the magnifier's thread meets it (world). */
  private readonly lens = new Container();
  private lensRowsT: Text[] = [];
  private lensTitle: Text | null = null;
  private lensTag: Text | null = null;
  private lensNote: Text | null = null;
  private lensKey: Text[] = [];
  private lensSig = '';
  private regionTexts: Text[] = [];
  private stickTexts: Text[] = [];
  private outSig = '';
  private stickSig = '';

  constructor() {
    this.lens.addChild(this.lensG);
    this.root.addChild(this.back, this.outG, this.names, this.touchG, this.bubbleLayer, this.lens);
    this.root.visible = false;
  }

  /** The chips of the installed sticks (four per stick, in device order), for a new scene. */
  setScene(T: Theme, rects: Rect[]): void {
    this.T = T;
    this.rects = rects;
    this.destroyChips();
    for (const t of this.bubbleTexts) t.destroy();
    this.bubbleTexts = [];
    for (const t of [...this.regionTexts, ...this.stickTexts, ...this.lensRowsT, ...(this.lensTitle ? [this.lensTitle] : []), ...(this.lensTag ? [this.lensTag] : []), ...(this.lensNote ? [this.lensNote] : []), ...this.lensKey]) t.destroy();
    this.regionTexts = []; this.stickTexts = []; this.lensRowsT = []; this.lensTitle = null; this.lensTag = null; this.lensNote = null; this.lensKey = []; this.lensSig = ''; this.outSig = '';
    this.back.clear(); this.outG.clear(); this.touchG.clear(); this.lensG.clear(); this.lens.visible = false;
    this.regionSig = '';
    this.layout();
  }

  private destroyChips(): void {
    this.chips = [];
  }

  private layout(): void {
    this.destroyChips();
    const bytes = this.map?.bytes ?? 0;
    if (!this.map || this.rects.length === 0) return;
    const slots = chipLayout(this.rects, this.sticks, bytes);
    this.chips = slots.map((slot) => ({ slot }));
    const T = this.T!;
    for (const c of this.chips) {
      const r = chipContent(c.slot.rect);
      this.back.rect(r.x, r.y, r.w, r.h).fill({ color: mix(T.die, T.bg, 0.55), alpha: 0.95 });
    }
  }

  /** The installed sticks (slot number and size, in device order); a change lays the chips out again. */
  setSticks(sticks: Stick[]): void {
    const sig = sticks.map((s) => `${s.idx}:${s.bytes}`).join('|');
    if (sig === this.stickSig) return;
    this.stickSig = sig;
    this.sticks = sticks;
    this.prev = null;
    if (this.map) this.layout();
    this.regionSig = '';
  }

  setZoom(z: number): void {
    this.zoom = z;
  }

  /** The CPU reached for a RAM address (a fetch, a load, a store): that spot lights in the colour of the instruction. */
  touch(kind: string, addr: number, color: string, core?: number): void {
    const t: Touch = { addr, kind, color, t: performance.now(), core };
    this.touches.push(t);
    if (this.touches.length > (core === undefined ? MAX_TOUCHES : MAX_CORE_TOUCHES)) this.touches.shift();
    this.lastTouch = t;
  }

  /** A new RAM map from a snapshot (null: the machine is off). */
  setMap(m: RamMap | null): void {
    if (!m || !m.image) { this.map = null; this.prev = null; this.root.visible = false; return; }
    const sizeChanged = !this.map || this.map.bytes !== m.bytes;
    this.map = m;
    if (sizeChanged || this.chips.length === 0) { this.prev = null; this.layout(); }
    const sig = m.regions.map((r) => `${r.id}:${r.lo}:${r.hi}:${r.codeEnd ?? 0}:${r.type ?? ''}`).join('|');
    if (sig !== this.regionSig) { this.regionSig = sig; this.recolor(m.regions); }
    const prev = this.prev;
    let changed = !prev;
    if (prev) for (let a = 0; a < m.image.length; a++) if (prev[a] !== m.image[a]) { changed = true; break; }
    if (changed) this.imgVersion++;
    this.prev = m.image;
  }

  private recolor(regions: RamRegion[]): void {
    if (!this.T) return;
    this.own = ownerMap(regions, this.map?.image.length ?? 0);
    this.outSig = '';
  }

  /** Per frame (`inner`: the interior of the board shows, not the exterior covering it). */
  frame(inner: boolean, wall = performance.now()): void {
    const fade = bandAlpha(this.zoom, onBand(SHOW_Z));
    const show = inner && !!this.map && this.chips.length > 0 && fade > SHOWN;
    this.root.visible = show;
    this.root.alpha = fade;
    if (!show) return;
    this.touches = this.touches.filter((t) => wall - t.t < TOUCH_MS);
    this.drawOutlines();
    this.drawLens(wall);
    this.drawTouches(wall);
  }

  /** The slot number of the stick that holds `addr` (-1: none). */
  stickOf(addr: number): number {
    const i = this.chips.findIndex((c) => addr >= c.slot.lo && addr < c.slot.hi);
    return i < 0 ? -1 : this.sticks[Math.floor(i / CHIPS_PER_STICK)]?.idx ?? -1;
  }

  private chipOf(addr: number): ChipView | undefined {
    return this.chips.find((c) => addr >= c.slot.lo && addr < c.slot.hi);
  }

  /** The cell (page) that holds `addr`, in the world. */
  private spot(c: ChipView, addr: number): { x: number; y: number; sx: number; sy: number } {
    const r = chipContent(c.slot.rect);
    const sx = r.w / c.slot.tilesX, sy = r.h / c.slot.tilesY, p = Math.floor((addr - c.slot.lo) / PAGE);
    return { x: r.x + (p % c.slot.tilesX) * sx, y: r.y + Math.floor(p / c.slot.tilesX) * sy, sx, sy };
  }

  private text(pool: Text[], k: number, size: number, color: string): Text {
    let t = pool[k];
    if (!t) {
      t = label('', 0, 0, size, color, { minPx: 4 });
      pool[k] = t;
      this.names.addChild(t);
    }
    return t;
  }

  /** The pages' cells, region outlines and names on the chips, and how full each stick is. */
  private drawOutlines(): void {
    const m = this.map, T = this.T;
    if (!m || !T) return;
    // line widths follow the zoom in quarter-octave steps (about 19 %): a redraw per step, not one per tenth of a zoom while the wheel turns
    const q = Math.round(Math.log2(this.zoom) * 4), z = 2 ** (q / 4);
    const sig = `${this.regionSig}|${q}|${OUTLINE_Z <= this.zoom ? 1 : 0}${BAND_Z <= this.zoom ? 1 : 0}|${this.imgVersion}|${T.dark}|${m.dram?.open.join(',') ?? ''}|${vmSig(m)}`;
    if (sig === this.outSig) return;
    this.outSig = sig;
    const g = this.outG;
    g.clear();
    let nt = 0, ns = 0;
    const outlines = this.zoom >= OUTLINE_Z, bands = this.zoom >= BAND_Z;
    for (const t of this.regionTexts) t.visible = false;
    for (const t of this.stickTexts) t.visible = false;
    const tint = 1;
    for (const c of this.chips) {
      const cr = chipContent(c.slot.rect), cw = cr.w / c.slot.tilesX, ch = cr.h / c.slot.tilesY;
      const pages = Math.ceil((c.slot.hi - c.slot.lo) / PAGE);
      // a page is one cell: its owner's colour, stronger the fuller it is
      if (tint > 0.02) {
        for (let p = 0; p < pages; p++) {
          const a0 = c.slot.lo + p * PAGE, a1 = Math.min(a0 + PAGE, m.image.length);
          let nz = 0, owned = 0, best = 0;
          const votes = new Map<number, number>();
          for (let a = a0; a < a1; a++) {
            if (m.image[a]) nz++;
            const o = this.own[a]!;
            if (o) { owned++; const v = (votes.get(o) ?? 0) + 1; votes.set(o, v); if (v > (votes.get(best) ?? 0)) best = o; }
          }
          if (nz === 0 && owned === 0) continue;
          const col = best ? regionColor(m.regions[best - 1]!, T) : T.mute;
          const x = cr.x + (p % c.slot.tilesX) * cw, y = cr.y + Math.floor(p / c.slot.tilesX) * ch;
          g.rect(x + 0.4, y + 0.4, cw - 0.8, ch - 0.8).fill({ color: col, alpha: tint * (0.14 + 0.5 * (owned / PAGE) + 0.36 * (nz / PAGE)) });
        }
      }
      // DRAM: pages are rows, interleaved over channels and banks, and the row open in each bank is outlined
      const d = m.dram;
      if (outlines && d && d.rowBytes === PAGE) {
        d.open.forEach((row, bank) => {
          if (row < 0) return;
          const ch2 = Math.floor(bank / d.banks), b = bank % d.banks, page = (row * d.banks + b) * d.channels + ch2, off = page - c.slot.lo / PAGE; // the inverse of Dram.locate
          if (off < 0 || off >= pages) return;
          const x = cr.x + (off % c.slot.tilesX) * cw, y = cr.y + Math.floor(off / c.slot.tilesX) * ch;
          g.rect(x + 1, y + 1, cw - 2, ch - 2).stroke({ width: Math.max(0.5, 1.6 / z), color: T.ink, alpha: 0.85 });
        });
      }
      if (outlines) {
        for (let i = 0; i <= c.slot.tilesX; i++) g.moveTo(cr.x + i * cw, cr.y).lineTo(cr.x + i * cw, cr.y + ch * c.slot.tilesY);
        for (let j = 0; j <= c.slot.tilesY; j++) g.moveTo(cr.x, cr.y + j * ch).lineTo(cr.x + cw * c.slot.tilesX, cr.y + j * ch);
        g.stroke({ width: Math.max(0.15, 0.6 / z), color: T.line, alpha: 0.55 });
      }
    }
    // the page tables: a bar at the foot of every page a program has mapped, by what the table allows (read and run: cyan, read and write: magenta, all three: amber)
    if (outlines && m.vm) {
      const seen = new Set<number>();
      for (const sp of m.vm.spaces) {
        for (let i = 0; i < sp.pages.length; i += 3) {
          const frame = sp.pages[i + 1]!, fl = sp.pages[i + 2]!;
          if (seen.has(frame)) continue;
          seen.add(frame);
          const c = this.chipOf(frame * PAGE);
          if (!c) continue;
          const sx = chipContent(c.slot.rect), cw = sx.w / c.slot.tilesX, ch = sx.h / c.slot.tilesY, off = frame - c.slot.lo / PAGE;
          const x = sx.x + (off % c.slot.tilesX) * cw, y = sx.y + Math.floor(off / c.slot.tilesX) * ch;
          g.rect(x + 1, y + ch - Math.max(1.2, ch * 0.16) - 0.6, cw - 2, Math.max(1.2, ch * 0.16)).fill({ color: fl & 4 && fl & 2 ? T.ld : fl & 4 ? T.alu : T.br, alpha: 0.95 });
        }
      }
    }
    if (outlines) {
      m.regions.forEach((r) => {
        const col = regionColor(r, T);
        for (const c of this.chips) {
          const pts = spanOutline(Math.floor(r.lo / PAGE), Math.ceil(r.hi / PAGE), c.slot.lo / PAGE, c.slot.hi / PAGE, c.slot.tilesX);
          if (pts.length === 0) continue;
          const cr = chipContent(c.slot.rect), cw = cr.w / c.slot.tilesX, ch = cr.h / c.slot.tilesY;
          g.poly(pts.flatMap(([x, y]) => [cr.x + x * cw, cr.y + y * ch]), true).stroke({ width: Math.max(0.35, 1.3 / z), color: col, alpha: 0.95, join: 'miter' });
        }
      });
    }
    if (bands) {
      for (let s = 0; s * CHIPS_PER_STICK < this.chips.length; s++) {
        const cs = this.chips.slice(s * CHIPS_PER_STICK, (s + 1) * CHIPS_PER_STICK);
        if (cs.length === 0) continue;
        const lo = Math.min(...cs.map((c) => c.slot.lo)), hi = Math.max(...cs.map((c) => c.slot.hi));
        const minY = Math.min(...cs.map((c) => c.slot.rect.y)), maxY = Math.max(...cs.map((c) => c.slot.rect.y + c.slot.rect.h));
        const flip = cs[0]!.slot.rect.y > cs[cs.length - 1]!.slot.rect.y;
        // the key sits on the free end of the stick, away from the pins and the ECC chip
        const x = cs[0]!.slot.rect.x, w = cs[0]!.slot.rect.w, y = flip ? maxY + 8 : minY - 14, h = 0;
        // the key: a line per owner on this stick (its colour and name, and what it holds here); a stick does not know how full it is
        const keys: { name: string; color: string; bytes: number }[] = [];
        for (const r of m.regions) {
          const n = Math.min(r.hi, hi) - Math.max(r.lo, lo);
          if (n <= 0) continue;
          const name = r.kind === 'rom' ? 'ROM' : r.kind === 'app' || r.kind === 'work' ? r.name.replace(/ data$/, '') : 'OS';
          const k = keys.find((q) => q.name === name);
          if (k) k.bytes += n; else keys.push({ name, color: regionColor(r.kind === 'osdata' ? { ...r, kind: 'os' } : r.kind === 'work' ? { ...r, kind: 'app' } : r, T), bytes: n });
        }
        // the key is colour only: a swatch per owner on this stick, then the read and write colours
        const sw = [...keys.slice(0, 6).map((k) => k.color), T.alu, T.br];
        sw.forEach((col, i) => {
          const gap = i >= sw.length - 2 ? 6 : 0;
          g.roundRect(x + i * 11 + gap, y, 8, 6, 2).fill({ color: col });
        });
      }
    }
  }

  /** The pages the CPU touched in the last moments: the cell is outlined in the colour of the instruction and fades; the last one is joined to the magnifier. */
  private drawTouches(wall: number): void {
    if (this.touches.length === 0) {
      if (this.touchDrawn) { this.touchG.clear(); this.hideBubbleTexts(0); this.touchDrawn = false; }
      return;
    }
    const g = this.touchG;
    g.clear();
    this.touchDrawn = true;
    const z = this.zoom;
    for (const t of this.touches.slice(-MAX_TOUCHES)) {
      const c = this.chipOf(t.addr);
      if (!c) continue;
      const a = 1 - (wall - t.t) / TOUCH_MS;
      const sp = this.spot(c, t.addr);
      g.rect(sp.x + 0.3, sp.y + 0.3, sp.sx - 0.6, sp.sy - 0.6).fill({ color: t.color, alpha: 0.55 * a }).stroke({ width: Math.max(0.5, 1.4 / z), color: t.color, alpha: a });
      if (this.lens.visible && this.lensAt && t === this.lastTouch) {
        g.moveTo(sp.x + sp.sx / 2, sp.y + sp.sy).lineTo(this.lensAt.x, this.lensAt.y).stroke({ width: Math.max(0.4, 1.1 / z), color: t.color, alpha: 0.7 * a });
      }
    }
    this.drawBubbles(g, wall);
  }

  /**
   * One bubble per resource (a region of RAM) the cores reached for in the last moments, above the spot of its newest touch: ringed in the colour of
   * each core on it (a split ring when several), a red outer ring when more than one core shares it, bigger for writes. Past the band zoom it says
   * which cores and which resource.
   */
  private drawBubbles(g: Graphics, wall: number): void {
    const T = this.T, m = this.map;
    const ct = this.touches.filter((t) => t.core !== undefined);
    if (!T || !m || ct.length === 0) { this.hideBubbleTexts(0); return; }
    const bubbles = bubblesOf(ct.map((t) => ({ addr: t.addr, core: t.core!, write: t.kind === 'store', t: t.t })), m.regions, MAX_BUBBLES);
    const z = this.zoom, r0 = 7 / z, text = z >= BAND_Z;
    let used = 0;
    for (const b of bubbles) {
      const c = this.chipOf(b.addr);
      if (!c) continue;
      const sp = this.spot(c, b.addr);
      const a = Math.max(0.3, 1 - (wall - b.t) / TOUCH_MS);
      const r = r0 * (1 + Math.min(3, b.writes) * 0.12), cx = sp.x + sp.sx / 2, cy = sp.y - r * 1.7;
      g.moveTo(cx, cy + r).lineTo(cx, sp.y).stroke({ width: Math.max(0.3, 1 / z), color: T.ink, alpha: 0.5 * a });
      g.circle(cx, cy, r).fill({ color: T.die, alpha: 0.92 * a });
      const n = b.cores.length, lw = 2.4 / z;
      if (n === 1) g.circle(cx, cy, r).stroke({ width: lw, color: coreColor(b.cores[0]!.core, T.dark), alpha: a });
      else {
        b.cores.forEach((k, j) => {
          const a0 = -Math.PI / 2 + (j * 2 * Math.PI) / n, a1 = a0 + (2 * Math.PI) / n - 0.14;
          g.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0)).arc(cx, cy, r, a0, a1).stroke({ width: lw, color: coreColor(k.core, T.dark), alpha: a });
        });
      }
      if (b.contended) g.circle(cx, cy, r * 1.4).stroke({ width: Math.max(0.3, 1.2 / z), color: T.br, alpha: 0.85 * a });
      if (!text) continue;
      const t = this.bubbleText(used++);
      t.text = `${coresText(b.cores)}  ${b.label}`;
      t.style.fill = T.ink;
      t.scale.set(1 / z);
      t.position.set(cx + r * 1.7, cy);
      t.alpha = a;
      t.visible = true;
    }
    this.hideBubbleTexts(used);
  }

  private bubbleText(i: number): Text {
    let t = this.bubbleTexts[i];
    if (!t) {
      t = label('', 0, 0, 9, this.T!.ink, { minPx: 4, weight: '700' });
      this.bubbleLayer.addChild(t);
      this.bubbleTexts[i] = t;
    }
    return t;
  }

  private hideBubbleTexts(from: number): void {
    for (let i = from; i < this.bubbleTexts.length; i++) this.bubbleTexts[i]!.visible = false;
  }

  /** The magnifier: the words around the address the CPU touched last, as code (the instructions) or data (words and text). */
  private drawLens(wall: number): void {
    const T = this.T, m = this.map;
    const fade = bandAlpha(this.zoom, onBand(LENS_Z)), show = !!T && !!m && fade > SHOWN;
    this.lens.visible = show;
    this.lens.alpha = fade;
    if (!show || !T || !m) return;
    const app = m.regions.find((r) => r.kind === 'app');
    const focus = this.lastTouch && wall - this.lastTouch.t < 9000 ? this.lastTouch : null;
    const addr = focus?.addr ?? app?.lo ?? m.regions[0]?.lo ?? 0;
    const c = this.chipOf(addr);
    if (!c) { this.lens.visible = false; return; }
    const color = focus?.color ?? T.alu;
    // sized so its text stays about 14 px on the screen, beside the line it reads: below it when the line is in the upper half of its chip, else above
    const z = this.zoom, k = Math.min(1.05, 1.75 / z);
    const sp = this.spot(c, addr);
    const rc = c.slot.rect;
    const below = sp.y < rc.y + rc.h / 2;
    const gap = 6 + 8 / z, top = below ? sp.y + sp.sy + gap : sp.y - gap - LENS_H * k;
    const cx = rc.x + rc.w / 2;
    this.lens.scale.set(k);
    this.lens.position.set(cx - (LENS_W * k) / 2, top);
    this.lensAt = { x: cx, y: below ? top : top + LENS_H * k };
    const sig = `${addr}|${this.imgVersion}|${color}|${focus?.kind ?? ''}|${this.regionSig}|${T.dark}|${vmSig(m)}`;
    if (sig === this.lensSig) return;
    this.lensSig = sig;
    const rows = lensRows(m.image, m.regions, addr, LENS_ROWS);
    const g = this.lensG;
    g.clear();
    g.roundRect(0, 0, LENS_W, LENS_H, 5).fill({ color: mix(T.die, T.bg, 0.35), alpha: 0.97 }).stroke({ width: 1.4, color, alpha: 0.95 });
    const reg = rows.find((x) => x.current)?.region ?? null;
    if (!this.lensTitle) { this.lensTitle = label('', 8, 8, 9, T.ink, { minPx: 4, weight: '700' }); this.lens.addChild(this.lensTitle); }
    if (!this.lensTag) { this.lensTag = label('', LENS_W - 8, 8, 8, color, { minPx: 4, anchor: [1, 0.5], weight: '700' }); this.lens.addChild(this.lensTag); }
    this.lensTitle.text = reg ? reg.name : 'RAM';
    this.lensTitle.style.fill = T.ink;
    this.lensTag.text = `${(focus?.kind ?? 'program').toUpperCase()}  @0x${(addr & ~3).toString(16).padStart(4, '0')}`;
    this.lensTag.style.fill = color;
    if (!this.lensNote) { this.lensNote = label('', 8, 16 + LENS_ROWS * LINE + 8, 7, T.mute, { minPx: 4, anchor: [0, 0], align: 'left' }); this.lens.addChild(this.lensNote); }
    this.lensNote.position.set(8, 16 + LENS_ROWS * LINE + 8);
    this.lensNote.text = vmNote(m, addr);
    this.lensNote.style.fill = T.mute;
    const classColor: Record<OpClass, string> = { alu: T.alu, ld: T.ld, st: T.st, mul: T.mul, br: T.br, sys: T.mute };
    // the key to the pills: what kind of instruction each colour is
    let kx = 8;
    CLASS_KEY.forEach(([c, name], i) => {
      let k = this.lensKey[i];
      if (!k) { k = label('', 0, 0, 7, T.mute, { minPx: 4, anchor: [0, 0.5] }); this.lensKey[i] = k; this.lens.addChild(k); }
      k.text = ''; k.style.fill = classColor[c]; void name;
      g.roundRect(kx, LENS_H - 11, 12, 5, 2).fill({ color: classColor[c] });
      kx += 18;
    });
    rows.forEach((row, i) => {
      const y = 16 + i * LINE;
      if (row.current) g.rect(3, y, LENS_W - 6, LINE).fill({ color, alpha: 0.3 });
      // a pill per instruction: its class, so a code area reads at a glance as mostly arithmetic, loads, branches...
      if (row.code && row.text) g.roundRect(6, y + 2, 8, LINE - 4, 3).fill({ color: classColor[opClass(row.text.split(' ')[0]!)] });
      let t = this.lensRowsT[i];
      if (!t) { t = label('', 20, y + LINE / 2, 8, T.ink, { minPx: 4 }); this.lensRowsT[i] = t; this.lens.addChild(t); }
      t.position.set(20, y + LINE / 2);
      t.text = `${row.addr.toString(16).padStart(4, '0')}  ${row.hex}  ${row.text}`;
      t.style.fill = row.code || row.current ? T.ink : T.mute;
      t.visible = true;
    });
    for (let i = rows.length; i < this.lensRowsT.length; i++) this.lensRowsT[i]!.visible = false;
  }
}
