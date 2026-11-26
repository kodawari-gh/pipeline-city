import type { Graphics } from 'pixi.js';
import { NIC_RX_SLOTS, NIC_TX_SLOTS } from '@/core/sim/memmap';
import type { Theme } from '@/core/render/theme';
import * as blockart from '../../../cpu/render/die/blockart';
import type { Rect } from '../plan/netplan';
import type { NicBlock, NicPlanInput } from './nicplan';
import {
  FRAME_FIELDS,
  PHY_STAGES,
  dmaGeom,
  macGeom,
  phyGeom,
  phyNames,
  pcieGeom,
  queueGeom,
  statsGeom,
  tempGeom,
} from './nicgeom';

// What is inside a block of the NIC controller's die (docs/render/net.md "Inside the NIC and the router"): the schematic an engineer would draw for the block, drawn with the CPU
// die's own tools (`glyphKit`) so the die and the CPU's read as one family. The PHY is a chain of front end, DSP and coding on each pair; the MAC an Ethernet frame as its
// fields; the statistics the port's counters; each queue a ring of slots and the transfers in flight; the DMA engine the two ways a frame goes to and from RAM; the PCIe core
// its lanes; the heat sensor the scale to the damage point. (The jack, the magnetics, the flash, the crystal and the regulator are 3D bodies on the card: nic3d.ts.) Pure
// drawing into a Graphics (and a callback for the few labels); the rectangles the live layer lights are the `*Geom` functions below, shared by the drawing and by `nicLive`.

export const NIC_GLYPH_KINDS = new Set<NicBlock['kind']>(['phy', 'mac', 'stats', 'rxq', 'txq', 'dma', 'pcie', 'temp']);

/** The area a symbol may use: the block under its name, or null when the block is too small. */
export function nicGlyphArea(b: Pick<NicBlock, 'kind' | 'rect'>): Rect | null {
  if (!NIC_GLYPH_KINDS.has(b.kind)) {
    return null;
  }
  const r = b.rect,
    head = r.h >= 70 ? 44 : r.h * 0.55;
  const a = { x: r.x + 8, y: r.y + head, w: r.w - 16, h: r.y + r.h - 6 - (r.y + head) };
  return a.w > 8 && a.h > 6 ? a : null;
}

/** The size of a label inside a symbol (plan units): the card's plan is drawn four times wider than a die's, so its small print is larger than the die's 6 to 8. */
const LAB = 11;
/** The speed pairs of the cable, as the standards name them. */

// ---------------------------------------------------------------- the static symbols

type NicGlyphKit = ReturnType<typeof blockart.glyphKit>;

interface NicGlyphCtx {
  g: Graphics;
  T: Theme;
  b: NicBlock;
  put: blockart.Put;
  input: NicPlanInput;
  a: Rect;
  solid: string;
  soft: string;
  line: string;
  rect: NicGlyphKit['rect'];
  stub: NicGlyphKit['stub'];
}

function glyphLab(opts: { put: blockart.Put; t: string; lx: number; ly: number }): void {
  const { put, t, lx, ly } = opts;
  put(t, lx + (t.length * LAB * 0.6) / 2, ly, LAB);
}

function glyphOutline(opts: { g: Graphics; line: string; r: Rect }): void {
  const { g, line, r } = opts;
  g.roundRect(r.x, r.y, r.w, r.h, 1.5).stroke({ width: 1, color: line, alpha: 0.85 });
}

function glyphArrow(opts: {
  g: Graphics;
  stub: NicGlyphKit['stub'];
  line: string;
  x0: number;
  y: number;
  x1: number;
}): void {
  const { g, stub, line, x0, y, x1 } = opts;
  stub(x0, y, x1, y);
  g.poly([x1, y, x1 - 4, y - 2.5, x1 - 4, y + 2.5]).fill({ color: line });
}

function nicGlyphPhy(ctx: NicGlyphCtx): void {
  const { g, put, input, a, solid, soft, line, rect, stub } = ctx;

  const q = phyGeom(a, input.pairs, phyNames(input));
  for (const p of q.pairs) {
    glyphLab({ put, t: p.name, lx: a.x, ly: p.cy });
    p.stages.forEach((r, j) => {
      rect(r.x, r.y, r.w, r.h, j === 1 ? solid : soft);
      glyphOutline({ g, line, r });
      put(PHY_STAGES[j]!, r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB, r.h * 0.45, r.w * 0.3));
      if (j < 2) {
        glyphArrow({ g, stub, line, x0: r.x + r.w + 1, y: p.cy, x1: p.stages[j + 1]!.x - 1 });
      }
    });
  }
  rect(q.gauge.x, q.gauge.y, q.gauge.w, q.gauge.h, soft);
  glyphOutline({ g, line, r: q.gauge });
}
function nicGlyphMac(ctx: NicGlyphCtx): void {
  const { g, put, a, solid, soft, line, rect } = ctx;

  const q = macGeom(a);
  q.fields.forEach((r, k) => {
    rect(r.x, r.y, r.w, r.h, k % 2 ? solid : soft);
    put(FRAME_FIELDS[k]![0], r.x + r.w / 2, r.y + r.h / 2, Math.min(LAB, r.w * 0.3, r.h * 0.45));
  });
  for (const [r, t] of [
    [q.rx, 'rx'],
    [q.tx, 'tx'],
  ] as [Rect, string][]) {
    glyphLab({ put, t, lx: a.x, ly: r.y + r.h / 2 });
    rect(r.x, r.y, r.w, r.h, soft);
    glyphOutline({ g, line, r });
  }
}
function nicGlyphStats(ctx: NicGlyphCtx): void {
  const { g, put, a, soft, line, rect } = ctx;

  const q = statsGeom(a);
  for (const [r, v, t] of [
    [q.rx, q.rxVal, 'rx'],
    [q.tx, q.txVal, 'tx'],
  ] as [Rect, Rect, string][]) {
    glyphLab({ put, t, lx: r.x, ly: r.y + r.h / 2 });
    rect(v.x, v.y, v.w, v.h, soft);
    glyphOutline({ g, line, r: v });
  }
  for (const r of [q.rxBar, q.txBar]) {
    rect(r.x, r.y, r.w, r.h, soft);
    glyphOutline({ g, line, r });
  }
}
function nicGlyphQueue(ctx: NicGlyphCtx): void {
  const { g, b, put, input, a, soft, line, rect } = ctx;

  const q = queueGeom(a, b.kind === 'rxq' ? input.fifo : 0);
  if (q.fifoBox) {
    glyphLab({ put, t: 'FIFO', lx: q.label.x, ly: q.label.y + q.label.h / 2 });
    for (const r of q.cells) {
      rect(r.x, r.y, r.w, r.h, soft);
    }
    glyphOutline({ g, line, r: q.fifoBox });
  }
  for (const f of q.flows) {
    rect(f.bar.x, f.bar.y, f.bar.w, f.bar.h, soft);
    glyphOutline({ g, line, r: f.bar });
  }
}
function nicGlyphDma(ctx: NicGlyphCtx): void {
  const { g, T, put, a, soft, line, rect, stub } = ctx;

  const q = dmaGeom(a, NIC_RX_SLOTS, NIC_TX_SLOTS);
  rect(q.ring.x, q.ring.y, q.ring.w, q.ring.h, T.die);
  glyphOutline({ g, line, r: q.ring });
  for (const [grp, t] of [
    [q.rx, 'RX'],
    [q.tx, 'TX'],
  ] as [typeof q.rx, string][]) {
    glyphLab({ put, t, lx: grp.label.x, ly: grp.label.y + grp.label.h / 2 });
    for (const r of grp.cells) {
      rect(r.x, r.y, r.w, r.h, soft);
    }
  }
  glyphLab({ put, t: 'descriptor rings, in RAM', lx: q.ring.x + 6, ly: q.ring.y + q.ring.h + 9 });
  rect(q.engine.x, q.engine.y, q.engine.w, q.engine.h, T.die);
  glyphOutline({ g, line, r: q.engine });
  // two arrows: a received frame goes down into RAM, a frame to send comes up out of it
  for (const [r, up, t] of [
    [q.down, false, 'to RAM'],
    [q.up, true, 'from RAM'],
  ] as [Rect, boolean, string][]) {
    const cx = r.x + 12,
      y0 = up ? r.y + r.h : r.y,
      y1 = up ? r.y : r.y + r.h,
      d = up ? 1 : -1;
    stub(cx, y0, cx, y1);
    g.poly([cx, y1, cx - 5, y1 + 7 * d, cx + 5, y1 + 7 * d]).fill({ color: line });
    glyphLab({ put, t, lx: r.x + 26, ly: r.y + r.h / 2 });
  }
}
function nicGlyphPcie(ctx: NicGlyphCtx): void {
  const { g, put, input, a, soft, line, rect } = ctx;

  const q = pcieGeom(a, input.lanes);
  for (const l of q.lanes) {
    rect(l.rx.x, l.rx.y, l.rx.w, l.rx.h, soft);
    rect(l.tx.x, l.tx.y, l.tx.w, l.tx.h, soft);
    glyphOutline({ g, line, r: l.rx });
    glyphOutline({ g, line, r: l.tx });
    if (input.lanes <= 8) {
      put(`${l.idx}`, l.tag.x, l.tag.y, 10);
    }
  }
}
function nicGlyphTemp(ctx: NicGlyphCtx): void {
  const { g, a, solid, soft, line, rect } = ctx;

  const q = tempGeom(a);
  g.roundRect(q.icon.cx - 3, a.y + 2, 6, q.icon.h - 10, 3)
    .fill({ color: soft })
    .stroke({ width: 1.2, color: line });
  g.circle(q.icon.cx, a.y + q.icon.h - 5, 5)
    .fill({ color: solid })
    .stroke({ width: 1.2, color: line });
  rect(q.bar.x, q.bar.y, q.bar.w, q.bar.h, soft);
  glyphOutline({ g, line, r: q.bar });
}

const NIC_GLYPH: Partial<Record<NicBlock['kind'], (ctx: NicGlyphCtx) => void>> = {
  phy: nicGlyphPhy,
  mac: nicGlyphMac,
  stats: nicGlyphStats,
  rxq: nicGlyphQueue,
  txq: nicGlyphQueue,
  dma: nicGlyphDma,
  pcie: nicGlyphPcie,
  temp: nicGlyphTemp,
};

function drawNicGlyph(ctx: NicGlyphCtx & { kind: NicBlock['kind'] }): void {
  NIC_GLYPH[ctx.kind]?.(ctx);
}

/** Draw the symbol of block `b` into `g`; `put` adds a label. `input` is the plan's. */
export function nicGlyph(opts: {
  g: Graphics;
  T: Theme;
  block: NicBlock;
  color: string;
  put: blockart.Put;
  input: NicPlanInput;
}): void {
  const { g, T, block: b, color: c, put, input } = opts;
  const a = nicGlyphArea(b);
  if (!a) {
    return;
  }
  const kit = blockart.glyphKit(g, T, c, put);
  const { solid, soft, line, rect, stub } = kit;
  drawNicGlyph({ kind: b.kind, g, T, b, put, input, a, solid, soft, line, rect, stub });
}

export {
  PAIRS,
  LANES,
  FRAME_FIELDS,
  PHY_STAGES,
  phyNames,
  phyGeom,
  macGeom,
  statsGeom,
  queueGeom,
  dmaGeom,
  pcieGeom,
  tempGeom,
  tempAt,
} from './nicgeom';
export type { LiveKey, NicLive } from './niclive';
export { actLevel, nicLive } from './niclive';
