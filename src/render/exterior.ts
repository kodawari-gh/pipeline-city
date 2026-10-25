import { Container, FillGradient, Graphics } from 'pixi.js';
import type { Snapshot } from '../sim/protocol';
import { IO_PORTS, IO_X } from './boardlayout';
import { portProfile, shieldSheet } from './ports';
import { box, disc, label, mix } from './ink';
import { BAY_CELLS, BR, CASE, CASE_GLASS, CASE_IN, CASE_LEDS, CASE_PANEL, LAYOUT_CASE, PSU, REAR_FAN, WALL_T, nicJack, nicY, type Rect } from './layout';
import { CASE_LOOK } from './case';
import type { DriveKind } from './drives';
import type { Theme } from './theme';

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
}

/** Where a cage drive's activity LED sits (world), by cell: on the front rim, level with its cell. */
export const frontLed = (cell: number) => ({ x: stripRect().x + 10, y: BAY_CELLS[cell]!.y + BAY_CELLS[cell]!.h / 2 });

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
  const nv = [10, 16, 22, 28][LAYOUT_CASE] ?? 22;
  for (let k = 0; k < nv; k++) box(g, -2500 + k * 78, p.y + 130, 34, 190, 17, { fill: c.cut });
  box(g, CASE_LEDS.disk - 120, p.y + 70, CASE_LEDS.err - CASE_LEDS.disk + 240, 250, 40, { fill: c.cut, stroke: c.edge, lw: 5, sa: 0.5 });
  root.addChild(label(`PIPELINE CITY · ${CASE_LOOK[LAYOUT_CASE]?.tag ?? ''}`, -3560, p.y + 200, 130, T.dark ? '#dfe7ff' : '#1a2338', { head: true, a: 0.5 }));
  root.addChild(label('DISK', CASE_LEDS.disk, p.y + 340, 34, T.dark ? '#8d9bc4' : '#2a3550', { anchor: [0.5, 0.5], a: 0.9 }));
  for (const [t, x] of [['ON', CASE_LEDS.on], ['OFF', CASE_LEDS.off], ['ERR', CASE_LEDS.err]] as const) root.addChild(label(t, x, p.y + 340, 34, T.dark ? '#8d9bc4' : '#2a3550', { anchor: [0.5, 0.5], a: 0.9 }));

  // rear I/O plate (west): a panel with the external connectors cut into it
  const io = { x: c0.x + 30, y: ci.y, w: BR.io.x + BR.io.w + 60 - (c0.x + 30), h: gl.h };
  g.roundRect(io.x, io.y, io.w, io.h, 30).fill(vgrad(c.mid, c.lo)).stroke({ width: 6, color: c.edge, alpha: 0.7 });
  brush(g, io.x + 10, io.y + 10, io.w - 20, io.h - 20, T, 40);
  rearIo(g, T, o);
  root.addChild(label('REAR I/O', io.x + 24, io.y + 70, 56, T.dark ? '#8d9bc4' : '#2a3550', { head: true, a: 0.6 }));
  // the rear fan, the expansion slot covers and the top fans are inside: only their vents show on the plate
  for (let k = 0; k < Math.min(5, Math.floor((REAR_FAN.h - 40) / 70)); k++) box(g, io.x + 40, REAR_FAN.y + 60 + k * 70, 120, 26, 13, { fill: c.cut, fa: 0.75 });

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

  // PSU compartment: brushed panel with a perforated intake (the drive cage is inside, behind the glass)
  const lowY = gl.y + gl.h, lowH = ci.y + ci.h - lowY;
  g.roundRect(ci.x, lowY, ci.w, lowH, 36).fill(vgrad(c.mid, c.lo)).stroke({ width: 6, color: c.edge, alpha: 0.5 });
  brush(g, ci.x + 10, lowY + 10, ci.w - 20, lowH - 20, T, 40);
  const mesh = { x: PSU.x + 120, y: PSU.y + 60, w: 3300, h: PSU.h - 120 };
  box(g, mesh.x, mesh.y, mesh.w, mesh.h, 40, { fill: c.cut, stroke: c.edge, lw: 5, sa: 0.6 });
  for (let y = mesh.y + 60; y < mesh.y + mesh.h - 40; y += 64) for (let x = mesh.x + 60 + (Math.round((y - mesh.y) / 64) % 2) * 32; x < mesh.x + mesh.w - 40; x += 64) g.circle(x, y, 13);
  g.fill({ color: c.glassTop, alpha: 1 });
  g.rect(mesh.x + 20, mesh.y + 20, mesh.w - 40, 4).fill({ color: '#ffffff', alpha: 0.04 });
  // nameplate beside the intake, along the lower front
  const npx = mesh.x + mesh.w + 260, np = { x: npx, y: PSU.y + 250, w: Math.min(4200, ci.x + ci.w - 300 - npx), h: 620 };
  box(g, np.x, np.y, np.w, np.h, 36, { fill: c.cut, stroke: c.edge, lw: 5, sa: 0.6 });
  g.rect(np.x + 60, np.y + np.h - 130, np.w - 120, 8).fill({ color: T.alu, alpha: 0.55 });
  root.addChild(label('PIPELINE CITY', np.x + np.w / 2, np.y + 250, 230, T.dark ? '#dfe7ff' : '#e9eefb', { head: true, anchor: [0.5, 0.5], a: 0.8 }));
  root.addChild(label(`MODEL PC-${LAYOUT_CASE + 1} · TEMPERED GLASS EDITION`, np.x + np.w / 2, np.y + np.h - 70, 50, T.dark ? '#8d9bc4' : '#aeb8d0', { anchor: [0.5, 0.5], a: 0.8 }));

  // front rim: a slim vertical vent column east of the glass
  const STRIP = stripRect();
  for (let k = 0; k < Math.floor((STRIP.y1 - STRIP.y0 - 260) / 215) + 1; k++) box(g, STRIP.x + 62, STRIP.y0 + 260 + k * 215, 16, 120, 8, { fill: c.cut, fa: 0.8 });
  box(g, STRIP.x - 6, STRIP.y0 - 6, STRIP.w + 12, STRIP.y1 - STRIP.y0 + 12, 12, { fill: c.cut, stroke: c.edge, lw: 3, sa: 0.5 });
  return root;
}

const tones = exteriorTones;

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
