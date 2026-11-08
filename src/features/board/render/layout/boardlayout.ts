import { BOARD_TIERS } from '../../sim/specs';
import type { Rect } from './layout';
import { M2_H, M2_W, MEM_SPACING, legRun, legsFrom, legsOf, memLanes, type IoPort } from './pins';

// Per-tier motherboard geometry (pure data, no Pixi). The CPU socket is the origin on every board, the rear I/O sits on the west
// edge and the power connectors on the east / top edges, as on a real board seen through the side glass of a case. Each tier is
// a different form factor with its own size and its own set of sockets: a socket a tier lacks is simply not there (no ghosts).
// The proportions are a real board's (about 22 units a millimetre): the socket about a third of the way in from the rear I/O, the
// memory sticks their real length in one bank beside it.
//
//   tier 0 Starter     mini-ITX-ish    1 DIMM, 1 PCIe, 2 SATA
//   tier 1 Basic       micro-ATX-ish   2 DIMM, 2 PCIe, 3 SATA, ethernet
//   tier 2 Mainstream  ATX             4 DIMM, 3 PCIe, 2 M.2, 4 SATA
//   tier 3 Enthusiast  E-ATX           8 DIMM (one bank), 4 PCIe, 3 M.2, 6 SATA, more of everything
//
// The chipset sits south-east of the CPU, below the memory: the DMI lanes drop from the CPU's south edge east of the PCIe slots' ends
// and step east onto it under the M.2 stack, the SATA lanes run east along the ports' rows, so no trace crosses a slot. USB comes from
// the CPU straight to the rear I/O.
//
// Memory is point-to-point: each stick has a lane in every row. The rows stack on the CPU's east edge and fan out along the sticks, as a real
// board's byte lanes do, so a stick takes its pins along its length (`memFrom` and `memLand`, see `routes.ts`). The lanes of the nearer sticks carry
// zigzags between the CPU and the bank, so every lane is as long as the longest, and a lane dives to an inner layer under the sockets before its own.

export interface Pt { x: number; y: number }
/** A pin header; `key`: the pin left out where a plug is keyed (the TPM's 14-1). */
export interface HeaderGeo { name: string; x: number; y: number; cols: number; rows: number; key?: [number, number] }
export interface DimmGeo { rect: Rect }
/** A row of small passives (decoupling capacitors, the art's `smd`): `n` parts from the centre (x, y), `dx` and `dy` apart, each `w` by `h`. */
export interface Passives { x: number; y: number; n: number; dx: number; dy: number; w: number; h: number }
/** The rect a row of passives covers. */
export function passiveRect(p: Passives): Rect {
  const x1 = p.x + (p.n - 1) * p.dx, y1 = p.y + (p.n - 1) * p.dy;
  return { x: Math.min(p.x, x1) - p.w / 2, y: Math.min(p.y, y1) - p.h / 2, w: Math.abs(x1 - p.x) + p.w, h: Math.abs(y1 - p.y) + p.h };
}

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
  /** First leg (index on the chipset's west side) of the lanes to each slot the chipset feeds, of the BIOS and of the I/O controller's link. */
  west: { slots: number[]; bios: number; sio: number };
  /** Each PCIe slot's wiring: its pairs (a real slot's two per lane, so 32 on a x16 connector) and whether the CPU feeds it (x8 and wider; the chipset has the legs for no more than a x4). */
  pcieLinks: { pairs: number; cpu: boolean }[];
  /** x of the DMI column that leaves the CPU's south edge: the middle of the chipset's north side. */
  dmiX: number;
  codec: Rect;
  /** Ethernet PHY next to the jack (boards with ethernet only). */
  phy: Rect | null;
  bat: Rect;
  /** 8-pin CPU power connector (top edge, mouth up) and the 24-pin (east edge, mouth east). */
  cpw: Rect; atx: Rect;
  // ---- CPU VRM: a row of phase blocks above the CPU, a PWM controller at its west end ----
  vrm: Rect; pwm: Rect; vrmPhases: Rect[]; vrmSink: Rect; vrmLed: Pt;
  /** The square of a fan fitted on each regulator's sink (a 40 mm fan in the sink's housing over the fins, blowing down into them). */
  vrmFan: Rect; dFan: Rect;
  /** Where the 8-pin's power enters the input rail, and the rail's y. */
  vrmRailY: number;
  // ---- memory VRM: a short row above the DIMM bank, its output rail runs along the pins of the sockets ----
  dvrm: Rect; dPhases: Rect[]; dSink: Rect; vdimmY: number; dRailY: number;
  dimm: DimmGeo[];
  /** y of each memory lane on the package's east edge and on its stick's pin column, by stick and row. A row's lanes run side by side; the rows spread along the sticks. */
  memFrom: number[][]; memLand: number[][];
  /** Lanes per stick (`memLanes`). */
  memLanes: number;
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
  /** The decoupling: rows of passives by the CPU socket (outside its printed keep-out and the cooler's plate) and by the chipset. */
  passives: Passives[];
  /** Mounting holes. */
  holes: [number, number][];
}

export const VRM_PITCH = 380, VRM_BW = 340, VRM_BH = 470;
export const DRAM_PITCH = 225, DRAM_BW = 160, DRAM_BH = 300;
/** A heatsink fan's side: a 40 mm fan (`fanLen(40)`). */
export const SINK_FAN = 920;
/** The rim of a fan sink's housing round the fan's square (sink3d.ts, devices.ts), and how far a fan's square keeps from its neighbours: the rim and 30 more. */
export const SINK_FAN_RIM = 30;
const CLEAR = SINK_FAN_RIM + 30;
/** The stock cooler's shroud reaches 1090 north of the CPU (cooler3d.ts). */
const SHROUD_N = -1090;
/** The width of a one-column pin header. */
const HDR1 = 52 + 24;
/** A memory socket: the pitch of a bank, the stick's width as the 2D lays it flat, and its length (a real DIMM's 133 mm at the board's scale). */
export const DIMM_PITCH = 220, DIMM_W0 = 170, DIMM_H0 = 2400;
/** Vertical pitch of the SATA ports on the east edge. */
export const SATA_PITCH = 150;

const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/** West edge of the rear I/O block: flush with the case's rear panel (the wall's outer face), see layout.ts. The board's west edge is 210 east of it. */
export const IO_X = -2810;
/** The board's west edge (every tier's): the rear I/O plate overhangs it into the case's rear wall. */
export const BD_X = IO_X + 210;
/** The USB hub controller between the rear I/O and the CPU, level with the CPU's centre (west of the regulators' controllers and their fan header). */
const HUB = R(IO_X + 960, -130, 260, 260);
/** The rear I/O's shield plate (the connectors sit on it with their mouths facing west; the traces arrive at its east edge). */
export const IO_PLATE = R(IO_X, -2000, 400, 2450);
/** Every connector the rear I/O can carry; a tier fits the first of each kind (the others are drawn as bare outlines). Mouths face west. */
export const IO_PORTS: IoPort[] = [
  { id: 'line-out', kind: 'jack', x: IO_X + 30, y: -1928, w: 200, h: 70, tone: 'st' },
  { id: 'line-in', kind: 'jack', x: IO_X + 30, y: -1850, w: 200, h: 70, tone: 'br' },
  { id: 'mic', kind: 'jack', x: IO_X + 30, y: -1772, w: 200, h: 70, tone: 'ld' },
  { id: 'eth', kind: 'rj45', x: IO_X + 10, y: -1560, w: 170, h: 124 },
  { id: 'hdmi', kind: 'hdmi', x: IO_X, y: -1150, w: 240, h: 120 },
  { id: 'dp', kind: 'dp', x: IO_X, y: -930, w: 240, h: 120 },
  ...[0, 1, 2, 3].map((i): IoPort => ({ id: `usb${i}`, kind: 'usb', x: IO_X + 18, y: i * 130, w: 290, h: 108, tone: 'alu' })),
];
export const ioPort = (id: string): IoPort => IO_PORTS.find((p) => p.id === id)!;

interface Spec {
  tier: number; form: string; bd: Rect; phases: number; dphases: number; dimms: number; pcie: number; m2Y: number[]; sata: number;
  usb: number; dp: boolean; west: { slots: number[]; bios: number; sio: number }; chip: Rect; /** vertical pitch of the SATA ports (the top board packs eight) */ satap?: number;
  /** The memory bank: its west edge, its north end under the board's top edge (the 24-pin follows the regulator's rail above it, so 915 keeps that clear of the corner's mounting hole), and how far along the sticks the lanes' rows spread. */
  bank: { x: number; top: number; span: number };
  /** How far east of centred over the CPU the core regulator's row sits, and how far north of the usual row (the top board's six phases lean toward the memory, clear of the I/O hub's lanes, and stand higher so their runs still funnel onto the package at 45 degrees). */
  vdx?: number; vdy?: number;
}

// (every board's west edge is `BD_X`; the M.2 stack sits under the memory bank, above the chipset)
const SPECS: Spec[] = [
  { tier: 0, form: 'mini-ITX', bd: R(BD_X, -2150, 4700, 4000), phases: 2, dphases: 2, dimms: 1, pcie: 1, m2Y: [], sata: 2, usb: 1, dp: false, west: { slots: [], bios: 6, sio: 10 }, chip: R(180, 1140, 400, 400), bank: { x: 1100, top: 920, span: 1500 } },
  { tier: 1, form: 'micro-ATX', bd: R(BD_X, -2350, 5000, 4800), phases: 3, dphases: 2, dimms: 2, pcie: 2, m2Y: [], sata: 3, usb: 2, dp: false, west: { slots: [0], bios: 11, sio: 15 }, chip: R(330, 1500, 540, 540), bank: { x: 1450, top: 1020, span: 1800 } },
  { tier: 2, form: 'ATX', bd: R(BD_X, -2500, 6000, 6060), phases: 4, dphases: 3, dimms: 4, pcie: 3, m2Y: [1035, 1640], sata: 4, usb: 3, dp: true, west: { slots: [7], bios: 1, sio: 17 }, chip: R(400, 2430, 600, 600), bank: { x: 1560, top: 1080, span: 1800 } },
  { tier: 3, form: 'E-ATX', bd: R(BD_X, -2500, 6800, 6700), phases: 6, dphases: 4, dimms: 8, pcie: 4, m2Y: [1130, 1715, 2300], sata: 8, satap: 132, usb: 4, dp: true, west: { slots: [10], bios: 5, sio: 21 }, chip: R(300, 3067, 600, 700), vdx: 200, vdy: 240, bank: { x: 1700, top: 1180, span: 1900 } },
];

/** Rail lengths going down the board, widest slot first (a real x16 slot's 89 mm, then shorter): every slot ends west of the CPU's DMI lanes,
 * the x16 just past the CPU's x16 lanes, each next one shorter so the chipset's lanes rising to it clear the ones below. Every tier's rails
 * take these by slot order, and the lane widths (`BOARD_TIERS[].pcieWidths`, which only ever fall going down) are told by the label. */
const PCIE_RAIL_LEN = [2030, 1650, 1250, 850];
/** The PCIe slot rails of a tier, an even 700 apart (the cards are 640 high, docs/GPU.md section 7), from the rear wall's slot row. */
const PCIE_Y0 = 1100, PCIE_PITCH = 700, PCIE_X0 = IO_X + 760;
const pcieRails = (tier: number): Rect[] => BOARD_TIERS[tier]!.pcieWidths.map((_, i) => R(PCIE_X0, PCIE_Y0 + i * PCIE_PITCH, PCIE_RAIL_LEN[i]!, 60));
/** The memory bank's west edge is at least this far east of the core regulator's east end. */
const BANK_GAP = 90;
/** Where the memory lanes leave the socket (its east edge), their tightest pitch at the bank, and the pitch of a lane's zigzag (`routes.ts`). */
const MEM_X = 676, MEM_MIN = 24, TOOTH = 32;

function build(s: Spec): TierGeo {
  const bd = s.bd, east = bd.x + bd.w, south = bd.y + bd.h;
  // ---- CPU VRM: phases over the CPU (centred, or `vdx` east of it), the PWM controller at the west end ----
  const vx0 = -(s.phases * VRM_PITCH) / 2 + 20 + (s.vdx ?? 0), vy = -1700 - (s.vdy ?? 0);
  const vrmPhases = Array.from({ length: s.phases }, (_, i) => R(vx0 + i * VRM_PITCH, vy, VRM_BW, VRM_BH));
  const pwm = R(vx0 - 390, vy + 110, 210, 210); // (the 120 between it and the first phase and the 60 more carry the controller's lanes to the phases)
  const vrm = R(pwm.x - 90, vy - 100, vx0 + s.phases * VRM_PITCH - (pwm.x - 90) + 20, 650);
  // (its sink covers the power stages and the chokes: it stands on the stages, and clears the chokes)
  const vrmSink = R(vx0 - 10, vy + 18, s.phases * VRM_PITCH - 20, 360);
  // ---- memory: one bank of sticks east of the CPU, each the length of a real DIMM, room for the memory regulator above it; the lanes' rows stack on the
  // CPU's east edge and spread along the sticks ----
  const lanes = memLanes(s.dimms), n = s.dimms, X0 = Math.max(s.bank.x, vrm.x + vrm.w + BANK_GAP), top0 = bd.y + s.bank.top;
  const dimm: DimmGeo[] = Array.from({ length: n }, (_, i) => ({ rect: R(X0 + i * DIMM_PITCH, top0, DIMM_W0, DIMM_H0) }));
  const step = Math.max((n + 2) * MEM_SPACING, 140), mid = top0 + DIMM_H0 / 2, spread = s.bank.span / lanes;
  // (the rows sit as near the bank's middle as the edge's 460 of pins lets them: the shorter the fan, the more room it leaves the zigzags)
  const free = 460 - ((lanes - 1) * step + (n - 1) * MEM_SPACING) / 2, lean = Math.max(-free, Math.min(free, mid));
  const rowOf = (r: number) => r - (lanes - 1) / 2, onPkg = (r: number) => lean + rowOf(r) * step, onBank = (r: number) => mid + rowOf(r) * spread;
  const memFrom = Array.from({ length: n }, (_, i) => Array.from({ length: lanes }, (_, r) => MEM_SPACING * Math.floor((onPkg(r) + (i - (n - 1) / 2) * MEM_SPACING) / MEM_SPACING + 0.5)));
  // on the bank a lane keeps room for its zigzag above it: the more length it has to make up and the less room its row's fan leaves, the taller
  const rise = (r: number) => Math.abs(onBank(r) - onPkg(r)), most = Math.max(...Array.from({ length: lanes }, (_, r) => rise(r)));
  const memLand = Array.from({ length: n }, () => new Array<number>(lanes).fill(0));
  for (let r = 0; r < lanes; r++) {
    const teeth = Math.max(1, Math.floor((X0 - 30 - (MEM_X + 110 + rise(r))) / TOOTH));
    const tall = (i: number) => ((n - 1 - i) * DIMM_PITCH + 0.41 * (most - rise(r))) / (2 * teeth) + 6;
    let y = onBank(r) - (Array.from({ length: n }, (_, i) => tall(i)).reduce((a, h) => a + h, 0) + (n - 1) * MEM_MIN) / 2;
    for (let i = 0; i < n; i++) { y += tall(i); memLand[i]![r] = y; y += MEM_MIN; }
  }
  // ---- memory VRM above the bank, its rail y just above the sockets' north ends ----
  const vdimmY = top0 - 130;
  const dy = vdimmY - 90 - DRAM_BH;
  const dPhases = Array.from({ length: s.dphases }, (_, i) => R(X0 + 40 + i * DRAM_PITCH, dy, DRAM_BW, DRAM_BH));
  const dvrm = R(X0, dy - 120, s.dphases * DRAM_PITCH + 80, 440);
  const dpwmWest = s.tier < 2; // the bigger boards' regulators have the CPU's regulator close on their west side: the controller stands east of them
  const dpwm = dpwmWest ? R(X0 - 290, dy + 150, 210, 210) : R(dvrm.x + dvrm.w + 40, dy + 150, 210, 210);
  const dSink = R(X0 + 20, dy + 18, s.dphases * DRAM_PITCH + 40, 230);
  // ---- connectors ----
    const cpw = R(vrm.x - 10, bd.y + 90, 520, 234); // the 24-pin's cavity pitch: 110 across, 87 down
  // the 24-pin's top row of pins is level with the memory regulator's input rail, so the 12 V run to it is straight
  const atx = R(east - 300, dy - 70 - 66, 300, 1100);
  // the memory sink fan's header: a vertical row beside its controller, on the side away from the phases
  const ramFanX = dpwmWest ? dpwm.x - 100 - HDR1 : dpwm.x + dpwm.w + 100;
  // the sinks' fan squares, wider than the sinks: the CPU sink's at its west end, toward the rear I/O as real boards have it, east of the
  // 8-pin's plug, on the board, north of the stock cooler's shroud; the memory sink's west of the 24-pin, clear of its header, north of the
  // sticks' tops (it overhangs the sink's north side) (each keeps its housing's rim and 30 more clear of them: `CLEAR`)
  const half = SINK_FAN / 2, out = half + CLEAR;
  const vcx = Math.max(vrmSink.x + SINK_FAN_RIM + half, cpw.x + cpw.w + out), vcy = Math.min(Math.max(vrmSink.y + vrmSink.h / 2, bd.y + 40 + half), SHROUD_N - out);
  const vrmFan = R(vcx - half, vcy - half, SINK_FAN, SINK_FAN);
  const dcx = dpwmWest ? Math.max(Math.min(dSink.x + dSink.w / 2, atx.x - out), ramFanX + HDR1 + out) : Math.min(dSink.x + dSink.w / 2, atx.x - out, ramFanX - out);
  // (the housing stands over the sockets' latches, so it keeps clear of the sticks only; on the mini-ITX its rim overhangs the board's top
  // edge by 4 mm: the bank cannot move south, its south end is level with the SATA lanes)
  const dFan = R(dcx - half, top0 - out - half, SINK_FAN, SINK_FAN);
  // SATA ports on the east edge, on the chipset's row, mouths facing east: the lanes run straight east from the chipset and the
  // drive cables come from the bay
  const pcy = s.chip.y + s.chip.h / 2, sp = s.satap ?? SATA_PITCH, sy0 = pcy - ((s.sata - 1) * sp + 110) / 2;
  const sataRects = Array.from({ length: s.sata }, (_, i) => R(east - 390, sy0 + i * sp, 300, 110));
  // the I/O controller sits west of the chipset, level with the last four of its west legs (a straight link of four lanes); the pin headers
  // stand in a row to its west, the last of them 50 from it and 40 apart (the top board then keeps its RGB lane clear of the south-west hole),
  // and a trunk below the row serves them all
  const sioLegs = legsFrom(s.chip, 'w', s.west.sio, 4), sio = R(s.chip.x - 520, sioLegs.reduce((a, p) => a + p[1], 0) / 4 - 75, 150, 150);
  const hdrY = south - 520, hw = (cols: number) => cols * 52 + 24;
  const eastToWest: Omit<HeaderGeo, 'x' | 'y'>[] = [
    { name: 'SYS_FAN', cols: 4, rows: 1 }, { name: 'USB_2', cols: 5, rows: 2 }, { name: 'F_PANEL', cols: 5, rows: 2 },
    ...(s.tier >= 3 ? [{ name: 'SYS_FAN2', cols: 4, rows: 1 }] : []),
    ...(s.tier >= 2 ? [{ name: 'USB_3', cols: 5, rows: 2 }, { name: 'TPM', cols: 7, rows: 2, key: [6, 0] as [number, number] }] : []),
    ...(s.tier >= 3 ? [{ name: 'ARGB', cols: 3, rows: 1 }] : []),
  ];
  let hx = sio.x - 50;
  const hdrs: HeaderGeo[] = eastToWest.map((h) => { hx -= hw(h.cols); const g = { ...h, x: hx, y: hdrY }; hx -= 40; return g; });
  // the CR2032 under the chipset (two lanes from its south legs to the cell's top, two to the vertical clear-CMOS jumper beside it)
  const br = [95, 105, 145, 120][s.tier]!, bcx = s.chip.x + s.chip.w * 0.75, bcy = s.chip.y + s.chip.h + 8 + 58 + br;
  const bat = R(bcx - br, bcy - br, 2 * br, 2 * br);
  hdrs.push({ name: 'CLR_CMOS', x: s.tier >= 3 ? bcx + br + 74 : bcx - br - 150, y: bcy - 62, cols: 1, rows: 3 });
  // the CPU fan's header south of the I/O hub (four lanes from the hub's south legs; the cooler's cable comes to it)
  hdrs.push({ name: 'CPU_FAN', x: HUB.x + 90, y: 320, cols: 4, rows: 1 });
  // the heatsink fans' headers, each a vertical row beside its controller on the side away from its phases (four lanes from the controller's legs
  // on that side), clear of the fan over its sink: the sinks' fan cables come to them
  // (the top board's controller stands further north: its header drops 100, so it and its printed name clear the mounting hole north-west of it)
  hdrs.push({ name: 'VRM_FAN', x: pwm.x - 250, y: pwm.y + 105 - (4 * 52 + 24) / 2 + (s.tier >= 3 ? 100 : 0), cols: 1, rows: 4 });
  hdrs.push({ name: 'RAM_FAN', x: ramFanX, y: dpwm.y + 105 - (4 * 52 + 24) / 2, cols: 1, rows: 4 });
  // the mounting holes. The boards share tray positions where their parts allow, as real form factors do: a bigger case holds a smaller board on
  // studs it already has. The memory bank and the big regulators keep some corners apart (a case then has those extra threads: `standoffs`).
  // (the small board's south hole and the top board's chipset and bottom-edge holes stand where its own BIOS and RGB strip leave room)
  const holes: [number, number][] = ([
    [[-1600, -1900], [0, -2000], [1950, -2000], [-2450, 1700], [0, 1650], [1950, 1700]],
    [[-2450, -2200], [0, -2200], [2250, -2200], [-2450, 1700], [0, 1300], [-2450, 2300], [0, 2350], [2250, 2300]],
    [[-2450, -2200], [-1600, -1900], [0, -2200], [3250, -2350], [0, 1300], [3250, 1500], [-2450, 3400], [100, 3200], [3250, 3410]],
    [[-2450, -2200], [-1600, -1900], [0, -2200], [4050, -2350], [0, 1300], [3250, 1500], [-2450, 3400], [-200, 3125], [4050, 2300], [-2450, 4050], [0, 3925], [4050, 4050]],
  ] as [number, number][][])[s.tier]!;
  // the decoupling: two blocks by the socket's south-west corner (outside the printed keep-out and the cooler's plate, clear of the USB lanes and the
  // crystal) and one at the chipset's north-west corner (west of the DMI lanes, clear of its heat sink)
  const row = (x: number, y: number, n: number, across: boolean): Passives => (across ? { x, y, n, dx: 46, dy: 0, w: 30, h: 18 } : { x, y, n, dx: 0, dy: 46, w: 18, h: 30 });
  const passives = [
    row(-830, 200, 6, false), row(-868, 200, 6, false), row(-1010, 724, 5, true), row(-1010, 756, 5, true),
    row(s.chip.x - 66, s.chip.y - 112, 3, true), row(s.chip.x - 66, s.chip.y - 80, 3, true),
  ];
  return {
    tier: s.tier, form: s.form, bd,
    io: IO_PLATE,
    pcieLinks: BOARD_TIERS[s.tier]!.pcieWidths.map((w) => ({ pairs: 2 * Math.min(w, 16), cpu: w >= 8 })),
    chip: s.chip, dmiX: legRun(s.chip, 'n', 6).reduce((a, p) => a + p[0], 0) / 6,
    hub: HUB, // 8 legs a side, 26 apart, centred on y 0: the CPU's four lanes on the east side, two per port on the west
    usb: s.usb, dp: s.dp,
    bios: R(s.chip.x - 250, legsFrom(s.chip, 'w', s.west.bios, 4)[0]![1] + 39 - 45, 170, 90), west: s.west,
    codec: R(IO_X + 470, -1967, 230, 234), // seven legs on its west side: the three jacks sit on the 1st, 4th and 7th
    phy: s.tier >= 1 ? R(IO_X + 710, -1690, 220, 260) : null, // eight legs: the jack's four pads sit on the middle ones
    bat,
    cpw, atx,
    vrm, pwm, vrmPhases, vrmSink, vrmLed: { x: pwm.x + 105, y: pwm.y - 62 }, vrmFan, dFan,
    vrmRailY: vy - 52,
    dvrm, dPhases, dSink, vdimmY, dRailY: dy - 70,
    dimm, memFrom, memLand, memLanes: lanes,
    pcie: pcieRails(s.tier),
    // the M.2 2280 slots (pins.ts `M2_STICK`) end where the cooler's hoses climb, west of the ATX plug's column
    m2: s.m2Y.map((y) => R(2910 - M2_W, y, M2_W, M2_H)),
    sata: sataRects.slice(0, s.sata),
    // the sticker patch: along the bottom edge under the header trunk, or (on the top board, whose header bus runs there) in the free corner by the rear I/O, beside the top hole
    // and above the audio capacitors
    hex: s.tier >= 3 ? R(bd.x + 530, bd.y + 190, 640, 200) : R(bd.x + 400, south - 320, 640, 200),
    qr: s.tier >= 3 ? R(bd.x + 300, bd.y + 180, 220, 220) : s.tier >= 1 ? R(bd.x + 1060, south - 330, 220, 220) : null,
    hdrY,
    dpwm, dpwmWest,
    sio, hdrs,
    // the crystals: the CPU's under its socket (west of the x16 lanes), the chipset's above its last north legs (east of the DMI lanes)
    xtalCpu: R(-640, 650, 100, 56),
    xtalPch: R(legsOf(s.chip, 'n').at(-2)![0] + 13 - 50, s.chip.y - 150, 100, 56),
    // the top board: a two-digit debug display under the chipset (fed from its south legs) and an RGB strip along the bottom edge
    dbg: s.tier >= 3 ? R(legRun(s.chip, 's', 4, -7)[0]![0] + 39 - 150, s.chip.y + s.chip.h + 110, 300, 170) : null,
    rgb: s.tier >= 3 ? R(bd.x + 700, south - 82, bd.w - 1400, 44) : null,
    passives,
    holes,
  };
}

export const TIER_GEO: readonly TierGeo[] = SPECS.map(build);
export const geoOf = (tier: number): TierGeo => TIER_GEO[Math.max(0, Math.min(TIER_GEO.length - 1, tier))]!;
