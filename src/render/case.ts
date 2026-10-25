import { Container, Graphics } from 'pixi.js';
import { box, dashed, disc, label, mix } from './ink';
import {
  BAY, BAY_CELLS, BR, CASE, CASE_GLASS, CASE_IN, CASE_LEDS, CASE_PANEL, POWER_BTN, PSU, SATA_LINK, type Rect,
} from './layout';
import { mkLane, roundedPath, type Lane, type Pt } from './routes';
import type { Theme } from './theme';

// The PC case: a thin low-contrast chassis around the board and the PSU, a quiet glass side, the top panel (brand, vents,
// status lights, the power button sits on it) and the SATA drive bay with the cables that serve it. Everything here is static
// (baked with the device layer); the lights and the drives are live (Live, props.ts).

export const wallTone = (T: Theme) => mix(T.bg, T.dark ? T.line : '#ffffff', T.dark ? 0.3 : 0.6);
export const cavityTone = (T: Theme) => (T.dark ? mix(T.bg, '#000000', 0.45) : mix(T.bg, T.mute, 0.1));
const edgeTone = (T: Theme) => mix(T.line, T.mute, T.dark ? 0.15 : 0.55);

/** The chassis behind the board: walls, top panel, cavity, PSU compartment, vents, feet. */
export function caseBack(T: Theme): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const wall = wallTone(T), cav = cavityTone(T), edge = edgeTone(T);
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
  for (let k = 0; k < 16; k++) box(g, -1900 + k * 70, p.y + 120, 26, 170, 13, { fill: cav, fa: 0.9 });
  // cavity (behind the glass) and the PSU compartment
  box(g, i.x, i.y, i.w, i.h, 36, { fill: cav, stroke: edge, lw: 6, sa: 0.8 });
  const psuTop = PSU.y - 200;
  g.rect(i.x + 8, psuTop, i.w - 16, i.y + i.h - psuTop - 8).fill({ color: mix(cav, T.bg, 0.3), alpha: 0.5 });
  g.moveTo(i.x + 8, psuTop).lineTo(i.x + i.w - 8, psuTop).stroke({ width: 5, color: edge, alpha: 0.55 });
  // intake slots in the floor
  for (let k = 0; k < 14; k++) box(g, -2400 + k * 190, i.y + i.h + 30, 110, 22, 11, { fill: cav, fa: 0.85 });
  // I/O shield opening in the west wall (keys and the video cable pass through it)
  box(g, c.x + 26, -2080, 108, 2600, 30, { fill: cav, fa: 0.85, stroke: edge, lw: 4, sa: 0.5 });
  // labels
  root.addChild(label('PIPELINE CITY', -3500, p.y + 200, 90, T.ink, { head: true, a: 0.32 }));
  root.addChild(label('DISK', CASE_LEDS.disk, p.y + 340, 34, T.mute, { anchor: [0.5, 0.5], a: 0.85 }));
  for (const [t, x] of [['ON', CASE_LEDS.on], ['OFF', CASE_LEDS.off], ['ERR', CASE_LEDS.err]] as const) root.addChild(label(t, x, p.y + 340, 34, T.mute, { anchor: [0.5, 0.5], a: 0.85 }));
  void POWER_BTN;
  return root;
}

/** Glass side: a barely there sheen and a hairline edge, drawn over the board. */
export function caseGlass(T: Theme): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const r = CASE_GLASS, a = T.dark ? 0.024 : 0.14;
  const band = (x0: number, x1: number) => g.poly([r.x + x0, r.y + 6, r.x + x1, r.y + 6, r.x + x1 - 1500, r.y + r.h - 6, r.x + x0 - 1500, r.y + r.h - 6]).fill({ color: '#ffffff', alpha: a });
  band(2600, 3300); band(3700, 3860); band(6900, 7500);
  box(g, r.x + 14, r.y + 14, r.w - 28, r.h - 28, 26, { stroke: '#ffffff', lw: 5, sa: T.dark ? 0.07 : 0.4 });
  // corner screws
  for (const [x, y] of [[r.x - 80, r.y + 60], [r.x + r.w + 80, r.y + 60], [r.x - 80, r.y + r.h - 60], [r.x + r.w + 80, r.y + r.h - 60]] as const) {
    disc(g, x, y, 24, { fill: mix(wallTone(T), T.bg, 0.4), stroke: edgeTone(T), lw: 4, sa: 0.7 });
    g.moveTo(x - 12, y).lineTo(x + 12, y).stroke({ width: 4, color: edgeTone(T), alpha: 0.7 });
  }
  return root;
}

/** The drive cage: rails, cell outlines and the labels. `nSata` cells exist on this board tier. */
export function bayArt(T: Theme, nSata: number): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const edge = edgeTone(T), b = BAY;
  box(g, b.x, b.y, b.w, b.h, 24, { fill: mix(cavityTone(T), T.bg, 0.2), fa: 0.55, stroke: edge, lw: 6, sa: 0.65 });
  g.rect(b.x - 10, b.y + 60, 30, 12).rect(b.x - 10, b.y + b.h - 72, 30, 12).fill({ color: edge, alpha: 0.5 });
  root.addChild(label('DRIVE BAY', b.x + 24, b.y + 38, 38, T.mute, { head: true, a: 0.9 }));
  BAY_CELLS.forEach((c, i) => {
    const live = i < nSata;
    const pts: [number, number][] = [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h], [c.x, c.y]];
    dashed(g, pts, 34, 26);
    g.stroke({ width: 6, color: live ? T.mul : T.mute, alpha: live ? 0.55 : 0.25 });
    // guide rails the drive slides along
    g.rect(c.x + 40, c.y + 10, c.w - 60, 8).rect(c.x + 40, c.y + c.h - 18, c.w - 60, 8).fill({ color: edge, alpha: live ? 0.55 : 0.25 });
    // empty-connector hint (the drive's connectors mate here)
    box(g, c.x - 4, c.y + 112, 52, 46, 6, { stroke: edge, lw: 3, sa: live ? 0.6 : 0.25 });
    box(g, c.x - 4, c.y + 300, 52, 118, 6, { stroke: edge, lw: 3, sa: live ? 0.6 : 0.25 });
    root.addChild(label(live ? `SATA${i}` : `SATA${i} · ATX+ BOARD`, c.x + 70, c.y + 56, 34, live ? T.mul : T.mute, { a: live ? 0.9 : 0.5 }));
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
 * Dense centre line of the SATA data cable from bay cell i to port i on the board edge (a Lane, for pulses). It drops out of
 * the cell's west side, goes down the gap, under the PSU, up its west side and along the top of the PSU to the port: no part of
 * it crosses the PSU port row or the PSU cables (see `SATA_LINK`).
 */
export function sataCablePath(i: 0 | 1): Lane {
  const c = BAY_CELLS[i]!, L = SATA_LINK[i]!;
  const y0 = c.y + L.plug, yPort = BR.sata.y + BR.sata.h + 58;
  const route: Pt[] = [[c.x - 76, y0], [L.col, y0], [L.col, L.lane], [L.west, L.lane], [L.west, L.top], [L.port, L.top], [L.port, yPort]];
  return mkLane(roundedPath(route, 70, 30));
}

export const SATA_CABLE_W = 32;

function plugBox(g: Graphics, T: Theme, x: number, y: number, w: number, h: number, accent: string) {
  box(g, x + 4, y + 8, w, h, 8, { fill: '#000000', fa: 0.25 });
  box(g, x, y, w, h, 8, { fill: T.dark ? '#1b2230' : '#2c3442', stroke: accent, lw: 4, sa: 0.85 });
}

/** Data cable (and, with a PSU, the power lead) for the drive in SATA cell i. Sits under the PSU cables. */
export function sataLinkArt(T: Theme, i: 0 | 1, withPower: boolean): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const c = BAY_CELLS[i]!, lane = sataCablePath(i), pts = lane.pts, w = SATA_CABLE_W, L = SATA_LINK[i]!;
  const sleeve = T.dark ? '#171d29' : '#2a313d';
  const line = (list: Pt[]) => { g.moveTo(list[0]![0], list[0]![1]); for (let k = 1; k < list.length; k++) g.lineTo(list[k]![0], list[k]![1]); };
  line(pts.map(([x, y]) => [x + 7, y + 10] as Pt)); g.stroke({ width: w + 6, color: '#000000', alpha: 0.26, cap: 'round', join: 'round' });
  line(pts); g.stroke({ width: w, color: sleeve, cap: 'round', join: 'round' });
  line(pts); g.stroke({ width: w, color: T.mul, alpha: 0.2, cap: 'round', join: 'round' });
  line(pts); g.stroke({ width: w * 0.2, color: '#ffffff', alpha: T.dark ? 0.08 : 0.14, cap: 'round', join: 'round' });
  plugBox(g, T, c.x - 82, c.y + L.plug - 34, 76, 68, T.mul); // drive end
  const e = pts[pts.length - 1]!;
  plugBox(g, T, e[0] - 36, e[1] - 6, 72, 78, T.mul); // board end (plugs up into the port)
  if (withPower) {
    // the drive's power lead sits above its data plug, so the data run never passes it in the gap
    const py = c.y + 110, x0 = PSU.x + PSU.w;
    const sl = [[x0, py], [c.x - 78, py]] as Pt[];
    line(sl.map(([x, y]) => [x + 6, y + 9] as Pt)); g.stroke({ width: 44, color: '#000000', alpha: 0.26, cap: 'round' });
    line(sl); g.stroke({ width: 38, color: sleeve, cap: 'round' });
    line(sl); g.stroke({ width: 38, color: T.ld, alpha: 0.16, cap: 'round' });
    plugBox(g, T, c.x - 86, py - 56, 80, 112, T.ld);
    box(g, x0 - 14, py - 46, 36, 92, 8, { fill: '#05070b', stroke: T.ld, lw: 4, sa: 0.6 }); // socket on the PSU's east face
  }
  return root;
}
