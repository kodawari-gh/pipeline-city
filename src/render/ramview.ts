import { Container, Graphics, Text } from 'pixi.js';
import type { RamMap } from '../sim/game/pipesnap';
import type { RamRegion } from '../sim/game/ramregions';
import { label, mix } from './ink';
import { opClass, type OpClass } from './diemotion';
import { CHIPS_PER_STICK, PAGE, chipContent, chipLayout, lensRows, ownerMap, regionColor, sizeText, spanOutline, type ChipSlot, type Stick } from './ramlayout';
import type { Rect } from './layout';
import type { Theme } from './theme';

// The memory sticks as a map of RAM (docs/DIE.md "Memory"). Every DRAM chip is a grid of cells, one per 256-byte page (a block of the drive):
// the colour is the owner (the boot ROM grey, the OS pale, each program by its type), the strength is how full the page is. Zoomed in, the
// regions are outlined, each stick shows how full it is, and a magnifier beside the address the CPU touches last reads the memory as text:
// the instructions of the code, the words of the data. Cells are drawn only when the memory changes, so the view costs next to nothing.

const TOUCH_MS = 700, MAX_TOUCHES = 8;
// the same zoom levels as the CPU die (dieview.ts setZoom: wires 0.7, cells 0.8, texts 0.85, subtexts 1.2): below them the traces are the picture
const SHOW_Z = 0.7, OUTLINE_Z = 0.8, BAND_Z = 0.85, LENS_Z = 1.2;
const LENS_ROWS = 9, LENS_W = 310, LINE = 11, NOTE_LINES = 2, LENS_H = 16 + LENS_ROWS * LINE + 8 + NOTE_LINES * 9 + 14;
const CLASS_KEY: [OpClass, string][] = [['alu', 'ALU'], ['ld', 'LOAD'], ['st', 'STORE'], ['mul', 'MUL'], ['br', 'BRANCH'], ['sys', 'SYSTEM']];

interface Touch { addr: number; kind: string; color: string; t: number }

interface ChipView { slot: ChipSlot }

/** Text broken into at most `lines` lines of `width` characters (the last one cut short with an ellipsis). */
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
    this.root.addChild(this.back, this.outG, this.names, this.touchG, this.lens);
    this.root.visible = false;
  }

  /** The chips of the installed sticks (four per stick, in device order), for a new scene. */
  setScene(T: Theme, rects: Rect[]): void {
    this.T = T;
    this.rects = rects;
    this.destroyChips();
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
  touch(kind: string, addr: number, color: string): void {
    const t = { addr, kind, color, t: performance.now() };
    this.touches.push(t);
    if (this.touches.length > MAX_TOUCHES) this.touches.shift();
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
    const show = inner && !!this.map && this.chips.length > 0 && this.zoom >= SHOW_Z;
    this.root.visible = show;
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
    const z = this.zoom;
    const sig = `${this.regionSig}|${Math.round(z * 4)}|${this.imgVersion}|${T.dark}`;
    if (sig === this.outSig) return;
    this.outSig = sig;
    const g = this.outG;
    g.clear();
    let nt = 0, ns = 0;
    const outlines = z >= OUTLINE_Z, bands = z >= BAND_Z;
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
      if (outlines) {
        for (let i = 0; i <= c.slot.tilesX; i++) g.moveTo(cr.x + i * cw, cr.y).lineTo(cr.x + i * cw, cr.y + ch * c.slot.tilesY);
        for (let j = 0; j <= c.slot.tilesY; j++) g.moveTo(cr.x, cr.y + j * ch).lineTo(cr.x + cw * c.slot.tilesX, cr.y + j * ch);
        g.stroke({ width: Math.max(0.15, 0.6 / z), color: T.line, alpha: 0.55 });
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
        const x = cs[0]!.slot.rect.x, w = cs[0]!.slot.rect.w, y = flip ? minY - 16 : maxY + 10, h = 0;
        // the key: a line per owner on this stick (its colour and name, and what it holds here); a stick does not know how full it is
        const keys: { name: string; color: string; bytes: number }[] = [];
        for (const r of m.regions) {
          const n = Math.min(r.hi, hi) - Math.max(r.lo, lo);
          if (n <= 0) continue;
          const name = r.kind === 'rom' ? 'ROM' : r.kind === 'app' || r.kind === 'work' ? r.name.replace(/ data$/, '') : 'OS';
          const k = keys.find((q) => q.name === name);
          if (k) k.bytes += n; else keys.push({ name, color: regionColor(r.kind === 'osdata' ? { ...r, kind: 'os' } : r.kind === 'work' ? { ...r, kind: 'app' } : r, T), bytes: n });
        }
        const SZ = 9, line = (n: number) => (flip ? y - 4 - n * 11 : y + h + 3 + n * 11);
        const shown = keys.slice(0, 2);
        shown.forEach((k, i) => {
          const t = this.text(this.stickTexts, ns++, SZ, k.color);
          t.text = `${k.name} ${sizeText(k.bytes)}`; t.style.fill = k.color; t.anchor.set(0, flip ? 1 : 0); t.position.set(x, line(i)); t.visible = true;
        });
        [['READ', T.alu], ['WRITE', T.br]].forEach(([name, col], i) => {
          const k = this.text(this.stickTexts, ns++, SZ, col!);
          k.text = name!; k.style.fill = col!; k.anchor.set(0, flip ? 1 : 0); k.position.set(x + i * 34, line(shown.length)); k.visible = true;
        });
      }
    }
  }

  /** The pages the CPU touched in the last moments: the cell is outlined in the colour of the instruction and fades; the last one is joined to the magnifier. */
  private drawTouches(wall: number): void {
    if (this.touches.length === 0) {
      if (this.touchDrawn) { this.touchG.clear(); this.touchDrawn = false; }
      return;
    }
    const g = this.touchG;
    g.clear();
    this.touchDrawn = true;
    const z = this.zoom;
    for (const t of this.touches) {
      const c = this.chipOf(t.addr);
      if (!c) continue;
      const a = 1 - (wall - t.t) / TOUCH_MS;
      const sp = this.spot(c, t.addr);
      g.rect(sp.x + 0.3, sp.y + 0.3, sp.sx - 0.6, sp.sy - 0.6).fill({ color: t.color, alpha: 0.55 * a }).stroke({ width: Math.max(0.5, 1.4 / z), color: t.color, alpha: a });
      if (this.lens.visible && this.lensAt && t === this.lastTouch) {
        g.moveTo(sp.x + sp.sx / 2, sp.y + sp.sy).lineTo(this.lensAt.x, this.lensAt.y).stroke({ width: Math.max(0.4, 1.1 / z), color: t.color, alpha: 0.7 * a });
      }
    }
  }

  /** The magnifier: the words around the address the CPU touched last, as code (the instructions) or data (words and text). */
  private drawLens(wall: number): void {
    const T = this.T, m = this.map;
    const show = !!T && !!m && this.zoom >= LENS_Z;
    this.lens.visible = show;
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
    const sig = `${addr}|${this.imgVersion}|${color}|${focus?.kind ?? ''}|${this.regionSig}|${T.dark}`;
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
    this.lensNote.text = reg ? wrap(`${sizeText(reg.hi - reg.lo)}: ${reg.note}`, 64, NOTE_LINES) : '';
    this.lensNote.style.fill = T.mute;
    const classColor: Record<OpClass, string> = { alu: T.alu, ld: T.ld, st: T.st, mul: T.mul, br: T.br, sys: T.mute };
    // the key to the pills: what kind of instruction each colour is
    let kx = 8;
    CLASS_KEY.forEach(([c, name], i) => {
      let k = this.lensKey[i];
      if (!k) { k = label('', 0, 0, 7, T.mute, { minPx: 4, anchor: [0, 0.5] }); this.lensKey[i] = k; this.lens.addChild(k); }
      k.text = name; k.style.fill = classColor[c];
      g.roundRect(kx, LENS_H - 11, 6, 5, 2).fill({ color: classColor[c] });
      k.position.set(kx + 9, LENS_H - 8.5);
      kx += 9 + name.length * 4.6 + 8;
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
