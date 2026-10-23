// World layout (arbitrary pixel units at zoom 1). The CPU socket sits at the origin.
//
//   monitor | motherboard (IO on its west edge, power connectors on its east edge) | cable gutter
//           |            PSU shroud below, full width of the board plus the gutter           |
//
// Everything on the board is placed here on purpose (no random scatter); buses are routed in routes.ts.

export interface Rect { x: number; y: number; w: number; h: number }

export const BD: Rect = { x: -3400, y: -2500, w: 6800, h: 5000 };

export const BR = {
  /** Core VRM row north of the CPU. */
  vrm: { x: -1300, y: -1650, w: 2600, h: 550 },
  /** DRAM VRM block south-east of the DIMMs. */
  dvrm: { x: 1100, y: 1250, w: 1200, h: 420 },
  pcie: { x: -2950, y: 1120, w: 4150, h: 880 },
  /** Chipset sits west of the CPU, between it and the rear I/O. */
  chip: { x: -2250, y: -300, w: 600, h: 600 },
  io: { x: -3440, y: -2000, w: 690, h: 2450 },
  atx: { x: 3100, y: -1600, w: 300, h: 1100 },
  cpw: { x: 3100, y: -2200, w: 300, h: 420 },
  pciew: { x: 3100, y: 1000, w: 300, h: 330 },
  m2: { x: 2420, y: -800, w: 200, h: 1300 },
  /** Two SATA ports on the bottom edge (port 0 east, port 1 west, mouths facing down). */
  sata: { x: -2150, y: 2290, w: 310, h: 110 },
  hex: { x: 300, y: 2230, w: 760, h: 200 },
  qr: { x: 1500, y: 2060, w: 240, h: 240 },
  audio: { x: -3380, y: 640, w: 560, h: 330 },
  bat: { x: -1500, y: 400, w: 300, h: 300 },
} satisfies Record<string, Rect>;

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

// ---- DIMM, PCIe ----
export const DIMM_X = (i: number) => 1400 + i * 220;
export const DIMM_Y = -840, DIMM_W = 170, DIMM_H = 1680;
export const PCIE_RAILS: Rect[] = [
  { x: -2850, y: 1030, w: 3800, h: 60 }, { x: -2850, y: 2150, w: 1800, h: 60 }, { x: -2850, y: 2290, w: 600, h: 60 },
];

// ---- PSU (below the board, full width plus the cable gutter) ----
export const GUTTER_X = 3400;
export const PSU: Rect = { x: -3400, y: 2750, w: 7400, h: 1100 };
/** Fan grill centre and radius on the PSU face. */
export const PSU_FAN = { x: -2450, y: 3300, r: 430 };
/** Label plate (model, capacity). */
export const PSU_LABEL: Rect = { x: -80, y: 2900, w: 1050, h: 800 };
/** Live readout panel: load gauge, temperature, fan. */
export const PSU_PANEL: Rect = { x: 1120, y: 2890, w: 2200, h: 820 };
export const VENTS: Rect = { x: -1750, y: 2880, w: 1500, h: 840 };
/** Output sockets along the PSU's top edge, by cable (x of the socket centre). Inner-to-outer order avoids cable crossings. */
export const PSU_PORTS = { pcie: 3520, atx: 3680, cpu: 3830 } as const;
export const PORT_Y = PSU.y;

// ---- monitor (west of the board, big, 16:9 screen) ----
export const SCREEN: Rect = { x: -7410, y: -2170, w: 3120, h: 1755 };
export const MONITOR: Rect = { x: -7500, y: -2250, w: 3300, h: 1995 };
/** Y of the video cable and of the HDMI port on the rear I/O. */
export const VIDEO_Y = -1150;

// ---- assembly props: the USB key tray, the power button, the USB port ----
/** USB key tray, just under the monitor stand: 2 columns by 5 rows of wide keys (queue cap 10). */
export const TRAY: Rect = { x: -7500, y: 330, w: 3300, h: 1620 };
export const TRAY_COLS = 2;
// ---- the PC case: chassis around the board and the PSU, with the front/top panel and the drive bay ----
/** Outer chassis. West wall at the rear I/O (keys and the HDMI cable pass through it), the front (panel, bay, power) is east. */
export const CASE: Rect = { x: -3800, y: -3100, w: 9060, h: 7350 };
/** Inside of the chassis (glass area plus the PSU compartment). */
export const CASE_IN: Rect = { x: -3640, y: -2700, w: 8740, h: 6690 };
/** Top panel strip: brand, vents, disk LED, status lights, power button. */
export const CASE_PANEL: Rect = { x: -3800, y: -3100, w: 9060, h: 400 };
/** The glass side window: motherboard area. */
export const CASE_GLASS: Rect = { x: -3640, y: -2700, w: 8740, h: 5250 };
/** Power button on the top panel and the status lights beside it. */
export const POWER_BTN = { x: 4660, y: -2900, r: 130 };
export const CASE_LEDS = { y: -2900, on: 4180, off: 4300, err: 4420, disk: 3900 };
/** The 2-position SATA drive bay (a cage right of the PSU). Cell 0 = slot sata0 (top), cell 1 = sata1. */
export const BAY: Rect = { x: 4180, y: 2700, w: 880, h: 1230 };
export const BAY_CELLS: Rect[] = [{ x: 4300, y: 2790, w: 700, h: 500 }, { x: 4300, y: 3360, w: 700, h: 500 }];
/** Where a drive's SATA data cable runs: column x in the cage gap, lane y under the board, port x on the board edge. */
export const SATA_LINK = [
  { col: 4160, lane: 2590, port: -1910 },
  { col: 4100, lane: 2650, port: -2080 },
] as const;
/** Board port rect for SATA index i. */
export const sataPort = (i: number): Rect => ({ x: BR.sata.x + (1 - i) * 170, y: BR.sata.y, w: 140, h: BR.sata.h });
/** Key rack ("held" keys the OS has ingested, waiting for their result), under the tray. */
export const HELD: Rect = { x: -5900, y: 2150, w: 1670, h: 1000 };

/** The USB-A port on the rear I/O panel that keys plug into (its mouth faces west). */
export const USB_PORT: Rect = { x: BR.io.x + 18, y: -54, w: 290, h: 108 };
/** HDMI socket on the rear I/O panel (the video plug goes here). */
export const HDMI_PORT: Rect = { x: BR.io.x, y: VIDEO_Y - 60, w: 240, h: 120 };

/** Everything the camera should see at once (board, PSU, monitor, cables, tray). */
export const WORLD: Rect = { x: -7650, y: -3250, w: 13150, h: 7600 };

// ---- hover region list (ids are the contract with the UI) ----
export const REGIONS: { id: string; rect: Rect }[] = [
  { id: 'vrm', rect: BR.vrm }, { id: 'vrm2', rect: BR.dvrm }, { id: 'pcie', rect: BR.pcie }, { id: 'chipset', rect: BR.chip },
  { id: 'io', rect: BR.io }, { id: 'atx', rect: BR.atx }, { id: 'cpw', rect: BR.cpw }, { id: 'm2', rect: BR.m2 },
  { id: 'sata', rect: BR.sata }, { id: 'bat', rect: BR.bat }, { id: 'audio', rect: BR.audio }, { id: 'hex', rect: BR.hex },
  { id: 'qr', rect: BR.qr },
];
