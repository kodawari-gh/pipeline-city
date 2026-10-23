import { Container, Graphics } from 'pixi.js';
import { box, disc, label, mix } from './ink';
import { BAY_CELLS, BR, type Rect } from './layout';
import type { Theme } from './theme';

// Drive art. Static casing (`driveArt`) plus the parts that move while the drive is busy (`drawDriveLive`: HDD platter and
// head arm, activity LEDs), redrawn by Live from the game clock. All geometry is in world units.

export type DriveKind = 'hdd' | 'ssd-sata' | 'ssd-nvme';

export const driveKindOf = (visual: string): DriveKind => (visual === 'ssd-nvme' ? 'ssd-nvme' : visual === 'ssd-sata' ? 'ssd-sata' : 'hdd');

/** Body rect of a drive of this kind sitting in a bay cell (SATA) or on the M.2 slot. */
export function driveBody(kind: DriveKind, slot: string): Rect {
  if (kind === 'ssd-nvme') { const m = BR.m2; return { x: m.x + 25, y: m.y + 30, w: m.w - 50, h: m.h - 190 }; }
  const c = BAY_CELLS[slot === 'sata1' ? 1 : 0]!;
  return kind === 'hdd' ? { x: c.x + 46, y: c.y + 28, w: 640, h: 444 } : { x: c.x + 46, y: c.y + 78, w: 520, h: 344 };
}

/** Cell/slot rect that a drive of this slot occupies (drop target). */
export const slotRect = (slot: string): Rect => (slot === 'm20' ? BR.m2 : BAY_CELLS[slot === 'sata1' ? 1 : 0]!);

const metal = (T: Theme) => (T.dark ? '#2c3548' : '#b4bdcc');
const metalHi = (T: Theme) => (T.dark ? '#3a4660' : '#cdd5e2');

/** Static casing, centred nowhere: drawn straight in world coordinates. */
export function driveArt(T: Theme, kind: DriveKind, slot: string, name: string, capLabel: string): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const b = driveBody(kind, slot);
  const cell = slotRect(slot);
  const ink = T.dark ? '#e2eaff' : '#18203a';
  if (kind === 'ssd-nvme') {
    // M.2 stick: green-black PCB with gold fingers at the bottom, controller, NAND, a heat spreader over the upper part
    box(g, b.x + 4, b.y + 8, b.w, b.h, 10, { fill: '#000000', fa: 0.25 });
    box(g, b.x, b.y, b.w, b.h, 10, { fill: T.dark ? '#142330' : '#2f4a55', stroke: T.mul, lw: 5, sa: 0.8 });
    const fy = b.y + b.h - 150;
    for (let i = 0; i < 12; i++) g.rect(b.x + 12 + i * ((b.w - 24) / 12), fy + 40, (b.w - 24) / 12 - 4, 100);
    g.fill({ color: T.pin, alpha: 0.9 });
    box(g, b.x + 20, b.y + 260, b.w - 40, 190, 8, { fill: '#10151e', stroke: T.line, lw: 3 }); // NAND (shown through the gap)
    box(g, b.x + 20, b.y + 500, b.w - 40, 170, 8, { fill: '#10151e', stroke: T.line, lw: 3 });
    // heat spreader: slim plate with fins covering the controller end
    const sp = { x: b.x - 6, y: b.y + 20, w: b.w + 12, h: 220 };
    box(g, sp.x, sp.y, sp.w, sp.h, 10, { fill: metalHi(T), stroke: T.alu, lw: 4, sa: 0.6 });
    for (let k = 0; k < 4; k++) g.moveTo(sp.x + 14, sp.y + 36 + k * 44).lineTo(sp.x + sp.w - 14, sp.y + 36 + k * 44);
    g.stroke({ width: 6, color: T.alu, alpha: 0.35 });
    box(g, b.x + 20, b.y + 700, b.w - 40, 260, 8, { fill: mix('#10151e', T.alu, 0.12), stroke: T.alu, lw: 3, sa: 0.5 }); // controller
    disc(g, b.x + b.w / 2, b.y + b.h - 8, 20, { fill: metal(T), stroke: T.line, lw: 4 });
    return root;
  }
  // SATA data and power connectors on the west edge of the casing
  const connectors = () => {
    box(g, cell.x - 4, cell.y + 112, 52, 46, 6, { fill: '#0b0f18', stroke: T.line, lw: 3 });
    g.rect(cell.x + 8, cell.y + 124, 28, 8).rect(cell.x + 8, cell.y + 140, 28, 8).fill({ color: T.pin, alpha: 0.8 });
    box(g, cell.x - 4, cell.y + 300, 52, 118, 6, { fill: '#0b0f18', stroke: T.line, lw: 3 });
    for (let i = 0; i < 5; i++) g.rect(cell.x + 8, cell.y + 312 + i * 21, 28, 9);
    g.fill({ color: T.pin, alpha: 0.8 });
  };
  connectors();
  if (kind === 'hdd') {
    box(g, b.x + 10, b.y + 14, b.w, b.h, 18, { fill: '#000000', fa: 0.25 });
    box(g, b.x, b.y, b.w, b.h, 18, { fill: metal(T), stroke: mix(T.line, T.mute, 0.5), lw: 7 });
    g.rect(b.x + 14, b.y + 14, b.w - 28, 10).fill({ color: '#ffffff', alpha: T.dark ? 0.06 : 0.35 });
    // platter bay (the platter and head arm are drawn live above this)
    disc(g, b.x + 235, b.y + 222, 200, { fill: T.dark ? '#0d121c' : '#7e8899', stroke: mix(T.line, T.mute, 0.4), lw: 6 });
    // label sticker
    box(g, b.x + 465, b.y + 40, 150, 360, 10, { fill: T.dark ? '#d6dcec' : '#f4f6fb', fa: T.dark ? 0.82 : 0.95, stroke: T.line, lw: 3 });
    g.rect(b.x + 485, b.y + 62, 110, 12).rect(b.x + 485, b.y + 90, 70, 12).fill({ color: '#334', alpha: 0.5 });
    root.addChild(label(capLabel, b.x + 540, b.y + 200, 52, '#243', { anchor: [0.5, 0.5], head: true, a: 0.9 }));
    root.addChild(label('HDD', b.x + 540, b.y + 330, 40, '#445', { anchor: [0.5, 0.5], a: 0.8 }));
    for (const [sx, sy] of [[b.x + 36, b.y + 36], [b.x + 36, b.y + b.h - 36], [b.x + b.w - 36, b.y + 36], [b.x + b.w - 36, b.y + b.h - 36]] as const) disc(g, sx, sy, 11, { fill: mix(T.line, '#000000', 0.4) });
  } else {
    // SATA SSD: slim 2.5" casing with a window onto the PCB: controller, NAND, a status LED
    box(g, b.x + 8, b.y + 12, b.w, b.h, 22, { fill: '#000000', fa: 0.25 });
    box(g, b.x, b.y, b.w, b.h, 22, { fill: metal(T), stroke: mix(T.line, T.mute, 0.5), lw: 7 });
    g.rect(b.x + 18, b.y + 14, b.w - 36, 8).fill({ color: '#ffffff', alpha: T.dark ? 0.06 : 0.35 });
    const w = { x: b.x + 40, y: b.y + 70, w: 300, h: 204 };
    box(g, w.x, w.y, w.w, w.h, 10, { fill: T.dark ? '#142330' : '#2f4a55', stroke: T.line, lw: 4 });
    box(g, w.x + 24, w.y + 28, 100, 100, 8, { fill: '#10151e', stroke: T.mul, lw: 4, sa: 0.9 }); // controller
    g.rect(w.x + 160, w.y + 30, 112, 56).rect(w.x + 160, w.y + 112, 112, 56).fill({ color: '#10151e' });
    g.stroke({ width: 3, color: T.line });
    for (let i = 0; i < 8; i++) g.rect(w.x + 40 + i * 28, w.y + w.h - 26, 14, 14);
    g.fill({ color: T.pin, alpha: 0.7 });
    root.addChild(label('SSD', b.x + 420, b.y + 120, 56, ink, { anchor: [0.5, 0.5], head: true, a: 0.75 }));
    root.addChild(label(capLabel, b.x + 420, b.y + 215, 40, ink, { anchor: [0.5, 0.5], a: 0.6 }));
    for (const [sx, sy] of [[b.x + 24, b.y + 24], [b.x + 24, b.y + b.h - 24], [b.x + b.w - 24, b.y + 24], [b.x + b.w - 24, b.y + b.h - 24]] as const) disc(g, sx, sy, 8, { fill: mix(T.line, '#000000', 0.4) });
  }
  return root;
}

export interface DriveLiveState {
  /** Platter rotation (rad) and head arm swing 0..1. */
  spin: number;
  head: number;
  /** 0..1 activity LED brightness. */
  led: number;
  burnt: boolean;
}

/** The moving parts and LEDs, drawn on a cleared Graphics (world coordinates). */
export function drawDriveLive(g: Graphics, T: Theme, kind: DriveKind, slot: string, st: DriveLiveState) {
  g.clear();
  const b = driveBody(kind, slot);
  if (kind === 'hdd') {
    const cx = b.x + 235, cy = b.y + 222, R = 190;
    // platter disc with a few rings and two spokes so the rotation reads
    disc(g, cx, cy, R, { fill: T.dark ? '#1b2333' : '#98a3b6', stroke: T.alu, lw: 3, sa: 0.35 });
    for (const rr of [150, 105, 62]) g.circle(cx, cy, rr);
    g.stroke({ width: 3, color: T.alu, alpha: 0.22 });
    for (let k = 0; k < 2; k++) {
      const a = st.spin + k * Math.PI;
      g.moveTo(cx + Math.cos(a) * 36, cy + Math.sin(a) * 36).lineTo(cx + Math.cos(a) * (R - 14), cy + Math.sin(a) * (R - 14));
    }
    g.stroke({ width: 10, color: T.alu, alpha: 0.5, cap: 'round' });
    disc(g, cx, cy, 30, { fill: metalHi(T), stroke: T.line, lw: 4 });
    // head arm: pivot bottom-right of the platter, swings across it while busy, parks at the rim otherwise
    const px = b.x + 395, py = b.y + 400, len = 330;
    const ang = Math.PI * (1.12 + 0.22 * st.head);
    const ex = px + Math.cos(ang) * len, ey = py + Math.sin(ang) * len;
    g.moveTo(px, py).lineTo(ex, ey).stroke({ width: 22, color: mix(T.mute, T.ink, 0.3), cap: 'round', alpha: 0.95 });
    g.moveTo(px, py).lineTo(ex, ey).stroke({ width: 6, color: '#ffffff', alpha: 0.18, cap: 'round' });
    disc(g, px, py, 24, { fill: metalHi(T), stroke: T.line, lw: 4 });
    disc(g, ex, ey, 12, { fill: T.ld });
    led(g, T, b.x + b.w - 36, b.y + b.h - 78, st);
  } else if (kind === 'ssd-sata') {
    led(g, T, b.x + b.w - 44, b.y + b.h - 44, st);
  } else {
    led(g, T, b.x + b.w / 2, b.y + b.h - 70, st);
  }
  if (st.burnt) {
    box(g, b.x, b.y, b.w, b.h, 18, { fill: T.bg, fa: 0.6 });
    g.moveTo(b.x + b.w * 0.2, b.y + b.h * 0.2).lineTo(b.x + b.w * 0.8, b.y + b.h * 0.8).moveTo(b.x + b.w * 0.8, b.y + b.h * 0.2).lineTo(b.x + b.w * 0.2, b.y + b.h * 0.8);
    g.stroke({ width: 16, color: T.bad, alpha: 0.85, cap: 'round' });
  }
}

function led(g: Graphics, T: Theme, x: number, y: number, st: DriveLiveState) {
  if (st.led > 0.02) g.circle(x, y, 34).fill({ color: T.ld, alpha: 0.3 * st.led });
  g.circle(x, y, 15).fill({ color: st.led > 0.02 ? T.ld : mix(T.ld, T.bg, 0.8), alpha: st.led > 0.02 ? 0.4 + 0.6 * st.led : 0.7 }).stroke({ width: 4, color: T.line, alpha: 0.8 });
}
