import { Container, Graphics } from 'pixi.js';
import { box, disc, label, lgrad, mix, rgrad } from '@/core/render/ink';
import { TIER_GEO, geoOf } from '@/features/board/render/layout/boardlayout';
import {
  BASE_BAYS, BAY, BAY_CELLS, BR, CASE_BD, CELL_H, CELL_PITCH, CASE, CASE_GLASS, CASE_IN, CASE_LEDS, CASE_PANEL, FAN_HUB, FAN_SLOT, FAN_W, FRONT_FAN_COUNT, GEO, HUB_POWER_Y, LAYOUT_CASE, LAYOUT_TIER, PC_POWER, POWER_BTN, POWER_LEAD_X, PSU, PSU_FACE_X, PSU_REAR_FAN, REAR_FAN, REAR_FAN_FITTED, SATA_LINK, TOP_FANS, FAN_LEN, WALL_T, MINI_FAN_Y, RAD_TANK, RAD_ROOM,
  sataPort, gutterTieYs, PORT_Y, PSU_PORTS, type Rect,
} from '@/features/board/render/layout/layout';
import { driveScale } from '@/features/storage/render/drives';
import { acInlet } from '@/features/board/render/layout/ports';
import { mkLane, roundedPath, type Lane, type Pt } from '@/features/board/render/wiring/routes';
import { CASE_CUTS, CASE_KIND, WINDOW_CUTS, caseWindow, hexes, isCut, outline, pillar, showPillars, type CaseKind } from '@/features/room/render/shell/casedecor';
import type { Theme } from '@/core/render/theme';
import { paintCable, paintTie, sleeveOf, tiePoints } from '@/core/render/cable';

// The PC case: a thin low-contrast chassis around the board and the PSU, a quiet glass side, the top panel (brand, vents,
// status lights, the power button sits on it) and the SATA drive cage with the cables that serve it. Everything here is static
// (baked with the device layer); the lights and the drives are live (Live, props.ts).

export const wallTone = (T: Theme) => mix(T.bg, T.dark ? T.line : '#ffffff', T.dark ? 0.3 : 0.6);
/** What the player's case is called on its top panel, and how many vents it has: the cases differ at a glance (docs/render/board.md "Cases"). */
export const CASE_LOOK = [
  { tag: 'MINI', vents: 7, trim: 0 }, { tag: 'MICRO', vents: 11, trim: 0 }, { tag: 'MID', vents: 16, trim: 1 }, { tag: 'FULL', vents: 22, trim: 2 },
] as const;
export const cavityTone = (T: Theme) => (T.dark ? mix(T.bg, '#000000', 0.45) : mix(T.bg, T.mute, 0.1));
const edgeTone = (T: Theme) => mix(T.line, T.mute, T.dark ? 0.15 : 0.55);

/** The kind of the case being drawn (`LAYOUT_CASE`): the same one the exterior reads (`CASE_KIND`). */
export const kindNow = (): CaseKind => CASE_KIND[LAYOUT_CASE] ?? 'gamer';

/**
 * The paint inside each kind of case: bare cream steel in the OEM tower, black powder coat in the matte case, blue-black with a violet
 * edge in the gaming case, near-black with a silver edge in the showcase. `wall` is the sheet metal, `cav` the dark behind the board.
 */
export function caseInterior(T: Theme, kind: CaseKind) {
  const wall = wallTone(T), cav = cavityTone(T), edge = edgeTone(T);
  switch (kind) {
    case 'oem': return { wall: mix(wall, '#d9d0b0', 0.7), cav: mix(cav, '#9c9575', 0.55), edge: mix(edge, '#6b6548', 0.6) };
    case 'matte': return { wall: mix(wall, '#0a0b0e', 0.6), cav: mix(cav, '#000000', 0.45), edge: mix(edge, '#2a2d36', 0.4) };
    case 'gamer': return { wall: mix(wall, '#1b2236', 0.5), cav: mix(cav, '#0a0f1c', 0.5), edge: mix(edge, '#4b5a8a', 0.35) };
    default: return { wall: mix(wall, '#040405', 0.6), cav: mix(cav, '#000000', 0.5), edge: mix(edge, '#4a4d56', 0.5) };
  }
}

/** The chassis behind the board: walls, top panel, cavity, PSU compartment, vents, feet. */
export function caseBack(T: Theme): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const look = CASE_LOOK[LAYOUT_CASE] ?? CASE_LOOK[2];
  const kind = kindNow(), { wall, cav, edge } = caseInterior(T, kind);
  const c = CASE, i = CASE_IN, p = CASE_PANEL;
  // feet
  for (const fx of [c.x + 300, c.x + c.w - 700]) box(g, fx, c.y + c.h - 30, 400, 130, 30, { fill: mix(wall, T.bg, 0.4), stroke: edge, lw: 6, sa: 0.7 });
  // soft shadow and body
  const bc = isCut(CASE_CUTS[kind]) ? CASE_CUTS[kind] : undefined; // the showcase's body is chamfered, inside as outside
  outline(g, c.x + 20, c.y + 34, c.w, c.h, 110, bc).fill({ color: '#000000', alpha: T.dark ? 0.3 : 0.12 });
  outline(g, c.x, c.y, c.w, c.h, 110, bc).fill(wall).stroke({ width: 10, color: edge, alpha: 0.9 });
  // top panel
  g.rect(p.x + 40, p.y + p.h - 4, p.w - 80, 8).fill({ color: edge, alpha: 0.7 });
  g.rect(p.x + 40, p.y + 8, p.w - 80, 5).fill({ color: '#ffffff', alpha: T.dark ? 0.06 : 0.5 });
  // vents on the panel: a quiet row of slots
  for (let k = 0; k < look.vents; k++) box(g, -1900 + k * 70, p.y + 120, 26, 170, 13, { fill: cav, fa: 0.9 });
  if (kind === 'gamer' || kind === 'show') g.rect(p.x + 40, p.y + p.h - 12, p.w - 80, 5).fill({ color: kind === 'gamer' ? T.mul : T.alu, alpha: 0.5 });
  // cavity (behind the glass) and the PSU compartment
  g.roundRect(i.x, i.y, i.w, i.h, 36).fill(lgrad(mix(cav, '#ffffff', T.dark ? 0.07 : 0.12), mix(cav, '#000000', T.dark ? 0.3 : 0.1))).stroke({ width: 6, color: edge, alpha: 0.8 });
  // the back panel's stamped ribs, and an inner shadow where the walls turn in (the cavity is a box, not a flat sheet)
  for (let y = i.y + 300; y < i.y + i.h - 200; y += 380) g.moveTo(i.x + 30, y).lineTo(i.x + i.w - 30, y);
  g.stroke({ width: 5, color: '#000000', alpha: T.dark ? 0.14 : 0.07 });
  for (let y = i.y + 304; y < i.y + i.h - 200; y += 380) g.moveTo(i.x + 30, y).lineTo(i.x + i.w - 30, y);
  g.stroke({ width: 3, color: '#ffffff', alpha: T.dark ? 0.04 : 0.3 });
  for (let k = 0; k < 7; k++) box(g, i.x + 8 + k * 14, i.y + 8 + k * 14, i.w - 16 - k * 28, i.h - 16 - k * 28, 30, { stroke: '#000000', lw: 16, sa: (T.dark ? 0.1 : 0.045) * (1 - k / 7) });
  const psuTop = PSU.y - 200;
  g.rect(i.x + 8, psuTop, i.w - 16, i.y + i.h - psuTop - 8).fill({ color: mix(cav, T.bg, 0.3), alpha: 0.5 });
  g.moveTo(i.x + 8, psuTop).lineTo(i.x + i.w - 8, psuTop).stroke({ width: 5, color: edge, alpha: 0.55 });
  // intake slots in the floor
  for (let k = 0; k < 14 && -2400 + k * 190 < i.x + i.w - 400; k++) box(g, -2400 + k * 190, i.y + i.h + 30, 110, 22, 11, { fill: cav, fa: 0.85 });
  // the motherboard tray: a plate a little bigger than the board it carries, perforated, with a brass standoff at every mounting hole of
  // every form factor the case takes (the installed board's holes sit over its own: they line up by construction) and a cable cut-out
  {
    const BD = CASE_BD, x0 = Math.max(BD.x - 110, i.x + 12), tr = { x: x0, y: BD.y - 110, w: BD.x + BD.w + 110 - x0, h: BD.h + 220 }, tone = mix(cav, wall, T.dark ? 0.32 : 0.45);
    box(g, tr.x + 14, tr.y + 24, tr.w, tr.h, 120, { fill: '#000000', fa: T.dark ? 0.28 : 0.1 }); // the tray stands off the back panel
    g.roundRect(tr.x, tr.y, tr.w, tr.h, 120).fill(lgrad(mix(tone, '#ffffff', T.dark ? 0.08 : 0.16), mix(tone, '#000000', T.dark ? 0.18 : 0.08))).stroke({ width: 6, color: edge, alpha: 0.55 });
    g.moveTo(tr.x + 110, tr.y + 8).lineTo(tr.x + tr.w - 110, tr.y + 8).stroke({ width: 5, color: '#ffffff', alpha: T.dark ? 0.1 : 0.4, cap: 'round' });
    // the punched rows: round holes, a honeycomb in the showcase
    if (kind === 'show') {
      hexes(g, { x: tr.x + 60, y: tr.y + 50, w: tr.w - 120, h: 150 }, 34, 8);
      hexes(g, { x: tr.x + 60, y: tr.y + tr.h - 200, w: tr.w - 120, h: 150 }, 34, 8);
    } else {
      for (let x = tr.x + 90; x < tr.x + tr.w - 60; x += 90) for (let y = tr.y + 60; y < tr.y + 190; y += 80) g.circle(x, y, 14);
      for (let x = tr.x + 90; x < tr.x + tr.w - 60; x += 90) for (let y = tr.y + tr.h - 190; y < tr.y + tr.h - 50; y += 80) g.circle(x, y, 14);
    }
    g.fill({ color: cav, alpha: 0.9 });
    // cable cut-outs beside the 24-pin and over the 8-pin (the cables come through them): slanted in the gaming case, rimmed in rubber in the matte one
    const gx = BD.x + BD.w;
    if (kind === 'gamer') g.poly([gx + 80, -1750, gx + 90, -1750, gx + 30, -250, gx + 20, -250]).fill(cav).stroke({ width: 4, color: edge, alpha: 0.6 });
    else box(g, gx + 20, -1750, 70, 1500, 35, { fill: cav, stroke: edge, lw: 4, sa: 0.6 });
    if (kind === 'matte') box(g, gx + 12, -1758, 86, 1516, 42, { stroke: '#000000', lw: 10, sa: 0.75 });
    for (const [x, y] of standoffs()) standoff(g, T, x, y, wall, edge);
    cableDuct(g, T, cav, wall, edge);
  }
  frontFans(g, T, cav, wall, edge);
  rearWall(g, T, cav, wall, edge);
  topFans(g, T, cav, wall, edge);
  fanHub(root, g, T, cav, wall, edge);
  if (kind === 'show') { // the silver pillars either side of the glass, as on the outside (`exterior.ts`)
    const hi = '#444851', lo = mix('#444851', cav, 0.55), acc = T.br;
    for (const r of showPillars(caseWindow(kind))) {
      pillar(g, r, hi, lo, edge);
      const px = r.x + r.w / 2 + r.w * 0.2, sh = r.h - 520; // the same lit slot as outside
      g.roundRect(px - 24, r.y + 260, 48, sh, 24).fill({ color: acc, alpha: 0.18 });
      g.roundRect(px - 8, r.y + 270, 16, sh - 20, 8).fill({ color: '#04060a' }).stroke({ width: 3, color: hi, alpha: 0.5 });
      g.roundRect(px - 4, r.y + 280, 8, sh - 40, 4).fill(acc);
    }
  }
  // labels
  root.addChild(label('DISK', CASE_LEDS.disk, p.y + 340, 34, T.mute, { anchor: [0.5, 0.5], a: 0.85 }));
  for (const [t, x] of [['ON', CASE_LEDS.on], ['OFF', CASE_LEDS.off], ['ERR', CASE_LEDS.err]] as const) root.addChild(label(t, x, p.y + 340, 34, T.mute, { anchor: [0.5, 0.5], a: 0.85 }));
  void POWER_BTN; void LAYOUT_TIER;
  return root;
}

/**
 * The cable duct beside the board: a channel up the gutter from the PSU's sockets to the top edge, a lane for the PSU leads (visual only: a plate
 * of the tray's tone, a rail down each side) with a clip base at every height the leads are tied (`gutterTieYs`: the ties are drawn over the leads).
 * Its top turns west as a gutter along the top of the case where the 8-pin lead runs.
 */
function cableDuct(g: Graphics, T: Theme, cav: string, wall: string, edge: string) {
  const xs = [...PSU_PORTS.pcie, PSU_PORTS.atx, PSU_PORTS.cpu], x0 = Math.min(...xs) - 150, x1 = Math.max(...xs) + 150, y0 = GEO.bd.y - 250, y1 = PORT_Y - 30;
  const tone = mix(cav, wall, T.dark ? 0.22 : 0.4);
  box(g, x0 + 10, y0 + 16, x1 - x0, y1 - y0, 40, { fill: '#000000', fa: T.dark ? 0.26 : 0.1 });
  box(g, x0, y0, x1 - x0, y1 - y0, 40, { fill: tone, stroke: edge, lw: 5, sa: 0.6 });
  for (const rx of [x0 + 26, x1 - 38]) g.rect(rx, y0 + 40, 12, y1 - y0 - 80).fill({ color: edge, alpha: 0.5 });
  // the clip bases: a plate across the duct with its screws, under each tie
  for (const y of gutterTieYs()) {
    if (y < y0 + 200 || y > y1 - 300) continue;
    box(g, x0 + 20, y - 34, x1 - x0 - 40, 68, 14, { fill: mix(tone, '#000000', 0.25), stroke: edge, lw: 4, sa: 0.7 });
    for (const sx of [x0 + 60, x1 - 60]) disc(g, sx, y, 14, { fill: mix(wall, T.bg, 0.5), stroke: edge, lw: 3, sa: 0.7 });
  }
}

/**
 * The front intake fans, seen edge-on (the side panel looks along the board, so a front fan is a thin vertical module: its frame, the
 * ring of blade tips and a light strip), in front of the drive cage, and the perforated front panel beyond them. The sim's count of one
 * size of fan (`FRONT_FAN_COUNT`, `FAN_LEN`), stacked from under the top, a radiator's end tank under it; the Mini's stack starts under the bay
 * covers on its face.
 */
export function frontFanRects(): Rect[] {
  const gl = CASE_GLASS, east = gl.x + gl.w, n = FRONT_FAN_COUNT[LAYOUT_CASE] ?? 1, gap = 20;
  const y0 = LAYOUT_CASE === 0 ? CASE.y + MINI_FAN_Y : CASE_IN.y + 40 + RAD_TANK;
  const w = FAN_W, x = east - 170 - 20 - w;
  return Array.from({ length: n }, (_, k) => ({ x, y: y0 + k * (FAN_LEN + gap), w, h: FAN_LEN }));
}

function frontFans(g: Graphics, T: Theme, cav: string, wall: string, edge: string) {
  const gl = CASE_GLASS, east = gl.x + gl.w;
  // front panel: a perforated wall along the east side of the glass
  const fp = { x: east - 170, y: gl.y + 60, w: 130, h: gl.h - 120 };
  box(g, fp.x, fp.y, fp.w, fp.h, 50, { fill: mix(cav, wall, 0.15), stroke: edge, lw: 5, sa: 0.5 });
  for (let yy = fp.y + 60; yy < fp.y + fp.h - 40; yy += 70) for (let xx = fp.x + 60; xx < fp.x + fp.w - 40; xx += 70) g.circle(xx, yy, 14);
  g.fill({ color: cav, alpha: 0.95 });
  for (const r of frontFanRects()) edgeFan(g, T, r, true, wall, edge);
}

export interface FanMount {
  /** The sim's mount id (`caseMounts` in the sim's specs): `front0..`, `top0..`, `rear`. A radiator's slot is `rad-<id>`, the fan's cable `fan:<id>`. */
  id: string;
  side: 'front' | 'top' | 'rear';
  rect: Rect;
}

/** Every fan mount of the case, in the sim's order (front, top, rear): the same order as `fanStubs` and `hubHeaders`. */
export function fanMounts(): FanMount[] {
  return [
    ...frontFanRects().map((rect, k) => ({ id: `front${k}`, side: 'front' as const, rect })),
    ...TOP_FANS.map((rect, k) => ({ id: `top${k}`, side: 'top' as const, rect })),
    ...(REAR_FAN_FITTED ? [{ id: 'rear', side: 'rear' as const, rect: REAR_FAN }] : []),
  ];
}

/**
 * What a radiator on a side of the case covers: every fan mount of that side, as one mount (`id` is the side, `rect` the box round all of them).
 * Null when the case has no mount there. The sim's slot is `rad-<side>`; `ids` are the mounts it takes the fans of, in order along the side.
 */
export function radiatorSpan(side: 'front' | 'top'): (FanMount & { ids: string[] }) | null {
  const ms = fanMounts().filter((m) => m.side === side);
  if (ms.length === 0) return null;
  const x0 = Math.min(...ms.map((m) => m.rect.x)), y0 = Math.min(...ms.map((m) => m.rect.y));
  const x1 = Math.max(...ms.map((m) => m.rect.x + m.rect.w)), y1 = Math.max(...ms.map((m) => m.rect.y + m.rect.h));
  return { id: side, side, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, ids: ms.map((m) => m.id) };
}

/**
 * The room a radiator takes on a side: the box round that side's fans, grown by an end tank past each end (`RAD_TANK`) and by the room inboard
 * of the fans (`RAD_ROOM`). A radiator's drop target. Null when the case has no mount there.
 */
export function radiatorBay(side: 'front' | 'top'): Rect | null {
  const r = radiatorSpan(side)?.rect;
  if (!r) return null;
  return side === 'top' ? { x: r.x - RAD_TANK, y: r.y, w: r.w + 2 * RAD_TANK, h: r.h + RAD_ROOM } : { x: r.x - RAD_ROOM, y: r.y - RAD_TANK, w: r.w + RAD_ROOM, h: r.h + 2 * RAD_TANK };
}

/** Where each case fan's cable leaves it: a short stub into the gap beside the fan (front fans below, top fans east, the rear fan below), that goes behind the tray. */
export function fanStubs(): { x: number; y: number; dx: number; dy: number }[] {
  return [
    ...frontFanRects().map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h, dx: 0, dy: 1 })),
    ...TOP_FANS.map((r) => ({ x: r.x + r.w, y: r.y + r.h / 2, dx: 1, dy: 0 })),
    ...(REAR_FAN_FITTED ? [{ x: REAR_FAN.x + REAR_FAN.w / 2, y: REAR_FAN.y + REAR_FAN.h, dx: 0, dy: 1 }] : []),
  ];
}

/** The hub's fan headers, left to right along its top edge (one per case fan). */
export function hubHeaders(): { x: number; y: number }[] {
  const n = fanStubs().length, h = FAN_HUB, pitch = Math.min(130, (h.w - 300) / Math.max(1, n - 1));
  return Array.from({ length: n }, (_, i) => ({ x: h.x + h.w - 100 - (n - 1 - i) * pitch, y: h.y }));
}

const plugTone = (T: Theme) => (T.dark ? '#1b2230' : '#2c3442');

/** The fan hub in the basement (west of its drive cage), the stubs of the fans' cables and the hub's cables up into the slot in the tray. */
function fanHub(root: Container, g: Graphics, T: Theme, cav: string, wall: string, edge: string) {
  const h = FAN_HUB, sl = FAN_SLOT, pcb = mix(cav, wall, 0.25);
  // the fans' cable stubs: a plug on the fan, a short sleeve into the gap, where it goes behind the tray
  for (const f of fanStubs()) {
    const x1 = f.x + f.dx * 74, y1 = f.y + f.dy * 74;
    paintCable(g, T, [[f.x, f.y], [x1, y1]], { w: 22, accent: T.mul });
    const pw = f.dx ? 40 : 48, ph = f.dx ? 48 : 40;
    box(g, f.x - (f.dx ? 6 : pw / 2), f.y - (f.dy ? 6 : ph / 2), pw, ph, 6, { fill: plugTone(T), stroke: T.mul, lw: 3, sa: 0.8 });
    disc(g, x1 + f.dx * 8, y1 + f.dy * 8, 12, { fill: '#05070b', stroke: edge, lw: 3, sa: 0.7 });
  }
  // the slot in the tray the hub's cables go through
  box(g, sl.x, sl.y, sl.w, sl.h, 30, { fill: '#05070b', stroke: edge, lw: 5, sa: 0.7 });
  // the board: a substrate with its mounting screws, the controller, the fan headers, the power plug and the input header
  box(g, h.x + 14, h.y + 20, h.w, h.h, 22, { fill: '#000000', fa: T.dark ? 0.3 : 0.12 });
  box(g, h.x, h.y, h.w, h.h, 22, { fill: pcb, stroke: edge, lw: 6, sa: 0.85 });
  box(g, h.x + 14, h.y + 14, h.w - 28, h.h - 28, 16, { stroke: edge, lw: 3, sa: 0.4 });
  for (const [x, y] of [[h.x + 36, h.y + 36], [h.x + h.w - 36, h.y + 36], [h.x + 36, h.y + h.h - 36], [h.x + h.w - 36, h.y + h.h - 36]] as const) disc(g, x, y, 14, { fill: mix(wall, T.bg, 0.5), stroke: edge, lw: 3, sa: 0.7 });
  const mcu = { x: h.x + h.w / 2 - 80, y: h.y + 190, w: 160, h: 160 };
  for (let k = 0; k < 6; k++) { const o = mcu.x + 22 + k * 24; g.rect(o - 4, mcu.y - 12, 8, 14).rect(o - 4, mcu.y + mcu.h - 2, 8, 14); }
  for (let k = 0; k < 6; k++) { const o = mcu.y + 22 + k * 24; g.rect(mcu.x - 12, o - 4, 14, 8).rect(mcu.x + mcu.w - 2, o - 4, 14, 8); }
  g.fill({ color: T.pin, alpha: 0.55 });
  box(g, mcu.x, mcu.y, mcu.w, mcu.h, 8, { fill: '#05070b', stroke: T.mul, lw: 4, sa: 0.6 });
  root.addChild(label('MCU', mcu.x + mcu.w / 2, mcu.y + mcu.h / 2, 40, T.mul, { head: true, anchor: [0.5, 0.5], a: 0.6 }));
  hubHeaders().forEach((p) => {
    box(g, p.x - 40, p.y + 8, 80, 44, 6, { fill: '#05070b', stroke: edge, lw: 3, sa: 0.8 });
    for (let k = 0; k < 4; k++) g.rect(p.x - 31 + k * 20, p.y + 22, 10, 16);
    g.fill({ color: T.pin, alpha: 0.7 });
    // (its cable, a plug on the header and a sleeve up into the slot, is live: `fancords.ts`)
  });
  // the input header (the cable from the board's SYS_FAN header) and the power plug on the west edge (from the PSU's east face)
  box(g, h.x + 40, h.y + 8, 100, 44, 6, { fill: '#05070b', stroke: T.mul, lw: 3, sa: 0.7 });
  for (let k = 0; k < 4; k++) g.rect(h.x + 52 + k * 20, h.y + 22, 10, 16);
  g.fill({ color: T.pin, alpha: 0.7 });
  const py = HUB_POWER_Y, x0 = PSU_FACE_X;
  paintCable(g, T, [[x0 + 6, py], [h.x - 20, py]], { w: 30, accent: T.ld });
  box(g, x0 - 14, py - 46, 36, 92, 8, { fill: '#05070b', stroke: T.ld, lw: 4, sa: 0.6 }); // the PSU's second socket
  box(g, h.x - 56, py - 50, 64, 100, 8, { fill: plugTone(T), stroke: T.ld, lw: 4, sa: 0.85 });
  // the lighting side: three addressable-LED outputs along the bottom edge and a USB header, a few passives round the controller
  for (let k = 0; k < 3; k++) {
    const ax = h.x + 200 + k * 180, ay = h.y + h.h - 130;
    box(g, ax, ay, 150, 56, 6, { fill: '#05070b', stroke: edge, lw: 3, sa: 0.8 });
    for (let q = 0; q < 3; q++) g.rect(ax + 22 + q * 44, ay + 20, 12, 18);
    g.fill({ color: T.pin, alpha: 0.7 });
    root.addChild(label(`ARGB${k + 1}`, ax + 75, ay + 84, 24, T.mute, { anchor: [0.5, 0.5], a: 0.7 }));
  }
  const ux = h.x + h.w - 380, uy = h.y + h.h - 150;
  box(g, ux, uy, 280, 84, 6, { fill: '#05070b', stroke: edge, lw: 3, sa: 0.8 });
  for (let q = 0; q < 5; q++) { g.rect(ux + 22 + q * 48, uy + 18, 14, 18); g.rect(ux + 22 + q * 48, uy + 48, 14, 18); }
  g.fill({ color: T.pin, alpha: 0.7 });
  root.addChild(label('USB 2.0', ux + 140, uy - 24, 24, T.mute, { anchor: [0.5, 0.5], a: 0.7 }));
  for (let k = 0; k < 5; k++) { g.rect(mcu.x - 260 + k * 50, mcu.y + 40, 30, 18); g.rect(mcu.x + mcu.w + 120 + k * 50, mcu.y + 100, 30, 18); }
  g.fill({ color: plugTone(T), alpha: 0.9 });
  for (let k = 0; k < 5; k++) { g.rect(mcu.x - 260 + k * 50, mcu.y + 40, 8, 18).rect(mcu.x - 238 + k * 50, mcu.y + 40, 8, 18); g.rect(mcu.x + mcu.w + 120 + k * 50, mcu.y + 100, 8, 18).rect(mcu.x + mcu.w + 142 + k * 50, mcu.y + 100, 8, 18); }
  g.fill({ color: T.pin, alpha: 0.6 });
  root.addChild(label('FAN HUB', h.x + 170, h.y + 110, 38, T.mute, { head: true, a: 0.9 }));
  root.addChild(label('FAN + LIGHTING CONTROLLER', h.x + 170, h.y + 330, 26, T.mute, { a: 0.6 }));
  root.addChild(label(`${hubHeaders().length} CH`, h.x + h.w - 60, h.y + h.h - 40, 28, T.mute, { anchor: [1, 0.5], a: 0.7 }));
}

/** The standoff positions of the case: every mounting hole of every board tier it takes (no duplicates). */
export function standoffs(): [number, number][] {
  const seen = new Set<string>(), out: [number, number][] = [];
  for (let t = 0; t <= LAYOUT_CASE; t++) for (const [x, y] of TIER_GEO[t]!.holes) if (!seen.has(`${x},${y}`)) { seen.add(`${x},${y}`); out.push([x, y]); }
  return out;
}

/** A brass standoff on the tray: a hex collar with a threaded bore (the board's screw goes into it). */
function standoff(g: Graphics, T: Theme, x: number, y: number, wall: string, edge: string) {
  disc(g, x, y, 44, { fill: '#000000', fa: T.dark ? 0.3 : 0.14 });
  const brass = mix(T.pin, wall, 0.25);
  disc(g, x, y, 36, { fill: brass, stroke: edge, lw: 4, sa: 0.8 });
  const hex: number[] = [];
  for (let k = 0; k < 6; k++) hex.push(x + Math.cos(k * 1.047) * 22, y + Math.sin(k * 1.047) * 22);
  g.poly(hex).stroke({ width: 3, color: edge, alpha: 0.7 });
  disc(g, x, y, 9, { fill: mix(wall, '#000000', 0.6) });
}

/**
 * A case fan seen edge-on (the glass looks along the board), the static part: the frame, the hub line and four corner screws.
 * The blades and the light strips are the live `EdgeFan` on top. `vertical`: the long side runs along y (front and rear fans); else along x.
 */
export function edgeFan(g: Graphics, T: Theme, r: Rect, vertical: boolean, wall: string, edge: string) {
  const { x, y, w, h } = r;
  box(g, x + 14, y + 20, w, h, 40, { fill: '#000000', fa: T.dark ? 0.3 : 0.12 });
  box(g, x, y, w, h, 40, { fill: mix(wall, T.bg, 0.35), stroke: edge, lw: 6, sa: 0.8 });
  if (vertical) g.moveTo(x + w / 2, y + 60).lineTo(x + w / 2, y + h - 60); else g.moveTo(x + 60, y + h / 2).lineTo(x + w - 60, y + h / 2);
  g.stroke({ width: 18, color: T.line, alpha: 0.6, cap: 'round' });
  const cx = [x + 36, x + w - 36], cy = [y + 40, y + h - 40];
  for (const sy of vertical ? cy : [y + 36, y + h - 36]) for (const sx of vertical ? cx : [x + 40, x + w - 40]) disc(g, sx, sy, 12, { fill: mix(wall, T.bg, 0.5), stroke: edge, lw: 3, sa: 0.7 });
}

/** The lights of the gaming case, one per fan. */
const RGB = ['#ff4d6d', '#ffb84d', '#7dff4d', '#4dd2ff', '#6a4dff', '#ff4dd2'];

/** Blade spacing of an edge-on fan (the pattern repeats this far along its long side). */
const BLADE = 56;

/**
 * The live part of a case fan seen edge-on: the blade tips slide along its long side while it spins (a still fan shows them at rest),
 * and the light strips along both long edges brighten with its speed. Redrawn only while something changes.
 */
export class EdgeFan extends Container {
  private g = new Graphics();
  private phase = 0;
  private key = '';
  constructor(private r: Rect, private T: Theme) {
    super();
    this.addChild(this.g);
    this.draw(0);
  }
  private get vertical() { return this.r.h > this.r.w; }
  /** How far the blades have slid along the fan (0 up to one blade spacing). */
  get offset() { return this.phase; }
  /** Put the blades back where they were (a rebuilt view keeps its fans' motion). */
  set offset(v: number) { this.phase = ((v % BLADE) + BLADE) % BLADE; this.draw(0); }
  /** Advance by `d` blade-lengths per frame's worth of spin and set the light level (0 = off, 1 = full). */
  spin(d: number, level: number) {
    this.phase = (this.phase + d * BLADE) % BLADE;
    if (d === 0 && `${level.toFixed(2)}` === this.key) return;
    this.draw(level);
  }
  private draw(level: number) {
    const { x, y, w, h } = this.r, g = this.g, T = this.T, vertical = this.vertical, L = vertical ? h : w, S = vertical ? w : h, m = Math.min(70, S * 0.26);
    this.key = `${level.toFixed(2)}`;
    g.clear();
    const pad = Math.min(60, L * 0.14); // the end margin: a short slab (a heatsink's fan) keeps blades and rails, they do not vanish
    for (let t = pad + 30 - BLADE + this.phase; t < L - pad - 10; t += BLADE) {
      if (t < pad) continue;
      if (vertical) g.moveTo(x + m, y + t + 22).lineTo(x + w - m, y + t - 22);
      else g.moveTo(x + t + 22, y + m).lineTo(x + t - 22, y + h - m);
    }
    g.stroke({ width: 10, color: T.mute, alpha: 0.22 + 0.18 * level, cap: 'round' });
    const e = pad + 10;
    if (vertical) g.rect(x + 20, y + e, 8, h - 2 * e).rect(x + w - 28, y + e, 8, h - 2 * e); else g.rect(x + e, y + 20, w - 2 * e, 8).rect(x + e, y + h - 28, w - 2 * e, 8);
    // the light strips: none on the plain cases, a colour per fan on the gaming case, the accent on the showcase
    const kind = kindNow();
    if (kind === 'oem' || kind === 'matte') return;
    const col = kind === 'gamer' ? RGB[Math.abs(Math.round(x / 7 + y / 11)) % RGB.length]! : T.alu;
    g.fill({ color: col, alpha: 0.16 + 0.6 * level });
  }
}

/** The top fans (as many as the case takes), under the top panel and clear of the 8-pin cable's run above the board. */
function topFans(g: Graphics, T: Theme, cav: string, wall: string, edge: string) {
  if (!TOP_FANS.length) return;
  const f0 = TOP_FANS[0]!, f1 = TOP_FANS[TOP_FANS.length - 1]!;
  // the mounting rail the fans hang from
  g.rect(f0.x - 80, f0.y - 22, f1.x + f1.w - f0.x + 160, 14).fill({ color: edge, alpha: 0.55 });
  for (const f of TOP_FANS) edgeFan(g, T, f, false, wall, edge);
  void cav;
}

/**
 * The rear wall (the slab at the west edge, seen edge-on): the opening the board's I/O plate sits in, an opening with a slot cover
 * for every expansion slot the case has, and the rear exhaust fan above them.
 */
function rearWall(g: Graphics, T: Theme, cav: string, wall: string, edge: string) {
  const c = CASE, i = CASE_IN, x = c.x + 14, w = WALL_T - 28, io = geoOf(LAYOUT_CASE).io;
  // the I/O opening: the plate (drawn with the board) fills it
  box(g, x, io.y - 80, w, io.h + 150, 22, { fill: cav, stroke: edge, lw: 4, sa: 0.5 });
  // the expansion slots: an opening each, closed by a slot cover with vents and a screw (a card's bracket replaces it)
  for (const r of geoOf(LAYOUT_CASE).pcie) {
    const y = r.y + 30 - 82; // centred on the slot, as a card's bracket is (`nicY`)
    box(g, x, y, w, 164, 14, { fill: cav, stroke: edge, lw: 3, sa: 0.5 });
    box(g, x + 16, y + 14, w - 32, 136, 8, { fill: mix(wall, T.bg, 0.35), stroke: edge, lw: 3, sa: 0.7 });
    for (let k = 0; k < 4; k++) g.rect(x + 40, y + 34 + k * 26, w - 80, 8);
    g.fill({ color: cav, alpha: 0.9 });
    disc(g, x + w / 2, y + 134, 9, { fill: mix(wall, T.bg, 0.5), stroke: edge, lw: 2, sa: 0.7 });
  }
  // the PSU's own exhaust: an opening with the fan's frame (its blades are the PSU's live part, devices.ts), above the mains inlet
  if (PSU_REAR_FAN) {
    box(g, x - 4, PSU_REAR_FAN.y - 24, w + 8, PSU_REAR_FAN.h + 48, 20, { fill: cav, stroke: edge, lw: 4, sa: 0.5 });
    edgeFan(g, T, PSU_REAR_FAN, true, wall, edge);
  }
  // the PSU's mains inlet, at the PSU's end of the wall
  acInlet(g, T, PC_POWER, { wallX: CASE.x, wallW: WALL_T });
  // the rear exhaust above the I/O opening: a fan, or on the Mini (no room for one) a perforated grille
  box(g, x - 4, REAR_FAN.y - 24, w + 8, REAR_FAN.h + 48, 20, { fill: cav, stroke: edge, lw: 4, sa: 0.5 });
  if (REAR_FAN_FITTED) edgeFan(g, T, REAR_FAN, true, wall, edge);
  else {
    const r = REAR_FAN;
    box(g, r.x, r.y, r.w, r.h, 26, { fill: mix(wall, T.bg, 0.35), stroke: edge, lw: 5, sa: 0.8 });
    for (let row = 0, y = r.y + 44; y < r.y + r.h - 30; row++, y += 38) for (let col = 0; col < 3 - (row % 2); col++) g.circle(r.x + r.w / 2 + (col - (1 - (row % 2) * 0.5)) * 42, y, 13);
    g.fill({ color: cav, alpha: 0.95 });
    for (const sy of [r.y + 18, r.y + r.h - 18]) for (const sx of [r.x + 20, r.x + r.w - 20]) disc(g, sx, sy, 6, { fill: mix(wall, T.bg, 0.5), stroke: edge, lw: 2, sa: 0.7 });
  }
  void i;
}

/** Glass side: a barely there sheen and a hairline edge, drawn over the board. */
export function caseGlass(T: Theme): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  // the glass starts east of the rear I/O plate (the plate sits in the rear wall's opening, not behind the glass)
  const kind = kindNow(), { edge } = caseInterior(T, kind);
  if (kind === 'oem') { // no glass: the side panel is off, four screw holes where it fixes
    for (const [x, y] of [[CASE_GLASS.x + 80, CASE_GLASS.y + 60], [CASE_GLASS.x + CASE_GLASS.w - 80, CASE_GLASS.y + 60], [CASE_GLASS.x + 80, CASE_GLASS.y + CASE_GLASS.h - 60], [CASE_GLASS.x + CASE_GLASS.w - 80, CASE_GLASS.y + CASE_GLASS.h - 60]] as const) disc(g, x, y, 22, { fill: '#000000', fa: 0.35, stroke: edge, lw: 4, sa: 0.7 });
    return root;
  }
  const gx = BR.io.x + BR.io.w + 60, a = T.dark ? 0.024 : 0.14;
  // the glass is the window of the outside: the upper part on the matte case, between the pillars on the showcase
  const win = caseWindow(kind), r = kind === 'matte' || kind === 'show' ? win : { ...CASE_GLASS, x: gx, w: CASE_GLASS.w - (gx - CASE_GLASS.x) };
  if (kind === 'matte') g.roundRect(win.x, win.y, win.w, win.h, 50).fill({ color: '#000000', alpha: T.dark ? 0.2 : 0.14 }); // the tint
  const band = (x0: number, x1: number) => g.poly([r.x + x0, r.y + 6, r.x + x1, r.y + 6, r.x + x1 - 1500, r.y + r.h - 6, r.x + x0 - 1500, r.y + r.h - 6]).fill({ color: '#ffffff', alpha: a });
  for (const [a, b] of [[2600, 3300], [3700, 3860], [6900, 7500]] as const) if (b - 1500 < r.w - 200) band(a, Math.min(b, r.w + 1500 - 200));
  if (kind === 'show' && isCut(WINDOW_CUTS.show)) { // the glass has the cut corners of the outside window
    const cuts = WINDOW_CUTS.show;
    outline(g, r.x + 14, r.y + 14, r.w - 28, r.h - 28, 26, [cuts[0] - 8, cuts[1] - 8, cuts[2] - 8, cuts[3] - 8]).stroke({ width: 5, color: '#ffffff', alpha: T.dark ? 0.07 : 0.4 });
  } else box(g, r.x + 14, r.y + 14, r.w - 28, r.h - 28, 26, { stroke: '#ffffff', lw: 5, sa: T.dark ? 0.07 : 0.4 });
  // corner screws
  for (const [x, y] of [[r.x - 80, r.y + 60], [r.x + r.w + 80, r.y + 60], [r.x - 80, r.y + r.h - 60], [r.x + r.w + 80, r.y + r.h - 60]] as const) {
    disc(g, x, y, 24, { fill: mix(wallTone(T), T.bg, 0.4), stroke: edgeTone(T), lw: 4, sa: 0.7 });
    g.moveTo(x - 12, y).lineTo(x + 12, y).stroke({ width: 4, color: edgeTone(T), alpha: 0.7 });
  }
  return root;
}

/**
 * The light inside the case, over the board and under the glass's sheen: the walls shade the corners a little (a vignette) and the room's
 * lamp bounces a warm wash in from the top west, so the inside belongs to the room instead of being lit flat.
 */
export function caseShade(T: Theme): Container {
  const root = new Container();
  // from the cavity's west wall to the glass's east edge, so no edge of it shows inside the picture
  const r = { x: CASE_IN.x + 8, y: CASE_GLASS.y, w: CASE_GLASS.x + CASE_GLASS.w - CASE_IN.x - 8, h: CASE_GLASS.h };
  const vig = new Graphics();
  vig.roundRect(r.x, r.y, r.w, r.h, 30).fill(rgrad('#00000000', T.dark ? '#000000' : '#1c2a3a', [0.5, 0.5], 0.72));
  vig.alpha = T.dark ? 0.26 : 0.1;
  const warm = new Graphics();
  warm.roundRect(r.x, r.y, r.w, r.h, 30).fill(rgrad('#ffb26a', '#ffb26a00', [0.0, 0.0], 0.8));
  warm.alpha = T.dark ? 0.05 : 0.04;
  root.addChild(vig, warm);
  // the cases with lights wash the inside: a violet and pink glow from the floor in the gaming case, a cold glow from the front edge in the showcase
  const kind = kindNow();
  if (kind === 'gamer' || kind === 'show') {
    const glow = new Graphics();
    if (kind === 'gamer') {
      glow.roundRect(r.x, r.y + r.h * 0.6, r.w, r.h * 0.4, 30).fill(lgrad('#a04dff00', '#a04dff', [0, 1]));
    } else {
      glow.roundRect(r.x + r.w * 0.7, r.y, r.w * 0.3, r.h, 30).fill(lgrad(T.br + '00', T.br, [1, 0]));
      glow.roundRect(r.x, r.y, r.w, r.h * 0.22, 30).fill(lgrad(T.br, T.br + '00')); // the top rail's fans light the inside from above
    }
    glow.alpha = T.dark ? 0.1 : 0.06;
    root.addChild(glow);
  }
  return root;
}

/** The drive cage: a stamped metal rack along the front (perforated uprights), a recessed bay per slot with its rails and grommets, the connector hints and the labels. Cells beyond the board's SATA ports are locked (dim, no bracket). */
export function bayArt(T: Theme, nSata: number): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const kind = kindNow(), { wall, cav, edge } = caseInterior(T, kind), k = driveScale(), metal = mix(wall, T.bg, 0.15);
  // the main cage (`BAY`) and the basement's under the shroud, round its cells
  const low = BAY_CELLS.slice(0, BASE_BAYS), base: Rect | null = low.length ? { x: BAY.x, y: low[0]!.y - 110, w: BAY.w, h: (low.length - 1) * CELL_PITCH + CELL_H + 190 } : null;
  for (const b of base ? [BAY, base] : [BAY]) {
    box(g, b.x + 12, b.y + 22, b.w, b.h, 24, { fill: '#000000', fa: T.dark ? 0.3 : 0.1 });
    g.roundRect(b.x, b.y, b.w, b.h, 24).fill(lgrad(mix(metal, '#ffffff', T.dark ? 0.1 : 0.16), mix(metal, '#000000', T.dark ? 0.25 : 0.08), [1, 1])).stroke({ width: 6, color: edge, alpha: 0.7 });
    g.moveTo(b.x + 40, b.y + 8).lineTo(b.x + b.w - 40, b.y + 8).stroke({ width: 5, color: '#ffffff', alpha: T.dark ? 0.1 : 0.4, cap: 'round' });
    // the uprights: a strip down each side, punched with a column of slots
    for (const ux of [b.x + 12, b.x + b.w - 40]) {
      box(g, ux, b.y + 20, 28, b.h - 40, 8, { fill: mix(metal, '#000000', T.dark ? 0.2 : 0.06), stroke: edge, lw: 3, sa: 0.5 });
      for (let y = b.y + 60; y < b.y + b.h - 50; y += 64) g.roundRect(ux + 8, y, 12, 30, 6);
    }
    g.fill({ color: cav, alpha: 0.9 });
  }
  root.addChild(label('DRIVE CAGE', BAY.x + 52, BAY.y + 44, 38, T.mute, { head: true, a: 0.9 }));
  BAY_CELLS.forEach((c, i) => {
    const live = i < nSata, w = c.w - 60 * k;
    // the recess: a dark bay with its top shadowed and its lower lip lit
    box(g, c.x, c.y, c.w, c.h, 10, { fill: mix(cav, '#000000', T.dark ? 0.3 : 0.12), fa: live ? 0.9 : 0.6, stroke: edge, lw: 4, sa: live ? 0.55 : 0.25 });
    g.rect(c.x + 6, c.y + 6, c.w - 12, 30).fill({ color: '#000000', alpha: live ? 0.28 : 0.16 });
    g.moveTo(c.x + 14, c.y + c.h - 4).lineTo(c.x + c.w - 14, c.y + c.h - 4).stroke({ width: 4, color: '#ffffff', alpha: T.dark ? 0.06 : 0.3 });
    // the guide rails the drive slides along (a lit top edge on each) and a rubber grommet at the end of each
    for (const ry of [c.y + 10, c.y + c.h - 18]) {
      g.rect(c.x + 40 * k, ry, w, 8).fill({ color: edge, alpha: live ? 0.7 : 0.3 });
      g.rect(c.x + 40 * k, ry, w, 2).fill({ color: '#ffffff', alpha: (T.dark ? 0.1 : 0.35) * (live ? 1 : 0.5) });
      disc(g, c.x + 40 * k + w - 18, ry + 4, 9, { fill: T.dark ? '#05070b' : mix(edge, '#000000', 0.5), stroke: edge, lw: 2, sa: 0.7 });
    }
    // a live bay shows its corners (the drop target); a locked one stays plain
    if (live) {
      const L = 70, ins = 8;
      for (const [bx, by, sx, sy] of [[c.x + ins, c.y + ins, 1, 1], [c.x + c.w - ins, c.y + ins, -1, 1], [c.x + ins, c.y + c.h - ins, 1, -1], [c.x + c.w - ins, c.y + c.h - ins, -1, -1]] as const) g.moveTo(bx + sx * L, by).lineTo(bx, by).lineTo(bx, by + sy * L);
      g.stroke({ width: 6, color: T.mul, alpha: 0.6, join: 'round', cap: 'round' });
    }
    // empty-connector hint (the drive's connectors mate here)
    box(g, c.x - 4 * k, c.y + 112 * k, 52 * k, 46 * k, 6, { stroke: edge, lw: 3, sa: live ? 0.6 : 0.25 });
    box(g, c.x - 4 * k, c.y + 300 * k, 52 * k, 118 * k, 6, { stroke: edge, lw: 3, sa: live ? 0.6 : 0.25 });
    root.addChild(label(live ? `SATA${i}` : `SATA${i} · BIGGER BOARD`, c.x + 70 * k, c.y + 56 * k, 34, live ? T.mul : T.mute, { a: live ? 0.9 : 0.5 }));
  });
  return root;
}

/** Hint drawn inside an empty, usable cell. */
export function emptyCellHint(T: Theme, cell: Rect): Container {
  const root = new Container();
  root.addChild(label('EMPTY · DROP A DRIVE', cell.x + cell.w / 2 + 20, cell.y + cell.h / 2, 46, T.mute, { anchor: [0.5, 0.5], a: 0.7, head: true }));
  return root;
}

// ---------------------------------------------------------------- SATA cables and power leads

/**
 * Dense centre line of the SATA data cable from cage cell i to port i on the board edge (a Lane, for pulses): out of the drive's data
 * plug west to its own column (`SATA_LINK`), down to the port's row and west into the port. Columns run west to east in port order,
 * so no two cables cross; they cross the PSU cables in the gutter (under them).
 */
export function sataCablePath(i: number): Lane {
  const c = BAY_CELLS[i]!, L = SATA_LINK[i]!, p = sataPort(i);
  const y0 = c.y + L.plug, yPort = p.y + p.h / 2;
  const route: Pt[] = [[c.x - 76, y0], [L.col, y0], [L.col, yPort], [p.x + p.w + 40, yPort]];
  return mkLane(roundedPath(route, 70, 30));
}

export const SATA_CABLE_W = 32;

export function plugBox(g: Graphics, T: Theme, x: number, y: number, w: number, h: number, accent: string) {
  box(g, x + 4, y + 8, w, h, 8, { fill: '#000000', fa: 0.25 });
  box(g, x, y, w, h, 8, { fill: T.dark ? '#1b2230' : '#2c3442', stroke: accent, lw: 4, sa: 0.85 });
}

export { sleeveOf };
export const lineOf = (g: Graphics, list: Pt[]) => { g.moveTo(list[0]![0], list[0]![1]); for (let k = 1; k < list.length; k++) g.lineTo(list[k]![0], list[k]![1]); };

/** The data cable for the drive in cage cell i: the sleeve, the plug on the drive and the plug in the board's port. Sits under the PSU cables. */
export function sataLinkArt(T: Theme, i: number): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const c = BAY_CELLS[i]!, lane = sataCablePath(i), pts = lane.pts, w = SATA_CABLE_W, L = SATA_LINK[i]!;
  paintCable(g, T, pts, { w, accent: T.mul });
  for (const t of tiePoints(pts, 1700, 500)) paintTie(g, T, t.at, t.dir, w, T.mul);
  plugBox(g, T, c.x - 82, c.y + L.plug - 34, 76, 68, T.mul); // drive end
  const e = pts[pts.length - 1]!;
  plugBox(g, T, e[0] - 86, e[1] - 36, 86, 72, T.mul); // board end (plugs west into the port)
  return root;
}

/**
 * The SATA power lead: one cable from a socket on the PSU's east face, east to the cage's west side and up it, with a plug on the
 * power connector of every installed drive (a daisy chain, the way a real build does it). `cells` are the occupied cage cells.
 */
export function sataPowerArt(T: Theme, cells: number[]): Container {
  const root = new Container();
  if (!cells.length) return root;
  const g = new Graphics();
  root.addChild(g);
  const k = driveScale(), x0 = PSU.x + PSU.w, ys = PSU.y + PSU.h / 2, X = POWER_LEAD_X;
  const py = (i: number) => BAY_CELLS[i]!.y + 359 * k;
  const top = Math.min(...cells.map(py));
  const trunk: Pt[] = [[x0, ys], [X, ys], [X, top]];
  const path = roundedPath(trunk, 60, 30);
  paintCable(g, T, path, { w: 38, accent: T.ld });
  for (const t of tiePoints(path, 1500, 400)) paintTie(g, T, t.at, t.dir, 38, T.ld);
  for (const i of cells) {
    const c = BAY_CELLS[i]!, y = py(i);
    paintCable(g, T, [[X, y], [c.x - 78, y]], { w: 30, accent: T.ld });
    plugBox(g, T, c.x - 86, y - 56, 80, 112, T.ld);
  }
  box(g, x0 - 14, ys - 46, 36, 92, 8, { fill: '#05070b', stroke: T.ld, lw: 4, sa: 0.6 }); // socket on the PSU's east face
  return root;
}
