import { Container, Graphics } from 'pixi.js';
import { box, label, mix } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';
import { planFar, planNear, type DieArt, type PlanStyle } from '../../../cpu/render/die/dieart';
import type { RouterGeo } from './routerlayout';
import { routerGlyph, routerGlyphArea } from './routerglyph';
import { fmtSize, type RouterBlock, type RouterBlockKind, type RouterLink, type RouterLinkKind, type RouterPlan } from './routerplan';

// The static art of the router's face (docs/render/net.md "Inside the NIC and the router"): the board (relay's blue, docs/brands/relay.md) with its four mounting holes and the router's plan
// drawn in the CPU die's style (die/dieart.ts, docs/DIE.md): macro blocks tinted in their kind's colour with a rim line, the symbols of routerglyph.ts, trace bundles ending in
// solder pads, names and second lines. It is baked onto the panel over the router's front (board/render/three/machine3d.ts); the live layer (routerview.ts) runs over it.

type Key = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'bad' | 'mute';

/** The accent of each block kind (the theme token it is drawn with: the line side cyan, the forwarding green, the CPU purple, the memory amber, the router's small parts pink). */
export const ROUTER_KIND_COLOR: Record<RouterBlockKind, Key> = {
  soc: 'mute', cpu: 'mul', pkt: 'st', sw: 'st', dram: 'ld', flash: 'br', radio: 'br', power: 'br',
  wanjack: 'alu', wanmag: 'alu', wanphy: 'alu', lanphy: 'alu', lanmag: 'alu', lanjack: 'alu', stat: 'st',
};
export const ROUTER_LINK_COLOR: Record<RouterLinkKind, Key> = { line: 'alu', data: 'st', control: 'mute', memory: 'ld', power: 'br' };

/** The legend of the colours. */
export const ROUTER_LEGEND: { text: string; key: Key }[] = [
  { text: 'LINE', key: 'alu' }, { text: 'FORWARDING', key: 'st' }, { text: 'CPU', key: 'mul' }, { text: 'MEMORY', key: 'ld' }, { text: 'BOARD', key: 'br' },
];

/** The line under the plan: what the router is. */
export const routerTitle = (plan: RouterPlan): string => {
  const i = plan.input;
  return `${i.soc} · ${i.std} · ${i.cores} core${i.cores === 1 ? '' : 's'} ${i.mhz} MHz · ${fmtSize(i.dram.mb)} · WAN + ${i.lan} LAN`;
};

/** The names are 1.4 times the die's: the panel is read over a wide front (2400 units across a screen), so the die's 14 would be 7 pixels. The blocks' heads (44, routerglyph.ts) hold them. */
const ROUTER_TEXT = 1.4;

/** How the router is drawn: the CPU die's art (`planFar`, `planNear`) with the router's colours and symbols. */
export function routerStyle(plan: RouterPlan): PlanStyle<RouterBlock, RouterLink> {
  return {
    color: (T, b) => T[ROUTER_KIND_COLOR[b.kind]],
    linkColor: (T, l) => T[ROUTER_LINK_COLOR[l.kind]],
    frame: (b) => !!b.frame,
    symbol: (b) => routerGlyphArea(b),
    draw: (g, T, b, _a, c, put) => routerGlyph(g, T, b, c, put, plan.input),
    cells: () => [],
    text: ROUTER_TEXT,
  };
}

/** The plan's floor, the blocks and the SoC's frame: the far view. */
export function routerFar(g: Graphics, T: Theme, plan: RouterPlan): void {
  const D = plan.die;
  g.roundRect(D.x, D.y, D.w, D.h, 8).fill({ color: mix(T.die, '#000000', 0.3) }).stroke({ width: 2.5, color: mix(T.line, T.alu, 0.5) });
  planFar(g, T, plan.blocks, routerStyle(plan));
}

/** Traces, symbols and names of a plan, and the strip under the blocks. */
export function routerNear(T: Theme, plan: RouterPlan): DieArt {
  const art = planNear(T, plan, routerStyle(plan)), D = plan.die, sy = D.y + D.h - 38 + 19, names = art.names;
  names.addChild(label(routerTitle(plan), D.x + 16, sy, 17 * ROUTER_TEXT, T.mute, { weight: '700', a: 0.9 }));
  const legend = new Graphics();
  names.addChild(legend);
  const widths = ROUTER_LEGEND.map((e) => 16 + e.text.length * 8.4 * ROUTER_TEXT + 20);
  let lx = D.x + D.w - 16 - widths.reduce((n, w) => n + w, 0) + 8;
  ROUTER_LEGEND.forEach((e, k) => {
    legend.roundRect(lx, sy - 7, 14, 14, 2).fill({ color: T[e.key] });
    names.addChild(label(e.text, lx + 21, sy, 13 * ROUTER_TEXT, T.mute, { a: 0.9 }));
    lx += widths[k]!;
  });
  return art;
}

/** The router's face in world space: the board with its mounting holes, and the plan on it (drawn at the plan scale, `geo.scale` world units a unit). */
export function routerFace(T: Theme, geo: RouterGeo): Container {
  const root = new Container(), g = new Graphics(), f = geo.face;
  root.addChild(g);
  box(g, f.x + 12, f.y + 14, f.w, f.h, 14, { fill: '#000000', fa: 0.3 });
  box(g, f.x, f.y, f.w, f.h, 14, { fill: '#16294d', stroke: T.alu, lw: 6, sa: 0.55 });
  // the four screws that hold the board to the case: a ring and a dark head in each corner
  for (const [cx, cy] of [[f.x + 20, f.y + 20], [f.x + f.w - 20, f.y + 20], [f.x + 20, f.y + f.h - 20], [f.x + f.w - 20, f.y + f.h - 20]] as const) {
    g.circle(cx, cy, 8).fill({ color: '#0b1630' }).stroke({ width: 3, color: T.line, alpha: 0.7 });
    g.moveTo(cx - 4, cy).lineTo(cx + 4, cy).stroke({ width: 1.5, color: T.line, alpha: 0.6 });
  }
  const die = new Container(), plate = new Graphics(), near = routerNear(T, geo.plan);
  die.position.set(geo.origin.x, geo.origin.y);
  die.scale.set(geo.scale);
  routerFar(plate, T, geo.plan);
  die.addChild(plate, near.root);
  root.addChild(die);
  return root;
}
