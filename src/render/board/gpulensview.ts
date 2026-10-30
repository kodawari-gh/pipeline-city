import { Container, Graphics, type Text } from 'pixi.js';
import { label, mix } from '../ink';
import type { Theme } from '../theme';
import type { OpClass } from '../../sim/game/jobcode';
import { LENS_ROWS, type GpuLens } from '../gpu/gpulens';
import type { Rect } from './layout';

// The memory popups of one graphics card, drawn (render/gpu/gpulens.ts has what they say): the same panel as the RAM sticks' magnifier (ramview.ts), a
// title and the instruction in flight, nine rows with a class pill for code, a note. One beside each memory part the instruction touched, above or below
// the die, a thin line to the part, shifted along so two never cover each other.

export const LENS_Z = 1.1;
export const LENS_W = 300, LINE = 11;
/** A panel's height: the title, its rows (at least three), the note. */
export const lensHeight = (rows: number): number => 16 + Math.max(3, rows) * LINE + 8 + 2 * 9 + 6;
const GAP = 6;

interface Item {
  root: Container;
  g: Graphics;
  title: Text;
  tag: Text;
  rows: Text[];
  note: Text;
  sig: string;
}

export class GpuLensView {
  readonly root = new Container();
  private readonly items = new Map<string, Item>();
  private readonly link = new Graphics();
  private lastSig = '';

  constructor() {
    this.root.visible = false;
    this.root.addChild(this.link);
  }

  private item(id: string, T: Theme): Item {
    let it = this.items.get(id);
    if (it) return it;
    const root = new Container(), g = new Graphics();
    root.addChild(g);
    const title = label('', 8, 8, 9, T.ink, { minPx: 4, weight: '700' });
    const tag = label('', LENS_W - 8, 8, 8, T.ink, { minPx: 4, anchor: [1, 0.5], weight: '700' });
    const rows = Array.from({ length: LENS_ROWS }, (_, i) => label('', 20, 16 + i * LINE + LINE / 2, 8, T.ink, { minPx: 4 }));
    const note = label('', 8, 16 + LENS_ROWS * LINE + 8, 7, T.mute, { minPx: 4, anchor: [0, 0], align: 'left' });
    root.addChild(title, tag, ...rows, note);
    it = { root, g, title, tag, rows, note, sig: '' };
    this.items.set(id, it);
    this.root.addChild(root);
    return it;
  }

  /** Hide every popup (zoomed out, no card, or nothing touched). */
  hide(): void {
    this.root.visible = false;
    this.lastSig = '';
  }

  /**
   * Show `lenses` beside their blocks. `rects` are the blocks in the card's coordinates, `die` the die's; `zoom` the board's. `color` tints the frame
   * (the colour of the instruction in flight).
   */
  set(T: Theme, lenses: GpuLens[], rects: Map<string, Rect>, die: Rect, zoom: number, color: string): void {
    this.root.visible = lenses.length > 0 && zoom >= LENS_Z;
    if (!this.root.visible) return;
    const sig = `${lenses.map((l) => `${l.block}|${l.title}|${l.tag}|${l.note}|${l.rows.map((r) => r.at + r.hex + r.text + (r.current ? '*' : '')).join(';')}`).join('~')}|${Math.round(zoom * 20)}|${color}|${T.dark}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    const k = Math.min(1.05, 1.75 / zoom), w = LENS_W * k;
    const classColor: Record<OpClass, string> = { alu: T.alu, ld: T.ld, st: T.st, mul: T.mul, br: T.br, sys: T.mute };
    const used = new Set<string>();
    this.link.clear();
    // left to right on each side of the die, shifted so none covers the next
    const placed = lenses.map((l) => ({ l, r: rects.get(l.block) })).filter((x): x is { l: GpuLens; r: Rect } => !!x.r);
    placed.sort((a, b) => a.r.x + a.r.w / 2 - (b.r.x + b.r.w / 2));
    const next = { above: -Infinity, below: -Infinity };
    for (const { l, r } of placed) {
      used.add(l.block);
      const it = this.item(l.block, T), cx = r.x + r.w / 2, side = r.y + r.h / 2 < die.y + die.h / 2 ? 'above' : 'below';
      const x = Math.max(cx - w / 2, next[side]);
      next[side] = x + w + GAP;
      const H = lensHeight(l.rows.length), y = side === 'above' ? die.y - GAP - H * k : die.y + die.h + GAP;
      it.root.visible = true;
      it.root.scale.set(k);
      it.root.position.set(x, y);
      const lx = Math.min(Math.max(cx, x + 10), x + w - 10), ly = side === 'above' ? y + H * k : y, by = side === 'above' ? r.y : r.y + r.h;
      this.link.moveTo(lx, ly).lineTo(cx, by).stroke({ width: Math.max(0.6, 1.2 / zoom), color, alpha: 0.7 });
      const g = it.g;
      g.clear();
      g.roundRect(0, 0, LENS_W, H, 5).fill({ color: mix(T.die, T.bg, 0.35), alpha: 0.97 }).stroke({ width: 1.4, color, alpha: 0.95 });
      it.title.text = l.title;
      it.title.style.fill = T.ink;
      it.tag.text = l.tag;
      it.tag.style.fill = color;
      it.note.position.set(8, 16 + Math.max(3, l.rows.length) * LINE + 8);
      it.note.text = l.note;
      it.note.style.fill = T.mute;
      l.rows.forEach((row, i) => {
        const ry = 16 + i * LINE;
        if (row.current) g.rect(3, ry, LENS_W - 6, LINE).fill({ color, alpha: 0.3 });
        if (row.cls) g.roundRect(6, ry + 2, 8, LINE - 4, 3).fill({ color: classColor[row.cls] });
        const t = it.rows[i]!;
        t.text = `${row.at.padEnd(8, ' ')} ${row.hex}  ${row.text}`;
        t.style.fill = row.cls || row.current ? T.ink : T.mute;
        t.visible = true;
      });
      for (let i = l.rows.length; i < it.rows.length; i++) it.rows[i]!.visible = false;
    }
    for (const [id, it] of this.items) if (!used.has(id)) it.root.visible = false;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.items.clear();
  }
}
