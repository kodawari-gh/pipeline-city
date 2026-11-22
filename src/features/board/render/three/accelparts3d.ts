// The insides of a graphics card and an AI card in 3D (docs/render/net.md "Inside the NIC and the router", the same peek): on the PCB's top face two lidded packages, the main die (the SMs or the
// matrix unit, the host link) and the card memory's die beside it, each a real chip (`nicChip`): a substrate, a block of silicon that wears its floorplan, a nickel lid that fades as the camera comes in over the
// shared band (`dieShow`). Round them the power stage's inductors and the decoupling capacitors. The plans are the 2D game's (`gpuplans.ts`, `npuplans.ts`), the two dies drawn at one scale and a gap between them.
import { Group } from 'three';
import type { RectLike } from '@/core/render/three/geometry';
import { DIE_FILL } from './chipdie3d';
import { mirror, nicChip, type DieFloor, type NicChip } from './nicchip3d';
import { inductor, MM, passiveRow, passives, type Passive } from './pcbkit3d';

export type AccelPart = 'core' | 'mem';

/** The main die's width in mm by card (a real GPU's is 14 to 21 mm, a small AI accelerator's about the same), and the memory die's (a GDDR chip's). */
const MAIN_MM: Record<string, number> = { 'gpu-1': 13, 'gpu-2': 16, 'gpu-3': 21, 'npu-1': 14, 'npu-2': 20 };
const MEM_MM = 10;
const FALLBACK_MM = 16;

/** The package's markings by card, over the lid. */
const MARK: Record<string, readonly string[]> = {
  'gpu-1': ['OCULA', 'OG108', 'SIMD'], 'gpu-2': ['OCULA', 'OG116', 'WARP'], 'gpu-3': ['OCULA', 'OG132', 'MULTI'],
  'npu-1': ['SYNAPTA', 'SN4x4', 'MAC'], 'npu-2': ['SYNAPTA', 'SN8x8', 'MAC'],
};

export interface AccelDie {
  part: AccelPart;
  /** The chip as `nicChip` built it (its rectangle in the mirrored frame). */
  chip: NicChip;
  /** The die's rectangle in layout (y down), the plan rectangle its floorplan covers (board space, as the live layer draws) and the face to put the live layer on. */
  rect: RectLike;
  plan: RectLike;
}

export interface AccelOut {
  dies: AccelDie[];
  /** Where the live layer of a die goes: the face (`DieFloor` made it) and its depth. */
  floors: { part: AccelPart; root: NicChip['die'] }[];
}

/** What a card tells the builder: where its main die stands (layout), how far its PCB reaches east, its slot's line, and the plans' rectangles in board space. */
export interface AccelSpec {
  visual: string;
  /** The main die's middle (layout), the PCB's west and east ends. */
  at: { x: number; y: number };
  x0: number;
  x1: number;
  /** The plan rectangles of the two dies (board space) and the floor (the die's art in a frame) for each. */
  plans: Record<AccelPart, RectLike>;
  floor: (part: AccelPart) => DieFloor;
}

/** The packages and the power stage of a card, on the PCB's top face at depth `Z`, into `g` (a group in the lying card's frame). */
export function accelParts(g: Group, s: AccelSpec, Z: number): AccelOut {
  const top = new Group(), dies: AccelDie[] = [];
  g.add(top);
  const mainSide = (MAIN_MM[s.visual] ?? FALLBACK_MM) * MM, memSide = MEM_MM * MM;
  const place = (part: AccelPart, side: number, cx: number, cy: number, marks: readonly string[]): AccelDie => {
    const plan = s.plans[part], dh = (plan.h / plan.w) * side, k = 1 / DIE_FILL;
    const pkgRect = { x: cx - (side * k) / 2, y: cy - (dh * k) / 2, w: side * k, h: dh * k };
    const chip = nicChip(top, mirror(pkgRect), false, Z, marks, mirror, plan, s.floor(part), { die: side });
    return { part, chip, rect: mirror(chip.rect), plan };
  };
  const core = place('core', mainSide, s.at.x, s.at.y, MARK[s.visual] ?? ['CARD']);
  const gap = 7 * MM, memX = Math.min(s.at.x + (mainSide / DIE_FILL) / 2 + gap + (memSide / DIE_FILL) / 2, s.x1 - 8 * MM - memSide / 2);
  const mem = place('mem', memSide, memX, s.at.y, ['GDDR', 'MEM']);
  dies.push(core, mem);
  // the power stage: a block of inductors west of the main die, in two rows, and the decoupling rows along the dies' north and south edges
  const west = core.rect.x - 0.03 * core.rect.w - 6 * MM, ph = 5 * MM, rows = [s.at.y - 4 * MM, s.at.y + 4 * MM];
  for (const y of rows) for (let k = 0; k < 3; k++) {
    const x = west - k * 7 * MM;
    if (x - ph > s.x0 + 6 * MM) inductor(top, { x: x - ph / 2, y: y - ph / 2, w: ph, h: ph }, Z, 2 * MM, k % 2 ? '1R0' : 'R47');
  }
  const caps: Passive[] = [];
  const row = (d: AccelDie, n: number) => {
    const r = d.rect, step = 1.6 * MM;
    for (const y of [r.y - 2.4 * MM, r.y + r.h + 2.4 * MM]) caps.push(...passiveRow(r.x + (r.w - (n - 1) * step) / 2, y, n, step, '0603', 'cap'));
  };
  row(core, Math.max(4, Math.floor(core.rect.w / (1.6 * MM)) - 2));
  row(mem, Math.max(3, Math.floor(mem.rect.w / (1.6 * MM)) - 2));
  passives(top, caps, Z);
  return { dies, floors: dies.map((d) => ({ part: d.part, root: d.chip.die })) };
}
