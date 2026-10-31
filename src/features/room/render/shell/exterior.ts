import { Container, Graphics } from 'pixi.js';
import type { Snapshot } from '@/worker/protocol';
import { IO_PORTS, IO_X } from '@/features/board/render/layout/boardlayout';
import { acInlet, portProfile, shieldSheet } from '@/features/board/render/layout/ports';
import { box, disc, label, lgrad, mix } from '@/core/render/ink';
import { BAY_CELLS, BR, CASE, CASE_GLASS, CASE_IN, CASE_LEDS, CASE_PANEL, LAYOUT_CASE, PC_POWER, PSU, REAR_FAN, WALL_T, gpuPort, nicJack, nicY, type Rect } from '@/features/board/render/layout/layout';
import { CASE_LOOK } from '../desk/props/case';
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
function brush(g: Graphics, x: number, y: number, w: number, h: number, T: Theme, step = 34) {
  for (let yy = y + step / 2, k = 0; yy < y + h; yy += step, k++) g.moveTo(x, yy).lineTo(x + w, yy).stroke({ width: 5, color: k % 2 ? '#ffffff' : '#000000', alpha: T.dark ? 0.028 : 0.05 });
}

/**
 * How each case tier looks from outside, beyond its size: the colour of its body, its trim, its accent light and how round it is.
 * Mini: a pale aluminium shell, soft corners, amber light. Micro: matte black, cyan. Mid: gunmetal with brass trim, violet.
 * Full: graphite with an aluminium frame, square corners and an RGB light line under the glass.
 */
interface CaseStyle { mixTo: string; k: number; accent: (T: Theme) => string; trim: (T: Theme) => string | null; rad: number; rgb: boolean }
const STYLES: CaseStyle[] = [
  { mixTo: '#c4cfe4', k: 0.34, accent: (T) => T.ld, trim: () => null, rad: 160, rgb: false },
  { mixTo: '#000000', k: 0.3, accent: (T) => T.alu, trim: () => null, rad: 120, rgb: false },
  { mixTo: '#000000', k: 0.02, accent: (T) => T.mul, trim: (T) => T.pin, rad: 90, rgb: false },
  { mixTo: '#000000', k: 0.2, accent: (T) => T.br, trim: (T) => T.alu, rad: 60, rgb: true },
];
const styleOf = (): CaseStyle => STYLES[LAYOUT_CASE] ?? STYLES[2]!;

/** The body tones of the current tier: the shared steel tones mixed toward the tier's colour. */
function bodyTones(T: Theme, st: CaseStyle) {
  const c = exteriorTones(T), m = (v: string) => mix(v, st.mixTo, st.k);
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
  const ink = d ? '#dfe7ff' : '#1a2338', dim = d ? '#8d9bc4' : '#2a3550';

  // the feet (rubber pads on the small cases, wider blocks on the full tower, which also throws a little light on the desk) and the soft shadow
  const fw = [300, 360, 400, 560][LAYOUT_CASE] ?? 400;
  for (const fx of [c0.x + 300, c0.x + c0.w - 300 - fw]) {
    box(g, fx, c0.y + c0.h - 40, fw, 150, 34, { fill: c.shade, stroke: c.edge, lw: 6, sa: 0.5 });
    g.rect(fx + 30, c0.y + c0.h - 40, fw - 60, 5).fill({ color: '#ffffff', alpha: d ? 0.08 : 0.3 });
    if (st.rgb) g.rect(fx + 20, c0.y + c0.h + 100, fw - 40, 8).fill({ color: acc, alpha: 0.55 });
  }
  box(g, c0.x + 24, c0.y + 40, c0.w, c0.h, R, { fill: '#000000', fa: d ? 0.4 : 0.16 });
  box(g, c0.x + 60, c0.y + c0.h + 40, c0.w - 80, 120, 60, { fill: '#000000', fa: d ? 0.22 : 0.1 });

  // body: brushed metal lit from the top left, with a bevelled rim and a soft light band down the side
  g.roundRect(c0.x, c0.y, c0.w, c0.h, R).fill(lgrad(c.hi, c.lo, [0.25, 1])).stroke({ width: 12, color: c.edge, alpha: 0.9 });
  g.roundRect(c0.x + 14, c0.y + 14, c0.w - 28, c0.h - 28, R - 10).fill(lgrad(d ? '#ffffff12' : '#ffffff30', '#ffffff00', [1, 0.2]));
  brush(g, c0.x + 40, c0.y + 40, c0.w - 80, c0.h - 80, T);
  bevel(g, c0.x + 16, c0.y + 16, c0.w - 32, c0.h - 32, R - 10, T);

  // top panel: a recessed plate with an accent hairline, the brand, a row of vents and the light window for the status LEDs
  g.roundRect(p.x + 36, p.y + 36, p.w - 72, p.h - 52, 40).fill(lgrad(c.mid, c.lo)).stroke({ width: 6, color: c.edge, alpha: 0.6 });
  g.rect(p.x + 70, p.y + 44, p.w - 140, 10).fill({ color: '#000000', alpha: d ? 0.3 : 0.12 });
  g.rect(p.x + 90, p.y + p.h - 34, p.w - 180, 5).fill({ color: acc, alpha: 0.5 });
  const nv = CASE_LOOK[LAYOUT_CASE]?.vents ?? 16;
  for (let k = 0; k < nv; k++) box(g, -2250 + k * 78, p.y + 120, 30, 190, 15, { fill: c.cut });
  box(g, CASE_LEDS.disk - 120, p.y + 70, CASE_LEDS.err - CASE_LEDS.disk + 240, 250, 40, { fill: c.cut, stroke: c.edge, lw: 5, sa: 0.5 });
  root.addChild(label(`PIPELINE CITY · ${CASE_LOOK[LAYOUT_CASE]?.tag ?? ''}`, -3560, p.y + 205, 92, ink, { head: true, a: 0.55 }));
  root.addChild(label('DISK', CASE_LEDS.disk, p.y + 340, 34, dim, { anchor: [0.5, 0.5], a: 0.9 }));
  for (const [t, x] of [['ON', CASE_LEDS.on], ['OFF', CASE_LEDS.off], ['ERR', CASE_LEDS.err]] as const) root.addChild(label(t, x, p.y + 340, 34, dim, { anchor: [0.5, 0.5], a: 0.9 }));

  // rear I/O plate (west): a panel with the external connectors cut into it
  const io = { x: c0.x + 30, y: ci.y, w: BR.io.x + BR.io.w + 60 - (c0.x + 30), h: gl.h };
  g.roundRect(io.x, io.y, io.w, io.h, 30).fill(lgrad(c.mid, c.lo)).stroke({ width: 6, color: c.edge, alpha: 0.7 });
  brush(g, io.x + 10, io.y + 10, io.w - 20, io.h - 20, T, 40);
  rearIo(g, T, o);
  root.addChild(label('REAR I/O', io.x + 24, io.y + 70, 56, dim, { head: true, a: 0.6 }));
  // the rear fan, the expansion slot covers and the top fans are inside: only their vents show on the plate
  for (let k = 0; k < Math.min(5, Math.floor((REAR_FAN.h - 40) / 70)); k++) box(g, io.x + 40, REAR_FAN.y + 60 + k * 70, 120, 26, 13, { fill: c.cut, fa: 0.75 });

  // the glass side: a bezel (the tier's trim colour where it has one), a dark gasket, then the window itself, a hole in the body
  // with a thin smoked pane over it, so the real interior shows through at every zoom
  const win = { x: BR.io.x + BR.io.w + 110, y: gl.y + 56, w: gl.x + gl.w - 56 - (BR.io.x + BR.io.w + 110), h: gl.h - 112 };
  const bz = 44;
  g.roundRect(win.x - bz, win.y - bz, win.w + 2 * bz, win.h + 2 * bz, 76).fill(lgrad(trim ? mix(trim, c.hi, 0.5) : c.mid, trim ? mix(trim, c.lo, 0.5) : c.lo)).stroke({ width: 6, color: c.edge, alpha: 0.6 });
  bevel(g, win.x - bz + 4, win.y - bz + 4, win.w + 2 * bz - 8, win.h + 2 * bz - 8, 70, T, 0.8);
  box(g, win.x - 16, win.y - 16, win.w + 32, win.h + 32, 62, { fill: c.shade });
  const hole = new Graphics();
  hole.blendMode = 'erase';
  hole.roundRect(win.x, win.y, win.w, win.h, 50).fill('#000000');
  const pane = new Graphics();
  root.addChild(hole, pane);
  pane.roundRect(win.x, win.y, win.w, win.h, 50).fill(lgrad(c.glassTop, c.glassBot));
  pane.alpha = d ? 0.4 : 0.34;
  const top = new Graphics();
  root.addChild(top);
  const refl = (x0: number, w: number, a: number) => top.poly([win.x + x0, win.y + 8, win.x + x0 + w, win.y + 8, win.x + x0 + w - 1500, win.y + win.h - 8, win.x + x0 - 1500, win.y + win.h - 8]).fill({ color: '#ffffff', alpha: a });
  const ra = d ? 0.05 : 0.08;
  refl(3200, 700, ra); refl(4200, 150, ra * 0.8); refl(7500, 500, ra * 0.7);
  box(top, win.x + 14, win.y + 14, win.w - 28, win.h - 28, 40, { stroke: '#ffffff', lw: 5, sa: d ? 0.1 : 0.3 });
  // the light line under the glass: a thin accent on every tier, a full RGB line on the top one
  if (st.rgb) {
    const ly = win.y + win.h - 54, lx0 = win.x + 120, lw = win.w - 240;
    top.roundRect(lx0, ly - 24, lw, 56, 28).fill(lgrad(acc + '00', acc + '40', [0, 1]));
    top.roundRect(lx0, ly, lw, 10, 5).fill(lgrad(acc, T.alu, [1, 0]));
  } else top.roundRect(win.x + 160, win.y + win.h - 40, win.w - 320, 6, 3).fill({ color: acc, alpha: 0.5 });
  for (const [x, y] of [[win.x - 6, win.y + 70], [win.x + win.w + 6, win.y + 70], [win.x - 6, win.y + win.h - 70], [win.x + win.w + 6, win.y + win.h - 70]] as const) {
    disc(top, x, y, 26, { fill: mix(c.hi, c.lo, 0.3), stroke: c.edge, lw: 4, sa: 0.8 }); top.moveTo(x - 13, y).lineTo(x + 13, y).stroke({ width: 4, color: c.shade, alpha: 0.7 });
  }

  // PSU compartment: a brushed panel with a perforated intake (the drive cage is inside, behind the glass)
  const lowY = gl.y + gl.h, lowH = ci.y + ci.h - lowY;
  g.roundRect(ci.x, lowY, ci.w, lowH, 36).fill(lgrad(c.mid, c.lo)).stroke({ width: 6, color: c.edge, alpha: 0.5 });
  brush(g, ci.x + 10, lowY + 10, ci.w - 20, lowH - 20, T, 40);
  bevel(g, ci.x + 10, lowY + 10, ci.w - 20, lowH - 20, 30, T, 0.7);
  if (trim) g.rect(ci.x + 40, lowY + 14, ci.w - 80, 6).fill({ color: trim, alpha: 0.5 });
  const mesh = { x: PSU.x + 120, y: PSU.y + 60, w: 3300, h: PSU.h - 120 };
  box(g, mesh.x, mesh.y, mesh.w, mesh.h, 40, { fill: c.cut, stroke: c.edge, lw: 5, sa: 0.6 });
  for (let y = mesh.y + 60; y < mesh.y + mesh.h - 40; y += 64) for (let x = mesh.x + 60 + (Math.round((y - mesh.y) / 64) % 2) * 32; x < mesh.x + mesh.w - 40; x += 64) g.circle(x, y, 13);
  g.fill({ color: c.glassTop, alpha: 1 });
  g.rect(mesh.x + 20, mesh.y + 20, mesh.w - 40, 4).fill({ color: '#ffffff', alpha: 0.04 });
  // the mains inlet in the rear wall at the PSU's end (the cord is drawn by the room)
  acInlet(g, T, PC_POWER, { wallX: IO_X, wallW: WALL_T });
  // the badge beside the intake: a plate of the body's metal with the name pressed into it (a lit edge above each letter's shadow)
  const npx = mesh.x + mesh.w + 260, np = { x: npx, y: PSU.y + 250, w: Math.min(4200, ci.x + ci.w - 300 - npx), h: 620 };
  box(g, np.x + 8, np.y + 14, np.w, np.h, 36, { fill: '#000000', fa: d ? 0.3 : 0.12 });
  g.roundRect(np.x, np.y, np.w, np.h, 36).fill(lgrad(mix(c.mid, c.hi, 0.5), mix(c.mid, c.lo, 0.4))).stroke({ width: 5, color: c.edge, alpha: 0.7 });
  bevel(g, np.x + 6, np.y + 6, np.w - 12, np.h - 12, 30, T, 0.8);
  g.rect(np.x + 80, np.y + np.h - 150, np.w - 160, 8).fill({ color: acc, alpha: 0.8 });
  skyline(g, T, np, acc, c.shade);
  // dark bodies carry light lettering with a shadow under it, light bodies a pressed dark one with a lit edge under it
  const press = d ? '#b4c0e4' : '#25304a';
  root.addChild(label('PIPELINE CITY', np.x + np.w / 2, np.y + 256, 230, d ? '#000000' : '#ffffff', { head: true, anchor: [0.5, 0.5], a: d ? 0.45 : 0.55 }));
  root.addChild(label('PIPELINE CITY', np.x + np.w / 2, np.y + 250, 230, press, { head: true, anchor: [0.5, 0.5], a: 0.85 }));
  root.addChild(label(`MODEL PC-${LAYOUT_CASE + 1} · TEMPERED GLASS EDITION`, np.x + np.w / 2, np.y + np.h - 70, 50, press, { anchor: [0.5, 0.5], a: 0.7 }));

  // front rim: a slim vertical vent column east of the glass
  const STRIP = stripRect();
  for (let k = 0; k < Math.floor((STRIP.y1 - STRIP.y0 - 260) / 215) + 1; k++) box(g, STRIP.x + 62, STRIP.y0 + 260 + k * 215, 16, 120, 8, { fill: c.cut, fa: 0.8 });
  box(g, STRIP.x - 6, STRIP.y0 - 6, STRIP.w + 12, STRIP.y1 - STRIP.y0 + 12, 12, { fill: c.cut, stroke: c.edge, lw: 3, sa: 0.5 });
  traces(g, T, win, bz, acc, st.rgb);
  hazard(g, T, { x: ci.x + 40, y: lowY + lowH - 54, w: mesh.x - ci.x - 80 }, trim ?? acc);
  stickers(root, T, { x: mesh.x + mesh.w + 60, y: np.y - 120, w: np.x - (mesh.x + mesh.w + 60) + np.w, h: np.h + 240 }, acc);
  return root;
}

const tones = exteriorTones;

/** A tiny deterministic generator, so the art is the same on every build and in every test. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** The city: an etched skyline on the badge plate (towers with lit windows, a chimney, a crane), under the name. */
function skyline(g: Graphics, T: Theme, np: Rect, acc: string, shade: string) {
  const r = rng(7 + LAYOUT_CASE), base = np.y + np.h - 128, x1 = np.x + np.w - 80;
  let x = np.x + 80;
  while (x < x1 - 60) {
    const w = Math.min(x1 - x, 90 + Math.floor(r() * 150)), h = 70 + Math.floor(r() * r() * 330);
    g.rect(x, base - h, w, h).fill({ color: shade, alpha: T.dark ? 0.55 : 0.3 });
    g.rect(x, base - h, w, 5).fill({ color: '#ffffff', alpha: T.dark ? 0.1 : 0.35 });
    if (r() < 0.25) g.rect(x + w * 0.4, base - h - 50, w * 0.12, 50).fill({ color: shade, alpha: T.dark ? 0.55 : 0.3 });
    for (let wy = base - h + 26; wy < base - 24; wy += 34) for (let wx = x + 16; wx < x + w - 24; wx += 32) if (r() < 0.38) g.rect(wx, wy, 14, 18).fill({ color: acc, alpha: 0.75 });
    x += w + 14;
  }
  // a tower crane on the tallest side
  const cx = np.x + np.w * 0.78;
  g.moveTo(cx, base - 40).lineTo(cx, base - 420).moveTo(cx - 150, base - 420).lineTo(cx + 260, base - 420).moveTo(cx + 230, base - 420).lineTo(cx + 230, base - 340).stroke({ width: 7, color: shade, alpha: T.dark ? 0.6 : 0.4 });
  g.circle(cx - 150, base - 420, 9).fill({ color: acc, alpha: 0.9 });
}

/** Circuit traces that run out of the glass bezel's corners across the body, with solder pads on their ends: the machine's veins. */
function traces(g: Graphics, T: Theme, win: Rect, bz: number, acc: string, glow: boolean) {
  const r = rng(11 + LAYOUT_CASE), a = glow ? 0.7 : 0.4;
  const run = (x: number, y: number, sx: number, sy: number, n: number) => {
    let px = x, py = y;
    g.moveTo(px, py);
    for (let k = 0; k < n; k++) {
      const len = 90 + Math.floor(r() * 150), diag = r() < 0.5;
      px += sx * len; py += diag ? sy * len * 0.6 : 0;
      g.lineTo(px, py);
      if (!diag) { py += sy * (50 + r() * 90); g.lineTo(px, py); }
    }
    g.stroke({ width: 9, color: acc, alpha: a, cap: 'round', join: 'round' });
    g.circle(px, py, 20).fill({ color: acc, alpha: a }).stroke({ width: 5, color: '#000000', alpha: 0.35 });
    g.circle(px, py, 7).fill({ color: '#000000', alpha: 0.6 });
  };
  const x0 = win.x - bz, x1 = win.x + win.w + bz, y1 = win.y + win.h + bz;
  run(x0 + 120, y1 + 4, -1, 1, 3);
  run(x0 + 230, y1 + 4, -1, 1, 2);
  run(x1 - 120, win.y - bz - 4, 1, -1, 2);
  run(x1 - 230, y1 + 4, 1, 1, 2);
}

/** A hazard stripe (diagonal bars in the trim colour on a dark band), the way a workshop marks a danger. */
function hazard(g: Graphics, T: Theme, b: { x: number; y: number; w: number }, col: string) {
  const h = 34;
  if (b.w < 200) return;
  g.roundRect(b.x, b.y, b.w, h, 8).fill({ color: '#000000', alpha: T.dark ? 0.55 : 0.4 });
  for (let x = b.x; x < b.x + b.w - 40; x += 60) g.poly([x, b.y + h, x + 24, b.y + h, x + 24 + 24, b.y, x + 24, b.y].map((v, i) => (i % 2 ? v : Math.min(v, b.x + b.w)))).fill({ color: col, alpha: 0.75 });
}

/** A few stickers stuck on the PSU compartment, a little crooked: a chip mascot, a warning, a bug crossed out and a version tag. */
function stickers(root: Container, T: Theme, b: Rect, acc: string) {
  const r = rng(23 + LAYOUT_CASE), ink = '#10162a', paper = [T.alu, T.ld, '#f2f4fb', T.br];
  const one = (fx: number, kind: number) => {
    const s = new Container(), g = new Graphics(), u = Math.min(b.h * 0.2, 260);
    s.position.set(b.x + b.w * fx, b.y + b.h * (0.2 + 0.5 * r())); s.rotation = (r() - 0.5) * 0.35;
    const col = paper[kind % paper.length]!;
    g.roundRect(-u * 0.5 + 8, -u * 0.5 + 12, u, u, u * 0.18).fill({ color: '#000000', alpha: 0.3 });
    g.roundRect(-u * 0.5, -u * 0.5, u, u, u * 0.18).fill(col).stroke({ width: 5, color: '#ffffff', alpha: 0.7 });
    if (kind === 0) { // a chip with eyes
      g.roundRect(-u * 0.26, -u * 0.22, u * 0.52, u * 0.44, 10).fill(ink);
      for (const sx of [-1, 1]) { g.circle(sx * u * 0.1, -u * 0.04, u * 0.07).fill('#ffffff'); g.circle(sx * u * 0.1 + 3, -u * 0.03, u * 0.03).fill(ink); g.moveTo(sx * u * 0.26, -u * 0.12).lineTo(sx * u * 0.36, -u * 0.12).moveTo(sx * u * 0.26, u * 0.1).lineTo(sx * u * 0.36, u * 0.1).stroke({ width: 8, color: ink, cap: 'round' }); }
      g.moveTo(-u * 0.09, u * 0.1).quadraticCurveTo(0, u * 0.18, u * 0.09, u * 0.1).stroke({ width: 6, color: '#ffffff', cap: 'round' });
    } else if (kind === 1) { // a warning triangle
      g.poly([0, -u * 0.34, u * 0.36, u * 0.28, -u * 0.36, u * 0.28]).fill(ink);
      g.rect(-5, -u * 0.12, 10, u * 0.22).fill(col); g.circle(0, u * 0.17, 7).fill(col);
    } else if (kind === 2) { // a bug, crossed out
      g.ellipse(0, 0, u * 0.14, u * 0.2).fill(ink);
      for (const sy of [-1, 0, 1]) for (const sx of [-1, 1]) g.moveTo(sx * u * 0.12, sy * u * 0.1).lineTo(sx * u * 0.3, sy * u * 0.17).stroke({ width: 6, color: ink, cap: 'round' });
      g.moveTo(-u * 0.34, -u * 0.34).lineTo(u * 0.34, u * 0.34).stroke({ width: 12, color: '#d23b3b', cap: 'round' });
    } else { // a pipeline mark: rising bars
      for (let k = 0; k < 4; k++) g.rect(-u * 0.3 + k * u * 0.16, u * 0.26 - (0.14 + k * 0.1) * u, u * 0.11, (0.14 + k * 0.1) * u).fill(ink);
    }
    s.addChild(g);
    root.addChild(s);
  };
  if (b.w < 600) return;
  one(0.1, 0); one(0.5, 1); one(0.9, 2); void acc;
  if (b.w > 1500) one(0.3, 3);
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
