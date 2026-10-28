import { Container, Graphics } from 'pixi.js';
import { box, disc, label, mix } from '../ink';
import { BAY_CELLS, CELL_W, M2_SLOTS, type Rect } from './layout';
import type { Theme } from '../theme';

// Drive art. Static casing (`driveArt`) plus the parts that move while the drive is busy (`drawDriveLive`: HDD platter and
// head arm, activity LEDs), redrawn by Live from the game clock. All geometry is in world units.

export type DriveKind = 'hdd' | 'ssd-sata' | 'ssd-nvme';

export const driveKindOf = (visual: string): DriveKind => (visual === 'ssd-nvme' ? 'ssd-nvme' : visual === 'ssd-sata' ? 'ssd-sata' : 'hdd');

/** Index of a slot id: sata3 -> 3, m21 -> 1 (the number after the type). */
export const slotIndex = (slot: string): number => Number(slot.replace(/^(sata|m2)/, '')) || 0;

/** The SATA drives are drawn at this design size (a cell of 700 x 500) and scaled to the cell of the cage. */
const DESIGN = { w: 700, h: 500 };
export const driveScale = () => CELL_W / DESIGN.w;
/** Body of a SATA drive in design coordinates (relative to its cell). */
const bodyLocal = (kind: DriveKind): Rect => (kind === 'hdd' ? { x: 46, y: 28, w: 640, h: 444 } : { x: 46, y: 78, w: 520, h: 344 });

/** Body rect of a drive of this kind sitting in a cage cell (SATA) or on an M.2 slot, in world coordinates. */
export function driveBody(kind: DriveKind, slot: string): Rect {
  if (kind === 'ssd-nvme') { const m = M2_SLOTS[slotIndex(slot)] ?? M2_SLOTS[0]!; return { x: m.x + 112, y: m.y + 52, w: m.w - 112 - 96, h: m.h - 104 }; }
  const c = BAY_CELLS[slotIndex(slot)]!, k = driveScale(), b = bodyLocal(kind);
  return { x: c.x + b.x * k, y: c.y + b.y * k, w: b.w * k, h: b.h * k };
}

/** The small OS chip on the drive that hosts the OS (hover / select / highlight / flyTo id `os`). */
export function osBadgeRect(kind: DriveKind, slot: string): Rect {
  const b = driveBody(kind, slot);
  const k = kind === 'ssd-nvme' ? 1 : driveScale();
  return kind === 'ssd-nvme' ? { x: b.x + b.w / 2 - 70, y: b.y - 74, w: 140, h: 62 } : { x: b.x + 14 * k, y: b.y + 12 * k, w: 140 * k, h: 62 * k };
}

/** Cell/slot rect that a drive of this slot occupies (drop target). */
export const slotRect = (slot: string): Rect => (slot.startsWith('m2') ? M2_SLOTS[slotIndex(slot)]! : BAY_CELLS[slotIndex(slot)]!);

const metal = (T: Theme) => (T.dark ? '#2c3548' : '#b4bdcc');
const metalHi = (T: Theme) => (T.dark ? '#3a4660' : '#cdd5e2');

/** Static casing, centred nowhere: drawn straight in world coordinates. */
export function driveArt(T: Theme, kind: DriveKind, slot: string, name: string, capLabel: string): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const ink = T.dark ? '#e2eaff' : '#18203a';
  if (kind === 'ssd-nvme') {
    const b = driveBody(kind, slot);
    // M.2 2280 stick lying along the slot: gold fingers inside the connector (west), controller and NAND on the board, a slim finned
    // heat spreader over the NAND, a notch at the east end where the standoff screw holds it down
    box(g, b.x + 8, b.y + 12, b.w, b.h, 12, { fill: '#000000', fa: 0.28 });
    g.roundRect(b.x, b.y, b.w, b.h, 12).fill({ color: T.dark ? '#142330' : '#2f4a55' }).stroke({ width: 5, color: T.mul, alpha: 0.8 });
    g.circle(b.x + b.w, b.y + b.h / 2, 40).fill({ color: T.dark ? '#05070c' : '#c9d2df' }); // the notch (the screw sits in it)
    for (let i = 0; i < 12; i++) g.rect(b.x - 46, b.y + 22 + i * ((b.h - 44) / 12), 62, (b.h - 44) / 12 - 6);
    g.fill({ color: T.pin, alpha: 0.9 });
    box(g, b.x + 80, b.y + 50, 170, b.h - 100, 8, { fill: mix('#10151e', T.alu, 0.12), stroke: T.alu, lw: 3, sa: 0.5 }); // controller
    box(g, b.x + 290, b.y + 48, 330, b.h - 96, 8, { fill: '#10151e', stroke: T.line, lw: 3 }); // NAND
    box(g, b.x + 650, b.y + 48, 330, b.h - 96, 8, { fill: '#10151e', stroke: T.line, lw: 3 });
    const sp = { x: b.x + 270, y: b.y + 20, w: 740, h: b.h - 40 };
    box(g, sp.x, sp.y, sp.w, sp.h, 10, { fill: metalHi(T), stroke: T.alu, lw: 4, sa: 0.6 });
    for (let k = 0; k < 14; k++) g.moveTo(sp.x + 40 + k * 50, sp.y + 14).lineTo(sp.x + 40 + k * 50, sp.y + sp.h - 14);
    g.stroke({ width: 6, color: T.alu, alpha: 0.35 });
    return root;
  }
  // a SATA drive is drawn at its design size from the cell's corner and scaled to the cell of the cage
  const cell0 = { x: 0, y: 0, w: DESIGN.w, h: DESIGN.h }, cell = slotRect(slot), b = { ...bodyLocal(kind) };
  root.position.set(cell.x, cell.y); root.scale.set(driveScale());
  // SATA data and power connectors on the west edge of the casing
  const connectors = () => {
    const cell = cell0;
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
  // a SATA drive is drawn in design coordinates from its cell's corner, scaled to the cell; the M.2 stick in world coordinates
  const sata = kind !== 'ssd-nvme', cell = sata ? slotRect(slot) : null;
  g.position.set(cell?.x ?? 0, cell?.y ?? 0); g.scale.set(sata ? driveScale() : 1);
  const b = sata ? bodyLocal(kind) : driveBody(kind, slot);
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
    led(g, T, b.x + b.w - 130, b.y + b.h / 2, st);
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
