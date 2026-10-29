import { specsOfKind } from '../../sim/board/specs';
import type { Rect } from './layout';

// The floorplan of a graphics card (docs/ACCEL.md "Art as built"), in card-local units: (0, 0) is the PCB's north-west corner. One pure function
// gives every part the art draws, the view animates and the hover hits: the fans along the top edge, and under them the die's insides (the
// lanes in two rows, the vector registers, the card-memory banks, the execution mask and its stack, the program counter). Like `cpuplan` for the
// die: the tooltip test enumerates the ids from here, so a part cannot be drawn without a description.

/** Card size by the spec's `visual` key; the card is centred on its slot's rail. */
export const GPU_LEN: Record<string, number> = { 'gpu-1': 2000, 'gpu-2': 2500, 'gpu-3': 3000 };
export const GPU_H: Record<string, number> = { 'gpu-1': 318, 'gpu-2': 324, 'gpu-3': 330 };

/** Fan band (the fans stand a little over the PCB's top edge), then the body with the die's rows. */
const FAN_Y = 4, FAN_H = 110, FAN_W = 600, BODY_Y = 152;
const ROW_A = 24, ROW_B = 88, ROW_C = 20, GAP = 6, CELL = 44, REG_W = 12, BANK_W = 40, SLOT = 16;
const SHROUD_X = 150, TAIL = 180;

/** A fan module seen edge-on, like the case fans (card-local rectangle, long side along x). */
export type GpuFan = Rect;

export interface GpuPlan {
  visual: string;
  lanes: number;
  banks: number;
  /** Card memory in bytes. */
  memBytes: number;
  /** The card's PCB. */
  w: number;
  h: number;
  /** The shroud over the die (its fins show through when the card is zoomed out), and the body inside it where the internals live. */
  shroud: Rect;
  body: Rect;
  fans: GpuFan[];
  /** PCIe link block, on the PCB west of the shroud. */
  link: Rect;
  /** Program counter and current instruction (above the lanes and registers). */
  pc: Rect;
  /** The lane cells, lane 0 first (two rows, row-major). */
  laneCells: Rect[];
  lanesBlock: Rect;
  /** The execution mask: one bit per lane, under the lanes. */
  mask: Rect;
  maskBits: Rect[];
  /** The mask stack (8 deep). */
  maskStack: Rect;
  maskSlots: Rect[];
  /** The vector registers: `regRows[r]` is one register's strip, `lanes` cells wide. */
  regs: Rect;
  regRows: Rect[];
  /** The memory banks, and the card memory beside them. */
  bankBars: Rect[];
  mem: Rect;
}

/** The lane count, bank count and card memory of a card, from its spec (so a new tier needs no change here). */
export function gpuShape(visual: string): { lanes: number; banks: number; memBytes: number } {
  const s = specsOfKind('gpu').find((x) => x.visual === visual);
  return { lanes: s?.gpu?.lanes ?? 8, banks: s?.gpu?.banks ?? 1, memBytes: s?.gpu?.memBytes ?? 8192 };
}

/** Cooling fans a GPU shows along its top edge: one, two, three by tier. */
export const gpuFanCount = (visual: string): number => Number(/(\d)$/.exec(visual)?.[1] ?? 1);

export function gpuPlan(visual: string): GpuPlan {
  const { lanes, banks, memBytes } = gpuShape(visual);
  const w = GPU_LEN[visual] ?? 2000, h = GPU_H[visual] ?? 320;
  const shroud: Rect = { x: SHROUD_X, y: 12, w: w - SHROUD_X - TAIL, h: h - 24 };
  const n = gpuFanCount(visual), cell = shroud.w / n;
  const fans: GpuFan[] = Array.from({ length: n }, (_, k) => {
    const w = Math.min(FAN_W, cell - 120);
    return { x: shroud.x + cell * (k + 0.5) - w / 2, y: FAN_Y, w, h: FAN_H };
  });
  const body: Rect = { x: shroud.x, y: BODY_Y, w: shroud.w, h: h - BODY_Y - 12 };

  const lx = shroud.x + 24, yA = BODY_Y + 4, yB = yA + ROW_A + GAP, yC = yB + ROW_B + GAP;
  const cols = Math.ceil(lanes / 2);
  const lanesBlock: Rect = { x: lx, y: yB, w: cols * CELL, h: 2 * CELL };
  const laneCells: Rect[] = Array.from({ length: lanes }, (_, k) => ({ x: lx + (k % cols) * CELL + 2, y: yB + Math.floor(k / cols) * CELL + 2, w: CELL - 4, h: CELL - 4 }));
  const mask: Rect = { x: lx, y: yC, w: lanesBlock.w, h: ROW_C };
  const bitW = mask.w / lanes;
  const maskBits: Rect[] = Array.from({ length: lanes }, (_, k) => ({ x: mask.x + k * bitW, y: yC, w: bitW - 2, h: ROW_C }));

  const rx = lanesBlock.x + lanesBlock.w + 64, rowH = ROW_B / 8;
  const regs: Rect = { x: rx, y: yB, w: lanes * REG_W, h: ROW_B };
  const regRows: Rect[] = Array.from({ length: 8 }, (_, r) => ({ x: rx, y: yB + r * rowH, w: regs.w, h: rowH - 1 }));
  const pc: Rect = { x: lx, y: yA, w: regs.x + regs.w - lx, h: ROW_A };

  const bx = regs.x + regs.w + 40;
  const bankBars: Rect[] = Array.from({ length: banks }, (_, b) => ({ x: bx + b * (BANK_W + 8), y: yB, w: BANK_W, h: ROW_B }));
  const memX = bx + banks * (BANK_W + 8) + 16, memEnd = shroud.x + shroud.w - 24;
  const mem: Rect = { x: memX, y: yB, w: memEnd - memX, h: ROW_B };
  const maskStack: Rect = { x: memX, y: yA, w: 8 * (SLOT + 4), h: ROW_A };
  const maskSlots: Rect[] = Array.from({ length: 8 }, (_, k) => ({ x: memX + k * (SLOT + 4), y: yA + (ROW_A - SLOT) / 2, w: SLOT, h: SLOT }));

  return {
    visual, lanes, banks, memBytes, w, h, shroud, body, fans, link: { x: 18, y: BODY_Y + 24, w: 112, h: 70 }, pc, laneCells, lanesBlock, mask, maskBits,
    maskStack, maskSlots, regs, regRows, bankBars, mem,
  };
}

/** A hoverable part: the id without its slot (`lane3`; the full id is `pcie1.lane3`), its card-local rectangle, and whether it is a part of the zoomed-in view (the fans are seen from afar). */
export interface GpuPart { id: string; rect: Rect; inner: boolean }

/** Every part with an id, most specific first (the first hit wins), so the lanes come before the shroud they sit on. */
export function gpuParts(p: GpuPlan): GpuPart[] {
  const out: GpuPart[] = [];
  p.fans.forEach((f, k) => out.push({ id: `fan${k}`, rect: f, inner: false }));
  p.laneCells.forEach((r, k) => out.push({ id: `lane${k}`, rect: r, inner: true }));
  p.bankBars.forEach((r, k) => out.push({ id: `bank${k}`, rect: r, inner: true }));
  out.push({ id: 'regs', rect: p.regs, inner: true });
  out.push({ id: 'maskstack', rect: p.maskStack, inner: true });
  out.push({ id: 'mask', rect: p.mask, inner: true });
  out.push({ id: 'pc', rect: p.pc, inner: true });
  out.push({ id: 'mem', rect: p.mem, inner: true });
  out.push({ id: 'link', rect: p.link, inner: true });
  out.push({ id: 'fins', rect: p.shroud, inner: true });
  return out;
}

/** The ids of every part of a card in PCIe slot `slot` (`pcie0`..), for the hover table and its test. */
export const gpuIds = (visual: string, slot: string): string[] => gpuParts(gpuPlan(visual)).map((x) => `${slot}.${x.id}`);

/** The card-local rectangle moved to board space, given the card's north-west corner. */
export const moveRect = (r: Rect, o: { x: number; y: number }): Rect => ({ x: r.x + o.x, y: r.y + o.y, w: r.w, h: r.h });
