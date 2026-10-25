import { Container, Graphics } from 'pixi.js';
import { box, dashed, disc, label, mix } from './ink';
import { TIER_GEO, geoOf } from './boardlayout';
import {
  BAY, BAY_CELLS, CASE_BD, CASE, CASE_GLASS, CASE_IN, CASE_LEDS, CASE_PANEL, FAN_W, LAYOUT_CASE, LAYOUT_TIER, POWER_BTN, POWER_LEAD_X, PSU, REAR_FAN, SATA_LINK, TOP_FANS, WALL_T,
  nicY, sataPort, type Rect,
} from './layout';
import { driveScale } from './drives';
import { mkLane, roundedPath, type Lane, type Pt } from './routes';
import type { Theme } from './theme';

// The PC case: a thin low-contrast chassis around the board and the PSU, a quiet glass side, the top panel (brand, vents,
// status lights, the power button sits on it) and the SATA drive cage with the cables that serve it. Everything here is static
// (baked with the device layer); the lights and the drives are live (Live, props.ts).

export const wallTone = (T: Theme) => mix(T.bg, T.dark ? T.line : '#ffffff', T.dark ? 0.3 : 0.6);
/** What the player's case is called on its top panel, and how many vents it has: the cases differ at a glance (docs/RENDER.md "Cases"). */
export const CASE_LOOK = [
  { tag: 'MINI', vents: 7, trim: 0 }, { tag: 'MICRO', vents: 11, trim: 0 }, { tag: 'MID', vents: 16, trim: 1 }, { tag: 'FULL', vents: 22, trim: 2 },
] as const;
export const cavityTone = (T: Theme) => (T.dark ? mix(T.bg, '#000000', 0.45) : mix(T.bg, T.mute, 0.1));
const edgeTone = (T: Theme) => mix(T.line, T.mute, T.dark ? 0.15 : 0.55);

/** The chassis behind the board: walls, top panel, cavity, PSU compartment, vents, feet. */
export function caseBack(T: Theme): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const look = CASE_LOOK[LAYOUT_CASE] ?? CASE_LOOK[2];
  // the bigger cases are a little darker and carry an accent line along the top; the small ones are paler
  const wall = mix(wallTone(T), T.dark ? '#000000' : '#8fa0bb', [-0.08, 0, 0.1, 0.2][LAYOUT_CASE] ?? 0), cav = cavityTone(T), edge = edgeTone(T);
  const c = CASE, i = CASE_IN, p = CASE_PANEL;
  // feet
  for (const fx of [c.x + 300, c.x + c.w - 700]) box(g, fx, c.y + c.h - 30, 400, 130, 30, { fill: mix(wall, T.bg, 0.4), stroke: edge, lw: 6, sa: 0.7 });
  // soft shadow and body
  box(g, c.x + 20, c.y + 34, c.w, c.h, 110, { fill: '#000000', fa: T.dark ? 0.3 : 0.12 });
  box(g, c.x, c.y, c.w, c.h, 110, { fill: wall, stroke: edge, lw: 10, sa: 0.9 });
  // top panel
  g.rect(p.x + 40, p.y + p.h - 4, p.w - 80, 8).fill({ color: edge, alpha: 0.7 });
  g.rect(p.x + 40, p.y + 8, p.w - 80, 5).fill({ color: '#ffffff', alpha: T.dark ? 0.06 : 0.5 });
  // vents on the panel: a quiet row of slots
  for (let k = 0; k < look.vents; k++) box(g, -1900 + k * 70, p.y + 120, 26, 170, 13, { fill: cav, fa: 0.9 });
  if (look.trim >= 1) g.rect(p.x + 40, p.y + p.h - 12, p.w - 80, 5).fill({ color: T.alu, alpha: look.trim >= 2 ? 0.5 : 0.28 });
  // cavity (behind the glass) and the PSU compartment
  box(g, i.x, i.y, i.w, i.h, 36, { fill: cav, stroke: edge, lw: 6, sa: 0.8 });
  const psuTop = PSU.y - 200;
  g.rect(i.x + 8, psuTop, i.w - 16, i.y + i.h - psuTop - 8).fill({ color: mix(cav, T.bg, 0.3), alpha: 0.5 });
  g.moveTo(i.x + 8, psuTop).lineTo(i.x + i.w - 8, psuTop).stroke({ width: 5, color: edge, alpha: 0.55 });
  // intake slots in the floor
  for (let k = 0; k < 14 && -2400 + k * 190 < i.x + i.w - 400; k++) box(g, -2400 + k * 190, i.y + i.h + 30, 110, 22, 11, { fill: cav, fa: 0.85 });
  // the motherboard tray: a plate a little bigger than the board it carries, perforated, with a brass standoff at every mounting hole of
  // every form factor the case takes (the installed board's holes sit over its own: they line up by construction) and a cable cut-out
  {
    const BD = CASE_BD, x0 = Math.max(BD.x - 110, i.x + 12), tr = { x: x0, y: BD.y - 110, w: BD.x + BD.w + 110 - x0, h: BD.h + 220 }, tone = mix(cav, wall, T.dark ? 0.32 : 0.45);
    box(g, tr.x, tr.y, tr.w, tr.h, 120, { fill: tone, stroke: edge, lw: 6, sa: 0.55 });
    for (let x = tr.x + 90; x < tr.x + tr.w - 60; x += 90) for (let y = tr.y + 60; y < tr.y + 190; y += 80) g.circle(x, y, 14);
    for (let x = tr.x + 90; x < tr.x + tr.w - 60; x += 90) for (let y = tr.y + tr.h - 190; y < tr.y + tr.h - 50; y += 80) g.circle(x, y, 14);
    g.fill({ color: cav, alpha: 0.9 });
    // cable cut-outs beside the 24-pin and over the 8-pin (the cables come through them)
    const gx = BD.x + BD.w;
    box(g, gx + 20, -1750, 70, 1500, 35, { fill: cav, stroke: edge, lw: 4, sa: 0.6 });
    for (const [x, y] of standoffs()) standoff(g, T, x, y, wall, edge);
  }
  frontFans(g, T, cav, wall, edge);
  rearWall(g, T, cav, wall, edge);
  topFans(g, T, cav, wall, edge);
  // labels
  root.addChild(label(`PIPELINE CITY · ${look.tag}`, -3500, p.y + 200, 90, T.ink, { head: true, a: 0.32 }));
  root.addChild(label('DISK', CASE_LEDS.disk, p.y + 340, 34, T.mute, { anchor: [0.5, 0.5], a: 0.85 }));
  for (const [t, x] of [['ON', CASE_LEDS.on], ['OFF', CASE_LEDS.off], ['ERR', CASE_LEDS.err]] as const) root.addChild(label(t, x, p.y + 340, 34, T.mute, { anchor: [0.5, 0.5], a: 0.85 }));
  void POWER_BTN; void LAYOUT_TIER;
  return root;
}

/**
 * The front intake fans, seen edge-on (the side panel looks along the board, so a front fan is a thin vertical module: its frame, the
 * ring of blade tips and a light strip), in front of the drive cage, and the perforated front panel beyond them. One module per ~1600
 * units of height.
 */
function frontFans(g: Graphics, T: Theme, cav: string, wall: string, edge: string) {
  const BD = CASE_BD, gl = CASE_GLASS, east = gl.x + gl.w, y0 = BD.y, y1 = BD.y + BD.h;
  const n = Math.max(1, Math.round((y1 - y0 + 100) / 1700)), gap = 100, h = (y1 - y0 - (n - 1) * gap) / n;
  const w = FAN_W, x = east - 170 - 20 - w;
  // front panel: a perforated wall along the east side of the glass
  const fp = { x: east - 170, y: gl.y + 60, w: 130, h: gl.h - 120 };
  box(g, fp.x, fp.y, fp.w, fp.h, 50, { fill: mix(cav, wall, 0.15), stroke: edge, lw: 5, sa: 0.5 });
  for (let yy = fp.y + 60; yy < fp.y + fp.h - 40; yy += 70) for (let xx = fp.x + 60; xx < fp.x + fp.w - 40; xx += 70) g.circle(xx, yy, 14);
  g.fill({ color: cav, alpha: 0.95 });
  for (let k = 0; k < n; k++) edgeFan(g, T, { x, y: y0 + k * (h + gap), w, h }, true, wall, edge);
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
 * A case fan seen edge-on (the glass looks along the board): the frame, the blade tips down the middle, the hub, a light strip along
 * both long edges and four corner screws. `vertical`: the long side runs along y (front and rear fans); else along x (top fans).
 */
function edgeFan(g: Graphics, T: Theme, r: Rect, vertical: boolean, wall: string, edge: string) {
  const { x, y, w, h } = r, L = vertical ? h : w, S = vertical ? w : h, m = Math.min(70, S * 0.26);
  box(g, x + 14, y + 20, w, h, 40, { fill: '#000000', fa: T.dark ? 0.3 : 0.12 });
  box(g, x, y, w, h, 40, { fill: mix(wall, T.bg, 0.35), stroke: edge, lw: 6, sa: 0.8 });
  for (let t = 90; t < L - 70; t += 56) {
    if (vertical) g.moveTo(x + m, y + t + 22).lineTo(x + w - m, y + t - 22);
    else g.moveTo(x + t + 22, y + m).lineTo(x + t - 22, y + h - m);
  }
  g.stroke({ width: 10, color: T.mute, alpha: 0.22, cap: 'round' });
  if (vertical) g.moveTo(x + w / 2, y + 60).lineTo(x + w / 2, y + h - 60); else g.moveTo(x + 60, y + h / 2).lineTo(x + w - 60, y + h / 2);
  g.stroke({ width: 18, color: T.line, alpha: 0.6, cap: 'round' });
  // light strips along both long edges
  if (vertical) g.rect(x + 20, y + 70, 8, h - 140).rect(x + w - 28, y + 70, 8, h - 140); else g.rect(x + 70, y + 20, w - 140, 8).rect(x + 70, y + h - 28, w - 140, 8);
  g.fill({ color: T.alu, alpha: 0.25 });
  const cx = [x + 36, x + w - 36], cy = [y + 40, y + h - 40];
  for (const sy of vertical ? cy : [y + 36, y + h - 36]) for (const sx of vertical ? cx : [x + 40, x + w - 40]) disc(g, sx, sy, 12, { fill: mix(wall, T.bg, 0.5), stroke: edge, lw: 3, sa: 0.7 });
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
    const y = nicY(geoOf(LAYOUT_CASE).pcie.indexOf(r)) - 82;
    box(g, x, y, w, 164, 14, { fill: cav, stroke: edge, lw: 3, sa: 0.5 });
    box(g, x + 16, y + 14, w - 32, 136, 8, { fill: mix(wall, T.bg, 0.35), stroke: edge, lw: 3, sa: 0.7 });
    for (let k = 0; k < 4; k++) g.rect(x + 40, y + 34 + k * 26, w - 80, 8);
    g.fill({ color: cav, alpha: 0.9 });
    disc(g, x + w / 2, y + 134, 9, { fill: mix(wall, T.bg, 0.5), stroke: edge, lw: 2, sa: 0.7 });
  }
  // the rear exhaust fan, above the I/O opening
  box(g, x - 4, REAR_FAN.y - 24, w + 8, REAR_FAN.h + 48, 20, { fill: cav, stroke: edge, lw: 4, sa: 0.5 });
  edgeFan(g, T, REAR_FAN, true, wall, edge);
  void i;
}

/** Glass side: a barely there sheen and a hairline edge, drawn over the board. */
export function caseGlass(T: Theme): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const r = CASE_GLASS, a = T.dark ? 0.024 : 0.14;
  const band = (x0: number, x1: number) => g.poly([r.x + x0, r.y + 6, r.x + x1, r.y + 6, r.x + x1 - 1500, r.y + r.h - 6, r.x + x0 - 1500, r.y + r.h - 6]).fill({ color: '#ffffff', alpha: a });
  for (const [a, b] of [[2600, 3300], [3700, 3860], [6900, 7500]] as const) if (b - 1500 < r.w - 200) band(a, Math.min(b, r.w + 1500 - 200));
  box(g, r.x + 14, r.y + 14, r.w - 28, r.h - 28, 26, { stroke: '#ffffff', lw: 5, sa: T.dark ? 0.07 : 0.4 });
  // corner screws
  for (const [x, y] of [[r.x - 80, r.y + 60], [r.x + r.w + 80, r.y + 60], [r.x - 80, r.y + r.h - 60], [r.x + r.w + 80, r.y + r.h - 60]] as const) {
    disc(g, x, y, 24, { fill: mix(wallTone(T), T.bg, 0.4), stroke: edgeTone(T), lw: 4, sa: 0.7 });
    g.moveTo(x - 12, y).lineTo(x + 12, y).stroke({ width: 4, color: edgeTone(T), alpha: 0.7 });
  }
  return root;
}

/** The drive cage: a rack along the front, a rail and a dashed cell per slot, the connector hints and the labels. Cells beyond the board's SATA ports are locked. */
export function bayArt(T: Theme, nSata: number): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const edge = edgeTone(T), b = BAY, k = driveScale();
  box(g, b.x, b.y, b.w, b.h, 24, { fill: mix(cavityTone(T), T.bg, 0.2), fa: 0.55, stroke: edge, lw: 6, sa: 0.65 });
  // the rack's uprights, and its screws
  g.rect(b.x + 14, b.y + 24, 14, b.h - 48).rect(b.x + b.w - 28, b.y + 24, 14, b.h - 48).fill({ color: edge, alpha: 0.4 });
  root.addChild(label('DRIVE CAGE', b.x + 52, b.y + 44, 38, T.mute, { head: true, a: 0.9 }));
  BAY_CELLS.forEach((c, i) => {
    const live = i < nSata;
    const pts: [number, number][] = [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h], [c.x, c.y]];
    dashed(g, pts, 34, 26);
    g.stroke({ width: 6, color: live ? T.mul : T.mute, alpha: live ? 0.55 : 0.25 });
    // guide rails the drive slides along
    g.rect(c.x + 40 * k, c.y + 10, c.w - 60 * k, 8).rect(c.x + 40 * k, c.y + c.h - 18, c.w - 60 * k, 8).fill({ color: edge, alpha: live ? 0.55 : 0.25 });
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

function plugBox(g: Graphics, T: Theme, x: number, y: number, w: number, h: number, accent: string) {
  box(g, x + 4, y + 8, w, h, 8, { fill: '#000000', fa: 0.25 });
  box(g, x, y, w, h, 8, { fill: T.dark ? '#1b2230' : '#2c3442', stroke: accent, lw: 4, sa: 0.85 });
}

const sleeveOf = (T: Theme) => (T.dark ? '#171d29' : '#2a313d');
const lineOf = (g: Graphics, list: Pt[]) => { g.moveTo(list[0]![0], list[0]![1]); for (let k = 1; k < list.length; k++) g.lineTo(list[k]![0], list[k]![1]); };

/** The data cable for the drive in cage cell i: the sleeve, the plug on the drive and the plug in the board's port. Sits under the PSU cables. */
export function sataLinkArt(T: Theme, i: number): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const c = BAY_CELLS[i]!, lane = sataCablePath(i), pts = lane.pts, w = SATA_CABLE_W, L = SATA_LINK[i]!;
  const sleeve = sleeveOf(T);
  lineOf(g, pts.map(([x, y]) => [x + 7, y + 10] as Pt)); g.stroke({ width: w + 6, color: '#000000', alpha: 0.26, cap: 'round', join: 'round' });
  lineOf(g, pts); g.stroke({ width: w, color: sleeve, cap: 'round', join: 'round' });
  lineOf(g, pts); g.stroke({ width: w, color: T.mul, alpha: 0.2, cap: 'round', join: 'round' });
  lineOf(g, pts); g.stroke({ width: w * 0.2, color: '#ffffff', alpha: T.dark ? 0.08 : 0.14, cap: 'round', join: 'round' });
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
  const sleeve = sleeveOf(T), k = driveScale(), x0 = PSU.x + PSU.w, ys = PSU.y + PSU.h / 2, X = POWER_LEAD_X;
  const py = (i: number) => BAY_CELLS[i]!.y + 359 * k;
  const top = Math.min(...cells.map(py));
  const trunk: Pt[] = [[x0, ys], [X, ys], [X, top]];
  const path = roundedPath(trunk, 60, 30);
  lineOf(g, path.map(([x, y]) => [x + 6, y + 9] as Pt)); g.stroke({ width: 44, color: '#000000', alpha: 0.26, cap: 'round', join: 'round' });
  lineOf(g, path); g.stroke({ width: 38, color: sleeve, cap: 'round', join: 'round' });
  lineOf(g, path); g.stroke({ width: 38, color: T.ld, alpha: 0.16, cap: 'round', join: 'round' });
  for (const i of cells) {
    const c = BAY_CELLS[i]!, y = py(i);
    lineOf(g, [[X, y], [c.x - 78, y]]); g.stroke({ width: 30, color: sleeve, cap: 'round' });
    lineOf(g, [[X, y], [c.x - 78, y]]); g.stroke({ width: 30, color: T.ld, alpha: 0.16, cap: 'round' });
    plugBox(g, T, c.x - 86, y - 56, 80, 112, T.ld);
  }
  box(g, x0 - 14, ys - 46, 36, 92, 8, { fill: '#05070b', stroke: T.ld, lw: 4, sa: 0.6 }); // socket on the PSU's east face
  return root;
}
