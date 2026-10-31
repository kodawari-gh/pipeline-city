import { specsOfKind } from '../../board/sim/specs';
import { NPU_LIST_SHOWN } from '../sim/port';
import { NPU_TILES } from '@/core/sim/memmap';
import { arrayGeom, descGeom, npuGlyphArea, tilesGeom } from './npuglyph';
import type { NpuPlan, NpuPlanInput } from './npuplan';
import { npuDie, npuPlan } from './npuplans';
import { CARD_H } from '../../gpu/render/gpulayout';
import type { Rect } from '../../board/render/layout/layout';

// The AI card in its PCIe slot (docs/ACCEL.md "NPU internal view"), in card-local units: (0, 0) is the PCB's north-west corner, like `gpulayout`. The die
// (its plan is `npu/npuplans.ts`, drawn 1 : 1) lies under a lid at the card's offset; the PCB reaches west over the slot's bracket and east over the tail.
// The tooltip test enumerates the hover ids from here, so a part cannot be drawn without a description: each block of the die, each tile register, each
// row of the descriptor queue, each multiply-accumulate cell of the array (`mac<row>x<col>`), and the lid.

/** Where the die starts on the card, and the tail behind it (power lead, heatsink). */
const DIE_AT = { x: 160, y: 50 }, TAIL = 100, LID_PAD = 8;
/** What is left under the die so the card is as tall as a graphics card (gpulayout `CARD_H`): they share a slot height, so cards stack. */
const BOTTOM = CARD_H - DIE_AT.y - npuDie(4).h;

/** The plan input of a card from its spec's `visual` key (`npu-1`, `npu-2`). */
export function npuInputOf(visual: string): NpuPlanInput {
  const s = specsOfKind('npu').find((x) => x.visual === visual);
  return { grid: s?.npu?.grid ?? 4, memBytes: s?.npu?.memBytes ?? 8192, lanes: s?.pcieWidth ?? 4 };
}

/** Card size by the spec's `visual` key. */
export const NPU_LEN: Record<string, number> = Object.fromEntries(specsOfKind('npu').map((s) => [s.visual, DIE_AT.x + npuDie(s.npu!.grid).w + TAIL]));
export const NPU_H: Record<string, number> = Object.fromEntries(specsOfKind('npu').map((s) => [s.visual, DIE_AT.y + npuDie(s.npu!.grid).h + BOTTOM]));

export interface NpuGeo {
  visual: string;
  grid: number;
  /** The PCB. */
  w: number;
  h: number;
  /** The die and the lid over it, card-local. */
  die: Rect;
  lid: Rect;
  origin: { x: number; y: number };
  plan: NpuPlan;
}

const cache = new Map<string, NpuGeo>();

/** The geometry of a card by its spec's `visual` key. */
export function npuGeo(visual: string): NpuGeo {
  const hit = cache.get(visual);
  if (hit) return hit;
  const input = npuInputOf(visual), plan = npuPlan(input), d = plan.die;
  const geo: NpuGeo = {
    visual, grid: input.grid, w: NPU_LEN[visual] ?? DIE_AT.x + d.w + TAIL, h: NPU_H[visual] ?? DIE_AT.y + d.h + BOTTOM,
    die: { x: DIE_AT.x, y: DIE_AT.y, w: d.w, h: d.h }, lid: { x: DIE_AT.x - LID_PAD, y: DIE_AT.y - LID_PAD, w: d.w + 2 * LID_PAD, h: d.h + 2 * LID_PAD }, origin: { ...DIE_AT }, plan,
  };
  cache.set(visual, geo);
  return geo;
}

/** A rectangle of the die moved to card-local units. */
export const onCard = (g: Pick<NpuGeo, 'origin'>, r: Rect): Rect => ({ x: r.x + g.origin.x, y: r.y + g.origin.y, w: r.w, h: r.h });

/** A hoverable part: the id without its slot (`array`, `mac2x3`; the full id is `pcie1.array`), its card-local rectangle, and whether it is a part of the zoomed-in view (the lid is seen from afar) and of the closest one (a cell, a tile, a row). */
export interface NpuPart { id: string; rect: Rect; inner: boolean; fine: boolean }

/** Every part with an id, most specific first (the first hit wins): the cells of the array, the tile registers, the rows of the queue, each block of the die, then the lid over them. */
export function npuParts(g: NpuGeo): NpuPart[] {
  const out: NpuPart[] = [], K = g.grid, block = (id: string) => g.plan.blocks.find((b) => b.id === id)!;
  const arr = npuGlyphArea(block('array')), tiles = npuGlyphArea(block('tiles')), desc = npuGlyphArea(block('desc'));
  if (arr) arrayGeom(arr, K).cells.forEach((r, k) => out.push({ id: `mac${Math.floor(k / K)}x${k % K}`, rect: onCard(g, r), inner: true, fine: true }));
  if (tiles) tilesGeom(tiles, K).slice(0, NPU_TILES).forEach((t, k) => out.push({ id: `tile${k}`, rect: onCard(g, t.box), inner: true, fine: true }));
  if (desc) descGeom(desc).rows.slice(0, NPU_LIST_SHOWN).forEach((r, k) => out.push({ id: `entry${k}`, rect: onCard(g, r.row), inner: true, fine: true }));
  for (const b of g.plan.blocks) out.push({ id: b.id, rect: onCard(g, b.rect), inner: true, fine: false });
  out.push({ id: 'lid', rect: g.lid, inner: false, fine: false });
  return out;
}

/** The ids of every part of a card in PCIe slot `slot` (`pcie0`..), for the hover table and its test. */
export const npuIds = (visual: string, slot: string): string[] => npuParts(npuGeo(visual)).map((p) => `${slot}.${p.id}`);
