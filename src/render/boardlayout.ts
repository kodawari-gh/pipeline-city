import type { Rect } from './layout';

// Per-tier motherboard geometry (pure data, no Pixi). The CPU socket is the origin on every board, the rear I/O sits on the west
// edge and the power connectors on the east / top edges, as on a real board seen through the side glass of a case. Each tier is
// a different form factor with its own size and its own set of sockets: a socket a tier lacks is simply not there (no ghosts).
//
//   tier 0 Starter     mini-ITX-ish    1 DIMM, no PCIe, 1 SATA
//   tier 1 Basic       micro-ATX-ish   2 DIMM, 1 PCIe, 2 SATA, ethernet
//   tier 2 Mainstream  ATX             4 DIMM, 2 PCIe, M.2, 2 SATA
//   tier 3 Enthusiast  E-ATX           8 DIMM (two rows), 4 PCIe, M.2, 2 SATA, more of everything
//
// Memory is point-to-point: every DIMM gets its own bundle from the CPU's east edge, stacked in a staircase so nothing crosses
// (see `routes.ts`); `memY` is the y of each bundle's horizontal run and `padY` the y of the pad rows the bundles land on.

export interface Pt { x: number; y: number }
export interface DimmGeo { rect: Rect; /** Pins at the top (row 1) instead of the bottom (row 0). */ flip: boolean }

export interface TierGeo {
  tier: number;
  form: string;
  bd: Rect;
  io: Rect;
  chip: Rect;
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
  m2: Rect | null;
  sata: Rect[];
  hex: Rect | null; qr: Rect | null;
  /** Mounting holes. */
  holes: [number, number][];
}

export const VRM_PITCH = 380, VRM_BW = 340, VRM_BH = 470;
export const DRAM_PITCH = 225, DRAM_BW = 160, DRAM_BH = 300;
export const DIMM_PITCH = 220, DIMM_W0 = 170, DIMM_H0 = 690;
export const MEM_STEP = 140;

const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

interface Spec {
  tier: number; form: string; bd: Rect; x0: number; phases: number; dphases: number; dimms: number; pcie: number; m2: boolean; sata: number;
  chip: Rect; pciewY: number | null;
}

const SPECS: Spec[] = [
  { tier: 0, form: 'mini-ITX', bd: R(-3400, -2150, 5450, 3900), x0: 1200, phases: 2, dphases: 2, dimms: 1, pcie: 0, m2: false, sata: 1, chip: R(-2200, -230, 460, 460), pciewY: null },
  { tier: 1, form: 'micro-ATX', bd: R(-3400, -2350, 5800, 4700), x0: 1300, phases: 3, dphases: 2, dimms: 2, pcie: 1, m2: false, sata: 2, chip: R(-2250, -270, 540, 540), pciewY: 1000 },
  { tier: 2, form: 'ATX', bd: R(-3400, -2500, 6800, 5000), x0: 1300, phases: 4, dphases: 3, dimms: 4, pcie: 2, m2: true, sata: 2, chip: R(-2250, -300, 600, 600), pciewY: 1000 },
  { tier: 3, form: 'E-ATX', bd: R(-3400, -2500, 6800, 6000), x0: 1300, phases: 6, dphases: 4, dimms: 8, pcie: 4, m2: true, sata: 2, chip: R(-2250, -300, 600, 600), pciewY: 1000 },
];

/** The four PCIe slot rails (x16, x8, x4, x1): the tier uses the first ones. Lengths stop before the M.2 area. */
const PCIE_ALL: Rect[] = [R(-2850, 1030, 3300, 60), R(-2850, 1460, 2600, 60), R(-2850, 1810, 1800, 60), R(-2850, 2130, 1000, 60)];

function build(s: Spec): TierGeo {
  const bd = s.bd, east = bd.x + bd.w, south = bd.y + bd.h;
  // ---- memory: one or two rows of up to four DIMMs; the staircase of bundles decides the rows' y ----
  const rows: [number, number] = s.dimms > 4 ? [4, s.dimms - 4] : [s.dimms, 0];
  const two = rows[1] > 0;
  const padY: [number, number] = two ? [-590, 590] : [-150, 150];
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
  const pwm = R(vx0 - 330, -1590, 210, 210);
  const vrm = R(pwm.x - 90, -1800, vx0 + s.phases * VRM_PITCH - (pwm.x - 90) + 20, 650);
  const vrmSink = R(vx0 - 10, -1682, s.phases * VRM_PITCH - 20, 170);
  // ---- memory VRM above row 0, its rail y just above the sockets ----
  const vdimmY = top0 - 130;
  const dy = vdimmY - 90 - DRAM_BH;
  const dPhases = Array.from({ length: s.dphases }, (_, i) => R(X0 + 40 + i * DRAM_PITCH, dy, DRAM_BW, DRAM_BH));
  const dvrm = R(X0, dy - 120, s.dphases * DRAM_PITCH + 80, 440);
  const dSink = R(X0 + 20, dy + 18, s.dphases * DRAM_PITCH + 40, 150);
  // ---- connectors ----
    const cpw = R(vrm.x - 150, bd.y + 90, 660, 260);
  const atx = R(east - 300, -1600, 300, 1100);
  // SATA ports on the east edge near the bottom, mouths facing east (the drive cables run straight to the bay)
  const sataRects = [R(east - 390, south - 520, 300, 110), R(east - 390, south - 350, 300, 110)];
  const holes: [number, number][] = [
    [bd.x + 150, bd.y + 150], [east - 150, bd.y + 150], [bd.x + 150, south - 150], [east - 150, south - 150],
    [0, bd.y + 150], [0, south - 150],
  ];
  if (s.tier >= 1) holes.push([bd.x + 150 + Math.round((east - bd.x - 300) * 0.28), south - 150], [bd.x + 150 + Math.round((east - bd.x - 300) * 0.28), bd.y + 150]);
  if (s.tier >= 2) holes.push([east - 150, 1400]);
  if (s.tier >= 3) holes.push([bd.x + 150, 1200], [east - 150, 2500], [0, 1700]);
  return {
    tier: s.tier, form: s.form, bd,
    io: R(-3440, -2000, 690, 2450),
    chip: s.chip,
    codec: R(-2690, -1930, 250, 250),
    phy: s.tier >= 1 ? R(-2640, -1700, 220, 260) : null,
    bat: s.tier === 0 ? R(-1450, 450, 300, 300) : R(-1500, 400, 300, 300),
    cpw, atx,
    pciew: s.pciewY === null ? null : R(east - 300, s.pciewY, 300, 330),
    vrm, pwm, vrmPhases, vrmSink, vrmLed: { x: pwm.x + 105, y: pwm.y - 62 },
    vrmRailY: -1752,
    dvrm, dPhases, dSink, vdimmY, dRailY: dy - 70,
    dimm, memY, padY,
    pcie: PCIE_ALL.slice(0, s.pcie),
    m2: s.m2 ? R(1150, two ? 1420 : 1100, 1760, 400) : null,
    sata: sataRects.slice(0, s.sata),
    hex: R(-3250, south - 330, 760, 200),
    qr: s.tier >= 1 ? R(-3250, south - 620, 240, 240) : null,
    holes,
  };
}

export const TIER_GEO: readonly TierGeo[] = SPECS.map(build);
export const geoOf = (tier: number): TierGeo => TIER_GEO[Math.max(0, Math.min(TIER_GEO.length - 1, tier))]!;
