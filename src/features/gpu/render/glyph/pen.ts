import type { Graphics } from 'pixi.js';
import type { Pt, Rect } from '../../../cpu/render/core/cpuplan';
import { glyphKit } from '../../../cpu/render/die/blockart';
// oxlint-disable-next-line eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own
import type { Put } from '../../../cpu/render/die/blockart';
import type { Theme } from '@/core/render/theme';
import type { GpuBlock } from '../plan/gpuplan';
import { gpuCells } from '../plan/gpuplans';
import { gpuGlyphArea } from './area';

// The pen a block's symbol is drawn with: the CPU die's drawing tools (`glyphKit`) in the block's accent, the few extra strokes the GPU
// symbols use (a label from its left end, a junction dot, an outline, a wire through several points), the area the symbol may use and the
// block's cells.

/** The colours and the label callback a symbol is drawn with. */
export interface GlyphInk {
  T: Theme;
  /** The accent of the block. */ c: string;
  put: Put;
}

/** The stroke of a round gate. */
interface Stroke {
  width: number;
  color: string;
  alpha?: number;
}

/** Everything a block's symbol is drawn with. */
export interface Pen {
  g: Graphics;
  T: Theme;
  b: GpuBlock;
  /** The area the symbol may use (`gpuGlyphArea`). */ a: Rect;
  cells: Rect[];
  put: Put;
  kit: ReturnType<typeof glyphKit>;
  /** A label starting at `at`. */ lab: (t: string, at: Pt, size?: number) => void;
  dot: (px: number, py: number) => void;
  /** A filled dot of radius `r` in the line colour. */ pip: (px: number, py: number, r: number) => void;
  /** A round gate: a soft disc with a stroke. */ gate: (at: Pt, r: number, stroke: Stroke) => void;
  outline: (r: Rect) => void;
  wire: (...p: number[]) => void;
}

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
    // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- Graphics.fill takes a fill style; it is not Array.fill
    g.circle(px, py, r).fill({ color: line });
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
      // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- Graphics.fill takes a fill style; it is not Array.fill
      g.circle(cx, cy, r).fill({ color: soft }).stroke(stroke);
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
