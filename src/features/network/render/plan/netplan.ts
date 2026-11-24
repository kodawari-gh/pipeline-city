// The floorplan of a network part as data (docs/render/net.md "Inside the NIC and the router"): the card's controller and the router's board are
// laid out like the CPU die (die/cpufloor.ts): blocks that fill the area edge to edge, a gutter between them, and wires routed through the gutters.
// Pure geometry, no Pixi. `layPlan` is the one builder both parts use; the plans of the parts are in nic/nicplan.ts and router/routerplan.ts.

import type { Grid, Pt, Rect } from '../../../cpu/render/core/cpuplan';
import { placeTree, routeWires, type Node, type Spec, type WireSpec } from '../../../cpu/render/core/cpufloor';

export type { Pt, Rect };

/** One block of a plan. A `frame` is the container drawn behind its children (the controller round its blocks). */
export interface NetBlock<K extends string = string> {
  id: string;
  kind: K;
  label: string;
  sub?: string;
  rect: Rect;
  parent?: string;
  frame?: boolean;
  grid?: Grid;
}

/** One wire: the orthogonal polyline from the edge of `from` to the edge of `to`, and its parallel traces (1 a control wire, 2 a word, 3 a wide bus, 4 a bundle). */
export interface NetLink<L extends string = string> {
  id: string;
  kind: L;
  from: string;
  to: string;
  pts: Pt[];
  lanes: 1 | 2 | 3 | 4;
  label?: string;
  both?: boolean;
}

export interface NetPlan<K extends string = string, L extends string = string, I = unknown> {
  input: I;
  /** The area the plan fills, (0, 0) its north-west corner. */
  die: Rect;
  blocks: NetBlock<K>[];
  links: NetLink<L>[];
}

/** The space the blocks leave round the area: the bond pads and the wires run in it, and the south one carries the title and the legend. */
export interface Margins {
  x: number;
  top: number;
  bottom: number;
}

const cache = new Map<string, NetPlan<string, string, unknown>>();

/**
 * Lay `tree` out in a `size` area inside the margins, route `specs` through the gutters and return the plan. `extra` adds wires the router does not
 * find (a bus that runs along the margin, off the blocks); it sees the placed blocks. The result is cached by `key`.
 */
export function layPlan<K extends string, L extends string, I>(
  key: string,
  input: I,
  size: { w: number; h: number },
  m: Margins,
  tree: Node<K>,
  specs: WireSpec<L>[],
  tag: string,
  extra?: (blocks: NetBlock<K>[]) => NetLink<L>[],
): NetPlan<K, L, I> {
  const hit = cache.get(key);
  if (hit) return hit as NetPlan<K, L, I>;
  const die: Rect = { x: 0, y: 0, w: size.w, h: size.h },
    blocks: NetBlock<K>[] = [];
  placeTree<K, NetBlock<K>>(
    tree,
    { x: m.x, y: m.top, w: size.w - 2 * m.x, h: size.h - m.top - m.bottom },
    blocks,
    (s: Spec<K>, r, parent, _zone, frame) => {
      const b: NetBlock<K> = { id: s.id, kind: s.kind, label: s.label, rect: { ...r } };
      if (s.sub) b.sub = s.sub;
      if (parent) b.parent = parent;
      if (frame) b.frame = true;
      return b;
    },
  );
  const links: NetLink<L>[] = routeWires<NetBlock<K>, L>(die, blocks, specs, undefined, tag).map((w) => ({
    ...w,
    lanes: w.lanes as 1 | 2 | 3 | 4,
  }));
  if (extra) links.push(...extra(blocks));
  const plan: NetPlan<K, L, I> = { input, die, blocks, links };
  cache.set(key, plan as NetPlan<string, string, unknown>);
  return plan;
}

/** A block of a plan by id (throws on a plan that lacks it: the ids are the plan builder's own). */
export function blockOf<K extends string>(plan: Pick<NetPlan<K>, 'blocks'>, id: string): NetBlock<K> {
  const b = plan.blocks.find((x) => x.id === id);
  if (!b) throw new Error(`netplan: no block ${id}`);
  return b;
}

/** A link of a plan by id, or undefined. */
export const linkById = <L extends string>(
  plan: Pick<NetPlan<string, L>, 'links'>,
  id: string,
): NetLink<L> | undefined => plan.links.find((l) => l.id === id);
