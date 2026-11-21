import { Container, Graphics } from 'pixi.js';
import { box, label, mix } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';
import { planFar, planNear, type DieArt, type PlanStyle } from '../../../cpu/render/die/dieart';
import { BD, NIC_BRACKET_X, NIC_LEN, WALL_T, nicJack, nicY } from '../../../board/render/layout/layout';
import { IO_X } from '../../../board/render/layout/boardlayout';
import { portProfile } from '../../../board/render/layout/ports';
import { KEY, edgePins, tabOf } from '../../../board/render/three/pcie';
import { nicGlyph, nicGlyphArea } from './nicglyph';
import { nicGeo } from './niclayout';
import { NIC_LINK, nicInput, type NicBlock, type NicBlockKind, type NicLink, type NicLinkKind, type NicPlan } from './nicplan';

// The static art of the NIC card's face (docs/render/net.md "Inside the NIC and the router"): the PCB with its gold fingers and its bracket, the jack's profile out of the
// bracket, and the card's plan drawn in the CPU die's style (die/dieart.ts, docs/DIE.md): macro blocks tinted in their kind's colour with a rim line, the symbols of
// nicglyph.ts, trace bundles ending in solder pads, names and second lines. It is baked onto the 3D card's face (board/render/three/card3d.ts); the live layer (nicview.ts) runs over
// it. The shop tile and the old strip keep `nicArt` (network/render/net.ts).

type Key = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'bad' | 'mute';

/** The accent of each block kind (the theme token it is drawn with: the line side cyan, the MAC green, the queues amber, the host side purple, the card's small parts pink, the heat sensor red). */
export const NIC_KIND_COLOR: Record<NicBlockKind, Key> = { ctl: 'mute', jack: 'alu', mag: 'alu', phy: 'alu', mac: 'st', stats: 'st', rxq: 'ld', txq: 'ld', dma: 'mul', pcie: 'mul', nvm: 'br', xtal: 'br', vreg: 'br', temp: 'bad' };
export const NIC_LINK_COLOR: Record<NicLinkKind, Key> = { line: 'alu', data: 'st', host: 'mul', control: 'mute', clock: 'br', power: 'ld' };

/** The legend of the colours. */
export const NIC_LEGEND: { text: string; key: Key }[] = [
  { text: 'LINE', key: 'alu' }, { text: 'MAC', key: 'st' }, { text: 'QUEUES', key: 'ld' }, { text: 'HOST', key: 'mul' }, { text: 'CARD', key: 'br' }, { text: 'HEAT', key: 'bad' },
];

/** The line under the plan: what the card is. */
export const nicTitle = (plan: NicPlan): string => {
  const i = plan.input;
  return `${i.chip} · ${i.std} · PCIe x${i.lanes} · ${i.ports} jack${i.ports === 1 ? '' : 's'}`;
};

/** How the card is drawn: the CPU die's art (`planFar`, `planNear`) with the card's colours and symbols. */
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

/** The plan's floor, the blocks and the controller's frame: the far view. */
export function nicFar(g: Graphics, T: Theme, plan: NicPlan): void {
  const D = plan.die;
  g.roundRect(D.x, D.y, D.w, D.h, 8).fill({ color: mix(T.die, '#000000', 0.3) }).stroke({ width: 2.5, color: mix(T.line, T.alu, 0.5) });
  planFar(g, T, plan.blocks, nicStyle(plan));
}

/** Traces, symbols and names of a plan, and the strip under the blocks. */
export function nicNear(T: Theme, plan: NicPlan): DieArt {
  const art = planNear(T, plan, nicStyle(plan)), D = plan.die, sy = D.y + D.h - 38 + 19, names = art.names;
  names.addChild(label(nicTitle(plan), D.x + 16, sy, 17, T.mute, { weight: '700', a: 0.9 }));
  const legend = new Graphics();
  names.addChild(legend);
  const widths = NIC_LEGEND.map((e) => 16 + e.text.length * 8.4 + 20);
  let lx = D.x + D.w - 16 - widths.reduce((n, w) => n + w, 0) + 8;
  NIC_LEGEND.forEach((e, k) => {
    legend.roundRect(lx, sy - 5, 11, 11, 2).fill({ color: T[e.key] });
    names.addChild(label(e.text, lx + 17, sy, 13, T.mute, { a: 0.9 }));
    lx += widths[k]!;
  });
  return art;
}

/**
 * The card's face in board space: the PCB over the slot's line and its body, the gold fingers along the slot's line, the bracket and the jack's profile at the west end,
 * and the plan. The face rectangle is `nicFaceRect` (niclayout.ts): it covers the strip the old 2D art did and the body below it.
 */
export function nicFace(T: Theme, visual: string, slot: number): Container {
  const root = new Container(), g = new Graphics();
  root.addChild(g);
  const geo = nicGeo(visual, slot), f = geo.face, y = nicY(slot), x0 = BD.x, L = NIC_LEN[visual] ?? 1500, jack = nicJack(slot), pcb = '#103848';
  box(g, x0 + 10, f.y + 16, L, f.h, 14, { fill: '#000000', fa: 0.3 });
  box(g, x0, f.y, L, f.h, 14, { fill: pcb, stroke: T.alu, lw: 6, sa: 0.55 });
  // the gold fingers along the slot's line: one for each pin of the card's edge, the key's notch left out (the card's tab, pcie.ts)
  const lanes = (NIC_LINK[visual] ?? nicInput(visual)).lanes, tab = tabOf(slot, x0 + L, lanes), pins = edgePins(lanes), pitch = tab.w / (pins + 0.5);
  for (let k = 0; k < pins; k++) {
    const px = tab.x + (k + 0.5) * pitch;
    if (px > tab.x + KEY.at - pitch * 0.5 && px < tab.x + KEY.at + KEY.w + pitch * 0.5) continue;
    g.rect(px - pitch * 0.3, y - 14, pitch * 0.6, 28);
  }
  g.fill({ color: T.pin, alpha: 0.85 });
  // the bracket on the board's edge, the whole height of the face, and the jack out of it (the mouth faces west)
  box(g, NIC_BRACKET_X, f.y, 30, f.h, 4, { fill: '#aab4c9', stroke: T.line, lw: 4 });
  portProfile(g, T, { id: `nic${slot}`, kind: 'rj45', x: jack.x, y, w: jack.w, h: jack.h }, true, { wallX: IO_X, wallW: WALL_T });
  const die = new Container(), plate = new Graphics(), near = nicNear(T, geo.plan);
  die.position.set(geo.origin.x, geo.origin.y);
  nicFar(plate, T, geo.plan);
  die.addChild(plate, near.root);
  root.addChild(die);
  return root;
}
