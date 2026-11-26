import type { Rect } from '../../board/render/layout/layout';

/**
 * An NVMe stick's parts over its body `b`, as a real 2280 lays them out: the controller (13 mm square) by the fingers, its DRAM cache, two NAND
 * packages, and the finned spreader over the DRAM and the NAND, short of the notch.
 */
export function nvmeParts(b: Rect): { ctrl: Rect; dram: Rect; nand: Rect[]; sink: Rect } {
  const cy = b.y + b.h / 2;
  return {
    ctrl: { x: b.x + 110, y: cy - 150, w: 300, h: 300 },
    dram: { x: b.x + 500, y: cy - 110, w: 220, h: 220 },
    nand: [
      { x: b.x + 780, y: cy - 180, w: 400, h: 360 },
      { x: b.x + 1240, y: cy - 180, w: 400, h: 360 },
    ],
    sink: { x: b.x + 470, y: b.y + 24, w: b.w - 564, h: b.h - 48 },
  };
}
