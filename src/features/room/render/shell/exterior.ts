import { Container, Graphics } from 'pixi.js';
import type { Snapshot } from '@/worker/protocol';
import { IO_PORTS, IO_X } from '@/features/board/render/layout/boardlayout';
import { acInlet, portProfile, shieldSheet } from '@/features/board/render/layout/ports';
import { box, disc, label, lgrad, mix } from '@/core/render/ink';
import { BAY_CELLS, BR, CASE, CASE_GLASS, CASE_IN, CASE_LEDS, CASE_PANEL, LAYOUT_CASE, PC_POWER, PSU, PSU_REAR_FAN, REAR_FAN, TOP_FANS, WALL_T, gpuPort, nicJack, nicY, type Rect } from '@/features/board/render/layout/layout';
import { CASE_LOOK } from '../desk/props/case';
import { CASE_CUTS, CASE_KIND, WINDOW_CUTS, showPillars, caseWindow, chamferFrame, cutRect, fanWindow, glowPoly, growCuts, hexes, holes, isCut, logoMark, outline, pillar, screw, slots, type CaseKind, type Cuts } from './casedecor';
import type { DriveKind } from '@/features/storage/render/drives';
import type { Theme } from '@/core/render/theme';

// The far-zoom exterior of the PC: an opaque chassis (brushed panels, a smoked glass side with only a faint reflection, vents, feet,
// the top panel, the drive bay front and the rear I/O plate) that replaces the interior when the camera is far away. It shares the
// case rectangle (`CASE`) with the interior view, so the power button, its lights, the USB port, the video cable and the key tray
// (all external things, drawn by props.ts / live.ts above this layer) stay exactly where they are.
//
// Static art is built once per (theme, tier, drives) and baked to one texture by board.ts; the accent strip is the only live part.

/** The thin accent light strip on the front rim of the case (a vertical bar east of the glass). */
export const stripRect = () => ({ x: CASE.x + CASE.w - 82, y0: CASE_GLASS.y + 140, y1: CASE_GLASS.y + CASE_GLASS.h - 110, w: 20 });

export interface ExteriorOpts {
  /** SATA ports this tier has. */
  nSata: number;
  /** Drives mounted in the bay (NVMe lives on the board, not in the bay, and is not visible from outside). */
  drives: { slot: string; kind: DriveKind }[];
  /** External connectors this board offers (ethernetMbps 0 = no jack). */
  features: { ethernetMbps: number; usbPorts: number; displayPorts: number };
  /** PCIe slot indices that hold a NIC card: each has its jack on the rear plate. */
  nics?: number[];
  /** PCIe slot indices that hold a graphics card: each has an HDMI port on the rear plate (the video cable goes in there on a graphics display). */
  gpus?: number[];
}

/** Where a cage drive's activity LED sits (world), by cell: on the front rim, level with its cell. */
export const frontLed = (cell: number) => ({ x: stripRect().x + 10, y: BAY_CELLS[cell]!.y + BAY_CELLS[cell]!.h / 2 });


export function exteriorTones(T: Theme) {
  const d = T.dark;
  return {
    hi: d ? '#3b4663' : '#d3dbe8', mid: d ? '#29324b' : '#b3bfd1', lo: d ? '#181e30' : '#8e9cb3',
    edge: d ? '#51608a' : '#6f7e9b', shade: d ? '#070a12' : '#4d5972',
    glassTop: d ? '#0f172a' : '#2c3750', glassBot: d ? '#05080f' : '#1b2336',
    cut: d ? '#05070c' : '#242c3d',
  };
}

/** Fine horizontal hairlines that read as brushed metal. */
function brush(g: Graphics, x: number, y: number, w: number, h: number, T: Theme, step = 34, cuts?: Cuts) {
  const [tl, tr, br, bl] = cuts ?? [0, 0, 0, 0];
  for (let yy = y + step / 2, k = 0; yy < y + h; yy += step, k++) {
    // a cut corner shortens the line where the corner has been cut away
    const x0 = x + Math.max(0, tl - (yy - y), bl - (y + h - yy)), x1 = x + w - Math.max(0, tr - (yy - y), br - (y + h - yy));
    if (x1 > x0) g.moveTo(x0, yy).lineTo(x1, yy).stroke({ width: 5, color: k % 2 ? '#ffffff' : '#000000', alpha: T.dark ? 0.028 : 0.05 });
  }
}

/**
 * How each case tier looks from outside, beyond its size: the colour of its body, its trim, its accent light and how round it is.
 * Mini: a pale aluminium shell, soft corners, amber light. Micro: matte black, cyan. Mid: gunmetal with brass trim, violet.
 * Full: graphite with an aluminium frame, square corners and an RGB light line under the glass.
 */
interface CaseStyle { mixTo: string; k: number; accent: (T: Theme) => string; trim: (T: Theme) => string | null; rad: number; rgb: boolean; brushed: boolean }
const SILVER = '#c9d1de';
const STYLES: CaseStyle[] = [
  // a budget OEM tower: painted cream steel, square corners, a solid side with one vent patch, no window
  { mixTo: '#e6dfc4', k: 0.72, accent: (T) => T.ld, trim: () => null, rad: 28, rgb: false, brushed: false },
  // a matte black mid-tower: powder coat, a tinted window over the upper part, one small logo
  { mixTo: '#0b0c10', k: 0.72, accent: (T) => T.mute, trim: () => null, rad: 70, rgb: false, brushed: false },
  // a gaming case: dark, angular, slanted vents, a cut-corner window, multi-zone RGB and a lit logo plate
  { mixTo: '#1b2030', k: 0.5, accent: (T) => T.mul, trim: () => null, rad: 56, rgb: true, brushed: false },
  // a showcase frame: black body, silver anodised pillars and rails, black corner brackets, a hex mesh and a light bar
  { mixTo: '#05070b', k: 0.5, accent: (T) => T.br, trim: () => SILVER, rad: 36, rgb: true, brushed: true },
];
const styleOf = (): CaseStyle & { kind: CaseKind } => ({ ...(STYLES[LAYOUT_CASE] ?? STYLES[2]!), kind: CASE_KIND[LAYOUT_CASE] ?? 'gamer' });

/** The body tones of the current tier: the shared steel tones mixed toward the tier's colour. */
function bodyTones(T: Theme, st: CaseStyle) {
  const c = exteriorTones(T), m = (v: string) => mix(v, st.mixTo, st.k);
  // the painted OEM tower is cream to its edges: its own palette, nothing of the steel's dark grey left in it
  if (st.k >= 0.72 && st.mixTo === '#e6dfc4') {
    const dk = T.dark ? 0.1 : 0;
    const s = (v: string) => mix(v, '#000000', dk);
    return { ...c, hi: s('#ebe4cb'), mid: s('#ddd6bb'), lo: s('#c6bfa2'), edge: s('#9a9373'), shade: s('#6f6a52'), cut: s('#8a8468') };
  }
  return { ...c, hi: m(c.hi), mid: m(c.mid), lo: m(c.lo), edge: mix(c.edge, st.mixTo, st.k * 0.6), cut: mix(c.cut, '#000000', 0.2) };
}

/** A bevel round a rounded box: a lit edge on the top and west sides, a shaded one on the bottom and east. */
function bevel(g: Graphics, x: number, y: number, w: number, h: number, r: number, T: Theme, a = 1) {
  g.moveTo(x + r, y).lineTo(x + w - r, y).moveTo(x, y + r).lineTo(x, y + h - r).stroke({ width: 6, color: '#ffffff', alpha: (T.dark ? 0.13 : 0.55) * a, cap: 'round' });
  g.moveTo(x + r, y + h).lineTo(x + w - r, y + h).moveTo(x + w, y + r).lineTo(x + w, y + h - r).stroke({ width: 6, color: '#000000', alpha: (T.dark ? 0.4 : 0.2) * a, cap: 'round' });
}

/** The static exterior (world coordinates, around `CASE`). */
export function exteriorArt(T: Theme, o: ExteriorOpts): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const st = styleOf(), c = bodyTones(T, st), acc = st.accent(T), trim = st.trim(T), R = st.rad, d = T.dark;
  const c0 = CASE, p = CASE_PANEL, gl = CASE_GLASS, ci = CASE_IN;
  const oem = st.kind === 'oem', ink = oem ? '#4a4636' : d ? '#dfe7ff' : '#1a2338', dim = oem ? '#5a5642' : d ? '#8d9bc4' : '#2a3550';
  const slit = oem ? mix(c.lo, '#000000', 0.5) : c.glassTop; // the dark of the vent holes

  // the feet (rubber pads on the small cases, wider blocks on the full tower, which also throws a little light on the desk) and the soft shadow
  const kind = st.kind, fw = { oem: 190, matte: 300, gamer: 520, show: 600 }[kind];
  for (const fx of [c0.x + 300, c0.x + c0.w - 300 - fw]) {
    const fy = c0.y + c0.h - 40;
    if (kind === 'gamer' || kind === 'show') { // angled feet that splay out under the case
      g.poly([fx + 40, fy, fx + fw - 40, fy, fx + fw + 120, fy + 170, fx - 120, fy + 170]).fill(lgrad('#2b303b', '#0a0c11')).stroke({ width: 6, color: c.edge, alpha: 0.5 });
      g.rect(fx + 60, fy + 6, fw - 120, 5).fill({ color: '#ffffff', alpha: d ? 0.1 : 0.3 });
      if (kind === 'show') g.poly([fx - 101, fy + 150, fx + fw + 101, fy + 150, fx + fw + 120, fy + 170, fx - 120, fy + 170]).fill(lgrad(SILVER, mix(SILVER, '#000000', 0.55))); // a silver foot plate
    } else {
      box(g, fx, fy, fw, kind === 'oem' ? 130 : 150, kind === 'oem' ? 65 : 30, { fill: kind === 'oem' ? '#cfc8b0' : c.shade, stroke: c.edge, lw: 6, sa: 0.5 });
      g.rect(fx + 30, fy, fw - 60, 5).fill({ color: '#ffffff', alpha: d ? 0.08 : 0.3 });
    }
    if (st.rgb) g.rect(fx + 20, c0.y + c0.h + 100, fw - 40, 8).fill({ color: acc, alpha: 0.55 });
  }
  const bc = isCut(CASE_CUTS[kind]) ? CASE_CUTS[kind] : undefined; // the showcase is machined with chamfered corners, the others are rounded boxes
  outline(g, c0.x + 24, c0.y + 40, c0.w, c0.h, R, bc).fill({ color: '#000000', alpha: d ? 0.4 : 0.16 });
  box(g, c0.x + 60, c0.y + c0.h + 40, c0.w - 80, 120, 60, { fill: '#000000', fa: d ? 0.22 : 0.1 });
  if (bc) for (const grow of [90, 45]) outline(g, c0.x - grow, c0.y - grow, c0.w + 2 * grow, c0.h + 2 * grow, R + grow, growCuts(bc, grow)).fill({ color: acc, alpha: d ? 0.05 : 0.025 }); // its light spills onto the wall

  // body: brushed metal lit from the top left, with a bevelled rim and a soft light band down the side
  outline(g, c0.x, c0.y, c0.w, c0.h, R, bc).fill(lgrad(c.hi, c.lo, [0.25, 1])).stroke({ width: 12, color: c.edge, alpha: 0.9, join: 'miter' });
  outline(g, c0.x + 14, c0.y + 14, c0.w - 28, c0.h - 28, R - 10, bc && growCuts(bc, -8)).fill(lgrad(d ? '#ffffff12' : '#ffffff30', '#ffffff00', [1, 0.2]));
  if (st.brushed) brush(g, c0.x + 40, c0.y + 40, c0.w - 80, c0.h - 80, T, 34, bc && growCuts(bc, -26));
  if (bc) chamferFrame(g, { x: c0.x + 16, y: c0.y + 16, w: c0.w - 32, h: c0.h - 32 }, growCuts(bc, -10), d);
  else bevel(g, c0.x + 16, c0.y + 16, c0.w - 32, c0.h - 32, R - 10, T, kind === 'matte' ? 0.4 : kind === 'oem' ? 0.3 : 1);

  // top panel: a recessed plate with an accent hairline, the brand, a row of vents and the light window for the status LEDs
  const pi = bc ? 410 : 36; // the chamfered corners cut into the panel's ends
  if (kind !== 'matte') g.roundRect(p.x + pi, p.y + 36, p.w - 2 * pi, p.h - 52, 40).fill(lgrad(c.mid, c.lo)).stroke({ width: 6, color: c.edge, alpha: 0.6 });
  if (kind !== 'matte') g.rect(p.x + pi + 34, p.y + 44, p.w - 2 * pi - 68, 10).fill({ color: '#000000', alpha: d ? 0.3 : 0.12 });
  if (kind !== 'oem' && kind !== 'matte') g.rect(p.x + pi + 54, p.y + p.h - 34, p.w - 2 * pi - 108, 5).fill({ color: acc, alpha: 0.5 });
  const nv = CASE_LOOK[LAYOUT_CASE]?.vents ?? 16;
  if (kind === 'gamer') { slots(g, { x: -2250, y: p.y + 110, w: nv * 78, h: 200 }, nv, 70); g.fill({ color: c.cut }); }
  else if (kind === 'show') { // the top fans glow through the rail, one lit window each (the ring fans of a showcase)
    for (const f of TOP_FANS) fanWindow(g, { x: f.x + 130, y: p.y + 110, w: f.w - 260, h: 210 }, acc, SILVER);
  } else for (let k = 0; k < nv; k++) box(g, -2250 + k * 78, p.y + 120, 30, 190, 15, { fill: c.cut });
  if (kind === 'gamer') { // an angled mesh cap in the top front corner
    const cx = c0.x + c0.w - 20, cw = 380;
    g.poly([cx - cw, c0.y + 20, cx, c0.y + 20, cx, c0.y + 20 + cw * 0.8]).fill(lgrad('#1c212c', '#07090d')).stroke({ width: 5, color: c.edge, alpha: 0.6 });
    for (let k = 1; k < 5; k++) { const x0 = cx - cw + k * 70; g.moveTo(x0, c0.y + 20).lineTo(cx, c0.y + 20 + 0.8 * (cx - x0)); }
    g.stroke({ width: 14, color: '#000000', alpha: 0.7 });
  }
  box(g, CASE_LEDS.disk - 120, p.y + 70, CASE_LEDS.err - CASE_LEDS.disk + 240, 250, 40, { fill: c.cut, stroke: c.edge, lw: 5, sa: 0.5 });
  root.addChild(label('DISK', CASE_LEDS.disk, p.y + 340, 34, dim, { anchor: [0.5, 0.5], a: 0.9 }));
  for (const [t, x] of [['ON', CASE_LEDS.on], ['OFF', CASE_LEDS.off], ['ERR', CASE_LEDS.err]] as const) root.addChild(label(t, x, p.y + 340, 34, dim, { anchor: [0.5, 0.5], a: 0.9 }));

  // rear I/O plate (west): a panel with the external connectors cut into it
  const io = { x: c0.x + 30, y: ci.y, w: BR.io.x + BR.io.w + 60 - (c0.x + 30), h: gl.h };
  if (kind !== 'matte') { g.roundRect(io.x, io.y, io.w, io.h, 30).fill(lgrad(c.mid, c.lo)).stroke({ width: 6, color: c.edge, alpha: 0.7 }); brush(g, io.x + 10, io.y + 10, io.w - 20, io.h - 20, T, 40); }
  rearIo(g, T, o);
  root.addChild(label('REAR I/O', io.x + 24, io.y + 70, 56, dim, { head: true, a: 0.6 }));
  // the PSU's exhaust grille (the cases above the Mini)
  if (PSU_REAR_FAN) for (let k = 0; k < 7; k++) box(g, io.x + 40, PSU_REAR_FAN.y + 50 + k * 90, 120, 26, 13, { fill: c.cut, fa: 0.75 });
  // the rear fan, the expansion slot covers and the top fans are inside: only their vents show on the plate
  for (let k = 0; k < Math.min(5, Math.floor((REAR_FAN.h - 40) / 70)); k++) box(g, io.x + 40, REAR_FAN.y + 60 + k * 70, 120, 26, 13, { fill: c.cut, fa: 0.75 });

  // the glass side: a bezel (the tier's trim colour where it has one), a dark gasket, then the window itself, a hole in the body
  // with a thin smoked pane over it, so the real interior shows through at every zoom
  // The window differs by case: none on the OEM tower (a solid side with a vent patch), the upper part on the matte case, a cut corner on the
  // gaming case, a full height pane between two pillars on the showcase.
  const win = caseWindow(kind);
  const bz = kind === 'matte' ? 22 : kind === 'gamer' ? 30 : 44, wr = kind === 'show' ? 24 : 50;
  const cuts: Cuts | undefined = isCut(WINDOW_CUTS[kind]) ? WINDOW_CUTS[kind] : undefined;
  const bcuts: Cuts | undefined = cuts && (cuts.map((v) => (v ? v + bz * 0.6 : 0)) as Cuts);
  const top = new Graphics();
  if (kind === 'oem') solidSide(g, T, c, { x: ci.x, y: gl.y, w: ci.w, h: gl.h }, win);
  else {
    // the showcase's bezel is dark graphite (the frame), edged by a thin silver trim line; the gaming one is blue-black, the others plain steel
    const bezelFill = kind === 'show' ? lgrad('#1c212b', '#07090d') : kind === 'gamer' ? lgrad('#222834', '#07090d') : lgrad(c.mid, c.lo);
    if (kind !== 'matte') outline(g, win.x - bz, win.y - bz, win.w + 2 * bz, win.h + 2 * bz, wr + 26, bcuts).fill(bezelFill).stroke({ width: 6, color: c.edge, alpha: 0.6 });
    if (kind === 'show') chamferFrame(g, { x: win.x - bz + 4, y: win.y - bz + 4, w: win.w + 2 * bz - 8, h: win.h + 2 * bz - 8 }, growCuts(cuts!, bz - 6), d, 0.9);
    else if (kind !== 'matte') bevel(g, win.x - bz + 4, win.y - bz + 4, win.w + 2 * bz - 8, win.h + 2 * bz - 8, 20, T, 0.8);
    outline(g, win.x - 16, win.y - 16, win.w + 32, win.h + 32, wr + 12, cuts && (cuts.map((v) => (v ? v + 10 : 0)) as Cuts)).fill(c.shade);
    if (kind === 'show') outline(g, win.x - 11, win.y - 11, win.w + 22, win.h + 22, wr + 8, growCuts(cuts!, 8)).stroke({ width: 9, color: SILVER, alpha: 0.95 });
    const hole = new Graphics();
    hole.blendMode = 'erase';
    outline(hole, win.x, win.y, win.w, win.h, wr, cuts).fill('#000000');
    const pane = new Graphics();
    root.addChild(hole, pane);
    outline(pane, win.x, win.y, win.w, win.h, wr, cuts).fill(lgrad(c.glassTop, c.glassBot));
    pane.alpha = kind === 'matte' ? (d ? 0.55 : 0.45) : d ? 0.4 : 0.34;
    root.addChild(top);
  }
  const refl = (x0: number, w: number, a: number) => top.poly([win.x + x0, win.y + 8, win.x + x0 + w, win.y + 8, win.x + x0 + w - 1500, win.y + win.h - 8, win.x + x0 - 1500, win.y + win.h - 8]).fill({ color: '#ffffff', alpha: a });
  const ra = d ? 0.05 : 0.08;
  refl(3200, 700, ra); refl(4200, 150, ra * 0.8); refl(7500, 500, ra * 0.7);
  outline(top, win.x + 14, win.y + 14, win.w - 28, win.h - 28, wr - 10, cuts && (cuts.map((v) => (v ? v - 10 : 0)) as Cuts)).stroke({ width: 5, color: '#ffffff', alpha: d ? 0.1 : 0.3 });
  // the light under the glass: multi-zone RGB on the gaming case, one colour on the showcase, nothing on the plain cases
  if (kind === 'gamer') {
    const ly = win.y + win.h - 40, lx0 = win.x + 140, lw = win.w - 280, hue = ['#ff4d6d', '#ffb84d', '#7dff4d', '#4dd2ff', '#6a4dff', '#ff4dd2'];
    hue.forEach((h, k) => { top.roundRect(lx0 + (k * lw) / hue.length, ly - 30, lw / hue.length, 60, 30).fill({ color: h, alpha: 0.12 }); });
    hue.forEach((h, k) => { top.roundRect(lx0 + (k * lw) / hue.length, ly, lw / hue.length + 1, 10, 5).fill(h); });
  } else if (kind === 'show') {
    // an edge light runs round the whole glass, inside the trim, and pools along the bottom (the showcase is lit like the reference, all round)
    glowPoly(top, cutRect(win.x + 26, win.y + 26, win.w - 52, win.h - 52, growCuts(cuts!, -15)), acc, 6, d ? 1 : 0.6);
    const ly = win.y + win.h - 70, lx0 = win.x + 300, lw = win.w - 600;
    top.roundRect(lx0, ly - 120, lw, 150, 75).fill(lgrad(acc + '00', acc + '38', [0, 1]));
    top.roundRect(lx0, ly, lw, 10, 5).fill(lgrad(acc, T.alu, [1, 0]));
  }
  if (kind === 'show') { // silver pillars on both sides of the glass (the west one over the end of the I/O plate), rails above and below
    const hi = mix(SILVER, c.hi, 0.35), lo = mix(SILVER, c.lo, 0.6), pil = showPillars(win, bz), py = pil[0].y, ph = pil[0].h;
    for (const r of pil) pillar(top, r, hi, lo, c.edge);
    top.rect(win.x - bz - 20, py, win.w + 2 * bz + 40, 130).fill(lgrad(hi, lo)).stroke({ width: 5, color: c.edge, alpha: 0.8 });
    top.rect(win.x - bz - 20, py + ph - 130, win.w + 2 * bz + 40, 130).fill(lgrad(hi, lo)).stroke({ width: 5, color: c.edge, alpha: 0.8 });
    // a recessed light slot down each pillar (the pillars are lit, as the frame's uprights are in the reference)
    for (const r of pil) {
      const px = r.x + r.w / 2 + r.w * 0.2, sh = ph - 520;
      top.roundRect(px - 24, py + 260, 48, sh, 24).fill({ color: acc, alpha: 0.18 });
      top.roundRect(px - 8, py + 270, 16, sh - 20, 8).fill({ color: '#04060a' }).stroke({ width: 3, color: SILVER, alpha: 0.5 });
      top.roundRect(px - 4, py + 280, 8, sh - 40, 4).fill(acc);
    }
    // the corners are machined plates along each chamfer, with a screw each (instead of the plain brackets of the other cases)
    const off = 90;
    for (const [bx, by, dx, dy, cut] of [[c0.x + 16, c0.y + 16, 1, 1, CASE_CUTS.show[0]], [c0.x + c0.w - 16, c0.y + 16, -1, 1, CASE_CUTS.show[1]], [c0.x + 16, c0.y + c0.h - 16, 1, -1, CASE_CUTS.show[3]], [c0.x + c0.w - 16, c0.y + c0.h - 16, -1, -1, CASE_CUTS.show[2]]] as const) {
      const ax = bx + dx * cut, ay = by, bx2 = bx, by2 = by + dy * cut, ox = dx * off, oy = dy * off;
      top.poly([ax, ay, bx2, by2, bx2 + ox, by2 + oy * 0.6, ax + ox * 0.6, ay + oy]).fill(lgrad('#222833', '#07090d')).stroke({ width: 5, color: SILVER, alpha: 0.55 });
      screw(top, (ax + bx2) / 2 + ox * 0.55, (ay + by2) / 2 + oy * 0.55, 22, mix(SILVER, '#000000', 0.5), c.edge);
    }
  }
  if (kind !== 'oem' && kind !== 'matte' && kind !== 'gamer') {
    for (const [x, y] of [[win.x - 6, win.y + 70], [win.x + win.w + 6, win.y + 70], [win.x - 6, win.y + win.h - 70], [win.x + win.w + 6, win.y + win.h - 70]] as const) screw(top, x, y, 26, mix(c.hi, c.lo, 0.3), c.edge);
  }

  // PSU compartment: a brushed panel with a perforated intake (the drive cage is inside, behind the glass)
  const lowY = gl.y + gl.h, lowH = ci.y + ci.h - lowY;
  const lowFill = kind === 'show' ? lgrad(mix(SILVER, c.hi, 0.35), mix(SILVER, c.lo, 0.55)) : kind === 'gamer' ? lgrad('#232936', '#0a0c11') : lgrad(c.mid, c.lo);
  if (kind !== 'matte') g.roundRect(ci.x, lowY, ci.w, lowH, 36).fill(lowFill).stroke({ width: 6, color: c.edge, alpha: 0.5 });
  if (st.brushed) brush(g, ci.x + 10, lowY + 10, ci.w - 20, lowH - 20, T, 40);
  if (kind !== 'matte') bevel(g, ci.x + 10, lowY + 10, ci.w - 20, lowH - 20, 30, T, 0.7); // the matte side is one sheet: no seam under the window
  const mesh = { x: PSU.x + 120, y: PSU.y + 60, w: 3300, h: PSU.h - 120 };
  box(g, mesh.x, mesh.y, mesh.w, mesh.h, 40, { fill: oem ? mix(c.lo, '#000000', 0.25) : c.cut, stroke: c.edge, lw: 5, sa: 0.6 });
  if (kind === 'show') hexes(g, { x: mesh.x + 40, y: mesh.y + 40, w: mesh.w - 80, h: mesh.h - 80 }, 46, 10);
  else holes(g, { x: mesh.x + 30, y: mesh.y + 30, w: mesh.w - 60, h: mesh.h - 60 }, 64, 13);
  g.fill({ color: slit, alpha: 1 });
  g.rect(mesh.x + 20, mesh.y + 20, mesh.w - 40, 4).fill({ color: '#ffffff', alpha: 0.04 });
  // the mains inlet in the rear wall at the PSU's end (the cord is drawn by the room)
  acInlet(g, T, PC_POWER, { wallX: IO_X, wallW: WALL_T });
  // the badge beside the intake: a plate of the body's metal with the name pressed into it (a lit edge above each letter's shadow)
  const bx = mesh.x + mesh.w + 260, area = { x: bx, y: PSU.y + 60, w: ci.x + ci.w - 300 - bx, h: PSU.h - 120 };
  badge(root, g, T, c, kind, area, acc);

  // front rim: a slim vertical vent column east of the glass
  const STRIP = stripRect();
  for (let k = 0; k < Math.floor((STRIP.y1 - STRIP.y0 - 260) / 215) + 1; k++) box(g, STRIP.x + 62, STRIP.y0 + 260 + k * 215, 16, 120, 8, { fill: c.cut, fa: 0.8 });
  box(g, STRIP.x - 6, STRIP.y0 - 6, STRIP.w + 12, STRIP.y1 - STRIP.y0 + 12, 12, { fill: c.cut, stroke: c.edge, lw: 3, sa: 0.5 });
  return root;
}

const tones = exteriorTones;

type Tones = ReturnType<typeof bodyTones>;

/** The solid side of the OEM tower: a pressed panel with a square perforated vent patch, screws in its corners and the seam to the PSU bay. */
function solidSide(g: Graphics, T: Theme, c: Tones, r: Rect, win: Rect) {
  g.roundRect(r.x + 50, r.y + 40, r.w - 100, r.h - 80, 20).fill(lgrad(mix(c.hi, c.lo, 0.25), mix(c.hi, c.lo, 0.6))).stroke({ width: 8, color: c.edge, alpha: 0.5 });
  g.roundRect(r.x + 62, r.y + 52, r.w - 124, r.h - 104, 14).stroke({ width: 5, color: '#ffffff', alpha: T.dark ? 0.08 : 0.4 });
  const v = { x: win.x + 700, y: r.y + r.h / 2 - 760, w: 1500, h: 1500 };
  g.roundRect(v.x - 24, v.y - 24, v.w + 48, v.h + 48, 50).fill({ color: '#000000', alpha: 0.18 });
  g.roundRect(v.x, v.y, v.w, v.h, 40).fill(mix(c.lo, '#000000', 0.2)).stroke({ width: 6, color: c.edge, alpha: 0.7 });
  holes(g, { x: v.x + 30, y: v.y + 30, w: v.w - 60, h: v.h - 60 }, 52, 12);
  g.fill({ color: mix(c.lo, '#000000', 0.5) });
  for (const [x, y] of [[r.x + 110, r.y + 100], [r.x + r.w - 110, r.y + 100], [r.x + 110, r.y + r.h - 100], [r.x + r.w - 110, r.y + r.h - 100]] as const) screw(g, x, y, 30, mix(c.hi, c.lo, 0.3), c.edge);
}

/**
 * The maker's mark, as small as on a real case and different on each: a plain label on the OEM tower, a debossed logo on the matte case,
 * a lit plate with an RGB outline on the gaming case, two angled name plates on the showcase.
 */
function badge(root: Container, g: Graphics, T: Theme, c: Tones, kind: CaseKind, r: Rect, acc: string) {
  const d = T.dark, press = kind === 'oem' ? '#4a4636' : d ? '#b4c0e4' : '#25304a', lit = d ? '#000000' : '#ffffff';
  const text = (s: string, x: number, y: number, size: number, col: string, a = 0.85) => root.addChild(label(s, x, y, size, col, { head: true, anchor: [0.5, 0.5], a }));
  const right = r.x + r.w, cy = r.y + r.h / 2;
  // one quiet mark per case, the logo and no more: a label, a debossed print, a lit plate, a name plate
  if (kind === 'oem') {
    const w = 700, x = right - w, h = 300;
    g.roundRect(x, cy - h / 2, w, h, 16).fill(mix(c.hi, c.lo, 0.45)).stroke({ width: 5, color: c.edge, alpha: 0.7 });
    logoMark(g, x + w / 2 - 150, cy - 90, 120, press, press);
    text('PC-1', x + w / 2 + 130, cy + 10, 90, press, 0.7);
  } else if (kind === 'matte') { // debossed: a dark print under a lit one
    for (const [dy, col] of [[5, lit], [0, '#000000']] as const) logoMark(g, right - 300, cy - 60 + dy, 100, col, col);
  } else if (kind === 'gamer') { // a dark plate with its own light
    const w = 1100, x = right - w, h = 380, y = cy - h / 2;
    g.roundRect(x - 14, y - 14, w + 28, h + 28, 40).fill({ color: acc, alpha: 0.16 });
    g.roundRect(x, y, w, h, 28).fill(lgrad('#171b25', '#07090d')).stroke({ width: 10, color: acc, alpha: 0.95 });
    logoMark(g, x + w / 2 - 330, y + 70, 200, '#e8ecf8', acc);
    text('TIER 3', x + w / 2 + 170, y + h / 2, 130, '#f0f3fc', 0.95);
  } else { // two angled plates
    const w = 900, lean = 120;
    for (const k of [0, 1] as const) {
      const x = right - (2 - k) * w - (1 - k) * 120, y = r.y + 140, h = r.h - 280;
      g.poly([x + lean, y, x + w, y, x + w - lean, y + h, x, y + h]).fill(lgrad('#20252f', '#080a0f')).stroke({ width: 7, color: SILVER, alpha: 0.8 });
      g.poly([x + lean + 30, y + 24, x + w - 30, y + 24]).stroke({ width: 5, color: acc, alpha: 0.9 });
      if (k === 0) logoMark(g, x + w / 2 - 90, cy - 110, 180, '#eef1f9', acc);
      else text('PC-4', x + w / 2, cy, 150, '#eef1f9', 0.95);
    }
  }
}


/**
 * The rear panel from outside, in the same side profile as inside the case (ports.ts): the wall's sheet at the case's west edge and
 * each connector passing through it (only the part that sits in the wall shows, the glass hides the rest). Audio, ethernet (if the
 * board has it), HDMI, DisplayPort (if it has a second output), USB, and the jack of every NIC card.
 */
function rearIo(g: Graphics, T: Theme, o: ExteriorOpts) {
  const c = tones(T), f = o.features, q = BR.io;
  const fitted = (id: string) => (id === 'eth' ? f.ethernetMbps > 0 : id === 'dp' ? f.displayPorts >= 2 : id.startsWith('usb') ? Number(id.slice(3)) < f.usbPorts : true);
  shieldSheet(g, T, IO_X + 14, q.y + 20, WALL_T - 28, q.h - 40);
  for (const p of IO_PORTS) portProfile(g, T, p, fitted(p.id), { wallX: IO_X, wallW: WALL_T, depth: WALL_T - 24 });
  if (f.ethernetMbps > 0) {
    const e = IO_PORTS.find((p) => p.id === 'eth')!;
    for (const lx of [e.x + 50, e.x + 110]) g.circle(lx, e.y + e.h / 2 + 36, 11).fill({ color: '#05070c' }).stroke({ width: 3, color: c.edge, alpha: 0.7 });
  }
  // NIC cards: their jack comes out of the rear wall at the height of the card's slot
  for (const i of o.nics ?? []) {
    const j = nicJack(i);
    portProfile(g, T, { id: `nic${i}`, kind: 'rj45', x: j.x, y: nicY(i), w: j.w, h: j.h }, true, { wallX: IO_X, wallW: WALL_T, depth: WALL_T - 24 });
    for (const lx of [j.x + 50, j.x + 112]) g.circle(lx, j.y + j.h + 30, 11).fill({ color: '#05070c' }).stroke({ width: 3, color: c.edge, alpha: 0.7 });
  }
  // graphics cards: an HDMI port at the height of the card's slot
  for (const i of o.gpus ?? []) {
    const p = gpuPort(i);
    portProfile(g, T, { id: `gpu${i}`, kind: 'hdmi', x: p.x, y: p.y + p.h / 2, w: p.w, h: p.h }, true, { wallX: IO_X, wallW: WALL_T, depth: WALL_T - 24 });
  }
}

export type StripMode = 'off' | 'idle' | 'halt' | 'work' | 'error' | 'dead';

/** What the accent strip should say right now (from the snapshot only). */
export function stripModeOf(s: Snapshot | null): StripMode {
  if (!s) return 'off';
  if (s.board?.burnt) return 'dead';
  if (s.phase === 'error' || s.power.tripped) return 'error';
  if (!s.powered) return 'off';
  const ph = s.phase;
  if (ph === 'halted') return 'halt';
  return ph === 'posting' || ph === 'mounting' || ph === 'loading' || ph === 'running' || ph === 'writing' || ph === 'booting-os' || ph === 'ingesting' || ph === 'running-os' || ph === 'flashing' ? 'work' : 'idle';
}

/**
 * The accent strip and the drive-front LEDs. `t` is game time in ms (frozen while paused); `wall` is wall time in ms. Off: unlit;
 * idle: a dim steady glow; halted: a steady amber glow (on, but finished or waiting for a boot key); working: a bright pulse that
 * travels down the strip; error blinks red on wall time (an alarm: a pause must not leave it stuck bright); dead is a steady dim red.
 */
export function drawStrip(g: Graphics, T: Theme, mode: StripMode, t: number, disk: number, drives: { slot: string }[], wall = t) {
  g.clear();
  const { x, y0, y1, w } = stripRect(), len = y1 - y0, c = tones(T);
  const col = mode === 'error' || mode === 'dead' ? T.bad : mode === 'halt' ? T.ld : T.alu;
  if (mode === 'off') {
    box(g, x, y0, w, len, 10, { fill: mix(c.shade, T.bg, 0.3), fa: 0.9 });
  } else {
    const base = mode === 'idle' ? 0.34 : mode === 'halt' ? 0.5 : mode === 'work' ? 0.5 : mode === 'dead' ? 0.4 : 0.35 + 0.65 * (Math.floor(wall / 420) % 2);
    box(g, x - 22, y0 - 10, w + 44, len + 20, 22, { fill: col, fa: 0.05 * (base + 0.3) });
    box(g, x, y0, w, len, 10, { fill: col, fa: base });
    if (mode === 'work') {
      const seg = 1000, u = (t / 2600) % 1, y = y0 - seg + (len + seg) * u, a = Math.max(y0, y), b = Math.min(y1, y + seg);
      if (b > a) {
        box(g, x - 24, a, w + 48, b - a, 24, { fill: col, fa: 0.16 });
        box(g, x - 4, a, w + 8, b - a, 12, { fill: '#ffffff', fa: 0.55 });
      }
    }
  }
  // drive-front activity LEDs (lit only while a drive is busy)
  for (const d of drives) {
    if (!d.slot.startsWith('sata')) continue; // an M.2 stick has no front LED
    const cell = Number(d.slot.slice(4));
    if (!BAY_CELLS[cell]) continue;
    const l = frontLed(cell), a = disk;
    if (a > 0.02) g.circle(l.x, l.y, 30).fill({ color: T.ld, alpha: 0.3 * a });
    g.circle(l.x, l.y, 14).fill({ color: a > 0.02 ? T.ld : mix(T.ld, T.bg, 0.8), alpha: a > 0.02 ? 0.4 + 0.6 * a : 0.7 }).stroke({ width: 3, color: c.edge, alpha: 0.8 });
  }
}

/** Rect the exterior covers (for the bake frame), a little beyond `CASE` for the feet and the shadow. */
export const exteriorFrame = (): Rect => ({ x: CASE.x - 60, y: CASE.y - 40, w: CASE.w + 140, h: CASE.h + 240 });
