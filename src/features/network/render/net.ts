import { Container, FillGradient, Graphics } from 'pixi.js';
import { box, disc, label, mix } from '@/core/render/ink';
import * as layout from '../../board/render/layout/layout';
import { IO_X } from '../../board/render/layout/boardlayout';
import { portProfile } from '../../board/render/layout/ports';
import type { Theme } from '@/core/render/theme';

// The network props (docs/render/net.md "Network"): the router on its shelf above the monitor, the wall plate with the ISP line, the
// ethernet cable (router to the board jack or a NIC jack), the NIC cards, the link LEDs and the traffic pulses. Everything the
// player sees of the network that is not inside a part lives in `NetView.root` (an external layer: it is drawn at any zoom).

const vgrad = (top: string, bot: string) =>
  new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: top },
      { offset: 1, color: bot },
    ],
    textureSpace: 'local',
  });

// ---------------------------------------------------------------- router geometry

interface Geom {
  w: number;
  h: number;
  nLan: number;
}
const GEOM: Record<string, Geom> = {
  'router-home': { w: 1050, h: 320, nLan: 2 },
  'router-gbe': { w: 1250, h: 360, nLan: 4 },
  'router-10g': { w: 1450, h: 400, nLan: 8 },
  'router-core': { w: 1600, h: 300, nLan: 4 },
};
const geom = (visual: string): Geom => GEOM[visual] ?? GEOM['router-home']!;
/** The box a router occupies in design units (right-aligned to the shelf end, standing on the shelf line). */
const designRect = (visual: string): layout.Rect => {
  const g = geom(visual);
  return { x: layout.ROUTER_EAST - g.w, y: layout.SHELF_Y - g.h, w: g.w, h: g.h };
};
const pitch = (visual: string) => Math.min(150, (geom(visual).w - 420) / geom(visual).nLan);
const SOCK_H = 84;
/** Design x of LAN socket k (0 is the rightmost, the one the cable uses) and of the WAN socket. */
const dLanX = (visual: string, k = 0) => layout.ROUTER_EAST - 150 - k * pitch(visual);
const dWanX = (visual: string) => designRect(visual).x + 150;
const dHdrLed = (r: layout.Rect, k: number) => ({ x: r.x + 78 + k * 62, y: r.y + 62 });
const dSockLed = (x: number) => ({ x, y: layout.SHELF_Y - SOCK_H - 40 });

const BODY: Record<string, { dark: [string, string]; light: [string, string]; rad: number }> = {
  'router-home': { dark: ['#c9d1e0', '#98a4bb'], light: ['#f6f8fb', '#cbd3e2'], rad: 46 },
  'router-gbe': { dark: ['#2d3752', '#171d30'], light: ['#4a5470', '#2b334a'], rad: 30 },
  'router-10g': { dark: ['#8d99b3', '#5a657d'], light: ['#c7d0e3', '#909cb6'], rad: 20 },
  'router-core': { dark: ['#353e55', '#1a2133'], light: ['#525c78', '#2f3752'], rad: 12 },
};

/** Static router art for one look; the LEDs are live (`NetView.frame`). */
function drawRouterShell(opts: {
  g: Graphics;
  T: Theme;
  visual: string;
  r: { x: number; y: number; w: number; h: number };
  tone: { rad: number; dark: [string, string] };
  hi: string;
  lo: string;
}): void {
  const { g, T, visual, r, tone, hi, lo } = opts;
  box(g, r.x + 10, r.y + 18, r.w, r.h, tone.rad, { fill: '#000000', fa: 0.34 });
  if (visual === 'router-core') {
    // rack unit: mounting ears with screw holes
    for (const ex of [r.x - 70, r.x + r.w]) {
      box(g, ex, r.y + 10, 70, r.h - 20, 8, { fill: mix(hi, lo, 0.4), stroke: T.line, lw: 4, sa: 0.7 });
      disc(g, ex + 35, r.y + 60, 12, { fill: '#05070c' });
      disc(g, ex + 35, r.y + r.h - 60, 12, { fill: '#05070c' });
    }
  }
  g.roundRect(r.x, r.y, r.w, r.h, tone.rad).fill(vgrad(hi, lo)).stroke({ width: 6, color: T.line, alpha: 0.9 });
  g.roundRect(r.x + 18, r.y + 8, r.w - 36, 12, 6).fill({ color: '#ffffff', alpha: 0.12 });
  if (visual === 'router-10g') {
    for (let y = r.y + 30; y < r.y + r.h - 20; y += 26) {
      g.moveTo(r.x + 14, y).lineTo(r.x + r.w - 14, y);
    }
    g.stroke({ width: 3, color: '#ffffff', alpha: 0.07 });
  }
  if (visual === 'router-gbe') {
    g.rect(r.x + 40, r.y + r.h - 18, r.w - 80, 5).fill({ color: T.alu, alpha: 0.55 });
  }
  if (visual === 'router-core') {
    for (let k = 0; k < 14; k++) {
      g.rect(r.x + 460 + k * 38, r.y + 36, 14, 70);
    }
    g.fill({ color: '#000000', alpha: 0.45 });
  }
}

function drawRouterSocks(opts: { g: Graphics; T: Theme; visual: string }): void {
  const { g, T, visual } = opts;
  const cage = visual === 'router-core',
    sw = cage ? Math.min(140, pitch(visual) - 10) : Math.min(110, pitch(visual) - 22);
  const sock = (x: number, used = false) => {
    box(g, x - sw / 2, layout.SHELF_Y - SOCK_H, sw, SOCK_H + 2, 8, {
      fill: '#05070c',
      stroke: used ? T.alu : T.line,
      lw: 3,
      sa: used ? 0.8 : 0.6,
    });
    if (cage) {
      g.rect(x - sw / 2 + 16, layout.SHELF_Y - SOCK_H + 30, sw - 32, 8);
    } else {
      for (let k = 0; k < 4; k++) {
        g.rect(x - sw / 2 + 14 + k * ((sw - 36) / 3), layout.SHELF_Y - SOCK_H + 8, 6, 20);
      }
    }
    g.fill({ color: T.pin, alpha: 0.55 });
  };
  sock(dWanX(visual));
  const geo = geom(visual);
  for (let k = 0; k < geo.nLan; k++) {
    sock(dLanX(visual, k), k === 0);
  }
  if (visual === 'router-10g') {
    // SFP cage next to the WAN port
    const x = dWanX(visual) + 150;
    box(g, x - 52, layout.SHELF_Y - 76, 104, 76, 6, { fill: '#05070c', stroke: T.alu, lw: 4, sa: 0.7 });
    g.rect(x - 38, layout.SHELF_Y - 56, 76, 14).fill({ color: T.alu, alpha: 0.35 });
  }
}

export function routerArt(T: Theme, visual: string, name: string): Container {
  const root = new Container(),
    g = new Graphics();
  root.addChild(g);
  root.pivot.set(layout.ROUTER_EAST, layout.SHELF_Y);
  root.position.set(layout.ROUTER_EAST, layout.SHELF_Y);
  root.scale.set(layout.NET_K);
  const r = designRect(visual),
    tone = BODY[visual] ?? BODY['router-home']!;
  const [hi, lo] = tone.dark;
  const brightBody = visual === 'router-home' || visual === 'router-10g';
  let ink = '#9eacd2';
  if (brightBody) {
    ink = visual === 'router-10g' ? '#1a2238' : '#3a4560';
  }
  drawRouterShell({ g, T, visual, r, tone, hi, lo });
  // LED wells: power, activity, and one over each of the WAN and used LAN sockets (lit by NetView.frame)
  const wells = [dHdrLed(r, 0), dHdrLed(r, 1), dSockLed(dWanX(visual)), dSockLed(dLanX(visual))];
  for (const w of wells) {
    disc(g, w.x, w.y, 15, { fill: '#05070c', stroke: T.line, lw: 3, sa: 0.7 });
  }
  // sockets open at the bottom edge: WAN on the left, LAN ports from the right. The edge router's five are QSFP+ cages (wider, one flat mouth with the connector's slot in it), the others RJ45 jacks
  drawRouterSocks({ g, T, visual });
  root.addChild(label('WAN', dWanX(visual), layout.SHELF_Y - SOCK_H - 92, 34, ink, { anchor: [0.5, 0.5], a: 0.95 }));
  root.addChild(label('LAN', dLanX(visual), layout.SHELF_Y - SOCK_H - 92, 34, ink, { anchor: [0.5, 0.5], a: 0.95 }));
  root.addChild(
    label(name.toUpperCase(), r.x + r.w - 70, r.y + 62, 42, ink, { anchor: [1, 0.5], a: 0.95, head: true }),
  );
  return root;
}

// ---------------------------------------------------------------- NIC cards

/** A PCIe NIC card on slot `i` (look = the spec's visual key): PCB, bracket, ethernet jack on the rear edge, a heatsink on the faster cards. */

function nicBadge(visual: string): string {
  if (visual === 'nic-gbe') {
    return 'GbE';
  }
  if (visual === 'nic-10g') {
    return '10G';
  }
  return '40G';
}

function drawNicHeatsink(opts: {
  g: Graphics;
  T: Theme;
  visual: string;
  x0: number;
  y: number;
  chip: { x: number; y: number; w: number; h: number };
}): void {
  const { g, T, visual, x0, y, chip } = opts;
  if (visual === 'nic-gbe') {
    return;
  }
  const big = visual === 'nic-40g';
  const hs = big ? { x: x0 + 560, y: y - 86, w: 820, h: 172 } : { x: x0 + 560, y: y - 76, w: 520, h: 152 };
  const metal = '#7d89a4';
  box(g, hs.x, hs.y, hs.w, hs.h, 8, { fill: metal, stroke: T.line, lw: 4 });
  for (let x = hs.x + 22; x < hs.x + hs.w - 14; x += 26) {
    g.moveTo(x, hs.y + 10).lineTo(x, hs.y + hs.h - 10);
  }
  g.stroke({ width: 7, color: '#000000', alpha: 0.28 });
  if (!big) {
    return;
  }
  // heat pipe to the controller, and a second small sink at the end
  g.moveTo(chip.x + chip.w, y)
    .lineTo(hs.x, y)
    .stroke({ width: 16, color: '#c4864a', cap: 'round' });
  box(g, hs.x + hs.w + 40, y - 56, 300, 112, 8, { fill: metal, stroke: T.line, lw: 4 });
  for (let x = hs.x + hs.w + 62; x < hs.x + hs.w + 330; x += 24) {
    g.moveTo(x, y - 46).lineTo(x, y + 46);
  }
  g.stroke({ width: 6, color: '#000000', alpha: 0.28 });
}

export function nicArt(T: Theme, visual: string, i: number): Container {
  const root = new Container(),
    g = new Graphics();
  root.addChild(g);
  const r = layout.nicRect(i, visual),
    y = layout.nicY(i),
    jack = layout.nicJack(i),
    L = layout.NIC_LEN[visual] ?? 1500;
  const x0 = layout.BD.x;
  const pcb = '#103848';
  box(g, x0 + 10, y - 98 + 16, L, 196, 14, { fill: '#000000', fa: 0.3 });
  box(g, x0, y - 98, L, 196, 14, { fill: pcb, stroke: T.alu, lw: 6, sa: 0.55 });
  // gold edge fingers over the slot
  for (let k = 0; k < 18; k++) {
    g.rect(-2830 + k * 34, y - 14, 18, 28);
  }
  g.fill({ color: T.pin, alpha: 0.85 });
  // controller chip, and the heatsink that grows with the speed
  const chip = { x: x0 + 300, y: y - 56, w: 170, h: 112 };
  box(g, chip.x, chip.y, chip.w, chip.h, 8, { fill: '#0a0f1a', stroke: T.line, lw: 4 });
  for (let k = 0; k < 4; k++) {
    g.rect(x0 + 520 + k * 46, y - 58, 22, 36);
    g.rect(x0 + 520 + k * 46, y + 22, 22, 36);
  }
  g.fill({ color: mix(pcb, '#000000', 0.45) });
  drawNicHeatsink({ g, T, visual, x0, y, chip });
  // bracket on the board edge and the jack that pokes out of it (mouth faces west); the 40G card has two QSFP+ cages, whose steel body in profile is the jack's, a little wider
  box(g, layout.NIC_BRACKET_X, y - 120, 30, 240, 4, { fill: '#aab4c9', stroke: T.line, lw: 4 });
  const quad = visual === 'nic-40g';
  for (const dy of quad ? [-62, 62] : [0]) {
    portProfile(g, T, { id: `nic${i}`, kind: 'rj45', x: jack.x, y: y + dy, w: jack.w, h: quad ? 112 : jack.h }, true, {
      wallX: IO_X,
      wallW: layout.WALL_T,
    }); // in the same side profile as the board's own jack
  }
  // (a cage has no lights in its face: the 40G card's stand in a block over it, out of this picture)
  if (!quad) {
    for (const w of nicLeds(i)) {
      disc(g, w.x, w.y, 11, { fill: '#05070c', stroke: T.line, lw: 3, sa: 0.7 });
    }
  }
  root.addChild(
    label(nicBadge(visual), x0 + 90, y - 50, 44, T.alu, {
      head: true,
      a: 0.85,
    }),
  );
  void r;
  return root;
}

/** LED wells of a NIC jack (link, activity). */
const nicLeds = (i: number): Pt2[] => {
  const j = layout.nicJack(i);
  return [
    { x: j.x + 50, y: j.y + j.h + 30 },
    { x: j.x + 112, y: j.y + j.h + 30 },
  ];
};
interface Pt2 {
  x: number;
  y: number;
}

export { wallArt } from './wallart';
