import { Container, Graphics } from 'pixi.js';
import { label, mix } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';
import { planFar, planNear, type DieArt, type PlanStyle } from '../../../cpu/render/die/dieart';
import { routerGeo } from './routerlayout';
import { routerGlyph, routerGlyphArea } from './routerglyph';
import { fmtSize, type RouterBlock, type RouterBlockKind, type RouterLink, type RouterLinkKind, type RouterPlan } from './routerplan';

// The static art of the router SoC's die (docs/render/net.md "Inside the NIC and the router"): the chip's plan drawn in the CPU die's style (die/dieart.ts, docs/DIE.md): macro blocks
// tinted in their kind's colour with a rim line, the symbols of routerglyph.ts, trace bundles ending in solder pads, names and second lines. It is baked onto the die's top in 3D
// (board/render/three/routerboard3d.ts, under the lid that fades); the live layer (routerview.ts) runs over it.

type Key = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'bad' | 'mute';

/** The accent of each block kind (the theme token it is drawn with: the line side cyan, the forwarding green, the CPU purple, the memory amber). */
export const ROUTER_KIND_COLOR: Record<RouterBlockKind, Key> = { soc: 'mute', cpu: 'mul', mem: 'ld', wanmac: 'alu', pkt: 'st', sw: 'st', stat: 'st' };
export const ROUTER_LINK_COLOR: Record<RouterLinkKind, Key> = { data: 'st', control: 'mute', memory: 'ld' };

/** The legend of the colours. */
export const ROUTER_LEGEND: { text: string; key: Key }[] = [
  { text: 'LINE', key: 'alu' }, { text: 'FORWARD', key: 'st' }, { text: 'CPU', key: 'mul' }, { text: 'MEMORY', key: 'ld' },
];

/** The line under the plan: what the router is. */
export const routerTitle = (plan: RouterPlan): string => {
  const i = plan.input;
  return `${i.soc} · ${i.std} · ${i.cores} core${i.cores === 1 ? '' : 's'} ${i.mhz} MHz · ${fmtSize(i.dram.mb)}`;
};

/** How the die is drawn: the CPU die's art (`planFar`, `planNear`) with the router's colours and symbols. */
export function routerStyle(plan: RouterPlan): PlanStyle<RouterBlock, RouterLink> {
  return {
    color: (T, b) => T[ROUTER_KIND_COLOR[b.kind]],
    linkColor: (T, l) => T[ROUTER_LINK_COLOR[l.kind]],
    frame: (b) => !!b.frame,
    symbol: (b) => routerGlyphArea(b),
    draw: (g, T, b, _a, c, put) => routerGlyph(g, T, b, c, put, plan.input),
    cells: () => [],
  };
}

/** The die's floor, the blocks and the SoC's frame: the far view. */
export function routerFar(g: Graphics, T: Theme, plan: RouterPlan): void {
  const D = plan.die;
  g.roundRect(D.x, D.y, D.w, D.h, 8).fill({ color: mix(T.die, '#000000', 0.3) }).stroke({ width: 2.5, color: mix(T.line, T.alu, 0.5) });
  planFar(g, T, plan.blocks, routerStyle(plan));
}

/** Traces, symbols and names of a plan, and the strip under the blocks. */
export function routerNear(T: Theme, plan: RouterPlan): DieArt {
  const art = planNear(T, plan, routerStyle(plan)), D = plan.die, sy = D.y + D.h - 30 + 15, names = art.names;
  names.addChild(label(routerTitle(plan), D.x + 14, sy, 15, T.mute, { weight: '700', a: 0.9 }));
  const legend = new Graphics();
  names.addChild(legend);
  const widths = ROUTER_LEGEND.map((e) => 14 + e.text.length * 7.4 + 14);
  let lx = D.x + D.w - 14 - widths.reduce((n, w) => n + w, 0) + 8;
  ROUTER_LEGEND.forEach((e, k) => {
    legend.roundRect(lx, sy - 4, 9, 9, 2).fill({ color: T[e.key] });
    names.addChild(label(e.text, lx + 14, sy, 11, T.mute, { a: 0.9 }));
    lx += widths[k]!;
  });
  return art;
}

/** The die's floorplan in its frame (`routerGeo`): the far view and the near one over it. The 3D board bakes it onto the SoC's die (routerboard3d.ts), the live layer draws over it (routerview.ts). */
export function routerDie(T: Theme, tier: number): Container {
  const root = new Container(), geo = routerGeo(tier), die = new Container(), plate = new Graphics(), near = routerNear(T, geo.plan);
  routerFar(plate, T, geo.plan);
  die.addChild(plate, near.root);
  root.addChild(die);
  return root;
}
