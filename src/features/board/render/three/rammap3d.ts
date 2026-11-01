// The live memory map on the 3D sticks (src/features/memory/RAM.md "Look", docs/GRAPHICS_3D_OVERHAUL.md "Inside the case"): as on the 2D sticks,
// each DRAM chip is a window onto the address space (`chipLayout`), a grid of 256-byte pages, each cell in its owner's colour, stronger the fuller
// the page is (`pageCells`), and the row open in each bank is outlined. Each chip's map is painted on a canvas that textures the chip's east face
// (`Stick.mapFaces`), the face the camera leans to read; it is painted again only when the memory or its regions change.
import { CanvasTexture, NearestFilter, SRGBColorSpace, type Mesh, type MeshBasicMaterial } from 'three';
import type { RamMap } from '@/features/cpu/sim/pipesnap';
import { PAGE, chipLayout, ownerMap, pageCells, regionColor, type ChipSlot, type Stick } from '@/features/memory/render/ramlayout';
import { mix } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';

/** A cell's size on the canvas (pixels), and the gap between cells. */
const CELL = 8, GAP = 1;

interface Face { mesh: Mesh; canvas: HTMLCanvasElement | null; tex: CanvasTexture | null; slot: ChipSlot | null }

export class RamMap3D {
  private faces: Face[] = [];
  private bytes = -1;
  private rsig = '';
  private osig = '';
  private prev: Uint8Array | null = null;
  private own: Uint8Array = new Uint8Array(0);
  private shown = 0;
  private last = -Infinity;

  /** `sticks` in device order with their map faces, one per data chip (`Stick.mapFaces`). */
  constructor(private sticks: (Stick & { faces: Mesh[] })[], private T: Theme) {
    for (const s of sticks) for (const mesh of s.faces) this.faces.push({ mesh, canvas: null, tex: null, slot: null });
  }

  /** How visible the maps are (0 to 1: they come in as the spreaders go). */
  show(a: number): void {
    this.shown = a;
    for (const f of this.faces) {
      f.mesh.visible = a > 0.01 && !!f.tex;
      (f.mesh.material as MeshBasicMaterial).opacity = a;
    }
  }

  /**
   * A new snapshot's map (null: the machine is off; the chips stay as they were last painted). Only while the maps show, and at most five
   * times a second: a running program writes all the time.
   */
  update(m: RamMap | null, now: number): void {
    if (!m?.image || this.faces.length === 0 || this.shown <= 0.01 || now - this.last < 200) return;
    // where each chip's window is: laid out again when the size changes; the owners again when the regions change
    if (m.bytes !== this.bytes) { this.bytes = m.bytes; this.layout(m.bytes); this.prev = null; }
    const rsig = m.regions.map((r) => `${r.id}:${r.lo}:${r.hi}:${r.type ?? ''}`).join('|'), osig = m.dram?.open.join(',') ?? '';
    if (rsig !== this.rsig) { this.rsig = rsig; this.own = ownerMap(m.regions, m.image.length); this.prev = null; }
    let changed = !this.prev || osig !== this.osig;
    if (!changed) for (let a = 0; a < m.image.length; a++) if (this.prev![a] !== m.image[a]) { changed = true; break; }
    if (!changed) return;
    this.last = now;
    this.osig = osig;
    this.prev = m.image;
    for (const f of this.faces) this.paint(f, m);
    this.show(this.shown);
  }

  private layout(bytes: number): void {
    const rects = this.faces.map(() => ({ x: 0, y: 0, w: 1, h: 1 }));
    const slots = chipLayout(rects, this.sticks.map((s) => ({ idx: s.idx, bytes: s.bytes })), bytes);
    this.faces.forEach((f, i) => {
      f.slot = slots[i] ?? null;
      if (!f.slot || typeof document === 'undefined') return;
      const w = f.slot.tilesX * CELL, h = f.slot.tilesY * CELL;
      if (!f.canvas || f.canvas.width !== w || f.canvas.height !== h) {
        f.tex?.dispose();
        f.canvas = document.createElement('canvas');
        f.canvas.width = w; f.canvas.height = h;
        f.tex = new CanvasTexture(f.canvas);
        f.tex.colorSpace = SRGBColorSpace;
        f.tex.magFilter = NearestFilter;
        (f.mesh.material as MeshBasicMaterial).map = f.tex;
        (f.mesh.material as MeshBasicMaterial).needsUpdate = true;
      }
    });
  }

  private paint(f: Face, m: RamMap): void {
    const c = f.canvas?.getContext('2d'), s = f.slot, T = this.T;
    if (!c || !s || !f.tex) return;
    const w = f.canvas!.width, h = f.canvas!.height;
    c.fillStyle = mix(T.die, T.bg, 0.55); c.fillRect(0, 0, w, h);
    for (const { page, best, strength } of pageCells(m.image, this.own, s)) {
      c.globalAlpha = Math.min(1, strength);
      c.fillStyle = best ? regionColor(m.regions[best - 1]!, T) : T.mute;
      c.fillRect((page % s.tilesX) * CELL + GAP, Math.floor(page / s.tilesX) * CELL + GAP, CELL - 2 * GAP, CELL - 2 * GAP);
    }
    c.globalAlpha = 1;
    // the row open in each bank (the inverse of Dram.locate), as on the 2D sticks
    const d = m.dram, pages = Math.ceil((s.hi - s.lo) / PAGE);
    if (d && d.rowBytes === PAGE) {
      c.strokeStyle = T.ink; c.lineWidth = 1;
      d.open.forEach((row, bank) => {
        if (row < 0) return;
        const ch = Math.floor(bank / d.banks), b = bank % d.banks, off = (row * d.banks + b) * d.channels + ch - s.lo / PAGE;
        if (off >= 0 && off < pages) c.strokeRect((off % s.tilesX) * CELL + 0.5, Math.floor(off / s.tilesX) * CELL + 0.5, CELL - 1, CELL - 1);
      });
    }
    f.tex.needsUpdate = true;
  }

  dispose(): void { for (const f of this.faces) f.tex?.dispose(); }
}
