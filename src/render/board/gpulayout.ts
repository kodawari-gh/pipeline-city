import { specsOfKind } from '../../sim/board/specs';
import type { Pt } from '../die/cpuplan';
import { gpuPlanInput, type GpuBlock, type GpuLinkKind, type GpuPlan as DiePlan, type GpuPlanInput } from '../gpu/gpuplan';
import { gpuCells, GPU_DIE, gpuPlan as dieOf, maskParts } from '../gpu/gpuplans';
import type { Rect } from './layout';

// The floorplan of a graphics card (docs/GPU.md section 7), in card-local units: (0, 0) is the PCB's north-west corner. The die's insides come
// from `gpu/gpuplans.ts` (the same slicing layout and router as the CPU die) and are moved under the fans; this file lays the card round it
// (the shroud, the fans along the top edge) and gives the card view the rectangles it animates and the hover table the parts it hits. Like
// `cpuplan` for the die: the tooltip test enumerates the ids from here, so a part cannot be drawn without a description.

/** The PCB: a fan band over the die, a margin all round, the host side and the power plugs at the ends. */
const SHROUD_X = 150, TAIL = 180, MARGIN = 12, FAN_Y = 4, FAN_H = 130, FAN_W = 900, DIE_Y = 138;
const CARD_H = 600;

/** Card size by the spec's `visual` key; the card is centred on its slot's rail. */
export const GPU_LEN: Record<string, number> = Object.fromEntries(specsOfKind('gpu').map((s) => [s.visual, GPU_DIE[gpuPlanInput(s.gpu!).kind].w + 2 * MARGIN + SHROUD_X + TAIL]));
export const GPU_H: Record<string, number> = Object.fromEntries(specsOfKind('gpu').map((s) => [s.visual, CARD_H]));

/** A fan module seen edge-on, like the case fans (card-local rectangle, long side along x). */
export type GpuFan = Rect;

/** One SM's vector registers on the card: `rows[r]` is register r's strip, `cols` lanes wide, the first lane `lane0`. */
export interface RegSet { lane0: number; cols: number; rows: Rect[] }

export interface GpuPlan {
  visual: string;
  lanes: number;
  banks: number;
  /** Card memory in bytes. */
  memBytes: number;
  /** The card's PCB. */
  w: number;
  h: number;
  /** The shroud over the die (its fins show through when the card is zoomed out), and the body inside it where the die lives (the die's rectangle). */
  shroud: Rect;
  body: Rect;
  fans: GpuFan[];
  /** The die's plan (die coordinates) and where its north-west corner is on the card. */
  die: DiePlan;
  origin: { x: number; y: number };
  /** The routed links, moved to card-local points. */
  links: { id: string; kind: GpuLinkKind; pts: Pt[]; lanes: number }[];
  /** PCIe link block, on the die's west edge. */
  link: Rect;
  /** Program counter and current instruction (SM 0's front end). */
  pc: Rect;
  /** The lane cells, lane 0 first, SM after SM (row-major in each). */
  laneCells: Rect[];
  lanesBlock: Rect;
  /** The execution mask: one bit per lane (all SMs), in the mask block of each SM. */
  mask: Rect;
  maskBits: Rect[];
  /** The mask stack (8 deep) of SM 0. */
  maskStack: Rect;
  maskSlots: Rect[];
  /** The vector registers of SM 0: `regRows[r]` is one register's strip, and every SM's in `regSets`. */
  regs: Rect;
  regRows: Rect[];
  regSets: RegSet[];
  /** The memory banks of SM 0, and the card memory. */
  bankBars: Rect[];
  mem: Rect;
}

const FALLBACK: GpuPlanInput = { kind: 'simd', sms: 1, warps: 1, lanes: 8, banks: 1, memBytes: 8192, lineWords: 1, l1Lines: 0, l2Lines: 0 };

/** The plan input of a card, from its spec (so a new tier needs no change here). */
export function gpuInputOf(visual: string): GpuPlanInput {
  const s = specsOfKind('gpu').find((x) => x.visual === visual);
  return s?.gpu ? gpuPlanInput(s.gpu) : FALLBACK;
}

/** The lane count, bank count and card memory of a card, from its spec. */
export function gpuShape(visual: string): { lanes: number; banks: number; memBytes: number } {
  const i = gpuInputOf(visual);
  return { lanes: i.lanes, banks: i.banks, memBytes: i.memBytes };
}

/** Cooling fans a GPU shows along its top edge: one, two, three by tier. */
export const gpuFanCount = (visual: string): number => Number(/(\d)$/.exec(visual)?.[1] ?? 1);

const cache = new Map<string, GpuPlan>();

export function gpuPlan(visual: string): GpuPlan {
  const hit = cache.get(visual);
  if (hit) return hit;
  const input = gpuInputOf(visual), die = dieOf(input), { lanes, banks, memBytes } = input;
  const w = GPU_LEN[visual] ?? SHROUD_X + 2 * MARGIN + die.die.w + TAIL, h = GPU_H[visual] ?? CARD_H;
  const shroud: Rect = { x: SHROUD_X, y: MARGIN, w: die.die.w + 2 * MARGIN, h: h - 2 * MARGIN };
  const n = gpuFanCount(visual), cell = shroud.w / n;
  const fans: GpuFan[] = Array.from({ length: n }, (_, k) => {
    const fw = Math.min(FAN_W, cell - 120);
    return { x: shroud.x + cell * (k + 0.5) - fw / 2, y: FAN_Y, w: fw, h: FAN_H };
  });
  const origin = { x: SHROUD_X + MARGIN, y: DIE_Y }, body: Rect = { x: origin.x, y: origin.y, w: die.die.w, h: die.die.h };
  const mv = (r: Rect): Rect => ({ x: r.x + origin.x, y: r.y + origin.y, w: r.w, h: r.h });
  const get = (id: string): GpuBlock => die.blocks.find((b) => b.id === id)!;
  const per = lanes / input.sms, laneCells: Rect[] = [], maskBits: Rect[] = [], regSets: RegSet[] = [];
  let first: { lanes: Rect; regs: Rect; mask: ReturnType<typeof maskParts>; pc: Rect; banks: Rect[] } | null = null;
  for (let k = 0; k < input.sms; k++) {
    const p = input.sms > 1 ? `sm${k}.` : '', lb = get(`${p}lanes`), rb = get(`${p}regs`), mb = get(`${p}mask`);
    laneCells.push(...gpuCells(lb).map(mv));
    const m = maskParts(mb.rect, per);
    maskBits.push(...m.bits.map(mv));
    const rc = gpuCells(rb), rows = Array.from({ length: 8 }, (_, r): Rect => {
      const a = rc[r * per]!, z = rc[r * per + per - 1]!;
      return mv({ x: a.x, y: a.y, w: z.x + z.w - a.x, h: a.h });
    });
    regSets.push({ lane0: k * per, cols: per, rows });
    if (!first) {
      const bb = die.blocks.find((b) => b.id === `${p}banks`) ?? get(`${p}arb`);
      first = { lanes: mv(lb.rect), regs: mv(rb.rect), mask: { ...m, strip: mv(m.strip), stack: mv(m.stack), slots: m.slots.map(mv) }, pc: mv((die.blocks.find((b) => b.id === 'pc') ?? get(`${p}fetch`)).rect), banks: gpuCells(bb).map(mv) };
    }
  }
  const f = first!;
  const plan: GpuPlan = {
    visual, lanes, banks, memBytes, w, h, shroud, body, fans, die, origin,
    links: die.links.map((l) => ({ id: l.id, kind: l.kind, lanes: l.lanes, pts: l.pts.map((p): Pt => [p[0] + origin.x, p[1] + origin.y]) })),
    link: mv(get('pcie').rect), pc: f.pc, laneCells, lanesBlock: f.lanes, mask: f.mask.strip, maskBits, maskStack: f.mask.stack, maskSlots: f.mask.slots,
    regs: f.regs, regRows: regSets[0]!.rows, regSets, bankBars: f.banks, mem: mv(get('dram').rect),
  };
  cache.set(visual, plan);
  return plan;
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
