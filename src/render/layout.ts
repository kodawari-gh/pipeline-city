// World layout (arbitrary pixel units at zoom 1). The CPU socket sits at the origin on every board.
//
//   monitor | motherboard (IO on its west edge, power connectors on its east / top edges) | cable gutter
//           |            PSU shroud below, full width of the board plus the gutter           |
//
// Everything on the board is placed here on purpose (no random scatter); buses are routed in routes.ts.
//
// Boards are different form factors (`boardlayout.ts`): the geometry that depends on the board tier is a **live binding** (`export let`)
// that `setLayoutTier(tier)` reassigns. The renderer calls it first thing when it builds a scene, so every importer sees the current
// tier's rectangles; never copy one of these into a module-level constant.

import { DRAM_BH, DRAM_BW, DIMM_H0, DIMM_W0, IO_X, geoOf, type TierGeo } from './boardlayout';

export interface Rect { x: number; y: number; w: number; h: number }

/** Deterministic PRNG (mulberry32). The board art is the same on every load. */
export function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BOARD_SEED = 1337;

// ---- CPU: package, die, floorplan (centred on the origin) ----
export const DIE: Rect = { x: -710, y: -565, w: 1420, h: 1130 };
export const PKG: Rect = { x: -900, y: -755, w: 1800, h: 1510 };
/** The cooler plate that sits on the package. */
export const COOLER: Rect = { x: -790, y: -690, w: 1580, h: 1380 };
/** Socket frame is PKG grown by this much; buses start at its edge. */
export const SOCKET_E = 46;

export interface Tile extends Rect { id: string; label: string; sub: string }
const tile = (id: string, label: string, sub: string, x: number, y: number, w: number, h: number): Tile => ({ id, label, sub, x, y, w, h });
const STEP = 260;
const STAGE_LABELS: [string, string][] = [['IF', 'fetch'], ['ID', 'decode'], ['EX', 'execute'], ['MEM', 'memory'], ['WB', 'write back']];
/** Pipeline stage tiles, in order IF ID EX MEM WB. */
export const STAGES: Tile[] = STAGE_LABELS.map(([n, s], k) => tile(n, n, s, k * STEP - 620, -145, 200, 190));
/** Other floorplan blocks (decor, except those that light up from counters). */
export const BLOCKS: Tile[] = [
  tile('IC', 'I-CACHE', '', -620, -295, 200, 100),
  tile('BP', 'BRANCH PRED', '', -360, -295, 200, 100),
  tile('CLK', 'CLOCK', '', -100, -295, 200, 100),
  tile('DC', 'D-CACHE', '', 160, -295, 200, 100),
  tile('RF', 'REGISTERS', '', 420, -335, 200, 140),
  tile('UNCORE', 'UNCORE', '', -620, -475, 520, 150),
  tile('MC', 'MEM CTRL', '', 160, -475, 200, 150),
  tile('IO', 'I/O', '', 420, -475, 200, 120),
  tile('L2', 'L2 CACHE', '', -620, 245, 1240, 230),
];
export const CHIP_W = 156;
export const CHIP_H = 78;
/** Centre of the chip slot inside a stage tile. */
export const stageCentre = (s: number) => ({ x: STAGES[s]!.x + 100, y: STAGES[s]!.y + 105 });

// ---- the board of the current tier (live bindings: reassigned by setLayoutTier) ----
const EMPTY: Rect = { x: 0, y: 0, w: 0, h: 0 };
const bound = (rs: Rect[]): Rect => {
  if (!rs.length) return EMPTY;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  return { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 };
};

export type RegionId = 'vrm' | 'dvrm' | 'pcie' | 'chip' | 'io' | 'atx' | 'cpw' | 'pciew' | 'm2' | 'sata' | 'hex' | 'qr' | 'audio' | 'bat';

/** The tier's geometry (every rect of the board). */
export let GEO: TierGeo = geoOf(2);
export let BD: Rect = GEO.bd;
/** Named board regions, for hover and for the art. A region the tier lacks is an empty rect (see `REGIONS`, which skips it). */
export let BR: Record<RegionId, Rect> = regionsOf(GEO);
/** The board tier and the case tier the layout is set to. The case holds boards up to its tier: it is as big as the biggest board it holds. */
export let LAYOUT_TIER = 2;
export let LAYOUT_CASE = 2;
/** The board area of the case (the outline of the biggest board it holds): the motherboard tray, the cable gutter and the front fans follow it. */
export let CASE_BD: Rect = GEO.bd;

function regionsOf(g: TierGeo): Record<RegionId, Rect> {
  return {
    vrm: g.vrm, dvrm: g.dvrm, pcie: bound(g.pcie), chip: g.chip, io: g.io, atx: g.atx, cpw: g.cpw, pciew: g.pciew ?? EMPTY,
    m2: bound(g.m2), sata: bound(g.sata), hex: g.hex ?? EMPTY, qr: g.qr ?? EMPTY, audio: g.codec, bat: g.bat,
  };
}

// ---- DIMM, PCIe ----
/** One DIMM socket (up to 8: two rows of four, a tier fills as many as it has). Row 1 sticks are drawn upside down (pins up). */
export const DIMM_X = (i: number) => GEO.dimm[i]?.rect.x ?? 0;
export const DIMM_Y = (i: number) => GEO.dimm[i]?.rect.y ?? 0;
export const DIMM_W = DIMM_W0, DIMM_H = DIMM_H0;
export const dimmFlip = (i: number) => !!GEO.dimm[i]?.flip;
/** M.2 connectors (slots m20, m21, ...), top to bottom. */
export let M2_SLOTS: Rect[] = GEO.m2;
/** PCIe slots (x16, x8, x4, x1 looks); a tier has the first ones. */
export let PCIE_RAILS: Rect[] = GEO.pcie;

// ---- VRM: one block north of the CPU with up to six phases, a PWM controller and the heatsink pad ----
export const VRM_MAX = 6;
/** One phase block (MOSFETs, choke, capacitors), left to right. */
export const vrmPhase = (i: number): Rect => GEO.vrmPhases[i] ?? EMPTY;
export let VRM_PWM: Rect = GEO.pwm;
/** Where a VRM heatsink bolts on: over the MOSFET strip of all phases (slot `vrm-sink0`). */
export let VRM_SINK: Rect = GEO.vrmSink;
/** One phase block of the memory (DRAM) VRM, left to right (up to five; a tier fills the first ones). */
export const DRAM_VRM_MAX = 5;
export const dramPhase = (i: number): Rect => GEO.dPhases[i] ?? EMPTY;
/** Where a memory VRM heatsink bolts on: over the MOSFET row of the DRAM phases (slot `ram-sink0`). */
export let RAM_SINK: Rect = GEO.dSink;
/** The power-good light of the VRM. */
export let VRM_LED = GEO.vrmLed;
export { DRAM_BH, DRAM_BW };

// ---- PSU (below the board, full width plus the cable gutter) ----
export let GUTTER_X = 3400;
/** The lower compartment (PSU, drive bay, cables) moves with the board's height: this is the shift from the ATX board's. */
export let SHIFT_Y = 0;
export let PSU: Rect = { x: -3400, y: 2750, w: 7400, h: 1100 };
/** Fan grill centre and radius on the PSU face. */
export let PSU_FAN = { x: -2450, y: 3300, r: 430 };
/** Label plate (model, capacity). */
export let PSU_LABEL: Rect = { x: -80, y: 2900, w: 1050, h: 800 };
/** Live readout panel: load gauge, temperature, fan. */
export let PSU_PANEL: Rect = { x: 1120, y: 2890, w: 2200, h: 820 };
export let VENTS: Rect = { x: -1750, y: 2880, w: 1500, h: 840 };
/** Output sockets along the PSU's top edge, by cable (x of the socket centre). Inner-to-outer order avoids cable crossings. */
export let PSU_PORTS: { pcie: number; atx: number; cpu: number } = { pcie: 3520, atx: 3680, cpu: 3830 };
export let PORT_Y = PSU.y;

// ---- monitor (west of the board, big, 16:9 screen) ----
/** The monitor is drawn and laid out at its design size (3300 x 1995, screen 3120 x 1755) and scaled by this factor, so it stands next to the case at a believable size. */
export const MONITOR_K = 1.6;
/** The screen's design size: the text and the OS screen are laid out in it, inside a container scaled by `MONITOR_K`. */
export const SCREEN_D = { w: 3120, h: 1755 };
export const MONITOR: Rect = { x: -4200 - 3300 * MONITOR_K, y: -2150, w: 3300 * MONITOR_K, h: 1995 * MONITOR_K };
export const SCREEN: Rect = { x: MONITOR.x + 90 * MONITOR_K, y: MONITOR.y + 80 * MONITOR_K, w: 3120 * MONITOR_K, h: 1755 * MONITOR_K };
/** Y of the video cable and of the HDMI port on the rear I/O. */
export const VIDEO_Y = -1150;

// ---- assembly props: the USB key tray, the power button, the USB port ----
/** USB key tray, just under the monitor stand: 3 columns by 4 rows of keys (queue cap 10). */
export const TRAY: Rect = { x: MONITOR.x + (MONITOR.w - 3300) / 2, y: MONITOR.y + MONITOR.h + 820, w: 3300, h: 1620 };
export const TRAY_COLS = 3;
// ---- the PC case: chassis around the board and the PSU, with the front/top panel and the drive bay ----
/** Rear wall thickness (its outer face is the rear I/O plate's west edge: the connectors and the expansion brackets pass through it), and the top of the case. */
export const WALL_T = 170, CASE_TOP = -3400;
/** Outer chassis. West wall at the rear I/O (keys and the HDMI cable pass through it), the front (panel, bay, power) is east. */
export let CASE: Rect = { x: IO_X, y: CASE_TOP, w: 9060, h: 7350 };
/** Inside of the chassis (glass area plus the PSU compartment). */
export let CASE_IN: Rect = { x: IO_X + WALL_T, y: CASE_TOP + 400, w: 8740, h: 6690 };
/** Top panel strip: brand, vents, disk LED, status lights, power button. */
export let CASE_PANEL: Rect = { x: IO_X, y: CASE_TOP, w: 9060, h: 400 };
/** The glass side window: motherboard area. */
export let CASE_GLASS: Rect = { x: IO_X + WALL_T, y: CASE_TOP + 400, w: 8740, h: 5250 };
/** Power button on the top panel and the status lights beside it. */
export let POWER_BTN = { x: 4660, y: CASE_TOP + 200, r: 130 };
export let CASE_LEDS = { y: CASE_TOP + 200, on: 4180, off: 4300, err: 4420, disk: 3900 };
/** The fans the case carries, seen edge-on (case.ts): the rear exhaust in the rear wall above the I/O opening, the top fans under the top panel. */
export let REAR_FAN: Rect = { x: IO_X + 14, y: CASE_TOP + 470, w: WALL_T - 28, h: 790 };
export let TOP_FANS: Rect[] = [];
/** Top fans the cases carry (mini, micro, mid, full tower). */
export const TOP_FAN_COUNT = [0, 1, 2, 3];
export const TOP_FAN_T = 230, TOP_FAN_LEN = 1700, TOP_FAN_PITCH = 1800;
/**
 * The drive cage: a column of cells along the case's front, east of the cable gutter and level with the board's SATA ports (cell i =
 * slot sata<i>, top to bottom; the cage has as many cells as the biggest board the case holds has SATA ports, the rest of the
 * cells are locked). The cells' bottom lines up with the board's, so every cell is above its port and the cables are short.
 */
export let BAY: Rect = { x: 4180, y: 2700, w: 880, h: 1230 };
export let BAY_CELLS: Rect[] = [];
/** Cell size and pitch in the cage (the drive art is drawn at its design size, 700 x 500, and scaled to the cell). */
export const CELL_W = 1050, CELL_H = 725, CELL_PITCH = 785;
/** Width of a front fan module (seen edge-on) east of the cage. */
export const FAN_W = 260;
/** x of the SATA power lead that runs up the cage's west side (from the PSU), and the cage's west edge. */
export let POWER_LEAD_X = 4070;
/**
 * Where a drive's SATA data cable runs (`sataCablePath` in case.ts): out of the board port east, along the port's row to its own
 * column (`col`, west to east in port order, so no two cables cross), up the column to the drive's data plug (cell y + `plug`) and
 * east into it. The columns sit between the PSU cables' gutter and the cage.
 */
export let SATA_LINK: { plug: number; col: number }[] = [];
/** Board port rect for SATA index i. */
export const sataPort = (i: number): Rect => GEO.sata[i] ?? EMPTY;

/** The USB-A port on the rear I/O panel that keys plug into (its mouth faces west). */
export const USB_PORT: Rect = { x: IO_X + 18, y: -54, w: 290, h: 108 };
/** HDMI socket on the rear I/O panel (the video plug goes here). */
export const HDMI_PORT: Rect = { x: IO_X, y: VIDEO_Y - 60, w: 240, h: 120 };

// ---- network props (docs/RENDER.md "Network"): all of them sit above the monitor, inside WORLD, so the overview does not change ----
/** The router spot: a shelf above the monitor. A router stands on it, right-aligned to `ROUTER_EAST` (its footprint depends on the tier). */
/** Scale of the network props (router, wall plate) against their design size. */
export const NET_K = 1.45;
export const ROUTER_EAST = -4500;
/** The shelf line the router stands on, and the y where the cables turn after leaving their sockets. */
export const SHELF_Y = -2480;
export const CABLE_ROW_Y = SHELF_Y + 200;
export const ROUTER_SPOT: Rect = { x: ROUTER_EAST - 1600 * NET_K, y: SHELF_Y - 420 * NET_K, w: 1600 * NET_K, h: 420 * NET_K };
/** The wall plate (ISP line enters here) and its jack position (bottom edge). */
export const WALL_PLATE: Rect = { x: MONITOR.x + 40, y: SHELF_Y - 420 * NET_K, w: 460 * NET_K, h: 420 * NET_K };
export const WALL_JACK = { x: WALL_PLATE.x + WALL_PLATE.w / 2, y: SHELF_Y };
/** Vertical run of the ethernet cable between the monitor and the case (between the video plug and the case wall; a plugged key is drawn over it). */
export const LAN_TRUNK_X = -3940;
/** Onboard ethernet jack on the rear I/O (mouth faces west) and the plug length of an ethernet plug. */
export const ETH0_MOUTH = { x: IO_X + 30, y: -1560 };
export const ETH0_RECT: Rect = { x: IO_X + 30, y: -1690, w: 330, h: 260 };
export const PLUG_L = 200, PLUG_W = 100;
/** NIC card geometry: the bracket sits at the board's west edge, the jack pokes out of it (mouth faces west); `i` is the PCIe slot index. */
export const nicY = (i: number) => PCIE_RAILS[i]!.y + 30;
export const NIC_BRACKET_X = -3400 - 30;
export const nicJack = (i: number): Rect => ({ x: -3400 - 200, y: nicY(i) - 62, w: 170, h: 124 });
export const NIC_LEN: Record<string, number> = { 'nic-gbe': 1500, 'nic-10g': 1950, 'nic-40g': 2400 };
export const nicRect = (i: number, visual: string): Rect => ({ x: nicJack(i).x, y: nicY(i) - 98, w: -3400 - nicJack(i).x + (NIC_LEN[visual] ?? 1500), h: 196 });

/**
 * Everything the camera should see at once (board, PSU, monitor, cables, tray): the content box, tightly. Its
 * extent is the monitor / tray column on the west (x -7500) and the case's east wall (x 5260), and the case top (y -3100) to
 * the feet (y 4360). Nothing else in the scene reaches outside it (the device bake uses it as its frame).
 */
export let WORLD: Rect = { x: MONITOR.x - 80, y: -3140, w: 5300 - (MONITOR.x - 80), h: 7540 };
/** Fit margin for the overview (`fit(WORLD, OVERVIEW_MARGIN)`): the content fills the free area, with a small border. */
export const OVERVIEW_MARGIN = 0.96;

// ---- hover region list (ids are the contract with the UI); only the regions the tier has ----
const REGION_IDS: [string, RegionId][] = [
  ['vrm', 'vrm'], ['vrm2', 'dvrm'], ['pcie', 'pcie'], ['chipset', 'chip'], ['io', 'io'], ['atx', 'atx'], ['cpw', 'cpw'], ['m2', 'm2'],
  ['sata', 'sata'], ['bat', 'bat'], ['audio', 'audio'], ['hex', 'hex'], ['qr', 'qr'],
];
export let REGIONS: { id: string; rect: Rect }[] = [];

/** Point every tier-dependent binding at this tier's board (call before building anything). */
export function setLayoutTier(tier: number, caseTier = tier): void {
  const g = geoOf(tier), cg = geoOf(Math.max(tier, caseTier));
  GEO = g; LAYOUT_TIER = g.tier; LAYOUT_CASE = cg.tier; CASE_BD = cg.bd; BD = g.bd; BR = regionsOf(g); PCIE_RAILS = g.pcie;
  M2_SLOTS = g.m2; VRM_PWM = g.pwm; VRM_SINK = g.vrmSink; RAM_SINK = g.dSink; VRM_LED = g.vrmLed;
  // the lower compartment and the case follow the board: the PSU shroud runs under the board and the cable gutter, the drive bay
  // sits at its east end, the case closes round them
  const east = cg.bd.x + cg.bd.w, south = cg.bd.y + cg.bd.h, dy = south - 2500;
  SHIFT_Y = dy;
  GUTTER_X = east;
  PSU_PORTS = { pcie: east + 120, atx: east + 280, cpu: east + 430 };
  const psuEast = east + 600, psuW = psuEast + 3400;
  PSU = { x: -3400, y: south + 250, w: psuW, h: 1100 };
  PORT_Y = PSU.y;
  PSU_FAN = { x: -2450, y: PSU.y + 550, r: 430 };
  PSU_PANEL = { x: psuEast - 680 - 2200, y: PSU.y + 140, w: 2200, h: 820 };
  PSU_LABEL = { x: PSU_PANEL.x - 1200, y: PSU.y + 150, w: 1050, h: 800 };
  VENTS = { x: -1750, y: PSU.y + 130, w: Math.max(0, PSU_LABEL.x - 170 + 1750), h: 840 };
  // the cage: as many cells as the biggest board the case holds has SATA ports, bottom-aligned with that board
  const cells = cg.sata.length, cageX = east + 800, y0 = south - 100 - (cells - 1) * CELL_PITCH - CELL_H;
  BAY_CELLS = Array.from({ length: cells }, (_, i) => ({ x: cageX, y: y0 + i * CELL_PITCH, w: CELL_W, h: CELL_H }));
  BAY = { x: cageX - 160, y: y0 - 110, w: CELL_W + 240, h: (cells - 1) * CELL_PITCH + CELL_H + 190 };
  POWER_LEAD_X = cageX - 130;
  SATA_LINK = BAY_CELLS.map((_, i) => ({ plug: 202, col: east + 510 + i * 22 }));
  // the front fans stand in front of the cage, the perforated front panel closes the glass
  const glassEast = cageX + CELL_W + 70 + FAN_W + 20 + 170;
  const ce = glassEast + 160, caseW = ce - IO_X, top = CASE_TOP, bottom = south + 1750;
  CASE = { x: IO_X, y: top, w: caseW, h: bottom - top };
  CASE_IN = { x: IO_X + WALL_T, y: top + 400, w: glassEast - (IO_X + WALL_T), h: south + 1490 - (top + 400) };
  CASE_GLASS = { x: CASE_IN.x, y: top + 400, w: CASE_IN.w, h: south + 50 - (top + 400) };
  CASE_PANEL = { x: IO_X, y: top, w: caseW, h: 400 };
  POWER_BTN = { x: ce - 600, y: top + 200, r: 130 };
  CASE_LEDS = { y: top + 200, on: ce - 1080, off: ce - 960, err: ce - 840, disk: ce - 1360 };
  REAR_FAN = { x: IO_X + 14, y: CASE_IN.y + 70, w: WALL_T - 28, h: -2140 - (CASE_IN.y + 70) };
  TOP_FANS = Array.from({ length: TOP_FAN_COUNT[cg.tier] ?? 0 }, (_, k) => ({ x: -2500 + k * TOP_FAN_PITCH, y: CASE_IN.y + 40, w: TOP_FAN_LEN, h: TOP_FAN_T }));
  WORLD = { x: MONITOR.x - 80, y: top - 40, w: ce + 40 - (MONITOR.x - 80), h: bottom + 150 - (top - 40) };
  REGIONS = REGION_IDS.filter(([, k]) => BR[k].w > 0).map(([id, k]) => ({ id, rect: BR[k] }));
}
setLayoutTier(2);
