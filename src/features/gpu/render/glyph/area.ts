import type { Rect } from '../../../cpu/render/core/cpuplan';
import type { GpuBlock, GpuBlockKind } from '../plan/gpuplan';

/** The block kinds with a symbol: every kind of a plan but the SM frame, which is only a frame. */
export const GPU_GLYPH_KINDS: Record<GpuBlockKind, boolean> = {
  pcie: true,
  launch: true,
  pc: true,
  fetch: true,
  decode: true,
  sched: true,
  warps: true,
  regfile: true,
  lanes: true,
  mask: true,
  coalescer: true,
  arbiter: true,
  banks: true,
  l1: true,
  l2: true,
  dram: true,
  sm: false,
};

export const hasGpuSymbol = (b: GpuBlock): boolean => GPU_GLYPH_KINDS[b.kind];

/** The area a symbol may use: the block under its name (the area the cell grids fill), or null when the block is too small. */
export function gpuGlyphArea(b: Pick<GpuBlock, 'kind' | 'rect'>): Rect | null {
  if (!GPU_GLYPH_KINDS[b.kind]) {
    return null;
  }
  const r = b.rect,
    head = r.h >= 70 ? 44 : r.h * 0.55;
  const a = { x: r.x + 8, y: r.y + head, w: r.w - 16, h: r.y + r.h - 6 - (r.y + head) };
  return a.w > 8 && a.h > 6 ? a : null;
}
