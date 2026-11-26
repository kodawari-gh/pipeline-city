import type { Graphics } from 'pixi.js';
import { glyphKit } from '../../../cpu/render/die/blockart';
import type { GpuBlock } from '../plan/gpuplan';
import { gpuCells } from '../plan/gpuplans';
import { gpuGlyphArea } from './area';
import type { GlyphInk, Pen } from './types';

// The pen a block's symbol is drawn with: the CPU die's drawing tools (`glyphKit`) in the block's accent, the few extra strokes the GPU
// symbols use (a label from its left end, a junction dot, an outline, a wire through several points), the area the symbol may use and the
// block's cells.

/** The pen for block `b`, or null when the block has no room for a symbol. */
export function makePen(g: Graphics, b: GpuBlock, ink: GlyphInk): Pen | null {
  const a = gpuGlyphArea(b);
  if (!a) {
    return null;
  }
  const { T, c, put } = ink;
  const kit = glyphKit(g, T, c, put),
    { line, soft } = kit;
  const pip = (px: number, py: number, r: number) => {
    g.circle(px, py, r).setFillStyle({ color: line }).fill();
  };
  return {
    g,
    T,
    b,
    a,
    cells: gpuCells(b),
    put,
    kit,
    lab: (t, [lx, ly], size = 6.5) => {
      put(t, lx + (t.length * size * 0.6) / 2, ly, size);
    },
    dot: (px, py) => {
      pip(px, py, 1.6);
    },
    pip,
    gate: ([cx, cy], r, stroke) => {
      g.circle(cx, cy, r).setFillStyle({ color: soft }).fill().stroke(stroke);
    },
    outline: (r) => {
      g.roundRect(r.x, r.y, r.w, r.h, 1.5).stroke({ width: 1, color: line, alpha: 0.85 });
    },
    wire: (...p) => {
      g.moveTo(p[0] ?? 0, p[1] ?? 0);
      for (let k = 2; k < p.length; k += 2) {
        g.lineTo(p[k] ?? 0, p[k + 1] ?? 0);
      }
      g.stroke({ width: 1, color: line, alpha: 0.75 });
    },
  };
}
