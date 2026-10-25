import type { Rect } from './layout';

// Pin maps: where a trace lands on a part. The art of a part (boardParts.ts / boardArt.ts) and the router (routes.ts) both read these
// functions, so a lane always ends on a pin that is drawn, never beside it. Pure geometry: nothing here draws or imports Pixi.

export type Pt = [number, number];
export type Side = 'n' | 's' | 'e' | 'w';

// ---- the CPU package's pins: three rows round its edge (see `cpuArt` in devices.ts), 20 apart, the outer row 24 inside the edge ----
export const PKG_PIN = 20, PKG_ROW = 24;
/** `n` pads of the package's outer pin row on one side, `step` pins apart, centred on `at` (a y for the east and west sides, an x for north and south). */
export function pkgPads(pkg: Rect, side: Side, at: number, n: number, step = 1): Pt[] {
  const across = side === 'n' || side === 's', base = (across ? pkg.x : pkg.y) + 70, last = Math.floor(((across ? pkg.w : pkg.h) - 140) / PKG_PIN);
  const first = Math.max(0, Math.min(last - (n - 1) * step, Math.round((at - ((n - 1) * step * PKG_PIN) / 2 - base) / PKG_PIN)));
  return Array.from({ length: n }, (_, i) => {
    const c = base + PKG_PIN * (first + i * step);
    switch (side) {
      case 'e': return [pkg.x + pkg.w - PKG_ROW, c] as Pt;
      case 'w': return [pkg.x + PKG_ROW, c] as Pt;
      case 'n': return [c, pkg.y + PKG_ROW] as Pt;
      default: return [c, pkg.y + pkg.h - PKG_ROW] as Pt;
    }
  });
}

// ---- QFP-style chips: legs along the sides, centred, 26 apart ----
export const LEG_PITCH = 26;
/** How far a leg's tip lies outside the chip body (the lane ends on the middle of the leg). */
export const LEG_OUT = 8;
/** Legs that fit along a side of this length. */
export const legCount = (len: number, pitch = LEG_PITCH) => Math.max(1, Math.floor((len - 60) / pitch) + 1);
/** Leg i of n on one side: centred along the side. */
export function legAt(r: Rect, side: Side, i: number, n: number, pitch = LEG_PITCH): Pt {
  const t = (i - (n - 1) / 2) * pitch;
  switch (side) {
    case 'n': return [r.x + r.w / 2 + t, r.y - LEG_OUT];
    case 's': return [r.x + r.w / 2 + t, r.y + r.h + LEG_OUT];
    case 'w': return [r.x - LEG_OUT, r.y + r.h / 2 + t];
    default: return [r.x + r.w + LEG_OUT, r.y + r.h / 2 + t];
  }
}
/** Every leg of a side. */
export const legsOf = (r: Rect, side: Side, n = legCount(side === 'n' || side === 's' ? r.w : r.h), pitch = LEG_PITCH): Pt[] =>
  Array.from({ length: n }, (_, i) => legAt(r, side, i, n, pitch));
/** `k` consecutive legs of a side from leg index `first`. */
export const legsFrom = (r: Rect, side: Side, first: number, k: number, pitch = LEG_PITCH): Pt[] => {
  const n = legCount(side === 'n' || side === 's' ? r.w : r.h, pitch);
  return Array.from({ length: k }, (_, i) => legAt(r, side, first + i, n, pitch));
};
/** `k` consecutive legs of a side, centred on the side's middle leg (the middle of the side, or `shift` legs off it). */
export function legRun(r: Rect, side: Side, k: number, shift = 0, pitch = LEG_PITCH): Pt[] {
  const n = legCount(side === 'n' || side === 's' ? r.w : r.h, pitch);
  const first = Math.round((n - k) / 2 + shift);
  return Array.from({ length: k }, (_, i) => legAt(r, side, first + i, n, pitch));
}

// ---- DIMM sockets: a pad bar across the data end (row 0: the south end, row 1: the north end) ----
export const MEM_LANES = 6, MEM_SPACING = 18;
/** The six data pads of a socket, inside its housing end. */
export function dimmPads(r: Rect, flip: boolean): Pt[] {
  const cx = r.x + r.w / 2, y = flip ? r.y + 30 : r.y + r.h - 30;
  return Array.from({ length: MEM_LANES }, (_, k) => [cx + (k - (MEM_LANES - 1) / 2) * MEM_SPACING, y] as Pt);
}
/** The memory-voltage pad of a socket, at the far end beside the latch. */
export const dimmPowerPad = (r: Rect, flip: boolean): Pt => [r.x + 36, flip ? r.y + r.h - 30 : r.y + 30];

// ---- PCIe slots: staggered SMT pads along both long edges, 40 apart (every second pin on each side) ----
export const PCIE_PAD = 40;
/** x of pad k along a slot. */
export const pciePadX = (r: Rect, k: number) => r.x + 20 + PCIE_PAD * k;
/** The last pad index that clears the retention latch. */
export const pciePadMax = (r: Rect) => Math.floor((r.w - 120) / PCIE_PAD);
/** `n` pads on the top (`side` 'n') or bottom ('s') edge, ending at the slot's latch end (or `back` pads before it). */
export function pciePads(r: Rect, n: number, side: 'n' | 's', back = 0): Pt[] {
  const last = pciePadMax(r) - back;
  return Array.from({ length: n }, (_, j) => [pciePadX(r, last - (n - 1) + j) + (side === 's' ? 20 : 0), side === 'n' ? r.y : r.y + r.h] as Pt);
}

// ---- M.2 sockets: nine contacts at the west end, 22 apart, centred; the three signal lanes use the middle ones ----
export const M2_PITCH = 22, M2_CONTACTS = 9;
/** All eight contacts of a socket (x is where the pad sits, just inside the housing's west edge). */
export function m2Contacts(m: Rect): Pt[] {
  return Array.from({ length: M2_CONTACTS }, (_, k) => [m.x + 40, m.y + m.h / 2 + (k - (M2_CONTACTS - 1) / 2) * M2_PITCH] as Pt);
}
export const m2Pads = (m: Rect): Pt[] => m2Contacts(m).slice(3, 6);

// ---- SATA ports: three signal pads on the west edge, 26 apart ----
export const SATA_LANES = 3, SATA_PAD = 26;
export const sataPads = (p: Rect): Pt[] => Array.from({ length: SATA_LANES }, (_, k) => [p.x + 8, p.y + p.h / 2 + (k - 1) * SATA_PAD] as Pt);

// ---- pin headers: pins on a 52 grid (see `header()` in boardParts.ts) ----
export const HDR_PITCH = 52;
/** Centre of the pin at column i, row j of a header at (x, y). */
export const headerPin = (x: number, y: number, i: number, j: number): Pt => [x + 12 + i * HDR_PITCH + 24, y + 12 + j * HDR_PITCH + 24];

// ---- power connectors ----
/** The four 12 V pins of the CPU's 8-pin connector (the first row of cavities, mouth up): the traces start on the connector's south side. */
export function cpuPowerPins(r: Rect): Pt[] {
  const pitch = (r.w - 80) / 4;
  return Array.from({ length: 4 }, (_, i) => [r.x + 40 + (i + 0.5) * pitch, r.y + r.h - 30] as Pt);
}
/** The 24-pin's top pin on its west column: the 12 V feed to the memory regulator leaves from here. */
export const atx12v = (r: Rect): Pt => [r.x + 75, r.y + 66];

// ---- rear I/O: connectors on the west edge, mouths facing west ----
export interface IoPort { id: string; kind: 'jack' | 'rj45' | 'hdmi' | 'dp' | 'usb'; x: number; y: number; w: number; h: number; tone?: string }
/** n pads, 26 apart, centred on a connector's row, just behind its rear (east) end, where its traces arrive. */
export const ioPads = (p: IoPort, n: number): Pt[] => Array.from({ length: n }, (_, k) => [p.x + p.w + 2, p.y + (k - (n - 1) / 2) * 26] as Pt);

// ---- VRM power stages: seven legs down the west side (see `powerStage` in boardParts.ts) ----
/** The tip of west leg i of a power stage at (x, y), size s. */
export const stageLeg = (x: number, y: number, s: number, i: number): Pt => [x - 8, y + (i + 0.7) * (s / 7.4) + 5.5];
/** The control leg of a CPU VRM phase block / a memory VRM phase block (the controller's lane lands here). */
export const cpuStageCtl = (r: Rect): Pt => stageLeg(r.x + 24, r.y + 40, 130, 3);
export const dramStageCtl = (r: Rect): Pt => stageLeg(r.x + 14, r.y + 30, 90, 3);
