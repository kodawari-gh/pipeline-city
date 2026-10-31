import { BOARD_TIERS } from '../sim/specs';
import type { Rect } from './layout';
import { MEM_LANES, MEM_SPACING, legRun, legsFrom, legsOf, type IoPort } from './pins';

// Per-tier motherboard geometry (pure data, no Pixi). The CPU socket is the origin on every board, the rear I/O sits on the west
// edge and the power connectors on the east / top edges, as on a real board seen through the side glass of a case. Each tier is
// a different form factor with its own size and its own set of sockets: a socket a tier lacks is simply not there (no ghosts).
//
//   tier 0 Starter     mini-ITX-ish    1 DIMM, 1 PCIe, 2 SATA
//   tier 1 Basic       micro-ATX-ish   2 DIMM, 2 PCIe, 3 SATA, ethernet
//   tier 2 Mainstream  ATX             4 DIMM, 3 PCIe, 2 M.2, 4 SATA
//   tier 3 Enthusiast  E-ATX           8 DIMM (two rows), 4 PCIe, 3 M.2, 6 SATA, more of everything
//
// The chipset sits south-east of the CPU, below the memory and east of the PCIe slots' ends: the DMI lanes drop straight onto it and
// the SATA lanes run east along the ports' rows, so no trace crosses a slot. USB comes from the CPU straight to the rear I/O.
//
// Memory is point-to-point: every DIMM gets its own bundle from the CPU's east edge, stacked in a staircase so nothing crosses
// (see `routes.ts`); `memY` is the y of each bundle's horizontal run and `padY` the y of the pad rows the bundles land on.

export interface Pt { x: number; y: number }
export interface HeaderGeo { name: string; x: number; y: number; cols: number; rows: number }
export interface DimmGeo { rect: Rect; /** Pins at the top (row 1) instead of the bottom (row 0). */ flip: boolean }

export interface TierGeo {
  tier: number;
  form: string;
  bd: Rect;
  io: Rect;
  /** The chipset (PCH): south-east of the CPU, under it, on the row of the SATA ports. */
  chip: Rect;
  /** The USB hub controller between the CPU's west edge and the rear I/O (the USB lanes run through it). */
  hub: Rect;
  /** USB-A ports the board fits, and whether it has a second display output (the rear I/O draws the rest as bare outlines). */
  usb: number; dp: boolean;
  /** The BIOS flash, west of the chipset on a straight SPI link (four lanes from its east legs to the chipset's west legs). */
  bios: Rect;
  /** First leg (index on the chipset's west side) of the four lanes to each PCIe slot after the first (slots 1, 2, ...), of the BIOS and of the I/O controller's link. */
  west: { slots: number[]; bios: number; sio: number };
  /** x of the DMI column that leaves the CPU's south edge: the middle of the chipset's north side. */
  dmiX: number;
  codec: Rect;
  /** Ethernet PHY next to the jack (boards with ethernet only). */
  phy: Rect | null;
  bat: Rect;
  /** 8-pin CPU power connector (top edge, mouth up) and the 24-pin (east edge, mouth east). */
  cpw: Rect; atx: Rect;
  /** PCIe auxiliary power (east edge) only when the board has PCIe slots. */
  pciew: Rect | null;
  // ---- CPU VRM: a row of phase blocks above the CPU, a PWM controller at its west end ----
  vrm: Rect; pwm: Rect; vrmPhases: Rect[]; vrmSink: Rect; vrmLed: Pt;
  /** Where the 8-pin's power enters the input rail, and the rail's y. */
  vrmRailY: number;
  // ---- memory VRM: a short row above the DIMM bank, its output rail runs along the pins of the sockets ----
  dvrm: Rect; dPhases: Rect[]; dSink: Rect; vdimmY: number; dRailY: number;
  dimm: DimmGeo[];
  /** y of each DIMM's bundle (horizontal run), index = DIMM. */
  memY: number[];
  /** y of the pad row of row 0 (the bottom of its sticks) and of row 1 (the top of its sticks). */
  padY: [number, number];
  pcie: Rect[];
  /** M.2 connectors, top to bottom (slots m20, m21, ...). */
  m2: Rect[];
  sata: Rect[];
  hex: Rect | null; qr: Rect | null;
  /** y of the row of pin headers along the bottom. */
  hdrY: number;
  /** The memory regulator's controller and the side of the phases it stands on (west of them, or east on the top board). */
  dpwm: Rect; dpwmWest: boolean;
  /** The I/O controller west of the chipset (its link is four lanes to the chipset's west legs, its header trunk runs west under the row) and every pin header of the board (name, position, size in pins). */
  sio: Rect; hdrs: HeaderGeo[];
  /** The reference crystals: the CPU's, south of its socket (pads on its top edge), and the chipset's, north of its legs (pads on its bottom edge). */
  xtalCpu: Rect; xtalPch: Rect;
  /** The top board's two-digit debug display under the chipset and its RGB strip along the bottom edge. */
  dbg: Rect | null; rgb: Rect | null;
  /** Mounting holes. */
  holes: [number, number][];
}

export const VRM_PITCH = 380, VRM_BW = 340, VRM_BH = 470;
export const DRAM_PITCH = 225, DRAM_BW = 160, DRAM_BH = 300;
export const DIMM_PITCH = 220, DIMM_W0 = 170, DIMM_H0 = 690;
/** Vertical pitch of the memory bundles' runs: a bundle's length-matching serpentine steps out into the free band between it and the bundle above (see `match.ts`). */
export const MEM_STEP = 190;
/** Vertical pitch of the SATA ports on the east edge. */
export const SATA_PITCH = 150;

const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/** West edge of the rear I/O block: flush with the case's rear panel (the wall's outer face), see layout.ts. */
export const IO_X = -3610;
/** The rear I/O's shield plate (the connectors sit on it with their mouths facing west; the traces arrive at its east edge). */
export const IO_PLATE = R(IO_X, -2000, 400, 2450);
/** Every connector the rear I/O can carry; a tier fits the first of each kind (the others are drawn as bare outlines). Mouths face west. */
export const IO_PORTS: IoPort[] = [
  { id: 'line-out', kind: 'jack', x: IO_X + 30, y: -1928, w: 200, h: 70, tone: 'st' },
  { id: 'line-in', kind: 'jack', x: IO_X + 30, y: -1850, w: 200, h: 70, tone: 'br' },
  { id: 'mic', kind: 'jack', x: IO_X + 30, y: -1772, w: 200, h: 70, tone: 'ld' },
  { id: 'eth', kind: 'rj45', x: IO_X + 30, y: -1560, w: 330, h: 260 },
  { id: 'hdmi', kind: 'hdmi', x: IO_X, y: -1150, w: 240, h: 120 },
  { id: 'dp', kind: 'dp', x: IO_X, y: -930, w: 240, h: 120 },
  ...[0, 1, 2, 3].map((i): IoPort => ({ id: `usb${i}`, kind: 'usb', x: IO_X + 18, y: i * 130, w: 290, h: 108, tone: 'alu' })),
];
export const ioPort = (id: string): IoPort => IO_PORTS.find((p) => p.id === id)!;

interface Spec {
  tier: number; form: string; bd: Rect; x0: number; phases: number; dphases: number; dimms: number; pcie: number; m2Y: number[]; sata: number;
  usb: number; dp: boolean; west: { slots: number[]; bios: number; sio: number }; chip: Rect; pciewY: number | null; /** vertical pitch of the SATA ports (the top board packs eight) */ satap?: number;
}

const SPECS: Spec[] = [
  { tier: 0, form: 'mini-ITX', bd: R(-3400, -2150, 5800, 3900), x0: 1480, phases: 2, dphases: 2, dimms: 1, pcie: 1, m2Y: [], sata: 2, usb: 1, dp: false, west: { slots: [], bios: 6, sio: 10 }, chip: R(540, 1000, 460, 460), pciewY: null },
  { tier: 1, form: 'micro-ATX', bd: R(-3400, -2350, 5800, 4800), x0: 1450, phases: 3, dphases: 2, dimms: 2, pcie: 2, m2Y: [], sata: 3, usb: 2, dp: false, west: { slots: [5], bios: 11, sio: 15 }, chip: R(430, 1500, 540, 540), pciewY: 1000 },
  // the first M.2 sits east of the CPU (a straight run from its east edge), the second below it
  { tier: 2, form: 'ATX', bd: R(-3400, -2500, 6800, 6060), x0: 1450, phases: 4, dphases: 3, dimms: 4, pcie: 3, m2Y: [560, 1100], sata: 4, usb: 3, dp: true, west: { slots: [0, 8], bios: 13, sio: 17 }, chip: R(400, 2430, 600, 600), pciewY: 1000 },
  // the second DIMM row takes the space east of the CPU, so the M.2 stack starts below it
  { tier: 3, form: 'E-ATX', bd: R(-3400, -2500, 6800, 6700), x0: 1450, phases: 6, dphases: 4, dimms: 8, pcie: 4, m2Y: [1650, 2050, 2450], sata: 8, satap: 132, usb: 4, dp: true, west: { slots: [0, 6, 12], bios: 17, sio: 21 }, chip: R(300, 3067, 600, 700), pciewY: 1000 },
];

/** Rail lengths going down the board, widest slot first. The lengths stop before the M.2 area; the first one ends east of the CPU's x16 lanes
 * (they are tuned to it), so every tier's rails take these by slot order, and the lane widths (`BOARD_TIERS[].pcieWidths`, which only ever
 * fall going down) are told by the label. */
const PCIE_RAIL_LEN = [3300, 2600, 1800, 1000];
/** The PCIe slot rails of a tier, an even 700 apart (the cards are 640 high, docs/GPU.md section 7). */
const PCIE_Y0 = 1100, PCIE_PITCH = 700;
const pcieRails = (tier: number): Rect[] => BOARD_TIERS[tier]!.pcieWidths.map((_, i) => R(-2850, PCIE_Y0 + i * PCIE_PITCH, PCIE_RAIL_LEN[i]!, 60));

function build(s: Spec): TierGeo {
  const bd = s.bd, east = bd.x + bd.w, south = bd.y + bd.h;
  // ---- memory: one or two rows of up to four DIMMs; the staircase of bundles decides the rows' y ----
  const rows: [number, number] = s.dimms > 4 ? [4, s.dimms - 4] : [s.dimms, 0];
  const two = rows[1] > 0;
  // (the staircase of the four-DIMM row ends above the first M.2; the two rows of the top board leave a free strip between them)
  const mid = (MEM_LANES - 1) * MEM_SPACING / 2, half = 20 + mid;
  const padY: [number, number] = two ? [-(half + 3 * MEM_STEP + 100), half + 3 * MEM_STEP + 100] : s.dimms > 2 ? [-210, 210] : [-150, 150];
  const memY: number[] = [];
  const dimm: DimmGeo[] = [];
  const X0 = s.x0;
  for (let i = 0; i < s.dimms; i++) {
    const row = i < 4 ? 0 : 1, col = i % 4;
    const y = row === 0 ? padY[0] - DIMM_H0 : padY[1];
    dimm.push({ rect: R(X0 + col * DIMM_PITCH, y, DIMM_W0, DIMM_H0), flip: row === 1 });
    memY.push(row === 0 ? padY[0] + 100 + col * MEM_STEP : padY[1] - 100 - col * MEM_STEP);
  }
  const top0 = padY[0] - DIMM_H0; // top of row 0
  // ---- CPU VRM: phases centred over the CPU, the PWM controller at the west end ----
  const vx0 = -(s.phases * VRM_PITCH) / 2 + 20;
  const vrmPhases = Array.from({ length: s.phases }, (_, i) => R(vx0 + i * VRM_PITCH, -1700, VRM_BW, VRM_BH));
  const pwm = R(vx0 - 390, -1590, 210, 210); // (the 120 between it and the first phase and the 60 more carry the controller's lanes to the phases)
  const vrm = R(pwm.x - 90, -1800, vx0 + s.phases * VRM_PITCH - (pwm.x - 90) + 20, 650);
  const vrmSink = R(vx0 - 10, -1682, s.phases * VRM_PITCH - 20, 170);
  // ---- memory VRM above row 0, its rail y just above the sockets ----
  const vdimmY = top0 - 130;
  const dy = vdimmY - 90 - DRAM_BH;
  const dPhases = Array.from({ length: s.dphases }, (_, i) => R(X0 + 40 + i * DRAM_PITCH, dy, DRAM_BW, DRAM_BH));
  const dvrm = R(X0, dy - 120, s.dphases * DRAM_PITCH + 80, 440);
  const dpwmWest = s.tier < 3; // the top board's regulator has the CPU's regulator close on its west side: the controller stands east of it
  const dpwm = dpwmWest ? R(X0 - 290, dy + 150, 210, 210) : R(dvrm.x + dvrm.w + 40, dy + 150, 210, 210);
  const dSink = R(X0 + 20, dy + 18, s.dphases * DRAM_PITCH + 40, 150);
  // ---- connectors ----
    const cpw = R(vrm.x - 10, bd.y + 90, 520, 234); // the 24-pin's cavity pitch: 110 across, 87 down
  // the 24-pin's top row of pins is level with the memory regulator's input rail, so the 12 V run to it is straight
  const atx = R(east - 300, dy - 70 - 66, 300, 1100);
  // SATA ports on the east edge, on the chipset's row, mouths facing east: the lanes run straight east from the chipset and the
  // drive cables come from the bay
  const pcy = s.chip.y + s.chip.h / 2, sp = s.satap ?? SATA_PITCH, sy0 = pcy - ((s.sata - 1) * sp + 110) / 2;
  const sataRects = Array.from({ length: s.sata }, (_, i) => R(east - 390, sy0 + i * sp, 300, 110));
  // the I/O controller sits west of the chipset, level with the last four of its west legs (a straight link of four lanes); the pin headers
  // stand in a row to its west, the last of them 50 from it, and a trunk below the row serves them all
  const sioLegs = legsFrom(s.chip, 'w', s.west.sio, 4), sio = R(s.chip.x - 520, sioLegs.reduce((a, p) => a + p[1], 0) / 4 - 75, 150, 150);
  const hdrY = south - 520, hw = (cols: number) => cols * 52 + 24;
  const eastToWest: Omit<HeaderGeo, 'x' | 'y'>[] = [
    { name: 'SYS_FAN', cols: 4, rows: 1 }, { name: 'USB_2', cols: 5, rows: 2 }, { name: 'F_PANEL', cols: 5, rows: 2 },
    ...(s.tier >= 3 ? [{ name: 'SYS_FAN2', cols: 4, rows: 1 }, { name: 'USB_3', cols: 5, rows: 2 }] : []),
    ...(s.tier >= 2 ? [{ name: 'TPM', cols: 6, rows: 2 }] : []),
    ...(s.tier >= 3 ? [{ name: 'ARGB', cols: 3, rows: 1 }] : []),
  ];
  let hx = sio.x - 50;
  const hdrs: HeaderGeo[] = eastToWest.map((h) => { hx -= hw(h.cols); const g = { ...h, x: hx, y: hdrY }; hx -= 50; return g; });
  // the CR2032 under the chipset (two lanes from its south legs to the cell's top, two to the vertical clear-CMOS jumper beside it)
  const br = [95, 105, 145, 120][s.tier]!, bcx = s.chip.x + s.chip.w * 0.75, bcy = s.chip.y + s.chip.h + 8 + 58 + br;
  const bat = R(bcx - br, bcy - br, 2 * br, 2 * br);
  hdrs.push({ name: 'CLR_CMOS', x: s.tier >= 3 ? bcx + br + 74 : bcx - br - 150, y: bcy - 62, cols: 1, rows: 3 });
  // the CPU fan's header south of the I/O hub (four lanes from the hub's south legs; the cooler's cable comes to it)
  hdrs.push({ name: 'CPU_FAN', x: -1960, y: 320, cols: 4, rows: 1 });
  // the heatsink fans' headers: the CPU regulator's, west of its controller (a vertical row, four lanes from the controller's west legs), the memory
  // regulator's, above its controller (four lanes from its north legs); the sinks' fan cables come to them
  hdrs.push({ name: 'VRM_FAN', x: pwm.x - 250, y: pwm.y + 105 - (4 * 52 + 24) / 2, cols: 1, rows: 4 });
  hdrs.push({ name: 'RAM_FAN', x: dpwm.x + 105 - (4 * 52 + 24) / 2, y: dpwm.y - 250, cols: 4, rows: 1 });
  const holes: [number, number][] = [
    [s.tier === 0 ? -2150 : bd.x + 150, bd.y + 150], [east - 150, bd.y + 150], [bd.x + 150, south - 150], [east - 150, south - 150], // (the small board's top-west one sits beside the I/O plate)
    [0, bd.y + 150], [0, south - 150],
  ];
  if (s.tier >= 1) holes.push([bd.x + 150 + Math.round((east - bd.x - 300) * 0.28), south - 150], [cpw.x - 220, bd.y + 150]); // the top one stays west of the 8-pin
  if (s.tier >= 2) holes.push([east - 150, 1520]);
  if (s.tier >= 3) holes.push([bd.x + 150, 1200], [east - 150, 2300], [0, 1700]);
  return {
    tier: s.tier, form: s.form, bd,
    io: IO_PLATE,
    chip: s.chip, dmiX: legRun(s.chip, 'n', 6).reduce((a, p) => a + p[0], 0) / 6,
    hub: R(-2050, -130, 260, 260), // 8 legs a side, 26 apart, centred on y 0: the CPU's four lanes on the east side, two per port on the west
    usb: s.usb, dp: s.dp,
    bios: R(s.chip.x - 250, legsFrom(s.chip, 'w', s.west.bios, 4)[0]![1] + 39 - 45, 170, 90), west: s.west,
    codec: R(-2540, -1967, 230, 234), // seven legs on its west side: the three jacks sit on the 1st, 4th and 7th
    phy: s.tier >= 1 ? R(-2300, -1690, 220, 260) : null, // eight legs: the jack's four pads sit on the middle ones
    bat,
    cpw, atx,
    pciew: s.pciewY === null ? null : R(east - 300, s.pciewY, 300, 330),
    vrm, pwm, vrmPhases, vrmSink, vrmLed: { x: pwm.x + 105, y: pwm.y - 62 },
    vrmRailY: -1752,
    dvrm, dPhases, dSink, vdimmY, dRailY: dy - 70,
    dimm, memY, padY,
    pcie: pcieRails(s.tier),
    m2: s.m2Y.map((y) => R(1150, y, 1760, 380)),
    sata: sataRects.slice(0, s.sata),
    // the sticker patch: along the bottom edge, or (on the top board, whose header bus runs there) in the free corner by the rear I/O
    hex: s.tier >= 3 ? R(-2800, bd.y + 170, 700, 200) : R(-3000, south - 400, 760, 200),
    qr: s.tier >= 3 ? R(-3100, bd.y + 170, 220, 220) : s.tier >= 1 ? R(-2150, south - 390, 220, 220) : null,
    hdrY,
    dpwm, dpwmWest,
    sio, hdrs,
    // the crystals: the CPU's under its socket (clear of the x16 lanes), the chipset's above its north legs
    xtalCpu: R(-430, 891, 100, 56),
    xtalPch: R(legsOf(s.chip, 'n')[0]![0] + 13 - 50, s.chip.y - 150, 100, 56),
    // the top board: a two-digit debug display under the chipset (fed from its south legs) and an RGB strip along the bottom edge
    dbg: s.tier >= 3 ? R(legRun(s.chip, 's', 4, -7)[0]![0] + 39 - 150, s.chip.y + s.chip.h + 110, 300, 170) : null,
    rgb: s.tier >= 3 ? R(bd.x + 700, south - 82, bd.w - 1400, 44) : null,
    holes,
  };
}

export const TIER_GEO: readonly TierGeo[] = SPECS.map(build);
export const geoOf = (tier: number): TierGeo => TIER_GEO[Math.max(0, Math.min(TIER_GEO.length - 1, tier))]!;
