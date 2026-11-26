// The live memory map on the 3D sticks (src/features/memory/RAM.md "Look", docs/render/three.md): as on the 2D sticks, each DRAM chip is a window onto the address space
// (`chipLayout`), each 256-byte page of it a cell in its owner's colour, stronger the fuller the page is (`pageCells`), and the row open in each bank is outlined. The cells lie in
// the banks of the chip's die (`ramDiePlan`, which the die art on the chip's face draws): a bank holds the pages the controller puts in it (`pageSlot`), so the map reads as the memory
// chip itself, not a sheet over it. Each chip's map is painted on a clear canvas over the die (`Stick.mapFaces`, the east face the camera leans to read); it is painted again only
// when the memory or its regions change.
import type { CanvasTexture, Mesh, MeshBasicMaterial } from 'three';
import { DECODE_SRGB, rawSrgb } from '@/core/render/three/artlod';
import type { RamMap } from '@/features/cpu/sim/pipesnap';
import { PAGE, chipLayout, ownerMap, pageCells, regionColor } from '@/features/memory/render/ramlayout';
import type * as ramlayoutTypes from '@/features/memory/render/ramlayout';
import { bankCell, pageSlot } from '@/features/memory/render/ramdie';
import type * as ramdieTypes from '@/features/memory/render/ramdie';
import { mix } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';

/** Canvas pixels to a unit of the die's plan. */
const PX = 2;

/** Where a page of a chip's window lies on its die: the bank and the cell in it, and how many cells that bank holds. */
export interface PageAt {
  bank: number;
  k: number;
}

interface Face {
  mesh: Mesh;
  plan: ramdieTypes.RamDiePlan;
  canvas: HTMLCanvasElement | null;
  tex: CanvasTexture | null;
  slot: ramlayoutTypes.ChipSlot | null;
  at: PageAt[];
  rows: number;
}

type CellAt = (q: number) => { x: number; y: number; w: number; h: number } | null;

/** The row open in each bank (the inverse of Dram.locate), as on the 2D sticks. */
function paintOpenRows(
  c: CanvasRenderingContext2D,
  args: { m: RamMap; slot: ramlayoutTypes.ChipSlot; pages: number; cell: CellAt; T: Theme },
): void {
  const { m, slot, pages, cell, T } = args;
  const d = m.dram;
  if (!d || d.rowBytes !== PAGE) {
    return;
  }
  c.strokeStyle = T.ink;
  c.lineWidth = 0.7;
  d.open.forEach((row, bank) => {
    if (row < 0) {
      return;
    }
    const ch = Math.floor(bank / d.banks),
      b = bank % d.banks,
      off = (row * d.banks + b) * d.channels + ch - slot.lo / PAGE;
    const r = off >= 0 && off < pages ? cell(off) : null;
    if (r) {
      c.strokeRect(r.x + 0.35, r.y + 0.35, r.w - 0.7, Math.max(0.5, r.h - 0.7));
    }
  });
}

/** The sticks whose maps are painted: in device order, with the plan of their dies and their map faces (one per data chip). */
export type MapStick = ramlayoutTypes.Stick & { faces: Mesh[]; plan: ramdieTypes.RamDiePlan | null };

/**
 * Where each of `pages` pages of a window lies on a die of `banks` banks, the controller's `channels` and `ctlBanks` giving the bank (`pageSlot`); and the most cells a bank holds.
 * The controller may drive fewer banks than the die has (the weakest stick's): the rest stay clear.
 */
export function pagesOnDie(
  pages: number,
  channels: number,
  ctlBanks: number,
  banks: number,
): { at: PageAt[]; rows: number } {
  const at: PageAt[] = [];
  let rows = 1;
  for (let q = 0; q < pages; q++) {
    const s = pageSlot(q, channels, ctlBanks);
    at.push({ bank: s.bank % Math.max(1, banks), k: s.k });
    rows = Math.max(rows, s.k + 1);
  }
  return { at, rows };
}

export class RamMap3D {
  private faces: Face[] = [];
  private bytes = -1;
  private rsig = '';
  private osig = '';
  private csig = '';
  private prev: Uint8Array | null = null;
  private own: Uint8Array = new Uint8Array(0);
  private shown = 0;
  private last = -Infinity;

  /** `sticks` in device order with their map faces, one per data chip (`Stick.mapFaces`). */
  constructor(
    private sticks: MapStick[],
    private T: Theme,
  ) {
    for (const s of sticks) {
      if (s.plan) {
        for (const mesh of s.faces) {
          this.faces.push({ mesh, plan: s.plan, canvas: null, tex: null, slot: null, at: [], rows: 1 });
        }
      }
    }
  }

  /** How visible the maps are (0 to 1: they come in as the spreaders go). */
  show(a: number): void {
    this.shown = a;
    for (const f of this.faces) {
      f.mesh.visible = a > 0.01 && Boolean(f.tex);
      (f.mesh.material as MeshBasicMaterial).opacity = a;
    }
  }

  /**
   * A new snapshot's map (null: the machine is off; the chips stay as they were last painted). Only while the maps show, and at most five
   * times a second: a running program writes all the time.
   */
  update(m: RamMap | null, now: number): void {
    if (!m?.image || this.faces.length === 0 || this.shown <= 0.01 || now - this.last < 200) {
      return;
    }
    // where each chip's window is: laid out again when the size changes; the owners again when the regions change
    const d = m.dram,
      csig = d ? `${d.channels}:${d.banks}` : '';
    if (m.bytes !== this.bytes || csig !== this.csig) {
      this.bytes = m.bytes;
      this.csig = csig;
      this.layout(m);
      this.prev = null;
    }
    const rsig = m.regions.map((r) => `${r.id}:${r.lo}:${r.hi}:${r.type ?? ''}`).join('|'),
      osig = d?.open.join(',') ?? '';
    if (rsig !== this.rsig) {
      this.rsig = rsig;
      this.own = ownerMap(m.regions, m.image.length);
      this.prev = null;
    }
    let changed = !this.prev || osig !== this.osig;
    if (!changed) {
      for (let a = 0; a < m.image.length; a++) {
        if (this.prev![a] !== m.image[a]) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) {
      return;
    }
    this.last = now;
    this.osig = osig;
    this.prev = m.image;
    for (const f of this.faces) {
      this.paint(f, m);
    }
    this.show(this.shown);
  }

  private layout(m: RamMap): void {
    const rects = this.faces.map(() => ({ x: 0, y: 0, w: 1, h: 1 }));
    // (a stick's chips are as many as its map faces)
    const sticks = this.sticks.filter((s) => s.plan).map((s) => ({ idx: s.idx, bytes: s.bytes })),
      slots = chipLayout(rects, sticks, m.bytes);
    this.faces.forEach((f, i) => {
      f.slot = slots[i] ?? null;
      if (!f.slot || typeof document === 'undefined') {
        return;
      }
      const pages = Math.ceil((f.slot.hi - f.slot.lo) / PAGE),
        d = m.dram,
        on = pagesOnDie(pages, d?.channels ?? 1, d?.banks ?? f.plan.banks.length, f.plan.banks.length);
      f.at = on.at;
      f.rows = on.rows;
      const w = Math.ceil(f.plan.w * PX),
        h = Math.ceil(f.plan.h * PX);
      if (!f.canvas || f.canvas.width !== w || f.canvas.height !== h) {
        f.tex?.dispose();
        f.canvas = document.createElement('canvas');
        f.canvas.width = w;
        f.canvas.height = h;
        f.tex = rawSrgb(f.canvas);
        const mat = f.mesh.material as MeshBasicMaterial;
        mat.map = f.tex;
        mat.defines = { ...DECODE_SRGB };
        mat.needsUpdate = true;
      }
    });
  }

  private paint(f: Face, m: RamMap): void {
    const c = f.canvas?.getContext('2d'),
      s = f.slot,
      { T } = this;
    if (!c || !s || !f.tex) {
      return;
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, f.canvas!.width, f.canvas!.height);
    c.setTransform(PX, 0, 0, PX, 0, 0);
    const cell = (q: number) => {
      const a = f.at[q];
      return a ? bankCell(f.plan.banks[a.bank]!.rect, a.k, f.rows) : null;
    };
    const pages = Math.ceil((s.hi - s.lo) / PAGE);
    // every page of the window is a cell of its bank, a clear one where it holds nothing
    c.fillStyle = mix(T.die, T.mute, 0.3);
    c.globalAlpha = 0.5;
    for (let q = 0; q < pages; q++) {
      const r = cell(q);
      if (r) {
        c.fillRect(r.x, r.y + 0.15, r.w, Math.max(0.5, r.h - 0.3));
      }
    }
    for (const { page, best, strength } of pageCells(m.image, this.own, s)) {
      const r = cell(page);
      if (!r) {
        continue;
      }
      c.globalAlpha = Math.min(1, 0.25 + strength * 0.75);
      c.fillStyle = best ? regionColor(m.regions[best - 1]!, T) : T.mute;
      c.fillRect(r.x, r.y + 0.15, r.w, Math.max(0.5, r.h - 0.3));
    }
    c.globalAlpha = 1;
    paintOpenRows(c, { m, slot: s, pages, cell, T });
    f.tex.needsUpdate = true;
  }

  dispose(): void {
    for (const f of this.faces) {
      f.tex?.dispose();
    }
  }
}
