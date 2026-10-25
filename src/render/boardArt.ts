import { Container, Graphics } from 'pixi.js';
import { BOARD_TIERS } from '../sim/board/specs';
import { BD, BOARD_SEED, GEO, PKG, SOCKET_E, VIDEO_Y, rng } from './layout';
import { box, disc, label, mix } from './ink';
import { IO_PORTS } from './boardlayout';
import { headerPin, legsFrom, legsOf, m2Contacts } from './pins';
import { buildBuses, mkLane, type Bus, type Lane } from './routes';
import { makePalette, type Palette, type Theme } from './theme';
import {
  cap, chip, dimmSocket, dramPhaseArt, header, hole, ioConnector, legRects, pcieSlot, powerConn, sataPortArt, shadow, smd, stitch, vrmPhaseArt, type Ctx,
} from './boardParts';

export interface BoardArt {
  root: Container;
  /** Text labels, hidden when zoomed far out. */
  labels: Container;
  /** Routed buses (dim base is drawn here; the live layer lights them). */
  buses: Bus[];
  pal: Palette;
}

const hexPoly = (cx: number, cy: number, r: number): number[] => {
  const p: number[] = [];
  for (let k = 0; k < 6; k++) { const a = k * 1.047 + 0.52; p.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  return p;
};

export function strokeLane(g: Graphics, l: Lane) {
  g.moveTo(l.pts[0]![0], l.pts[0]![1]);
  for (let i = 1; i < l.pts.length; i++) g.lineTo(l.pts[i]![0], l.pts[i]![1]);
}

/** A plated pad across each end of every signal lane (`w` wide, 34 long, along the lane's last stretch). */
function drawPads(g: Graphics, lanes: { l: Lane; w: number }[], color: string) {
  for (const { l, w } of lanes) {
    for (const end of [0, 1]) {
      const n = l.pts.length, a = end === 0 ? l.pts[1]! : l.pts[n - 2]!, p = end === 0 ? l.pts[0]! : l.pts[n - 1]!;
      const dx = p[0] - a[0], dy = p[1] - a[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
      const L = 34, W = w;
      g.poly([p[0] - ux * L * 0.5 + nx * W / 2, p[1] - uy * L * 0.5 + ny * W / 2, p[0] + ux * L * 0.5 + nx * W / 2, p[1] + uy * L * 0.5 + ny * W / 2,
        p[0] + ux * L * 0.5 - nx * W / 2, p[1] + uy * L * 0.5 - ny * W / 2, p[0] - ux * L * 0.5 - nx * W / 2, p[1] - uy * L * 0.5 - ny * W / 2]);
    }
  }
  g.fill({ color, alpha: 0.9 });
}

/** How each board tier looks beyond its geometry: the PCB colour, the trim, the armour. */
interface Skin { tint: [string, string] | null; tintK: number; trim: number; armor: number; name: string }
const SKINS: Skin[] = [
  { name: 'STARTER', tint: ['#46524c', '#b5c4b8'], tintK: 0.22, trim: 0, armor: 0 },
  { name: 'BASIC', tint: null, tintK: 0, trim: 0, armor: 0 },
  { name: 'MAINSTREAM', tint: ['#0e4750', '#9ed3d0'], tintK: 0.2, trim: 1, armor: 1 },
  { name: 'ENTHUSIAST', tint: ['#2a1a52', '#c0b4e6'], tintK: 0.26, trim: 2, armor: 2 },
];

/**
 * The static motherboard, built once per (theme, tier) and never touched per frame. Visual hierarchy: the working parts
 * (CPU, DIMMs, cooler, PSU, monitor) are drawn by devices.ts at full contrast; everything here is mixed toward the
 * board colour. Routing is deliberate (routes.ts); there is no random scatter. Every run of copper ends on a footprint.
 */
export function buildBoard(T: Theme, tier: number): BoardArt {
  const geo = GEO; // the layout is set by the caller (`setLayoutTier`) before the scene is built
  const rand = rng(BOARD_SEED);
  const P = makePalette(T);
  const skin = SKINS[tier] ?? SKINS[1]!;
  if (skin.tint) {
    const tint = skin.tint[T.dark ? 0 : 1];
    P.board = mix(P.board, tint, skin.tintK); P.edge = mix(P.edge, tint, 0.25); P.sub = mix(P.sub, tint, 0.18); P.panel = mix(P.panel, tint, 0.15);
  }
  const tierSpec = BOARD_TIERS[tier];
  const feat = tierSpec?.features ?? { ethernetMbps: 0, usbPorts: 1, displayPorts: 1 };
  const phases = tierSpec?.vrm.phases ?? 2, ramPhases = tierSpec?.ramVrm.phases ?? 2;
  const slots = tierSpec?.slots ?? {};
  const nSata = slots.sata ?? 0;
  const root = new Container();
  const labels = new Container();
  const g = new Graphics();
  root.addChild(g);
  const c: Ctx = { g, labels, T, P, tier };
  const lbl = (t: string, x: number, y: number, s = 38, a = 1) => labels.addChild(label(t, x, y, s, P.silk, { a }));
  const south = BD.y + BD.h;

  // ---- plate: a soft shadow on the tray, the substrate, an edge bevel (the mounting holes go on last, over any trim) ----
  box(g, BD.x + 22, BD.y + 34, BD.w, BD.h, 120, { fill: '#000000', fa: T.dark ? 0.32 : 0.14 });
  box(g, BD.x, BD.y, BD.w, BD.h, 120, { fill: P.board, stroke: P.edge, lw: 12 });
  box(g, BD.x + 70, BD.y + 70, BD.w - 140, BD.h - 140, 90, { stroke: P.edge, lw: 4, sa: 0.5 });
  g.rect(BD.x + 130, BD.y + 14, BD.w - 260, 6).fill({ color: '#ffffff', alpha: T.dark ? 0.06 : 0.3 });
  // the better boards carry a little more: a trim line round the plate (Mainstream, Enthusiast) and a second line for the top tier;
  // drawn first, so every part sits over it (the holes clear it with their own ring)
  if (skin.trim >= 1) box(g, BD.x + 120, BD.y + 120, BD.w - 240, BD.h - 240, 70, { stroke: T.alu, lw: 5, sa: skin.trim >= 2 ? 0.3 : 0.16 });
  if (skin.trim >= 2) box(g, BD.x + 150, BD.y + 150, BD.w - 300, BD.h - 300, 60, { stroke: T.mul, lw: 3, sa: 0.22 });

  // ---- the rear I/O's shield plate (flush with the case's rear panel); the lanes to the connectors run over it, the connectors sit on it later ----
  box(g, geo.io.x, geo.io.y, geo.io.w, geo.io.h, 30, { fill: P.panel, stroke: P.edge, lw: 10 });
  box(g, geo.io.x + 14, geo.io.y + 14, geo.io.w - 28, geo.io.h - 28, 22, { stroke: P.edge, lw: 3, sa: 0.5 });

  // ---- copper pours: the core voltage plane under the package edge, the memory rail ----
  {
    const ph = geo.vrmPhases, first = ph[0]!, last = ph[ph.length - 1]!, py = PKG.y - SOCKET_E;
    const y0 = first.y + first.h;
    const xl = Math.max(-840, first.x + 30), xr = Math.min(840, last.x + last.w - 30);
    const pour = [first.x + 24, y0, last.x + last.w - 24, y0, xr, py + 4, xl, py + 4];
    g.poly(pour).fill({ color: P.copper, alpha: 0.2 }).stroke({ width: 6, color: P.copper, alpha: 0.5, join: 'round' });
    for (let y = y0 + 40; y < py; y += 60) {
      const t = (y - y0) / (py - y0), x0 = pour[0]! + (xl - pour[0]!) * t, x1 = pour[2]! + (xr - pour[2]!) * t;
      for (let x = x0 + 40; x < x1 - 20; x += 60) g.circle(x, y, 5);
    }
    g.fill({ color: P.via, alpha: 0.4 });
    const dp = geo.dPhases;
    const lastRow0 = geo.dimm.filter((d) => !d.flip).pop()!;
    const pr = { x: dp[0]!.x + 10, y: geo.vdimmY - 56, w: lastRow0.rect.x + lastRow0.rect.w - dp[0]!.x - 10, h: 112 };
    box(g, pr.x, pr.y, pr.w, pr.h, 20, { fill: P.copper, fa: 0.16, stroke: P.copper, lw: 5, sa: 0.4 });
    stitch(c, pr, 52, 5, 0.35);
  }

  // ---- the regulators' substrates go under the copper that feeds them ----
  box(g, geo.vrm.x, geo.vrm.y, geo.vrm.w, geo.vrm.h, 28, { fill: P.sub, stroke: P.edge, lw: 6 });
  box(g, geo.dvrm.x, geo.dvrm.y, geo.dvrm.w, geo.dvrm.h, 22, { fill: P.sub, stroke: P.edge, lw: 6 });

  // ---- buses: base strokes (the live layer lights the active ones) and the pads they end on ----
  const buses = buildBuses();
  const padLanes: { l: Lane; w: number }[] = [];
  for (const b of buses) {
    const power = b.id === 'pwr12' || b.id === 'pwrcpu' || b.id === 'vdimm' || b.id === 'vcore';
    const all = b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : []);
    if (power) {
      for (const l of all) strokeLane(g, l);
      g.stroke({ width: b.w + 10, color: P.edge, alpha: 0.55, cap: 'round', join: 'round' });
      for (const l of all) strokeLane(g, l);
      g.stroke({ width: b.w, color: P.copper, alpha: 0.8, cap: 'round', join: 'round' });
      for (const l of all) strokeLane(g, l);
      g.stroke({ width: b.w * 0.26, color: '#ffffff', alpha: T.dark ? 0.1 : 0.28, cap: 'round', join: 'round' });
    } else {
      for (const l of all) strokeLane(g, l);
      g.stroke({ width: b.w, color: P.trace, alpha: 0.9, cap: 'round', join: 'round' });
      for (const l of all) strokeLane(g, l);
      g.stroke({ width: b.w * 0.34, color: mix(P.trace, '#ffffff', 0.35), alpha: T.dark ? 0.28 : 0.4, cap: 'round', join: 'round' });
      for (const l of all) padLanes.push({ l, w: b.pad ?? Math.min(b.w * 1.9, 20) });
    }
  }
  // (the pads these lanes end on are drawn last, over the parts: see `drawPads`)

  // ---- CPU VRM: PWM controller, the phases (a tier fills its own), power-good light ----
  {
    const v = geo.vrm;
    chip(c, geo.pwm, { legs: 6, pitch: 26, text: 'PWM', size: 46, accent: T.mul });
    disc(g, geo.vrmLed.x, geo.vrmLed.y, 20, { fill: P.dark, stroke: P.edge, lw: 5 }); // power-good light (lit by live.ts)
    geo.vrmPhases.forEach((r) => vrmPhaseArt(c, r, false, geo.vrmRailY));
    lbl(`VRM · CPU CORE · ${phases} PHASE`, v.x + 440, v.y - 36); // east of the 8-pin's four runs
  }
  // ---- memory VRM: a short row above the sockets ----
  {
    const v = geo.dvrm;
    geo.dPhases.forEach((r) => dramPhaseArt(c, r, geo.dRailY));
    lbl(`VRM · DRAM · ${ramPhases} PHASE`, v.x + 10, v.y - 36);
  }

  // ---- DIMM sockets ----
  geo.dimm.forEach((d, i) => dimmSocket(c, d.rect, d.flip, i));

  // ---- PCIe slots ----
  geo.pcie.forEach((r, i) => pcieSlot(c, r, ['PCIe x16 · GPU', 'PCIe x8', 'PCIe x4', 'PCIe x1'][i]!, skin.armor > 0, i === 0));

  // ---- M.2: the connector at the west end, a standoff for the stick's far end ----
  geo.m2.forEach((m, mi) => {
    shadow(c, m.x, m.y, m.w, m.h, 12, 8, 0.2);
    box(g, m.x, m.y, m.w, m.h, 12, { fill: P.sub, stroke: P.edge, lw: 5 });
    box(g, m.x + 8, m.y + 70, 120, m.h - 140, 8, { fill: P.dark, stroke: P.edge, lw: 4 });
    for (const [cx, cy] of m2Contacts(m)) g.rect(cx - 20, cy - 5, 90, 10);
    g.fill({ color: P.via, alpha: 0.6 });
    box(g, m.x + 160, m.y + 40, m.w - 320, m.h - 80, 10, { stroke: P.silk, lw: 4, sa: 0.3 });
    disc(g, m.x + m.w - 70, m.y + m.h / 2, 36, { fill: P.panel, stroke: P.edge, lw: 6 });
    disc(g, m.x + m.w - 70, m.y + m.h / 2, 14, { fill: P.dark });
    labels.addChild(label(geo.m2.length > 1 ? `M.2 NVMe · 2280 · M2_${mi}` : 'M.2 NVMe · 2280', m.x + m.w, m.y - 36, 38, P.silk, { anchor: [1, 0.5] }));
  });

  // ---- chipset (south-east of the CPU, on its SATA ports' rows): QFP legs, a heat sink on the better boards ----
  {
    const q = geo.chip;
    shadow(c, q.x, q.y, q.w, q.h, 26, 12, 0.3);
    legRects(c, q, 0);
    g.fill({ color: P.silkHi, alpha: 0.5 });
    box(g, q.x, q.y, q.w, q.h, 26, { fill: P.panel, stroke: T.mul, lw: 6, sa: 0.5 });
    if (tier === 0) {
      box(g, q.x + 60, q.y + 60, q.w - 120, q.h - 120, 12, { fill: P.dark, stroke: P.edge, lw: 4 });
    } else if (tier === 1) {
      for (let x = q.x + 70; x < q.x + q.w - 50; x += 36) g.moveTo(x, q.y + 50).lineTo(x, q.y + q.h - 50);
      g.stroke({ width: 8, color: P.edge, alpha: 0.9 });
    } else {
      // a finned heat sink: a base plate with a row of fins (alternating tone), a screw in each corner; the top board adds a lit edge
      box(g, q.x + 14, q.y + 14, q.w - 28, q.h - 28, 16, { fill: mix(P.panel, T.alu, 0.14), stroke: T.mul, lw: 4, sa: 0.5 });
      for (let x = q.x + 60, k = 0; x < q.x + q.w - 40; x += 40, k++) g.rect(x - 7, q.y + 44, 14, q.h - 88).fill({ color: k % 2 ? P.edge : P.silkHi, alpha: k % 2 ? 0.9 : 0.3 });
      for (const [sx, sy] of [[q.x + 40, q.y + 40], [q.x + q.w - 40, q.y + 40], [q.x + 40, q.y + q.h - 40], [q.x + q.w - 40, q.y + q.h - 40]] as const) {
        disc(g, sx, sy, 13, { fill: P.dark, stroke: P.edge, lw: 3 });
        g.moveTo(sx - 7, sy).lineTo(sx + 7, sy).stroke({ width: 3, color: P.edge, alpha: 0.9 });
      }
      if (tier === 3) {
        g.poly([q.x + 20, q.y + 90, q.x + 90, q.y + 20, q.x + q.w - 20, q.y + 20, q.x + q.w - 20, q.y + q.h - 90, q.x + q.w - 90, q.y + q.h - 20, q.x + 20, q.y + q.h - 20])
          .stroke({ width: 5, color: T.mul, alpha: 0.45, join: 'round' });
        g.rect(q.x + 70, q.y + q.h - 38, q.w - 140, 8).fill({ color: T.br, alpha: 0.55 });
      }
    }
    // decoupling under the chipset (the DMI lanes are above it, the SATA lanes east of it)
    smd(c, q.x + 70, q.y + q.h + 62, Math.floor((q.w - 140) / 62) + 1, 62, 0, 30, 18, 0.85);
    labels.addChild(label('PCH', q.x + q.w / 2, q.y + q.h / 2, tier === 0 ? 70 : 110, T.mul, { head: true, anchor: [0.5, 0.5], a: 0.6 }));
  }
  // ---- SATA: ports on the east edge, mouths facing east (the drive cables come from the bay) ----
  // stacked ports share a housing (pairs), the way the real connectors come
  for (let i = 0; i + 1 < geo.sata.length; i += 2) {
    const a = geo.sata[i]!, b = geo.sata[i + 1]!;
    box(g, a.x - 12, a.y - 12, a.w + 24, b.y + b.h - a.y + 24, 14, { fill: P.sub, fa: 0.5, stroke: P.edge, lw: 4, sa: 0.5 });
  }
  geo.sata.forEach((p, i) => sataPortArt(c, p, i, i < nSata));

  // ---- power connectors ----
  powerConn(c, geo.atx, 2, 12, 'ATX 24-PIN', 'e');
  // filter capacitors beside the 24-pin
  for (let k = 0; k < (tier === 0 ? 2 : 3); k++) cap(c, geo.atx.x - 140, geo.atx.y + 330 + k * 190, 62);
  powerConn(c, geo.cpw, 4, 2, 'CPU 8-PIN', 'n', 1, [geo.cpw.x, geo.cpw.y + geo.cpw.h + 44, 0]);
  if (geo.pciew) powerConn(c, geo.pciew, 2, 3, 'PCIe 6-PIN', 'e', 0.55);

  // ---- battery ----
  {
    const b = geo.bat, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    disc(g, cx + 8, cy + 12, 145, { fill: '#000000', fa: 0.25 });
    disc(g, cx, cy, 145, { fill: P.panel, stroke: P.edge, lw: 8 }); disc(g, cx, cy, 90, { stroke: P.edge, lw: 6 });
    labels.addChild(label('CR2032', cx, cy, 44, P.silk, { anchor: [0.5, 0.5], weight: '700' }));
  }

  // ---- rear I/O (west edge): the shield plate flush with the case's rear panel, the connectors on it with their mouths facing west ----
  {
    const q = geo.io, fitted = (id: string) => (id === 'eth' ? feat.ethernetMbps > 0 : id === 'dp' ? feat.displayPorts >= 2 : id.startsWith('usb') ? Number(id.slice(3)) < feat.usbPorts : true);
    for (const p of IO_PORTS) ioConnector(c, p, fitted(p.id));
    const tag = (t: string, id: string, a = 0.7) => { const p = IO_PORTS.find((o) => o.id === id)!; labels.addChild(label(t, p.x + p.w / 2, p.y, 28, P.silkHi, { anchor: [0.5, 0.5], a })); };
    tag('HDMI', 'hdmi', 0.85);
    if (feat.displayPorts >= 2) tag('DP', 'dp');
    IO_PORTS.filter((p) => p.kind === 'usb').forEach((p, i) => { if (i < feat.usbPorts) labels.addChild(label(`USB ${i + 1}`, p.x + p.w / 2 - 40, p.y + 30, 24, P.silkHi, { anchor: [0.5, 0.5], a: 0.6 })); });
    const eth = IO_PORTS.find((p) => p.id === 'eth')!;
    if (feat.ethernetMbps > 0) {
      for (const lx of [eth.x + 70, eth.x + 150]) disc(g, lx, eth.y + eth.h / 2 + 36, 13, { fill: P.dark, stroke: P.edge, lw: 3 }); // link / activity wells, lit live (net.ts)
      labels.addChild(label(feat.ethernetMbps >= 1000 ? 'ETH 1G' : `ETH ${feat.ethernetMbps}M`, eth.x + 200, eth.y + eth.h / 2 + 36, 28, P.silkHi, { anchor: [0, 0.5] }));
    } else labels.addChild(label('ETH · none', eth.x + 40, eth.y, 30, P.silk, { anchor: [0, 0.5], a: 0.6 }));
    lbl('REAR I/O', q.x + 6, q.y - 36);
  }
  // ---- audio codec (seven legs: the jacks' lanes leave from the 1st, 4th and 7th), the USB hub and the PHY, all with their legs on the lanes ----
  chip(c, geo.codec, { legs: 7, pitch: 26, text: 'CODEC', size: 36, accent: T.mul });
  for (let k = 0; k < 3; k++) cap(c, geo.codec.x + 50 + k * 66, geo.codec.y - 90, 26, T.ld); // the audio capacitors above the codec
  chip(c, geo.hub, { legs: 8, pitch: 26, text: 'USB', size: 48, accent: T.mul });
  if (geo.phy) chip(c, geo.phy, { legs: 8, pitch: 26, text: 'PHY', size: 40, accent: T.mul });

  // ---- CPU socket frame (empty-socket look; the package covers it when a CPU is installed) ----
  {
    const k = PKG, e = SOCKET_E;
    box(g, k.x - e, k.y - e, k.w + 2 * e, k.h + 2 * e, 90, { fill: P.dark, stroke: T.pin, lw: 10, fa: 0.8, sa: 0.55 });
    for (const [x, y] of [[k.x - e + 30, k.y - e + 30], [k.x + k.w + e - 30, k.y - e + 30], [k.x - e + 30, k.y + k.h + e - 30], [k.x + k.w + e - 30, k.y + k.h + e - 30]] as const) {
      disc(g, x, y, 28, { fill: P.panel });
      g.moveTo(x - 15, y).lineTo(x + 15, y).moveTo(x, y - 15).lineTo(x, y + 15).stroke({ width: 5, color: T.pin, alpha: 0.7 });
    }
    for (let x = k.x + 90; x < k.x + k.w - 80; x += 36) for (let y = k.y + 90; y < k.y + k.h - 80; y += 36) g.rect(x, y, 14, 14);
    g.fill({ color: T.pin, alpha: 0.25 });
    lbl('CPU_SOCKET · LGA-1337', k.x - e, k.y - e - 36, 38);
  }

  // ---- the small stuff that makes it a real board: decoupling beside the socket, the BIOS chip, the header corner with its controller ----
  {
    const sx = PKG.x - SOCKET_E, qy = PKG.y + PKG.h + SOCKET_E;
    smd(c, -1000, qy + 44, 14, 56, 0, 30, 18, 0.85);      // under the package's south edge, west of the PCIe lanes
    smd(c, sx - 70, 170, 9, 0, 56, 18, 30, 0.85);         // beside its west edge, clear of the USB lanes
    header(c, -1180, 790, 3, 1, 'CLR_CMOS');              // the CMOS-clear jumper, below the battery
    // the BIOS flash west of the chipset, on its SPI lanes (straight: the flash's east legs sit level with the chipset's west ones)
    chip(c, geo.bios, { legs: 4, pitch: 26, text: 'BIOS', size: 30, accent: T.mul });
    const spi: Lane[] = legsOf(geo.bios, 'e', 4, 26).map((l, k) => mkLane([l, legsFrom(geo.chip, 'w', geo.west.bios, 4)[k]!], k * 17));
    for (const l of spi) strokeLane(g, l);
    g.stroke({ width: 8, color: P.trace, alpha: 0.9, cap: 'round' });
    for (const l of spi) padLanes.push({ l, w: 16 });
    // the header corner: a row along the bottom, west of the chipset (the top board's second group sits east of it, under the SATA rows)
    const hy = geo.hdrY;
    const hdr = (x: number, cols: number, rows: number, name: string, y = hy) => header(c, x, y, cols, rows, name);
    const fp = hdr(-1100, 5, 2, 'F_PANEL');
    hdr(-80, 4, 1, 'SYS_FAN');
    if (tier >= 1) {
      const io = hdr(-450, 5, 2, 'USB_2');
      // a small I/O controller between the two headers, wired to both: its legs sit on the headers' pin rows, so the lanes run straight
      const sio = { x: -740, y: hy - 16, w: 190, h: 208 };
      chip(c, sio, { legs: 3, pitch: 52, text: 'SIO', size: 36, accent: T.mul });
      const links: Lane[] = [];
      for (let j = 0; j < 2; j++) {
        links.push(mkLane([headerPin(fp.x, fp.y, 4, j), legsOf(sio, 'w', 3, 52)[j]!], j * 17));
        links.push(mkLane([legsOf(sio, 'e', 3, 52)[j]!, headerPin(io.x, io.y, 0, j)], j * 17 + 5));
      }
      for (const l of links) strokeLane(g, l);
      g.stroke({ width: 8, color: P.trace, alpha: 0.9, cap: 'round' });
      for (const l of links) padLanes.push({ l, w: 16 });
    }
    if (tier >= 2) hdr(-1550, 6, 2, 'TPM');
    if (tier >= 3) { hdr(-2200, 5, 2, 'USB_3'); hdr(-1860, 4, 1, 'SYS_FAN2'); }
    // the top board: an RGB strip along the bottom edge and a two-digit debug display by the 24-pin
    if (tier >= 3) {
      for (let k = 0; k < 44; k++) {
        const x = BD.x + 700 + k * ((BD.w - 1400) / 43), col = mix(T.alu, T.br, k / 43);
        g.circle(x, south - 60, 22).fill({ color: col, alpha: 0.12 });
        g.circle(x, south - 60, 9).fill({ color: col, alpha: 0.85 });
      }
      const d = { x: BD.x + BD.w - 720, y: -420, w: 300, h: 170 };
      box(g, d.x, d.y, d.w, d.h, 10, { fill: '#05070b', stroke: P.edge, lw: 5 });
      for (let k = 0; k < 2; k++) {
        const ox = d.x + 24 + k * 134;
        for (const [a, b2, w, h] of [[10, 10, 70, 10], [10, 70, 70, 10], [10, 130, 70, 10], [4, 18, 10, 50], [74, 18, 10, 50], [4, 78, 10, 50], [74, 78, 10, 50]] as const) g.rect(ox + a, d.y + 14 + b2 * 0.82, w, h);
      }
      g.fill({ color: T.ld, alpha: 0.4 });
      labels.addChild(label('DEBUG', d.x + d.w / 2, d.y - 36, 28, P.silk, { anchor: [0.5, 0.5] }));
    }
  }

  // ---- quiet decoration: a tiny QR and hex patch, silkscreen ----
  if (geo.hex) {
    const hx = geo.hex, hr = 46, cells: [number, number, number][] = [];
    for (let q = 0; q < 8; q++) for (let r = 0; r < 3; r++) {
      const cx = hx.x + 60 + q * hr * 1.73 + (r % 2) * hr * 0.865, cy = hx.y + 50 + r * hr * 1.5;
      cells.push([cx, cy, rand()]);
    }
    for (const cc of cells) g.poly(hexPoly(cc[0], cc[1], hr - 4));
    g.stroke({ width: 4, color: P.edge, alpha: 0.7 });
    for (const cc of cells) if (cc[2] < 0.2) g.poly(hexPoly(cc[0], cc[1], hr - 4));
    g.fill({ color: T.br, alpha: 0.14 });
  }
  if (geo.qr) {
    const q = geo.qr, n = 14, s = (q.w - 40) / n;
    box(g, q.x, q.y, q.w, q.h, 10, { fill: P.dark, stroke: P.edge, lw: 4 });
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const corner = (i < 4 && j < 4) || (i > n - 5 && j < 4) || (i < 4 && j > n - 5);
      const on = corner ? i % 3 !== 1 || j % 3 !== 1 : rand() < 0.45;
      if (on) g.rect(q.x + 20 + i * s, q.y + 20 + j * s, s - 1, s - 1);
    }
    g.fill({ color: P.silkHi, alpha: 0.5 });
  }
  // the bottom silkscreen sits above the trim lines (south - 150 and below), clear of the header row and the holes
  labels.addChild(label('PIPELINE CITY', -800, south - 250, 90, P.silk, { head: true, a: 0.5 }));
  if (skin.trim >= 2) lbl('OVERCLOCK READY', -800, south - 195, 36, 0.6);
  lbl(`MB-${tier + 1}000 · ${(tierSpec?.name ?? 'BOARD').toUpperCase()} · ${geo.form.toUpperCase()} · REV A`, Math.min(1300, BD.x + BD.w - 1150), south - 215, 40, 0.8);

  // ---- the pads every signal lane ends on, over the parts, so each trace visibly meets its pin ----
  drawPads(g, padLanes, P.via);

  // ---- the mounting holes, last: each has a clear ring, so no trim or silkscreen line runs through a screw ----
  for (const [x, y] of geo.holes) hole(c, x, y, 66);

  root.addChild(labels);
  return { root, labels, buses, pal: P };
}
