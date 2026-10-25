import { Container, FillGradient, Graphics } from 'pixi.js';
import { BOARD_TIERS } from '../sim/board/specs';
import type { Snapshot } from '../sim/protocol';
import { drawPlug, plugRect } from './devices';
import { box, dashed, disc, label, mix, clear } from './ink';
import type { LanJack, LanScene, SceneInfo } from './interact';
import {
  BD, CABLE_ROW_Y, DESK_SLAB, DESK_Y, ETH0_MOUTH, ETH0_RECT, ISP_ROW_Y, LAN_TRUNK_X, MONITOR, RISER, WALL_Y, nicJack, nicRect, nicY, NIC_BRACKET_X, NIC_LEN, PLUG_L, PLUG_W, ROUTER_EAST, ROUTER_SPOT, SHELF_Y,
  NET_K, WALL_JACK, WALL_PLATE, WALL_T, type Rect,
} from './layout';
import { IO_X } from './boardlayout';
import { portProfile } from './ports';
import { netPropsVisible } from './netvis';
import { laneRects, mkLane, pointAt, roundedPath, type Lane, type Plug, type Pt } from './routes';
import type { Theme } from './theme';

// The network props (docs/RENDER.md "Network"): the router on its shelf above the monitor, the wall plate with the ISP line, the
// ethernet cable (router to the board jack or a NIC jack), the NIC cards, the link LEDs and the traffic pulses. Everything the
// player sees of the network that is not inside a part lives in `NetView.root` (an external layer: it is drawn at any zoom).

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const vgrad = (top: string, bot: string) => new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: top }, { offset: 1, color: bot }], textureSpace: 'local' });

/** "50 Mb", "1 Gb". */
export const fmtMbps = (m: number) => (m >= 1000 ? `${+(m / 1000).toFixed(1)} Gb` : `${m} Mb`);

// ---------------------------------------------------------------- router geometry

interface Geom { w: number; h: number; nLan: number }
const GEOM: Record<string, Geom> = {
  'router-home': { w: 1050, h: 320, nLan: 2 },
  'router-gbe': { w: 1250, h: 360, nLan: 4 },
  'router-10g': { w: 1450, h: 400, nLan: 8 },
  'router-core': { w: 1600, h: 300, nLan: 12 },
};
const geom = (visual: string): Geom => GEOM[visual] ?? GEOM['router-home']!;
// The router is drawn at its design size around its shelf corner (ROUTER_EAST, SHELF_Y) in a container scaled by NET_K, so the box and
// everything on it grow together; the `world` helpers below give the scaled positions the cable, the LEDs and the hit boxes use.
const tx = (x: number) => ROUTER_EAST + (x - ROUTER_EAST) * NET_K;
const ty = (y: number) => SHELF_Y + (y - SHELF_Y) * NET_K;
/** The box a router occupies in design units (right-aligned to the shelf end, standing on the shelf line). */
const designRect = (visual: string): Rect => { const g = geom(visual); return { x: ROUTER_EAST - g.w, y: SHELF_Y - g.h, w: g.w, h: g.h }; };
/** The box a router occupies in the world (right-aligned to the shelf end, standing on the shelf line). */
export const routerRect = (visual: string): Rect => { const d = designRect(visual); return { x: tx(d.x), y: ty(d.y), w: d.w * NET_K, h: d.h * NET_K }; };
const pitch = (visual: string) => Math.min(150, (geom(visual).w - 420) / geom(visual).nLan);
const SOCK_H = 84;
/** Design x of LAN socket k (0 is the rightmost, the one the cable uses) and of the WAN socket. */
const dLanX = (visual: string, k = 0) => ROUTER_EAST - 150 - k * pitch(visual);
const dWanX = (visual: string) => designRect(visual).x + 150;
const dHdrLed = (r: Rect, k: number) => ({ x: r.x + 78 + k * 62, y: r.y + 62 });
const dSockLed = (x: number) => ({ x, y: SHELF_Y - SOCK_H - 40 });
/** World x of LAN socket k and of the WAN socket, and the LEDs, after the scale. */
const lanX = (visual: string, k = 0) => tx(dLanX(visual, k));
const wanX = (visual: string) => tx(dWanX(visual));
const hdrLed = (r: Rect, k: number) => ({ x: r.x + (78 + k * 62) * NET_K, y: r.y + 62 * NET_K });
const sockLed = (x: number) => ({ x, y: ty(SHELF_Y - SOCK_H - 40) });

const BODY: Record<string, { dark: [string, string]; light: [string, string]; rad: number }> = {
  'router-home': { dark: ['#c9d1e0', '#98a4bb'], light: ['#f6f8fb', '#cbd3e2'], rad: 46 },
  'router-gbe': { dark: ['#2d3752', '#171d30'], light: ['#4a5470', '#2b334a'], rad: 30 },
  'router-10g': { dark: ['#8d99b3', '#5a657d'], light: ['#c7d0e3', '#909cb6'], rad: 20 },
  'router-core': { dark: ['#353e55', '#1a2133'], light: ['#525c78', '#2f3752'], rad: 12 },
};

/** Static router art for one look; the LEDs are live (`NetView.frame`). */
export function routerArt(T: Theme, visual: string, name: string): Container {
  const root = new Container(), g = new Graphics();
  root.addChild(g);
  root.pivot.set(ROUTER_EAST, SHELF_Y); root.position.set(ROUTER_EAST, SHELF_Y); root.scale.set(NET_K);
  const r = designRect(visual), geo = geom(visual), tone = BODY[visual] ?? BODY['router-home']!;
  const [hi, lo] = T.dark ? tone.dark : tone.light;
  const brightBody = visual === 'router-home' || (visual === 'router-10g');
  const ink = brightBody ? (T.dark && visual === 'router-10g' ? '#1a2238' : '#3a4560') : '#9eacd2';
  box(g, r.x + 10, r.y + 18, r.w, r.h, tone.rad, { fill: '#000000', fa: T.dark ? 0.34 : 0.16 });
  if (visual === 'router-core') {
    // rack unit: mounting ears with screw holes
    for (const ex of [r.x - 70, r.x + r.w]) {
      box(g, ex, r.y + 10, 70, r.h - 20, 8, { fill: mix(hi, lo, 0.4), stroke: T.line, lw: 4, sa: 0.7 });
      disc(g, ex + 35, r.y + 60, 12, { fill: '#05070c' }); disc(g, ex + 35, r.y + r.h - 60, 12, { fill: '#05070c' });
    }
  }
  g.roundRect(r.x, r.y, r.w, r.h, tone.rad).fill(vgrad(hi, lo)).stroke({ width: 6, color: T.line, alpha: 0.9 });
  g.roundRect(r.x + 18, r.y + 8, r.w - 36, 12, 6).fill({ color: '#ffffff', alpha: T.dark ? 0.12 : 0.55 });
  if (visual === 'router-10g') for (let y = r.y + 30; y < r.y + r.h - 20; y += 26) g.moveTo(r.x + 14, y).lineTo(r.x + r.w - 14, y);
  if (visual === 'router-10g') g.stroke({ width: 3, color: '#ffffff', alpha: 0.07 });
  if (visual === 'router-gbe') g.rect(r.x + 40, r.y + r.h - 18, r.w - 80, 5).fill({ color: T.alu, alpha: 0.55 });
  if (visual === 'router-core') {
    for (let k = 0; k < 14; k++) g.rect(r.x + 460 + k * 38, r.y + 36, 14, 70);
    g.fill({ color: '#000000', alpha: 0.45 });
  }
  // LED wells: power, activity, and one over each of the WAN and used LAN sockets (lit by NetView.frame)
  const wells = [dHdrLed(r, 0), dHdrLed(r, 1), dSockLed(dWanX(visual)), dSockLed(dLanX(visual))];
  for (const w of wells) disc(g, w.x, w.y, 15, { fill: '#05070c', stroke: T.line, lw: 3, sa: 0.7 });
  // sockets open at the bottom edge: WAN on the left, LAN ports from the right
  const sw = Math.min(110, pitch(visual) - 22);
  const sock = (x: number, used = false) => {
    box(g, x - sw / 2, SHELF_Y - SOCK_H, sw, SOCK_H + 2, 8, { fill: '#05070c', stroke: used ? T.alu : T.line, lw: 3, sa: used ? 0.8 : 0.6 });
    for (let k = 0; k < 4; k++) g.rect(x - sw / 2 + 14 + k * ((sw - 36) / 3), SHELF_Y - SOCK_H + 8, 6, 20);
    g.fill({ color: T.pin, alpha: 0.55 });
  };
  sock(dWanX(visual));
  for (let k = 0; k < geo.nLan; k++) sock(dLanX(visual, k), k === 0);
  if (visual === 'router-10g') {
    // SFP cage next to the WAN port
    const x = dWanX(visual) + 150;
    box(g, x - 52, SHELF_Y - 76, 104, 76, 6, { fill: '#05070c', stroke: T.alu, lw: 4, sa: 0.7 });
    g.rect(x - 38, SHELF_Y - 56, 76, 14).fill({ color: T.alu, alpha: 0.35 });
  }
  root.addChild(label('WAN', dWanX(visual), SHELF_Y - SOCK_H - 92, 34, ink, { anchor: [0.5, 0.5], a: 0.75 }));
  root.addChild(label('LAN', dLanX(visual), SHELF_Y - SOCK_H - 92, 34, ink, { anchor: [0.5, 0.5], a: 0.75 }));
  root.addChild(label(name.toUpperCase(), r.x + r.w - 70, r.y + 62, 42, ink, { anchor: [1, 0.5], a: 0.7, head: true }));
  return root;
}

// ---------------------------------------------------------------- wall plate

export function wallArt(T: Theme, isp: { id: string; name: string; downMbps: number } | null): Container {
  const root = new Container(), g = new Graphics();
  root.addChild(g);
  // drawn at design size (460 x 420) with its bottom-left corner on the plate's baseline (`WALL_Y`, under the desk), then scaled about that corner
  root.position.set(WALL_PLATE.x, WALL_Y); root.scale.set(NET_K);
  const p = { x: 0, y: -420, w: 460, h: 420 }, cx = p.x + p.w / 2;
  const [hi, lo] = T.dark ? ['#3a4560', '#252d44'] : ['#f1f4f9', '#cbd4e4'];
  const ink = T.dark ? '#dfe7ff' : '#26324f';
  box(g, p.x + 10, p.y + 16, p.w, p.h, 36, { fill: '#000000', fa: T.dark ? 0.32 : 0.14 });
  g.roundRect(p.x, p.y, p.w, p.h, 36).fill(vgrad(hi, lo)).stroke({ width: 6, color: T.line, alpha: 0.9 });
  for (const sx of [p.x + 48, p.x + p.w - 48]) { disc(g, sx, p.y + 46, 14, { fill: mix(lo, '#000000', 0.25) }); g.moveTo(sx - 8, p.y + 46).lineTo(sx + 8, p.y + 46).stroke({ width: 3, color: '#000000', alpha: 0.4 }); }
  const tier = isp ? Number(/\d+$/.exec(isp.id)?.[0] ?? 0) : 0;
  root.addChild(label(isp ? fmtMbps(isp.downMbps) : 'NO LINE', cx, p.y + 130, isp ? 116 : 76, isp ? ink : T.mute, { anchor: [0.5, 0.5], head: true, a: isp ? 1 : 0.8 }));
  if (isp) root.addChild(label(isp.name.toUpperCase(), cx, p.y + 206, 38, ink, { anchor: [0.5, 0.5], a: 0.65 }));
  for (let i = 0; i < 5; i++) disc(g, cx - 96 + i * 48, p.y + 258, 12, i < tier ? { fill: T.alu } : { stroke: T.mute, lw: 3, sa: 0.6 });
  // the jack opens at the bottom edge; the ISP line plugs in from below
  const jx = cx;
  box(g, jx - 55, -SOCK_H, 110, SOCK_H + 2, 8, { fill: '#05070c', stroke: isp ? T.alu : T.line, lw: 3, sa: isp ? 0.8 : 0.6 });
  disc(g, jx, -SOCK_H - 38, 15, { fill: '#05070c', stroke: T.line, lw: 3, sa: 0.7 });
  return root;
}

// ---------------------------------------------------------------- NIC cards

/** A PCIe NIC card on slot `i` (look = the spec's visual key): PCB, bracket, ethernet jack on the rear edge, a heatsink on the faster cards. */
export function nicArt(T: Theme, visual: string, i: number): Container {
  const root = new Container(), g = new Graphics();
  root.addChild(g);
  const r = nicRect(i, visual), y = nicY(i), jack = nicJack(i), L = NIC_LEN[visual] ?? 1500;
  const x0 = BD.x;
  const pcb = T.dark ? '#103848' : '#8fc7c2';
  box(g, x0 + 10, y - 98 + 16, L, 196, 14, { fill: '#000000', fa: 0.3 });
  box(g, x0, y - 98, L, 196, 14, { fill: pcb, stroke: T.alu, lw: 6, sa: 0.55 });
  // gold edge fingers over the slot
  for (let k = 0; k < 18; k++) g.rect(-2830 + k * 34, y - 14, 18, 28);
  g.fill({ color: T.pin, alpha: 0.85 });
  // controller chip, and the heatsink that grows with the speed
  const chip = { x: x0 + 300, y: y - 56, w: 170, h: 112 };
  box(g, chip.x, chip.y, chip.w, chip.h, 8, { fill: '#0a0f1a', stroke: T.line, lw: 4 });
  for (let k = 0; k < 4; k++) { g.rect(x0 + 520 + k * 46, y - 58, 22, 36); g.rect(x0 + 520 + k * 46, y + 22, 22, 36); }
  g.fill({ color: mix(pcb, '#000000', 0.45) });
  if (visual !== 'nic-gbe') {
    const big = visual === 'nic-40g';
    const hs = big ? { x: x0 + 560, y: y - 86, w: 820, h: 172 } : { x: x0 + 560, y: y - 76, w: 520, h: 152 };
    const metal = T.dark ? '#7d89a4' : '#b9c3d8';
    box(g, hs.x, hs.y, hs.w, hs.h, 8, { fill: metal, stroke: T.line, lw: 4 });
    for (let x = hs.x + 22; x < hs.x + hs.w - 14; x += 26) g.moveTo(x, hs.y + 10).lineTo(x, hs.y + hs.h - 10);
    g.stroke({ width: 7, color: '#000000', alpha: 0.28 });
    if (big) {
      // heat pipe to the controller, and a second small sink at the end
      g.moveTo(chip.x + chip.w, y).lineTo(hs.x, y).stroke({ width: 16, color: T.dark ? '#c4864a' : '#b4712f', cap: 'round' });
      box(g, hs.x + hs.w + 40, y - 56, 300, 112, 8, { fill: metal, stroke: T.line, lw: 4 });
      for (let x = hs.x + hs.w + 62; x < hs.x + hs.w + 330; x += 24) g.moveTo(x, y - 46).lineTo(x, y + 46);
      g.stroke({ width: 6, color: '#000000', alpha: 0.28 });
    }
  }
  // bracket on the board edge and the jack that pokes out of it (mouth faces west)
  box(g, NIC_BRACKET_X, y - 120, 30, 240, 4, { fill: T.dark ? '#aab4c9' : '#d6dce8', stroke: T.line, lw: 4 });
  portProfile(g, T, { id: `nic${i}`, kind: 'rj45', x: jack.x, y, w: jack.w, h: jack.h }, true, { wallX: IO_X, wallW: WALL_T }); // the jack, in the same side profile as the board's own
  for (const w of nicLeds(i)) disc(g, w.x, w.y, 11, { fill: '#05070c', stroke: T.line, lw: 3, sa: 0.7 });
  root.addChild(label(visual === 'nic-gbe' ? 'GbE' : visual === 'nic-10g' ? '10G' : '40G', x0 + 90, y - 50, 44, T.alu, { head: true, a: 0.85 }));
  void r;
  return root;
}

/** LED wells of a NIC jack (link, activity). */
const nicLeds = (i: number): Pt2[] => { const j = nicJack(i); return [{ x: j.x + 50, y: j.y + j.h + 30 }, { x: j.x + 112, y: j.y + j.h + 30 }]; };
const eth0Leds = (): Pt2[] => [{ x: ETH0_MOUTH.x + 70, y: -1394 }, { x: ETH0_MOUTH.x + 150, y: -1394 }];
interface Pt2 { x: number; y: number }

/** Exterior rear plate: the cut-outs and LED wells of the NIC jacks (the board's own jack is drawn by exterior.ts). */
export function nicPlateLeds(i: number): Pt2[] { return nicLeds(i); }

// ---------------------------------------------------------------- the view

type LanState = 'connected' | 'loose' | 'held';
type Light = [string | null, number];

export interface NetHit { id: string; rect: Rect; more?: Rect[] }

export class NetView {
  /** External layer (router, wall plate, ISP line, ethernet cable, jack LEDs, traffic pulses): drawn at every zoom. */
  readonly root = new Container();
  /** The ISP cable's body: it runs behind the desk, the riser and the monitor, so board.ts puts this container in the room's back layer (the desk and the monitor are drawn over it). */
  readonly behind = new Container();
  private art = new Container();
  private g = new Graphics();
  hits: NetHit[] = [];
  private T!: Theme;
  private key = '';
  private own: string[] = [];
  private snap: Snapshot | null = null;
  private vis = false;
  private router: { visual: string; name: string } | null = null;
  private hasIsp = false;
  private lan: Lane | null = null;
  private isp: Lane | null = null;
  private jacks: LanJack[] = [];
  private lanPortId: string | null = null;
  private lanState: LanState = 'loose';
  private ampDown = 0;
  private ampUp = 0;

  constructor() { this.root.addChild(this.art, this.g); }

  get visible() { return this.vis; }

  /**
   * Rebuild the static art when something it shows changed; fills the shared scene (rects, hit ids, the router drop slot, the lan cable).
   * Returns whether it rebuilt. `optPort` is the jack id the player just dropped the plug on (until the snapshot confirms it).
   */
  sync(s: Snapshot | null, T: Theme, scene: SceneInfo, lanState: LanState, optPort: string | null, force = false): boolean {
    this.T = T;
    this.snap = s;
    const net = s?.net ?? null;
    const routerInv = !!s?.inventory.some((i) => i.kind === 'router');
    const lanSnap = !!s?.cables.find((c) => c.id === 'lan')?.connected;
    const vis = !!s && netPropsVisible({ level: s.level.level, hasRouter: !!net?.router, hasIsp: !!net?.isp, routerInInventory: routerInv, lanConnected: lanSnap || lanState === 'connected' });
    const jacks: LanJack[] = [];
    if (vis && s) {
      if ((BOARD_TIERS[s.boardTier]?.features.ethernetMbps ?? 0) > 0) jacks.push({ id: 'eth0', port: 'board', rect: ETH0_RECT, mouth: [ETH0_MOUTH.x, ETH0_MOUTH.y], valid: !s.board?.burnt, slot: -1 });
      // NIC jacks are eth1, eth2, ... in PCIe slot order (the first card is eth1)
      const nics = s.devices.filter((d) => d.kind === 'nic').map((d) => ({ d, idx: Number(/\d+$/.exec(d.slot)?.[0] ?? 0) })).sort((a, b) => a.idx - b.idx);
      nics.forEach(({ d, idx }, k) => {
        const j = nicJack(idx);
        jacks.push({ id: `eth${k + 1}`, port: d.id, rect: j, mouth: [j.x, nicY(idx)], valid: !d.burnt, slot: idx });
      });
    }
    let portId: string | null = null;
    if (lanState === 'connected' && net) {
      if (net.port.kind === 'board') portId = 'eth0';
      else if (net.port.kind === 'nic') portId = jacks.find((j) => j.port === net.port.deviceId)?.id ?? null;
    }
    if (lanState === 'connected' && !portId) portId = (optPort && jacks.some((j) => j.id === optPort) ? optPort : jacks[0]?.id) ?? null;
    const rv = net?.router ? net.router.visual : null;
    const key = [T.dark, vis, rv, net?.router?.name, net?.isp?.id, lanState, portId, jacks.map((j) => j.id + j.valid).join(',')].join('|');
    this.vis = vis;
    if (!force && key === this.key) return false;
    this.key = key;
    for (const id of this.own) { scene.rects.delete(id); scene.interactive.delete(id); }
    scene.slots.delete('router');
    this.own = [];
    clear(this.art);
    clear(this.behind);
    this.hits = [];
    this.lan = null; this.isp = null; this.jacks = jacks; this.lanPortId = portId; this.lanState = lanState;
    this.router = rv ? { visual: rv, name: net!.router!.name } : null;
    this.hasIsp = !!net?.isp;
    scene.lan = null;
    if (!vis) return true;

    const g = new Graphics();
    this.art.addChild(g);
    const accent = T.alu;
    const reg = (id: string, rect: Rect) => { scene.rects.set(id, rect); scene.interactive.add(id); this.own.push(id); };

    // shelf: always, so the spot reads as a place; the empty spot is dashed and is the drop target of a router item
    g.roundRect(ROUTER_SPOT.x - 30, SHELF_Y + 2, ROUTER_SPOT.w + 90, 16, 8).fill({ color: T.mute, alpha: 0.4 });
    scene.slots.set('router', ROUTER_SPOT);
    const rr = this.router ? routerRect(this.router.visual) : ROUTER_SPOT;
    if (this.router) this.art.addChild(routerArt(T, this.router.visual, this.router.name));
    else {
      const r = ROUTER_SPOT;
      dashed(g, [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y]], 40, 30);
      g.stroke({ width: 10, color: T.mute, alpha: 0.7 });
      this.art.addChild(label('ROUTER', r.x + r.w / 2, r.y + r.h / 2, 170, T.mute, { anchor: [0.5, 0.5], head: true, a: 0.75 }));
    }
    reg('router', rr);
    this.hits.push({ id: 'router', rect: rr });
    this.art.addChild(wallArt(T, net?.isp ?? null));
    reg('wall', WALL_PLATE);

    const cable = (pts: Pt[], w: number, col: string, a = 1, gg: Graphics = g) => {
      const line = (dx = 0, dy = 0) => { gg.moveTo(pts[0]![0] + dx, pts[0]![1] + dy); for (let i = 1; i < pts.length; i++) gg.lineTo(pts[i]![0] + dx, pts[i]![1] + dy); };
      line(8, 12); gg.stroke({ width: w + 6, color: '#000000', alpha: 0.28, cap: 'round', join: 'round' });
      line(); gg.stroke({ width: w, color: T.dark ? '#171d29' : '#2a313d', cap: 'round', join: 'round', alpha: a });
      line(); gg.stroke({ width: w * 0.28, color: col, alpha: 0.5 * a, cap: 'round', join: 'round' });
    };

    // the ISP line: from the wall jack under the desk down a little, along, and up behind the desk, the riser and the monitor to the router's WAN socket
    // (a thin lead; the body is in `behind`, under the desk and the monitor, the plugs here)
    if (this.router && net?.isp) {
      const wx = WALL_JACK.x, rx = wanX(this.router.visual), y1w = WALL_Y + PLUG_L - 10, y1r = SHELF_Y + PLUG_L - 10;
      const route: Pt[] = [[wx, y1w], [wx, ISP_ROW_Y], [rx, ISP_ROW_Y], [rx, y1r]];
      this.isp = mkLane(roundedPath(route, 120));
      const gb = new Graphics();
      this.behind.addChild(gb);
      cable(this.isp.pts, 26, T.mute, 1, gb);
      drawPlug(g, T, { x: wx, y: WALL_Y, dx: 0, dy: 1, w: 80, l: PLUG_L, pins: [1, 1] }, T.mute, false, 'rj45');
      drawPlug(g, T, { x: rx, y: SHELF_Y, dx: 0, dy: 1, w: 80, l: PLUG_L, pins: [1, 1] }, T.mute, false, 'rj45');
    }

    // the ethernet cable: its router end is always seated; the PC end is on a jack (connected), at rest (loose) or in the hand (held)
    if (this.router) {
      const lx = lanX(this.router.visual), tail: Pt = [lx, SHELF_Y + PLUG_L - 10];
      drawPlug(g, T, { x: lx, y: SHELF_Y, dx: 0, dy: 1, w: PLUG_W, l: PLUG_L, pins: [1, 1] }, accent, false, 'rj45');
      const restPlug: Plug = { x: ROUTER_EAST + 320, y: CABLE_ROW_Y + 60, dx: -1, dy: 0, w: PLUG_W, l: PLUG_L, pins: [1, 1] };
      let plug: Rect = plugRect(restPlug), seated: Pt | null = null;
      const jack = lanState === 'connected' ? jacks.find((j) => j.id === portId) : undefined;
      if (lanState === 'connected' && jack) {
        const [mx, my] = jack.mouth;
        const route: Pt[] = [tail, [lx, CABLE_ROW_Y + 60], [LAN_TRUNK_X, CABLE_ROW_Y + 60], [LAN_TRUNK_X, my], [mx - PLUG_L + 8, my]];
        this.lan = mkLane(roundedPath(route, 100));
        cable(this.lan.pts, 38, accent);
        const pl: Plug = { x: mx, y: my, dx: -1, dy: 0, w: PLUG_W, l: PLUG_L, pins: [1, 1] };
        drawPlug(g, T, pl, accent, false, 'rj45');
        plug = plugRect(pl); seated = [mx, my];
        const more = laneRects(this.lan, 36);
        this.hits.push({ id: 'cable.lan', rect: pad(plug, 30), more });
      } else if (lanState === 'loose') {
        const route: Pt[] = [tail, [lx, CABLE_ROW_Y + 60], [restPlug.x - restPlug.l + 8, CABLE_ROW_Y + 60]];
        const stub = mkLane(roundedPath(route, 70));
        cable(stub.pts, 38, accent);
        drawPlug(g, T, restPlug, accent, false, 'rj45');
        this.hits.push({ id: 'cable.lan', rect: pad(plug, 30), more: laneRects(stub, 36) });
      }
      reg('cable.lan', plug);
      scene.lan = { connected: lanState === 'connected' && !!jack, held: lanState === 'held', plug, anchor: [lx, SHELF_Y + PLUG_L - 10], anchorDir: [0, 1], seated, jacks, port: jack?.id ?? null };
    }
    for (const j of jacks) { reg(j.id, j.rect); this.hits.push({ id: j.id, rect: j.rect }); }
    this.hits.push({ id: 'wall', rect: WALL_PLATE });
    return true;
  }

  /** Live part: LEDs and traffic pulses. `gt` is game time in ms, `gdt` game seconds since the last frame (both 0-step when paused). */
  frame(gt: number, gdt: number) {
    const g = this.g;
    g.clear();
    const s = this.snap;
    if (!s || !this.vis || !this.T) return;
    const T = this.T, net = s.net;
    const on = s.powered && !s.power.off && !s.power.tripped && !s.board?.burnt;
    const connected = this.lanState === 'connected' && !!this.lan;
    const linked = connected && on && (net.state === 'link-up' || net.state === 'saturated');
    const hasDown = linked && net.transfers.some((t) => t.dir === 'down'), hasUp = linked && net.transfers.some((t) => t.dir === 'up');
    const k = 1 - Math.exp(-gdt * 3.5);
    this.ampDown += ((hasDown ? 1 : 0) - this.ampDown) * k; this.ampUp += ((hasUp ? 1 : 0) - this.ampUp) * k;
    if (this.ampDown < 0.003 && !hasDown) this.ampDown = 0;
    if (this.ampUp < 0.003 && !hasUp) this.ampUp = 0;
    const flick = (seed: number) => (Math.sin(gt * 0.031 + seed) + Math.sin(gt * 0.0113 + seed * 2.3) > 0.2 ? 1 : 0.18);
    const busy = linked && net.transfers.length > 0;

    // link light of a jack or of the router's LAN socket: dark without a cable (or without power), green when up, pulsing when
    // saturated, amber when the link is down or the OS is not up
    let link: Light = [null, 0];
    if (connected && on) {
      if (net.state === 'link-up') link = [T.st, 1];
      else if (net.state === 'saturated') link = [T.st, 0.55 + 0.45 * Math.sin(gt * 0.009)];
      else link = [T.ld, 0.95];
    }
    const act: Light = busy ? [T.alu, flick(1)] : [null, 0];
    const led = (p: Pt2, l: Light, r = 14) => {
      if (!l[0] || l[1] <= 0.01) return;
      g.circle(p.x, p.y, r * 2.6).fill({ color: l[0], alpha: 0.2 * l[1] });
      g.circle(p.x, p.y, r).fill({ color: l[0], alpha: 0.35 + 0.65 * l[1] });
    };
    // jack LEDs: the board jack or the card the cable is in; every other jack stays dark
    const jack = this.jacks.find((j) => j.id === this.lanPortId);
    if (jack) {
      const pts = jack.slot < 0 ? eth0Leds() : nicLeds(jack.slot);
      led(pts[0]!, link, 13); led(pts[1]!, busy ? [T.ld, flick(2)] : [null, 0], 13);
    }
    // router: own power, always lit; the WAN light follows the plan; LAN follows the link; activity follows the traffic
    if (this.router) {
      const r = routerRect(this.router.visual), v = this.router.visual;
      led(hdrLed(r, 0), [T.st, 1]);
      led(hdrLed(r, 1), act);
      led(sockLed(wanX(v)), this.hasIsp ? [T.st, busy ? 0.6 + 0.4 * flick(3) : 0.85] : [null, 0]);
      led(sockLed(lanX(v)), link);
    }
    // wall jack light: lit once there is a plan
    if (this.hasIsp) led({ x: WALL_JACK.x, y: WALL_Y - (SOCK_H + 38) * NET_K }, [T.st, 0.85]);

    // traffic pulses: downloads run router -> PC, uploads PC -> router; speed and density follow the direction's bandwidth
    const bw = net.bandwidth;
    if (this.lan) {
      if (this.ampDown > 0) this.pulses(this.lan, 1, bw.downMbps, this.ampDown, T.alu, gt, 0);
      if (this.ampUp > 0) this.pulses(this.lan, -1, bw.upMbps, this.ampUp, T.mul, gt, 0.5);
    }
    if (this.isp) {
      // the lead runs behind the desk, the riser and the monitor: a pulse there is not drawn
      if (this.ampDown > 0) this.pulses(this.isp, 1, bw.downMbps, this.ampDown, T.alu, gt, 0, hiddenBehind);
      if (this.ampUp > 0) this.pulses(this.isp, -1, bw.upMbps, this.ampUp, T.mul, gt, 0.5, hiddenBehind);
    }
  }

  private pulses(lane: Lane, dir: 1 | -1, mbps: number, amp: number, col: string, gt: number, phase: number, hidden?: (x: number, y: number) => boolean) {
    const g = this.g;
    const lvl = clamp((Math.log10(Math.max(mbps, 10)) - 1) / 3.6);
    const v = 450 + 2300 * lvl, spacing = 640 - 400 * lvl;
    const off = (((gt / 1000) * v + phase * spacing) % spacing + spacing) % spacing;
    for (let s = off; s < lane.len; s += spacing) {
      const e = clamp(Math.min(s, lane.len - s) / 260);
      const [x, y] = pointAt(lane, dir > 0 ? s : lane.len - s);
      if (hidden?.(x, y)) continue;
      const a = amp * e;
      g.circle(x, y, 44).fill({ color: col, alpha: 0.16 * a });
      g.circle(x, y, 20).fill({ color: col, alpha: 0.9 * a });
    }
  }
}

/** Whether a point is behind the monitor, the riser or the desk slab (where the ISP lead is out of sight). */
const hiddenBehind = (x: number, y: number) => {
  const inR = (r: Rect) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
  return inR(MONITOR) || inR(RISER) || (y > DESK_Y - 20 && y < DESK_Y + DESK_SLAB + 20);
};

const pad = (r: Rect, e: number): Rect => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });
