import type { Graphics } from 'pixi.js';
import type { GpuBlock, GpuBlockKind } from '../plan/gpuplan';
import { drawLaunch, drawPcie } from './host';
import { drawDecode, drawFetch, drawPc } from './front';
import { drawLanes, drawMask, drawRegfile } from './lanes';
import { drawArbiter, drawBanks, drawCoalescer } from './memoryPath';
import { drawCache, drawDram } from './memory';
import { makePen } from './pen';
// oxlint-disable-next-line eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own
import type { GlyphInk, Pen } from './pen';
import { drawSched, drawWarps } from './warp';

// What is inside a block of a GPU card (docs/DIE.md "Inside the blocks", docs/GPU.md section 7): the schematic an engineer would draw for the part,
// drawn with the CPU die's own tools (`glyphKit`, `aluPoly`, `pcDigits`, the word strip) so the two read as one family, and wired inside: the
// decoder fans the op field out to its control lines, the scheduler's ready bits run into a round robin picker, the arbiter's requests queue per
// bank, the card memory ends in a row buffer and a controller. Pure drawing into a Graphics (and a callback for the few labels).
// The rectangles the live layer draws over (lane cells, warp cards, bank bars, register rows) are `gpuCells` / `maskParts` of gpuplans.ts and stay
// where they are; the symbols decorate inside them.

/** The drawing of each block kind's symbol; the SM frame has none. */
const DRAW: Record<GpuBlockKind, ((p: Pen) => void) | null> = {
  pcie: drawPcie,
  launch: drawLaunch,
  pc: drawPc,
  fetch: drawFetch,
  decode: drawDecode,
  sched: drawSched,
  warps: drawWarps,
  regfile: drawRegfile,
  lanes: drawLanes,
  mask: drawMask,
  coalescer: drawCoalescer,
  arbiter: drawArbiter,
  banks: drawBanks,
  l1: drawCache,
  l2: drawCache,
  dram: drawDram,
  sm: null,
};

/** Draw the symbol of block `b` into `g` in the colours and with the label callback of `ink`. */
export function gpuGlyph(g: Graphics, b: GpuBlock, ink: GlyphInk): void {
  const pen = makePen(g, b, ink),
    draw = DRAW[b.kind];
  if (pen && draw) {
    draw(pen);
  }
}
