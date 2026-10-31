import { Container, Graphics, type Text } from 'pixi.js';
import { label, mix } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';
import type { OpClass } from '../../jobs/sim/jobcode';
import { LENS_ROWS, type GpuLens } from './gpumem';
import type { Rect } from '../../board/render/layout/layout';
import { DEVICE_LOD, SHOWN, bandAlpha, onBand } from '@/core/render/lod/lod';

// The magnifier on a graphics card's memory, the RAM's (ramview.ts drawLens) for the card: beside the cell the last load or store touched, nine rows
// (address, word, the instruction or the number, a class pill for code), a note naming the region, the instruction in flight beside the title, and a thin
// line from the panel to the cell. The card's other memory parts show their data in place (gpumem.ts); this is the one reading aid, like the RAM's.

export const LENS_Z = DEVICE_LOD.gpu.lens;
export const LENS_W = 310, LINE = 11, LENS_H = 16 + LENS_ROWS * LINE + 8 + 2 * 9 + 14;
const CLASS_KEY: [OpClass, string][] = [['alu', 'ALU'], ['ld', 'LOAD'], ['st', 'STORE'], ['mul', 'MUL'], ['br', 'BRANCH'], ['sys', 'SYSTEM']];

export class GpuLensView {
  readonly root = new Container();
  /** The panel: its frame and texts in its own units, scaled and placed as a whole (the thread line is in card coordinates beside it). */
  private readonly panel = new Container();
  private readonly g = new Graphics();
  private readonly link = new Graphics();
  private title: Text | null = null;
  private tag: Text | null = null;
  private note: Text | null = null;
  private rows: Text[] = [];
  private sig = '';

  constructor() {
    this.root.visible = false;
    this.panel.addChild(this.g);
    this.root.addChild(this.link, this.panel);
  }

  hide(): void {
    this.root.visible = false;
    this.sig = '';
  }

  /**
   * Show `lens` above the memory block `block`, with a thread line down to `cell` (the touched cell of the memory map, card coordinates): the die's
   * other side is the card's edge, and the fans above have room. `fresh` is false once the instruction has moved on (the frame goes dimmer). `color` is the instruction's colour.
   */
  set(T: Theme, lens: GpuLens | null, cell: Rect, block: Rect, zoom: number, color: string, fresh: boolean): void {
    const fade = bandAlpha(zoom, onBand(LENS_Z));
    this.root.visible = !!lens && fade > SHOWN;
    this.root.alpha = fade;
    if (!this.root.visible || !lens) return;
    const k = Math.min(1.05, 1.75 / zoom), w = LENS_W * k, h = LENS_H * k, gap = 6 + 8 / zoom;
    const cx = block.x + block.w / 2, x = cx - w / 2, y = block.y - gap - h;
    this.panel.position.set(x, y);
    this.panel.scale.set(k);
    this.link.clear();
    const lx = Math.min(Math.max(cell.x + cell.w / 2, x + 10), x + w - 10), ly = y + h;
    this.link.moveTo(lx, ly).lineTo(cell.x + cell.w / 2, cell.y).stroke({ width: Math.max(0.6, 1.2 / zoom), color, alpha: fresh ? 0.8 : 0.4 });
    const sig = `${lens.tag}|${lens.note}|${lens.rows.map((r) => r.addr + r.hex + r.text + (r.current ? '*' : '')).join(';')}|${color}|${fresh}|${T.dark}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.draw(T, lens, color, fresh);
  }

  private draw(T: Theme, lens: GpuLens, color: string, fresh: boolean): void {
    const g = this.g, classColor: Record<OpClass, string> = { alu: T.alu, ld: T.ld, st: T.st, mul: T.mul, br: T.br, sys: T.mute };
    g.clear();
    g.roundRect(0, 0, LENS_W, LENS_H, 5).fill({ color: mix(T.die, T.bg, 0.35), alpha: 0.97 }).stroke({ width: 1.4, color, alpha: fresh ? 0.95 : 0.5 });
    if (!this.title) { this.title = label('', 8, 8, 9, T.ink, { minPx: 4, weight: '700' }); this.panel.addChild(this.title); }
    if (!this.tag) { this.tag = label('', LENS_W - 8, 8, 8, color, { minPx: 4, anchor: [1, 0.5], weight: '700' }); this.panel.addChild(this.tag); }
    if (!this.note) { this.note = label('', 8, 16 + LENS_ROWS * LINE + 8, 7, T.mute, { minPx: 4, anchor: [0, 0], align: 'left' }); this.panel.addChild(this.note); }
    this.title.text = lens.title;
    this.title.style.fill = T.ink;
    this.tag.text = lens.tag;
    this.tag.style.fill = color;
    this.note.text = lens.note;
    this.note.style.fill = T.mute;
    // the key to the pills: what kind of instruction each colour is
    let kx = 8;
    for (const [c] of CLASS_KEY) { g.roundRect(kx, LENS_H - 11, 12, 5, 2).fill({ color: classColor[c] }); kx += 18; }
    lens.rows.forEach((row, i) => {
      const y = 16 + i * LINE;
      if (row.current) g.rect(3, y, LENS_W - 6, LINE).fill({ color, alpha: 0.3 });
      if (row.cls) g.roundRect(6, y + 2, 8, LINE - 4, 3).fill({ color: classColor[row.cls] });
      let t = this.rows[i];
      if (!t) { t = label('', 20, y + LINE / 2, 8, T.ink, { minPx: 4 }); this.rows[i] = t; this.panel.addChild(t); }
      t.text = `${row.addr.toString(16).padStart(4, '0')}  ${row.hex}  ${row.text}`;
      t.style.fill = row.cls || row.current ? T.ink : T.mute;
      t.visible = true;
    });
    for (let i = lens.rows.length; i < this.rows.length; i++) this.rows[i]!.visible = false;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
