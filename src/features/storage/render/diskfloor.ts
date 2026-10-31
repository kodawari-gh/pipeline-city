// The floorplan of a drive's cutaway (pure, no Pixi): where the controller, the NAND dies, the channels, the platter and the head arm sit, in the
// drive's own units (0..w by 0..h, the body of the casing). The shapes are those of the CPU die's plan (`die/cpuplan.ts`: blocks with a rect and an
// optional cell grid, links as orthogonal polylines with lanes) so `diskart.ts` can draw them with the die's own art (`planFar`, `planNear`).
// The data in the cells is `diskplan.ts`. Tested in diskfloor.test.ts.

import type { Grid, Pt, Rect } from '../../cpu/render/core/cpuplan';
import { ARCH, dieSlices, platterOf, type DieSlice } from './diskplan';
import type { DriveKind } from './drives';

export type DiskBlockKind = 'iface' | 'ctrl' | 'cache' | 'nand' | 'queue' | 'pre';
export type DiskLinkKind = 'host' | 'data' | 'channel' | 'ctl';

export interface DiskBlock { id: string; kind: DiskBlockKind; label: string; sub?: string; rect: Rect; grid?: Grid }
export interface DiskLink { id: string; kind: DiskLinkKind; from: string; to: string; pts: Pt[]; lanes: 1 | 2 | 3 | 4 }

export interface DiskPlan {
  w: number;
  h: number;
  blocks: DiskBlock[];
  links: DiskLink[];
  /** The NAND dies of a flash drive: the block and the slice of the capacity map it shows. */
  dies: { block: string; slice: DieSlice }[];
  /** The hard disk's platter and head arm (the HDD has no dies). */
  platter?: { cx: number; cy: number; R: number; hub: number; tracks: number; sectors: number };
  arm?: { px: number; py: number; len: number };
}

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const midY = (r: Rect): number => r.y + r.h / 2;

/**
 * The floorplan of a drive of `kind` in a body of `w` by `h`, holding `cells` capacity cells. A hard disk is a platter, an arm and a controller; a SATA
 * SSD is one controller on one channel to four dies; an NVMe has more dies on four channels, and a queue block.
 */
export function diskPlan(kind: DriveKind, w: number, h: number, cells: number): DiskPlan {
  const blocks: DiskBlock[] = [], links: DiskLink[] = [], dies: DiskPlan['dies'] = [];
  if (kind === 'hdd') {
    const { tracks, sectors } = platterOf(cells);
    const R0 = Math.min(h * 0.44, w * 0.36), cx = w * 0.38, cy = h * 0.5;
    const iface = rect(w * 0.8, h * 0.06, w * 0.16, h * 0.14), ctrl = rect(w * 0.76, h * 0.34, w * 0.2, h * 0.3), pre = rect(w * 0.76, h * 0.74, w * 0.2, h * 0.14);
    blocks.push({ id: 'iface', kind: 'iface', label: 'SATA', rect: iface }, { id: 'ctrl', kind: 'ctrl', label: 'CONTROLLER', sub: 'servo + cache', rect: ctrl }, { id: 'pre', kind: 'pre', label: 'PREAMP', sub: 'head amp', rect: pre });
    links.push(
      { id: 'iface-ctrl', kind: 'host', from: 'iface', to: 'ctrl', pts: [[iface.x + iface.w / 2, iface.y + iface.h], [iface.x + iface.w / 2, ctrl.y]], lanes: 2 },
      { id: 'ctrl-pre', kind: 'data', from: 'ctrl', to: 'pre', pts: [[ctrl.x + ctrl.w / 2, ctrl.y + ctrl.h], [ctrl.x + ctrl.w / 2, pre.y]], lanes: 2 },
    );
    return { w, h, blocks, links, dies, platter: { cx, cy, R: R0, hub: R0 * 0.16, tracks, sectors }, arm: { px: w * 0.74, py: h * 0.86, len: R0 * 1.12 } };
  }
  const nvme = kind === 'ssd-nvme', a = ARCH[kind];
  const iface = nvme ? rect(w * 0.02, h * 0.4, w * 0.09, h * 0.2) : rect(w * 0.03, h * 0.38, w * 0.1, h * 0.24);
  const ctrl = nvme ? rect(w * 0.17, h * 0.25, w * 0.16, h * 0.5) : rect(w * 0.2, h * 0.3, w * 0.18, h * 0.4);
  const cache = nvme ? rect(w * 0.17, h * 0.82, w * 0.16, h * 0.12) : rect(w * 0.2, h * 0.78, w * 0.18, h * 0.14);
  blocks.push(
    { id: 'iface', kind: 'iface', label: nvme ? 'PCIe x4' : 'SATA', rect: iface },
    { id: 'ctrl', kind: 'ctrl', label: 'CONTROLLER', sub: nvme ? 'FTL, 4 channels' : 'FTL, 1 channel', rect: ctrl },
    { id: 'cache', kind: 'cache', label: 'DRAM', sub: 'map cache', rect: cache },
  );
  links.push(
    { id: 'iface-ctrl', kind: 'host', from: 'iface', to: 'ctrl', pts: [[iface.x + iface.w, midY(iface)], [ctrl.x, midY(iface)]], lanes: nvme ? 4 : 2 },
    { id: 'ctrl-cache', kind: 'data', from: 'ctrl', to: 'cache', pts: [[ctrl.x + ctrl.w / 2, ctrl.y + ctrl.h], [ctrl.x + ctrl.w / 2, cache.y]], lanes: 2 },
  );
  if (nvme) {
    const q = rect(w * 0.02, h * 0.08, w * 0.09, h * 0.24);
    blocks.push({ id: 'queue', kind: 'queue', label: 'QUEUES', rect: q, grid: { cols: 1, rows: 8, count: 8 } });
    links.push({ id: 'queue-ctrl', kind: 'ctl', from: 'queue', to: 'ctrl', pts: [[q.x + q.w, midY(q)], [ctrl.x + ctrl.w * 0.3, midY(q)], [ctrl.x + ctrl.w * 0.3, ctrl.y]], lanes: 1 });
  }
  const slices = dieSlices(cells, a.dies, a.channels);
  const cols = nvme ? 4 : 2;
  const x0 = nvme ? w * 0.42 : w * 0.5, dx = nvme ? w * 0.145 : w * 0.23, dw = nvme ? w * 0.125 : w * 0.2;
  const y0 = h * (nvme ? 0.1 : 0.08), dy = h * (nvme ? 0.45 : 0.46), dh = h * (nvme ? 0.37 : 0.38);
  const gapTop = y0 + dh, gapBot = y0 + dy;
  slices.forEach((s, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    blocks.push({ id: `nand${i}`, kind: 'nand', label: `NAND ${i}`, rect: rect(x0 + c * dx, y0 + r * dy, dw, dh), grid: { cols: s.cols, rows: s.rows, count: s.count } });
    dies.push({ block: `nand${i}`, slice: s });
  });
  if (nvme) {
    // one rail per channel in the gap between the two rows, a stub up and a stub down at its column
    for (let c = 0; c < cols; c++) {
      const railY = gapTop + ((gapBot - gapTop) * (c + 1)) / (cols + 1), x = x0 + c * dx + dw / 2, sy = ctrl.y + ((c + 0.5) * ctrl.h) / cols, bx = ctrl.x + ctrl.w + w * 0.03 + c * w * 0.012;
      links.push({ id: `ch${c}`, kind: 'channel', from: 'ctrl', to: `nand${c}`, pts: [[ctrl.x + ctrl.w, sy], [bx, sy], [bx, railY], [x, railY], [x, gapTop]], lanes: 1 });
      links.push({ id: `ch${c}b`, kind: 'channel', from: 'ctrl', to: `nand${c + cols}`, pts: [[x, railY], [x, gapBot]], lanes: 1 });
    }
  } else {
    // one shared channel: a bus down the left of the dies with a stub into each
    const busX = x0 - w * 0.05, cy = midY(ctrl);
    for (let i = 0; i < slices.length; i++) {
      const d = blocks.find((b) => b.id === `nand${i}`)!.rect;
      links.push({ id: `ch${i}`, kind: 'channel', from: 'ctrl', to: `nand${i}`, pts: [[ctrl.x + ctrl.w, cy], [busX, cy], [busX, midY(d)], [d.x, midY(d)]], lanes: 1 });
    }
  }
  return { w, h, blocks, links, dies };
}
