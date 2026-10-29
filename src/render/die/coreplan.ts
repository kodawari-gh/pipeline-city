// A multicore plan taken apart for the live die (docs/DIE.md "Core tiles"): the shared part (edge ring, shared L2, system bus, the wires out of the
// tiles) and one ordinary single-core plan per tile, in die coordinates, so each tile runs the same replay as a single-core die with its own
// hardware core's trace. Pure.

import type { Block, CpuPlan, Link, Rect } from './cpuplan';
import { CORE_TILE_W } from './cpuplans';

export interface CoreTile {
  /** The tile as a single-core plan: ids without the `c<k>.` prefix, positions still on the die. */
  plan: CpuPlan;
  rect: Rect;
  /** How much smaller than a single-core die the tile is: its zoom is the die's zoom times this. */
  scale: number;
}

export interface SplitPlan {
  /** Everything that is not inside a tile (the tiles' blocks are left out; the wires between a tile and the shared part stay). */
  shared: CpuPlan;
  tiles: CoreTile[];
}

/** The plan split into its shared part and its core tiles, or null for a single-core plan. */
export function splitPlan(plan: CpuPlan): SplitPlan | null {
  const rects = plan.tiles;
  if (plan.cores < 2 || !rects) return null;
  const inCore = (b: Block) => b.core !== undefined;
  const tiles: CoreTile[] = rects.map((rect, k) => {
    const p = `c${k}.`;
    const own = (id: string) => id.startsWith(p);
    const blocks = plan.blocks.filter((b) => b.core === k).map((b): Block => {
      const { core: _core, ...rest } = b;
      return { ...rest, id: b.id.slice(p.length), ...(b.parent ? { parent: b.parent.slice(p.length) } : {}) };
    });
    const links = plan.links.filter((l) => own(l.from) && own(l.to)).map((l): Link => ({ ...l, id: l.id.slice(p.length), from: l.from.slice(p.length), to: l.to.slice(p.length) }));
    return { plan: { arch: plan.arch, cores: 1, die: rect, blocks, links }, rect, scale: rect.w / CORE_TILE_W };
  });
  const inner = (l: Link) => /^c\d+\./.test(l.from) && /^c\d+\./.test(l.to) && l.from.split('.')[0] === l.to.split('.')[0];
  return {
    shared: { arch: plan.arch, cores: plan.cores, die: plan.die, blocks: plan.blocks.filter((b) => !inCore(b)), links: plan.links.filter((l) => !inner(l)), tiles: rects },
    tiles,
  };
}
