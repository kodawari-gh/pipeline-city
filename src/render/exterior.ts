import { Container, FillGradient, Graphics } from 'pixi.js';
import type { Snapshot } from '../sim/protocol';
import { box, disc, label, mix } from './ink';
import { BAY, BAY_CELLS, BR, CASE, CASE_GLASS, CASE_IN, CASE_LEDS, CASE_PANEL, PSU, VIDEO_Y, type Rect } from './layout';
import type { DriveKind } from './drives';
import type { Theme } from './theme';

// The far-zoom exterior of the PC: an opaque chassis (brushed panels, a smoked glass side with only a faint reflection, vents, feet,
// the top panel, the drive bay front and the rear I/O plate) that replaces the interior when the camera is far away. It shares the
// case rectangle (`CASE`) with the interior view, so the power button, its lights, the USB port, the video cable and the key tray
// (all external things, drawn by props.ts / live.ts above this layer) stay exactly where they are.
//
// Static art is built once per (theme, tier, drives) and baked to one texture by board.ts; the accent strip is the only live part.

/** The thin accent light strip on the front rim of the case (a vertical bar east of the glass). */
export const STRIP = { x: 5178, y0: -2560, y1: 2440, w: 20 };

export interface ExteriorOpts {
  /** SATA cells this tier has (1 or 2). */
  nSata: number;
  /** Drives mounted in the bay (NVMe lives on the board, not in the bay, and is not visible from outside). */
  drives: { slot: string; kind: DriveKind }[];
  /** External connectors this board offers (ethernetMbps 0 = no jack). */
  features: { ethernetMbps: number; usbPorts: number; displayPorts: number };
}

/** Where a bay-front drive's activity LED sits (world), by cell. */
export const frontLed = (cell: number) => ({ x: BAY_CELLS[cell]!.x + BAY_CELLS[cell]!.w - 60, y: BAY_CELLS[cell]!.y + BAY_CELLS[cell]!.h - 70 });

/** USB-A positions on the rear panel in fill order (usb0 is the one keys plug into: `USB_PORT`). */
export const USB_POS: [number, number][] = [[0, 0], [0, 150], [1, 0], [1, 150]];

const vgrad = (top: string, bot: string) => new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: top }, { offset: 1, color: bot }], textureSpace: 'local' });

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

/** The static exterior (world coordinates, around `CASE`). */
export function exteriorArt(T: Theme, o: ExteriorOpts): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const c = tones(T), c0 = CASE, p = CASE_PANEL, gl = CASE_GLASS, ci = CASE_IN;

  // feet and soft shadow
  for (const fx of [c0.x + 300, c0.x + c0.w - 700]) box(g, fx, c0.y + c0.h - 40, 400, 150, 34, { fill: c.shade, stroke: c.edge, lw: 6, sa: 0.5 });
  box(g, c0.x + 24, c0.y + 40, c0.w, c0.h, 120, { fill: '#000000', fa: T.dark ? 0.4 : 0.16 });

  // body: brushed steel with a lit top edge and a darker lower edge
  g.roundRect(c0.x, c0.y, c0.w, c0.h, 120).fill(vgrad(c.hi, c.lo)).stroke({ width: 12, color: c.edge, alpha: 0.9 });
  brush(g, c0.x + 40, c0.y + 40, c0.w - 80, c0.h - 80, T);
  g.roundRect(c0.x + 16, c0.y + 14, c0.w - 32, 8, 4).fill({ color: '#ffffff', alpha: T.dark ? 0.1 : 0.55 });

  // top panel: a darker strip with a vent row and the light window for the status LEDs
  g.roundRect(p.x + 36, p.y + 36, p.w - 72, p.h - 52, 40).fill(vgrad(c.mid, c.lo)).stroke({ width: 6, color: c.edge, alpha: 0.6 });
  for (let k = 0; k < 26; k++) box(g, -2500 + k * 78, p.y + 130, 34, 190, 17, { fill: c.cut });
  box(g, CASE_LEDS.disk - 120, p.y + 70, CASE_LEDS.err - CASE_LEDS.disk + 240, 250, 40, { fill: c.cut, stroke: c.edge, lw: 5, sa: 0.5 });
  root.addChild(label('PIPELINE CITY', -3560, p.y + 200, 130, T.dark ? '#dfe7ff' : '#1a2338', { head: true, a: 0.5 }));
  root.addChild(label('DISK', CASE_LEDS.disk, p.y + 340, 34, T.dark ? '#8d9bc4' : '#2a3550', { anchor: [0.5, 0.5], a: 0.9 }));
  for (const [t, x] of [['ON', CASE_LEDS.on], ['OFF', CASE_LEDS.off], ['ERR', CASE_LEDS.err]] as const) root.addChild(label(t, x, p.y + 340, 34, T.dark ? '#8d9bc4' : '#2a3550', { anchor: [0.5, 0.5], a: 0.9 }));

  // rear I/O plate (west): a panel with the external connectors cut into it
  const io = { x: ci.x, y: ci.y, w: BR.io.x + BR.io.w + 60 - ci.x, h: gl.h };
  g.roundRect(io.x, io.y, io.w, io.h, 30).fill(vgrad(c.mid, c.lo)).stroke({ width: 6, color: c.edge, alpha: 0.7 });
  brush(g, io.x + 10, io.y + 10, io.w - 20, io.h - 20, T, 40);
  rearIo(g, T, o);
  root.addChild(label('REAR I/O', io.x + 24, io.y + 70, 56, T.dark ? '#8d9bc4' : '#2a3550', { head: true, a: 0.6 }));

  // tempered glass side: smoked, opaque, a faint diagonal reflection and a hairline edge. Nothing of the inside shows.
  const win = { x: BR.io.x + BR.io.w + 110, y: gl.y + 56, w: gl.x + gl.w - 56 - (BR.io.x + BR.io.w + 110), h: gl.h - 112 };
  box(g, win.x - 26, win.y - 26, win.w + 52, win.h + 52, 70, { fill: c.shade, stroke: c.edge, lw: 6, sa: 0.5 });
  g.roundRect(win.x, win.y, win.w, win.h, 50).fill(vgrad(c.glassTop, c.glassBot));
  const refl = (x0: number, w: number, a: number) => g.poly([win.x + x0, win.y + 8, win.x + x0 + w, win.y + 8, win.x + x0 + w - 1500, win.y + win.h - 8, win.x + x0 - 1500, win.y + win.h - 8]).fill({ color: '#ffffff', alpha: a });
  const ra = T.dark ? 0.045 : 0.07;
  refl(3200, 700, ra); refl(4200, 150, ra * 0.8); refl(7500, 500, ra * 0.7);
  box(g, win.x + 14, win.y + 14, win.w - 28, win.h - 28, 40, { stroke: '#ffffff', lw: 5, sa: T.dark ? 0.08 : 0.3 });
  for (const [x, y] of [[win.x - 6, win.y + 70], [win.x + win.w + 6, win.y + 70], [win.x - 6, win.y + win.h - 70], [win.x + win.w + 6, win.y + win.h - 70]] as const) {
    disc(g, x, y, 26, { fill: mix(c.hi, c.lo, 0.3), stroke: c.edge, lw: 4, sa: 0.8 }); g.moveTo(x - 13, y).lineTo(x + 13, y).stroke({ width: 4, color: c.shade, alpha: 0.7 });
  }

  // PSU compartment: brushed panel with a perforated intake and the drive bay front
  const lowY = gl.y + gl.h, lowH = ci.y + ci.h - lowY;
  g.roundRect(ci.x, lowY, ci.w, lowH, 36).fill(vgrad(c.mid, c.lo)).stroke({ width: 6, color: c.edge, alpha: 0.5 });
  brush(g, ci.x + 10, lowY + 10, ci.w - 20, lowH - 20, T, 40);
  const mesh = { x: PSU.x + 120, y: PSU.y + 60, w: 3300, h: PSU.h - 120 };
  box(g, mesh.x, mesh.y, mesh.w, mesh.h, 40, { fill: c.cut, stroke: c.edge, lw: 5, sa: 0.6 });
  for (let y = mesh.y + 60; y < mesh.y + mesh.h - 40; y += 64) for (let x = mesh.x + 60 + (Math.round((y - mesh.y) / 64) % 2) * 32; x < mesh.x + mesh.w - 40; x += 64) g.circle(x, y, 13);
  g.fill({ color: c.glassTop, alpha: 1 });
  g.rect(mesh.x + 20, mesh.y + 20, mesh.w - 40, 4).fill({ color: '#ffffff', alpha: 0.04 });
  // nameplate between the intake and the bay
  const np = { x: mesh.x + mesh.w + 260, y: PSU.y + 250, w: 2600, h: 620 };
  box(g, np.x, np.y, np.w, np.h, 36, { fill: c.cut, stroke: c.edge, lw: 5, sa: 0.6 });
  g.rect(np.x + 60, np.y + np.h - 130, np.w - 120, 8).fill({ color: T.alu, alpha: 0.55 });
  root.addChild(label('PIPELINE CITY', np.x + np.w / 2, np.y + 250, 230, T.dark ? '#dfe7ff' : '#e9eefb', { head: true, anchor: [0.5, 0.5], a: 0.8 }));
  root.addChild(label('MODEL PC-1 · TEMPERED GLASS EDITION', np.x + np.w / 2, np.y + np.h - 70, 50, T.dark ? '#8d9bc4' : '#aeb8d0', { anchor: [0.5, 0.5], a: 0.8 }));
  bayFront(g, root, T, o);

  // front rim: a slim vertical vent column east of the glass
  for (let k = 0; k < 22; k++) box(g, STRIP.x + 62, -2300 + k * 215, 16, 120, 8, { fill: c.cut, fa: 0.8 });
  box(g, STRIP.x - 6, STRIP.y0 - 6, STRIP.w + 12, STRIP.y1 - STRIP.y0 + 12, 12, { fill: c.cut, stroke: c.edge, lw: 3, sa: 0.5 });
  return root;
}

const tones = exteriorTones;

/** External connectors on the rear plate: audio, ethernet (if the board has it), HDMI, DisplayPort (if it has a second output), USB. */
function rearIo(g: Graphics, T: Theme, o: ExteriorOpts) {
  const c = tones(T), q = BR.io, f = o.features;
  const cut = (x: number, y: number, w: number, h: number, tongue: string | null, ta = 0.55) => {
    box(g, x - 12, y - h / 2 - 12, w + 24, h + 24, 14, { fill: c.lo, stroke: c.edge, lw: 4, sa: 0.5 });
    box(g, x, y - h / 2, w, h, 8, { fill: c.cut });
    if (tongue) g.rect(x + 18, y - h * 0.12, w - 36, h * 0.24).fill({ color: tongue, alpha: ta });
  };
  ([[T.st], [T.br], [T.ld]] as const).forEach(([col], k) => cut(q.x + 30 + k * 215, -1870, 180, 90, col, 0.65));
  if (f.ethernetMbps > 0) {
    cut(q.x + 30, -1560, 330, 260, null);
    for (let k = 0; k < 8; k++) g.rect(q.x + 70 + k * 30, -1640, 14, 70);
    g.fill({ color: T.pin, alpha: 0.55 });
    g.rect(q.x + 50, -1405, 40, 22).fill({ color: T.st, alpha: 0.7 });
    g.rect(q.x + 130, -1405, 40, 22).fill({ color: T.ld, alpha: 0.7 });
  }
  const hdmi = (y: number, active: boolean) => {
    box(g, q.x - 12, y - 72, 264, 144, 16, { fill: c.lo, stroke: c.edge, lw: 4, sa: 0.5 });
    g.poly([q.x, y - 34, q.x + 26, y - 60, q.x + 240, y - 60, q.x + 240, y + 60, q.x + 26, y + 60, q.x, y + 34]).fill({ color: c.cut }).stroke({ width: 6, color: active ? T.st : c.edge, alpha: active ? 0.7 : 0.6 });
  };
  hdmi(VIDEO_Y, true);
  if (f.displayPorts >= 2) hdmi(VIDEO_Y + 220, false);
  USB_POS.forEach(([col, y], i) => {
    if (i < f.usbPorts) cut(q.x + 18 + col * 320, y, 290, 108, T.alu, 0.5);
    else box(g, q.x + 18 + col * 320, y - 54, 290, 108, 10, { stroke: c.edge, lw: 3, sa: 0.25 });
  });
}

/** The 2-position drive bay front: a recessed housing, a faceplate per mounted drive, a blanking plate per empty or absent cell. */
function bayFront(g: Graphics, root: Container, T: Theme, o: ExteriorOpts) {
  const c = tones(T), b = BAY;
  box(g, b.x, b.y, b.w, b.h, 24, { fill: c.cut, stroke: c.edge, lw: 6, sa: 0.7 });
  BAY_CELLS.forEach((cell, i) => {
    const drive = o.drives.find((d) => d.slot === `sata${i}`), real = i < o.nSata;
    if (drive) {
      const hdd = drive.kind === 'hdd';
      const f = hdd ? { x: cell.x + 36, y: cell.y + 30, w: cell.w - 36, h: cell.h - 60 } : { x: cell.x + 36, y: cell.y + 90, w: cell.w - 36, h: cell.h - 180 };
      box(g, f.x + 6, f.y + 10, f.w, f.h, 16, { fill: '#000000', fa: 0.3 });
      g.roundRect(f.x, f.y, f.w, f.h, 16).fill(hdd ? vgrad(T.dark ? '#59627a' : '#dfe5ef', T.dark ? '#323a4e' : '#aeb8c9') : vgrad(T.dark ? '#262d3f' : '#4a556c', T.dark ? '#141925' : '#323c52')).stroke({ width: 5, color: c.edge, alpha: 0.8 });
      brush(g, f.x + 8, f.y + 8, f.w - 16, f.h - 16, T, 22);
      for (let k = 0; k < 6; k++) g.rect(f.x + 40, f.y + f.h * 0.22 + k * 20, f.w * 0.5, 7);
      g.fill({ color: '#000000', alpha: hdd ? 0.2 : 0.4 });
      box(g, f.x + f.w * 0.62, f.y + f.h * 0.18, f.w * 0.3, f.h * 0.3, 8, { fill: hdd ? '#e8edf6' : T.mul, fa: hdd ? 0.85 : 0.35 });
      root.addChild(label(hdd ? 'HDD' : 'SSD', f.x + f.w * 0.77, f.y + f.h * 0.33, hdd ? 54 : 50, hdd ? '#2a3350' : '#dfe7ff', { head: true, anchor: [0.5, 0.5], a: 0.8 }));
    } else if (real) {
      box(g, cell.x + 36, cell.y + 24, cell.w - 36, cell.h - 48, 16, { fill: c.mid, stroke: c.edge, lw: 4, sa: 0.5 });
      for (let k = 0; k < 9; k++) box(g, cell.x + 90, cell.y + 70 + k * 42, cell.w - 150, 10, 5, { fill: c.cut });
    } else {
      box(g, cell.x + 36, cell.y + 24, cell.w - 36, cell.h - 48, 16, { fill: c.lo, stroke: c.edge, lw: 3, sa: 0.3 });
    }
  });
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
  return ph === 'posting' || ph === 'loading' || ph === 'running' || ph === 'writing' || ph === 'booting-os' || ph === 'ingesting' || ph === 'running-os' || ph === 'flashing' ? 'work' : 'idle';
}

/**
 * The accent strip and the drive-front LEDs. `t` is game time in ms (frozen while paused); `wall` is wall time in ms. Off: unlit;
 * idle: a dim steady glow; halted: a steady amber glow (on, but finished or waiting for a boot key); working: a bright pulse that
 * travels down the strip; error blinks red on wall time (an alarm: a pause must not leave it stuck bright); dead is a steady dim red.
 */
export function drawStrip(g: Graphics, T: Theme, mode: StripMode, t: number, disk: number, drives: { slot: string }[], wall = t) {
  g.clear();
  const { x, y0, y1, w } = STRIP, len = y1 - y0, c = tones(T);
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
    const i = d.slot === 'sata1' ? 1 : 0, l = frontLed(i), a = disk;
    if (a > 0.02) g.circle(l.x, l.y, 30).fill({ color: T.ld, alpha: 0.3 * a });
    g.circle(l.x, l.y, 14).fill({ color: a > 0.02 ? T.ld : mix(T.ld, T.bg, 0.8), alpha: a > 0.02 ? 0.4 + 0.6 * a : 0.7 }).stroke({ width: 3, color: c.edge, alpha: 0.8 });
  }
}

/** Rect the exterior covers (for the bake frame), a little beyond `CASE` for the feet and the shadow. */
export const EXTERIOR_FRAME: Rect = { x: CASE.x - 60, y: CASE.y - 40, w: CASE.w + 140, h: CASE.h + 240 };
