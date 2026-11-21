import { Container, Graphics } from 'pixi.js';
import { label, mix } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';
import { planFar, planNear, type DieArt, type PlanStyle } from '../../../cpu/render/die/dieart';
import { nicGlyph, nicGlyphArea } from './nicglyph';
import { nicGeo } from './niclayout';
import type { NicBlock, NicBlockKind, NicLink, NicLinkKind, NicPlan } from './nicplan';

// The static art of the NIC controller's die (docs/render/net.md "Inside the NIC and the router"): the card's plan drawn in the CPU die's style (die/dieart.ts, docs/DIE.md): macro
// blocks tinted in their kind's colour with a rim line, the symbols of nicglyph.ts, trace bundles ending in solder pads, names and second lines. It is baked onto the die's top in
// 3D (board/render/three/nic3d.ts, under the lid that fades); the live layer (nicview.ts) runs over it. The shop tile and the old strip keep `nicArt` (network/render/net.ts).

type Key = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'bad' | 'mute';

/** The accent of each block kind (the theme token it is drawn with: the line side cyan, the MAC green, the queues amber, the host side purple, the heat sensor red). */
export const NIC_KIND_COLOR: Record<NicBlockKind, Key> = { ctl: 'mute', phy: 'alu', mac: 'st', stats: 'st', rxq: 'ld', txq: 'ld', dma: 'mul', pcie: 'mul', temp: 'bad' };
export const NIC_LINK_COLOR: Record<NicLinkKind, Key> = { line: 'alu', data: 'st', host: 'mul', control: 'mute' };

/** The legend of the colours. */
export const NIC_LEGEND: { text: string; key: Key }[] = [
  { text: 'LINE', key: 'alu' }, { text: 'MAC', key: 'st' }, { text: 'QUEUES', key: 'ld' }, { text: 'HOST', key: 'mul' }, { text: 'HEAT', key: 'bad' },
];

/** The line under the plan: what the card is. */
export const nicTitle = (plan: NicPlan): string => {
  const i = plan.input;
  return `${i.chip} · ${i.std} · PCIe x${i.lanes}`;
};

/** How the die is drawn: the CPU die's art (`planFar`, `planNear`) with the card's colours and symbols. */
export function nicStyle(plan: NicPlan): PlanStyle<NicBlock, NicLink> {
  return {
    color: (T, b) => T[NIC_KIND_COLOR[b.kind]],
    linkColor: (T, l) => T[NIC_LINK_COLOR[l.kind]],
    frame: (b) => !!b.frame,
    symbol: (b) => nicGlyphArea(b),
    draw: (g, T, b, _a, c, put) => nicGlyph(g, T, b, c, put, plan.input),
    cells: () => [],
  };
}

/** The die's floor, the blocks and the controller's frame: the far view. */
export function nicFar(g: Graphics, T: Theme, plan: NicPlan): void {
  const D = plan.die;
  g.roundRect(D.x, D.y, D.w, D.h, 8).fill({ color: mix(T.die, '#000000', 0.3) }).stroke({ width: 2.5, color: mix(T.line, T.alu, 0.5) });
  planFar(g, T, plan.blocks, nicStyle(plan));
}

/** Traces, symbols and names of a plan, and the strip under the blocks. */
export function nicNear(T: Theme, plan: NicPlan): DieArt {
  const art = planNear(T, plan, nicStyle(plan)), D = plan.die, sy = D.y + D.h - 30 + 15, names = art.names;
  names.addChild(label(nicTitle(plan), D.x + 14, sy, 15, T.mute, { weight: '700', a: 0.9 }));
  const legend = new Graphics();
  names.addChild(legend);
  // (a chip with no heat sensor has no heat colour to name)
  const items = NIC_LEGEND.filter((e) => e.key !== 'bad' || plan.input.heat), widths = items.map((e) => 14 + e.text.length * 7.4 + 14);
  let lx = D.x + D.w - 14 - widths.reduce((n, w) => n + w, 0) + 8;
  items.forEach((e, k) => {
    legend.roundRect(lx, sy - 4, 9, 9, 2).fill({ color: T[e.key] });
    names.addChild(label(e.text, lx + 14, sy, 11, T.mute, { a: 0.9 }));
    lx += widths[k]!;
  });
  return art;
}

/**
 * The die's floorplan in its frame (`nicGeo`: the card's band): the plan drawn at its origin, the far view and the near one over it. The 3D card bakes it onto the die's top
 * (nic3d.ts), the live layer draws over it (nicview.ts).
 */
export function nicDie(T: Theme, visual: string, slot: number): Container {
  const root = new Container(), geo = nicGeo(visual, slot), die = new Container(), plate = new Graphics(), near = nicNear(T, geo.plan);
  die.position.set(geo.origin.x, geo.origin.y);
  nicFar(plate, T, geo.plan);
  die.addChild(plate, near.root);
  root.addChild(die);
  return root;
}
