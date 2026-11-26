import type { Graphics } from 'pixi.js';
import type { Pt, Rect } from '../../../cpu/render/core/cpuplan';
import type { glyphKit, Put } from '../../../cpu/render/die/blockart';
import type { Theme } from '@/core/render/theme';
import type { GpuBlock } from '../plan/gpuplan';

// The types the modules of this folder share: what a symbol is drawn with (`Pen`, made by `makePen` in pen.ts) and what the live layer shows.

export type { LiveGlyph } from '../../../cpu/render/die/blockart';

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
