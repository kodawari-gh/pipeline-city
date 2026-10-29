// A multicore plan taken apart for the live die (docs/DIE.md "Core tiles"): the shared part (edge ring, shared L2, system bus, the wires out of the
// tiles) and one ordinary single-core plan per tile, in die coordinates, so each tile runs the same replay as a single-core die with its own
// hardware core's trace. Pure.

import type { Block, CpuPlan, Link, Rect } from './cpuplan';
import { CORE_TILE_W } from './cpuplans';

export interface CoreTile {
  /** The tile as a single-core plan: ids without the `c<k>.` prefix, positions still on the die. */
  plan: CpuPlan;
  rect: Rect;
  /**
   * The plan the replay moves on: the tile plus the shared blocks and the wires between them (the shared L2 is called `l2` here, as on a single-core
   * die), so a miss sends packets out through the L2, the system bus and the memory controller, and an interrupt comes in from the controller.
   */
  motion: CpuPlan;
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
  const coreOf = (id: string) => /^c(\d+)\./.exec(id)?.[1];
  const shared = plan.blocks.filter((b) => !inCore(b));
  const isShared = (id: string) => coreOf(id) === undefined;
  const sharedName = (id: string) => (id === 'l2s' ? 'l2' : id);
  const tiles: CoreTile[] = rects.map((rect, k) => {
    const p = `c${k}.`;
    const own = (id: string) => id.startsWith(p);
    const strip = (id: string) => (own(id) ? id.slice(p.length) : sharedName(id));
    const blocks = plan.blocks.filter((b) => b.core === k).map((b): Block => {
      const { core: _core, ...rest } = b;
      return { ...rest, id: b.id.slice(p.length), ...(b.parent ? { parent: b.parent.slice(p.length) } : {}) };
    });
    const links = plan.links.filter((l) => own(l.from) && own(l.to)).map((l): Link => ({ ...l, id: l.id.slice(p.length), from: l.from.slice(p.length), to: l.to.slice(p.length) }));
    // the wires of this tile to the shared part, and the shared part's own
    const out = plan.links
      .filter((l) => (own(l.from) && isShared(l.to)) || (isShared(l.from) && own(l.to)) || (isShared(l.from) && isShared(l.to)))
      .map((l): Link => ({ ...l, id: own(l.from) || own(l.to) ? strip(l.id) : l.id, from: strip(l.from), to: strip(l.to) }));
    const die = rect;
    return {
      plan: { arch: plan.arch, cores: 1, die, blocks, links },
      rect,
      motion: { arch: plan.arch, cores: 1, die, blocks: [...blocks, ...shared.map((b) => ({ ...b, id: sharedName(b.id) }))], links: [...links, ...out] },
      scale: rect.w / CORE_TILE_W,
    };
  });
  const inner = (l: Link) => coreOf(l.from) !== undefined && coreOf(l.from) === coreOf(l.to);
  return {
    shared: { arch: plan.arch, cores: plan.cores, die: plan.die, blocks: shared, links: plan.links.filter((l) => !inner(l)), tiles: rects },
    tiles,
  };
}
