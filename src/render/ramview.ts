import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { RamMap } from '../sim/game/pipesnap';
import type { RamRegion } from '../sim/game/ramregions';
import { label, mix } from './ink';
import { CHIPS_PER_STICK, PAGE, TILE, chipContent, chipLayout, lensRows, ownerMap, pixelOf, regionColor, sizeText, spanOutline, type ChipSlot, type Stick } from './ramlayout';
import type { Rect } from './layout';
import type { Theme } from './theme';

// The memory sticks as a map of RAM (docs/DIE.md "Memory"). Every DRAM chip is a window onto an address range and shows it as a picture with
// one pixel per byte: the colour is the owner (the boot ROM grey, the OS pale, each program by its type), the brightness is the byte's value,
// a byte that has just changed flashes white. Zoomed in, the regions are outlined and named, each stick shows how full it is, and a magnifier
// beside the address the CPU touches last reads the memory as text: the instructions of the code, the words of the data.

const HEAT_MS = 900;
const TOUCH_MS = 1400;
const LENS_Z = 1.7, OUTLINE_Z = 0.55, BAND_Z = 0.5, SMOOTH_Z = 1.2;
const LENS_ROWS = 9, LENS_W = 310, LINE = 11, NOTE_LINES = 2, LENS_H = 16 + LENS_ROWS * LINE + 8 + NOTE_LINES * 9 + 4;

interface Touch { addr: number; kind: string; color: string; t: number }

interface ChipView {
  slot: ChipSlot;
  sprite: Sprite | null;
  canvas: HTMLCanvasElement | null;
  img: ImageData | null;
  heat: Uint8Array;
  hot: number;
  dirty: boolean;
}

const rgb = (c: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [128, 128, 128];
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

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
  /** colour lookup: (region index + 1) * 2 + data, then the byte's value; index 0 is memory no region claims. */
  private lut = new Uint32Array(0);
  private touches: Touch[] = [];
  private lastTouch: Touch | null = null;
  private zoom = 1;
  private smooth = true;
  private visible = false;
  private lastNow = 0;
  private imgVersion = 0;

  private readonly back = new Graphics();
  private readonly sprites = new Container();
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
  private lensSig = '';
  private regionTexts: Text[] = [];
  private stickTexts: Text[] = [];
  private outSig = '';
  private stickSig = '';

  constructor() {
    this.lens.addChild(this.lensG);
    this.root.addChild(this.back, this.sprites, this.outG, this.names, this.touchG, this.lens);
    this.root.visible = false;
  }

  /** The chips of the installed sticks (four per stick, in device order), for a new scene. */
  setScene(T: Theme, rects: Rect[]): void {
    this.T = T;
    this.rects = rects;
    this.destroyChips();
    for (const t of [...this.regionTexts, ...this.stickTexts, ...this.lensRowsT, ...(this.lensTitle ? [this.lensTitle] : []), ...(this.lensTag ? [this.lensTag] : []), ...(this.lensNote ? [this.lensNote] : [])]) t.destroy();
    this.regionTexts = []; this.stickTexts = []; this.lensRowsT = []; this.lensTitle = null; this.lensTag = null; this.lensNote = null; this.lensSig = ''; this.outSig = '';
    this.back.clear(); this.outG.clear(); this.touchG.clear(); this.lensG.clear(); this.lens.visible = false;
    this.regionSig = '';
    this.layout();
  }

  private destroyChips(): void {
    for (const c of this.chips) { c.sprite?.destroy({ texture: true, textureSource: true }); }
    this.chips = [];
    this.sprites.removeChildren();
  }

  private layout(): void {
    this.destroyChips();
    const bytes = this.map?.bytes ?? 0;
    if (!this.map || this.rects.length === 0) return;
    const slots = chipLayout(this.rects, this.sticks, bytes);
    this.chips = slots.map((slot) => ({ slot, sprite: null, canvas: null, img: null, heat: new Uint8Array(slot.hi - slot.lo), hot: 0, dirty: true }));
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
    const smooth = z < (this.smooth ? SMOOTH_Z : SMOOTH_Z * 1.15);
    if (smooth !== this.smooth) {
      this.smooth = smooth;
      for (const c of this.chips) if (c.sprite) c.sprite.texture.source.scaleMode = smooth ? 'linear' : 'nearest';
    }
  }

  /** The CPU reached for a RAM address (a fetch, a load, a store): that spot lights in the colour of the instruction. */
  touch(kind: string, addr: number, color: string): void {
    const t = { addr, kind, color, t: performance.now() };
    this.touches.push(t);
    if (this.touches.length > 24) this.touches.shift();
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
    let changed = false;
    for (const c of this.chips) {
      const { lo, hi } = c.slot;
      const top = Math.min(hi, m.image.length);
      for (let a = lo; a < top; a++) {
        const v = m.image[a]!;
        if (prev && prev[a] !== v) { c.heat[a - lo] = 255; c.hot++; c.dirty = true; changed = true; }
        else if (!prev && v !== 0) c.dirty = true;
      }
    }
    if (changed || !prev) this.imgVersion++;
    this.prev = m.image;
  }

  private recolor(regions: RamRegion[]): void {
    const T = this.T;
    if (!T) return;
    const lutN = (regions.length + 1) * 2;
    this.lut = new Uint32Array(lutN * 256);
    const bg = rgb(T.die);
    const fill = (slot: number, color: string, floor: number) => {
      const c = rgb(color);
      for (let b = 0; b < 256; b++) {
        const v = b === 0 ? floor : 0.38 + 0.62 * (b / 255);
        const k = b === 0 && floor === 0 ? -1 : v;
        const px = k < 0 ? 0 : (255 << 24) | (Math.round(bg[2] + (c[2] - bg[2]) * v) << 16) | (Math.round(bg[1] + (c[1] - bg[1]) * v) << 8) | Math.round(bg[0] + (c[0] - bg[0]) * v);
        this.lut[slot * 256 + b] = px >>> 0;
      }
    };
    fill(0, T.mute, 0); fill(1, T.mute, 0);
    regions.forEach((r, i) => {
      const col = regionColor(r, T);
      fill((i + 1) * 2, col, 0.14);
      fill((i + 1) * 2 + 1, mix(col, T.die, 0.4), 0.14);
    });
    this.own = ownerMap(regions, this.map?.image.length ?? 0);
    for (const c of this.chips) c.dirty = true;
    this.outSig = '';
  }

  /** Draw one chip's picture into its canvas texture: a tile of 16 x 16 pixels for every 256-byte page. */
  private paint(c: ChipView): void {
    const m = this.map;
    if (!m || typeof document === 'undefined') return;
    const { lo, hi, tilesX, tilesY } = c.slot;
    const W = tilesX * TILE, H = tilesY * TILE;
    if (!c.canvas) {
      c.canvas = document.createElement('canvas');
      c.canvas.width = W; c.canvas.height = H;
    }
    const ctx = c.canvas.getContext('2d');
    if (!ctx) return;
    if (!c.img) c.img = ctx.createImageData(W, H);
    const px = new Uint32Array(c.img.data.buffer);
    px.fill(0);
    const regions = m.regions, img = m.image, own = this.own, lut = this.lut;
    const top = Math.min(hi, img.length);
    for (let a = lo; a < top; a++) {
      const off = a - lo, page = off >> 8, w = off & 255;
      const o = own[a]!;
      let slot = 0;
      if (o) {
        const r = regions[o - 1]!;
        slot = o * 2 + (r.kind === 'app' && a >= (r.codeEnd ?? r.hi) ? 1 : 0);
      }
      let v = lut[slot * 256 + img[a]!]!;
      const h = c.heat[off]!;
      if (h > 0) {
        const k = (h / 255) * 0.85;
        const r = (v & 255), g = (v >> 8) & 255, b = (v >> 16) & 255;
        v = ((255 << 24) | (Math.round(b + (255 - b) * k) << 16) | (Math.round(g + (255 - g) * k) << 8) | Math.round(r + (255 - r) * k)) >>> 0;
      }
      px[((Math.floor(page / tilesX) * TILE + (w >> 4)) * W) + (page % tilesX) * TILE + (w & 15)] = v;
    }
    ctx.putImageData(c.img, 0, 0);
    if (!c.sprite) {
      const tex = Texture.from(c.canvas);
      tex.source.scaleMode = this.smooth ? 'linear' : 'nearest';
      c.sprite = new Sprite(tex);
      const r = chipContent(c.slot.rect);
      c.sprite.position.set(r.x, r.y);
      c.sprite.width = r.w; c.sprite.height = r.h;
      this.sprites.addChild(c.sprite);
    } else c.sprite.texture.source.update();
    c.dirty = false;
  }

  /** Per frame (`inner`: the interior of the board shows, not the exterior covering it). */
  frame(inner: boolean, wall = performance.now()): void {
    const show = inner && !!this.map && this.chips.length > 0;
    this.root.visible = show;
    this.visible = show;
    if (!show) { this.lastNow = wall; return; }
    const dt = this.lastNow ? Math.min(100, wall - this.lastNow) : 16;
    this.lastNow = wall;
    for (const c of this.chips) {
      if (c.hot > 0) {
        const d = Math.max(1, Math.round((255 * dt) / HEAT_MS));
        let left = 0;
        for (let i = 0; i < c.heat.length; i++) { const h = c.heat[i]!; if (h > 0) { c.heat[i] = h > d ? h - d : 0; if (c.heat[i]) left++; } }
        c.hot = left;
        c.dirty = true;
      }
      if (c.dirty) this.paint(c);
    }
    this.touches = this.touches.filter((t) => wall - t.t < TOUCH_MS);
    this.drawOutlines();
    this.drawLens(wall);
    this.drawTouches(wall);
  }

  private chipOf(addr: number): ChipView | undefined {
    return this.chips.find((c) => addr >= c.slot.lo && addr < c.slot.hi);
  }

  /** Where a byte of the address space sits in the world (and how big one byte is there). */
  private spot(c: ChipView, addr: number): { x: number; y: number; sx: number; sy: number } {
    const r = chipContent(c.slot.rect);
    const sx = r.w / (c.slot.tilesX * TILE), sy = r.h / (c.slot.tilesY * TILE), p = pixelOf(c.slot, addr);
    return { x: r.x + p.x * sx, y: r.y + p.y * sy, sx, sy };
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
    const tint = Math.max(0, Math.min(1, (1.7 - z) / 0.7));
    for (const c of this.chips) {
      const cr = chipContent(c.slot.rect), cw = cr.w / c.slot.tilesX, ch = cr.h / c.slot.tilesY;
      const pages = Math.ceil((c.slot.hi - c.slot.lo) / PAGE);
      // from afar a page is one lit cell (its owner's colour, brighter the fuller it is); closer, its bytes show through
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
        const x = cs[0]!.slot.rect.x, w = cs[0]!.slot.rect.w, y = flip ? minY - 30 : maxY + 14, h = 9;
        g.roundRect(x, y, w, h, 2).fill({ color: mix(T.die, T.bg, 0.5) }).stroke({ width: Math.max(0.4, 1 / z), color: T.line });
        let used = 0;
        for (const r of m.regions) {
          const a = Math.max(r.lo, lo), b = Math.min(r.hi, hi);
          if (b <= a) continue;
          used += b - a;
          g.rect(x + ((a - lo) / (hi - lo)) * w, y + 1, Math.max(0.6, ((b - a) / (hi - lo)) * w), h - 2).fill({ color: regionColor(r, T) });
        }
        // the key: a line per owner on this stick (its colour, name and size), the total beside the first
        const keys: { name: string; color: string; bytes: number }[] = [];
        for (const r of m.regions) {
          const n = Math.min(r.hi, hi) - Math.max(r.lo, lo);
          if (n <= 0) continue;
          const name = r.kind === 'rom' ? 'ROM' : r.kind === 'app' ? r.name : 'OS';
          const k = keys.find((q) => q.name === name);
          if (k) k.bytes += n; else keys.push({ name, color: regionColor(r.kind === 'osdata' ? { ...r, kind: 'os' } : r, T), bytes: n });
        }
        const SZ = 9, line = (n: number) => (flip ? y - 4 - n * 11 : y + h + 3 + n * 11);
        keys.slice(0, 3).forEach((k, i) => {
          const t = this.text(this.stickTexts, ns++, SZ, k.color);
          t.text = `${k.name} ${sizeText(k.bytes)}`; t.style.fill = k.color; t.anchor.set(0, flip ? 1 : 0); t.position.set(x, line(i)); t.visible = true;
        });
        const t = this.text(this.stickTexts, ns++, SZ, T.mute);
        t.text = `${sizeText(used)}/${sizeText(hi - lo)}`;
        t.style.fill = T.mute;
        t.anchor.set(1, flip ? 1 : 0);
        t.position.set(x + w, line(0));
        t.visible = true;
      }
    }
  }

  /** The addresses the CPU touched in the last moments: the 16-byte line lights in the colour of the instruction and a ring spreads from it. */
  private drawTouches(wall: number): void {
    const g = this.touchG;
    g.clear();
    const z = this.zoom;
    for (const t of this.touches) {
      const c = this.chipOf(t.addr);
      if (!c) continue;
      const a = 1 - (wall - t.t) / TOUCH_MS;
      const line = t.addr & ~15;
      const sp = this.spot(c, line);
      const w = Math.min(16, c.slot.hi - line) * sp.sx, h = sp.sy;
      const pad = (1 - a) * 9 / z + 1.2 / z;
      g.rect(sp.x - pad, sp.y - pad * 0.7, w + 2 * pad, h + 1.4 * pad).stroke({ width: Math.max(0.5, 1.6 / z), color: t.color, alpha: 0.9 * a });
      g.rect(sp.x, sp.y - 0.15, w, h + 0.3).fill({ color: t.color, alpha: 0.95 * a });
      // a thread from the touched line down to the magnifier that reads it
      if (this.lens.visible && this.lensAt && t === this.lastTouch) {
        g.moveTo(sp.x + w / 2, sp.y + h).lineTo(this.lensAt.x, this.lensAt.y).stroke({ width: Math.max(0.4, 1.1 / z), color: t.color, alpha: 0.7 * a });
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
    const sp = this.spot(c, addr & ~15);
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
    rows.forEach((row, i) => {
      const y = 16 + i * LINE;
      if (row.current) g.rect(3, y, LENS_W - 6, LINE).fill({ color, alpha: 0.3 });
      let t = this.lensRowsT[i];
      if (!t) { t = label('', 8, y + LINE / 2, 8, T.ink, { minPx: 4 }); this.lensRowsT[i] = t; this.lens.addChild(t); }
      t.position.set(8, y + LINE / 2);
      t.text = `${row.addr.toString(16).padStart(4, '0')}  ${row.hex}  ${row.text}`;
      t.style.fill = row.code || row.current ? T.ink : T.mute;
      t.visible = true;
    });
    for (let i = rows.length; i < this.lensRowsT.length; i++) this.lensRowsT[i]!.visible = false;
  }
}
