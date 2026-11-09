import { Container, Graphics } from 'pixi.js';
import { BOARD_TIERS, pcieLabel } from '../sim/specs';
import { BD, BOARD_SEED, COOLER_HOLE, COOLER_HOLES, GEO, PKG, SOCKET_E, SOCKET_KEEP, WALL_T, rng, type Rect } from './layout/layout';
import { shieldSheet } from './layout/ports';
import { box, disc, label, lgrad, mix } from '@/core/render/ink';
import { IO_PORTS } from './layout/boardlayout';
import { PKG_PIN, PKG_ROW, m2Contacts, m2Socket, m2Standoffs, m2Stick, m2Tie, pcieFeed, slotLanding, slotTie, xtalPads } from './layout/pins';
import { tuneBump } from './layout/match';
import { pchLedHousing } from './wiring/pchlive';
import { skinOf, slotArmour } from './skins';
import { buildBuses, offsetLine, pointAt, vdimmEnd, vdimmStart, visibleParts, type Bus, type Lane } from './wiring/routes';
import { stitchVias } from './wiring/stitch';
import { makePalette, type Palette, type Theme } from '@/core/render/theme';
import {
  cap, chip, coolerHole, dimmSocket, dramPhaseArt, header, hole, ioConnector, legRects, padsAt, pcieRelease, pcieSlot, powerConn, sataPortArt, shadow, smd, stitch, vrmPhaseArt, type Ctx,
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

export function strokeLane(g: Graphics, l: Lane, pair = 0) {
  const parts = visibleParts(l);
  parts.forEach((part, pi) => [pair ? -pair : 0, pair].slice(0, pair ? 2 : 1).forEach((off, k) => {
    let pts = off ? offsetLine(part, off) : part;
    // a pair's skew-tuning bump: one strand of the pair (alternating from lane to lane) steps out and back on the last stretch before the pad
    if (pair && pi === parts.length - 1 && k === (Math.floor(l.ph / 37) % 2)) pts = tuneBump(pts, Math.max(0, pts.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - pts[i - 1]![0], q[1] - pts[i - 1]![1]) : 0), 0) - 90), off < 0 ? -1 : 1);
    g.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
  }));
}

/** A plated pad across each end of every signal lane (`w` wide, 34 long, along the lane's last stretch). */
function drawPads(g: Graphics, lanes: { l: Lane; w: number }[], color: string) {
  for (const { l, w } of lanes) {
    for (const end of [0, 1]) {
      if (end === 0 && (l.hops?.[0]?.[0] ?? 99) < 20) continue; // (a lane that dives at its pin has no pad on the surface)
      const n = l.pts.length, a = end === 0 ? l.pts[1]! : l.pts[n - 2]!, p = end === 0 ? l.pts[0]! : l.pts[n - 1]!;
      const dx = p[0] - a[0], dy = p[1] - a[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
      const L = 34, W = w;
      g.poly([p[0] - ux * L * 0.5 + nx * W / 2, p[1] - uy * L * 0.5 + ny * W / 2, p[0] + ux * L * 0.5 + nx * W / 2, p[1] + uy * L * 0.5 + ny * W / 2,
        p[0] + ux * L * 0.5 - nx * W / 2, p[1] + uy * L * 0.5 - ny * W / 2, p[0] - ux * L * 0.5 - nx * W / 2, p[1] - uy * L * 0.5 - ny * W / 2]);
    }
  }
  g.fill({ color, alpha: 0.9 });
}

/** The chipset heat sink's raised plateau (Basic and up): a plain plate keeps a wide one, the faceted blocks a smaller one inside their facets. */
export const pchPlateau = (q: Rect, tier: number): Rect => { const i = tier >= 2 ? 92 : 56; return { x: q.x + i, y: q.y + i, w: q.w - 2 * i, h: q.h - 2 * i }; };
/** Where the chipset heat sink is held down: two fixings on a diagonal (push pins on the plain plate, spring screws on the faceted blocks). */
export const pchFixings = (q: Rect, tier: number): [number, number][] => { const i = tier >= 2 ? 52 : 30; return [[q.x + i, q.y + i], [q.x + q.w - i, q.y + q.h - i]]; };

/** The board palette of a tier: the theme's, mixed from the skin's solder mask, with the skin's silkscreen ink (skins.ts). */
export function boardPalette(T: Theme, tier: number): Palette {
  const skin = skinOf(tier), k = T.dark ? 0 : 1, P = makePalette(T, skin.mask[k]);
  P.silk = skin.silk[k]; P.silkHi = mix(skin.silk[k], '#ffffff', 0.35);
  return P;
}

/**
 * The static motherboard, built once per (theme, tier) and never touched per frame. Visual hierarchy: the working parts
 * (CPU, DIMMs, cooler, PSU, monitor) are drawn by devices.ts at full contrast; everything here is mixed toward the
 * board colour. Routing is deliberate (routes.ts); there is no random scatter. Every run of copper ends on a footprint.
 * `far`: for the far textures (the bake of the whole board, the shop's picture): a thin trace is lost there, so each lane is a wider, softer band of the same tone.
 */
export function buildBoard(T: Theme, tier: number, solid?: Ctx['solid'], far = false): BoardArt {
  const geo = GEO; // the layout is set by the caller (`setLayoutTier`) before the scene is built
  const rand = rng(BOARD_SEED);
  const P = boardPalette(T, tier), skin = skinOf(tier);
  const tierSpec = BOARD_TIERS[tier];
  const feat = tierSpec?.features ?? { ethernetMbps: 0, usbPorts: 1, displayPorts: 1 };
  const phases = tierSpec?.vrm.phases ?? 2, ramPhases = tierSpec?.ramVrm.phases ?? 2;
  const slots = tierSpec?.slots ?? {};
  const nSata = slots.sata ?? 0;
  const root = new Container();
  const labels = new Container();
  const g = new Graphics();
  root.addChild(g);
  const c: Ctx = { g, labels, T, P, tier, ...(solid ? { solid } : {}) };
  const lbl = (t: string, x: number, y: number, s = 38, a = 1) => labels.addChild(label(t, x, y, s, P.silk, { a }));
  const south = BD.y + BD.h;

  // ---- plate: a soft shadow on the tray, the substrate, an edge bevel (the mounting holes go on last, over any trim) ----
  box(g, BD.x + 22, BD.y + 34, BD.w, BD.h, 120, { fill: '#000000', fa: T.dark ? 0.32 : 0.14 });
  // the solder mask: lit from the top left (the lamp's side), a little deeper toward the bottom right
  g.roundRect(BD.x, BD.y, BD.w, BD.h, 120).fill(lgrad(mix(P.board, '#ffffff', T.dark ? 0.07 : 0.14), mix(P.board, '#000000', T.dark ? 0.26 : 0.1), [1, 1])).stroke({ width: 12, color: P.edge });
  box(g, BD.x + 70, BD.y + 70, BD.w - 140, BD.h - 140, 90, { stroke: P.edge, lw: 4, sa: 0.5 });
  // the bevel: a lit edge on the top and west sides, a shaded one on the bottom and east
  g.moveTo(BD.x + 120, BD.y + 9).lineTo(BD.x + BD.w - 120, BD.y + 9).moveTo(BD.x + 9, BD.y + 120).lineTo(BD.x + 9, BD.y + BD.h - 120).stroke({ width: 7, color: '#ffffff', alpha: T.dark ? 0.1 : 0.4, cap: 'round' });
  g.moveTo(BD.x + 120, BD.y + BD.h - 9).lineTo(BD.x + BD.w - 120, BD.y + BD.h - 9).moveTo(BD.x + BD.w - 9, BD.y + 120).lineTo(BD.x + BD.w - 9, BD.y + BD.h - 120).stroke({ width: 7, color: '#000000', alpha: T.dark ? 0.3 : 0.16, cap: 'round' });
  // the better boards carry a little more: a trim line round the plate (Mainstream, Enthusiast) and a second line for the top tier;
  // drawn first, so every part sits over it (the holes clear it with their own ring)
  if (skin.trim >= 1) box(g, BD.x + 120, BD.y + 120, BD.w - 240, BD.h - 240, 70, { stroke: T.alu, lw: 5, sa: skin.trim >= 2 ? 0.3 : 0.16 });
  if (skin.trim >= 2) box(g, BD.x + 150, BD.y + 150, BD.w - 300, BD.h - 300, 60, { stroke: T.mul, lw: 3, sa: 0.22 });

  // ---- the rear I/O's shield plate (flush with the case's rear panel); the lanes to the connectors run over it, the connectors sit on it later ----
  box(g, geo.io.x, geo.io.y, geo.io.w, geo.io.h, 30, { fill: P.panel, stroke: P.edge, lw: 10 });
  box(g, geo.io.x + 14, geo.io.y + 14, geo.io.w - 28, geo.io.h - 28, 22, { stroke: P.edge, lw: 3, sa: 0.5 });
  shieldSheet(g, T, geo.io.x + 14, geo.io.y + 20, WALL_T - 28, geo.io.h - 40); // the wall's own sheet, in its plane: the ports pass through it

  // ---- the ground plane: the whole board under the mask, a shade off the bare mask (the traces run in clear moats through it) ----
  g.roundRect(BD.x + 56, BD.y + 56, BD.w - 112, BD.h - 112, 80).fill({ color: P.pour, alpha: 0.3 });

  // ---- copper pours: the core voltage plane under the package edge, the memory rail ----
  {
    const ph = geo.vrmPhases, first = ph[0]!, last = ph[ph.length - 1]!, py = PKG.y - SOCKET_E;
    const y0 = first.y + first.h;
    const xl = Math.max(-840, first.x + 30), xr = Math.min(840, last.x + last.w - 30);
    const pour = [first.x + 24, y0, last.x + last.w - 24, y0, xr, py + 4, xl, py + 4];
    g.poly(pour).fill({ color: P.pour });
    for (let y = y0 + 40; y < py; y += 60) {
      const t = (y - y0) / (py - y0), x0 = pour[0]! + (xl - pour[0]!) * t, x1 = pour[2]! + (xr - pour[2]!) * t;
      for (let x = x0 + 40; x < x1 - 20; x += 60) g.circle(x, y, 5);
    }
    g.fill({ color: P.tent, alpha: 0.7 });
    const pr = { x: vdimmStart(geo) - 30, y: geo.vdimmY - 56, w: vdimmEnd(geo) + 30 - vdimmStart(geo) + 30, h: 112 };
    box(g, pr.x, pr.y, pr.w, pr.h, 20, { fill: P.pour });
    stitch(c, pr, 52, 5, 0.7);
  }

  // ---- the regulators' areas under the copper that feeds them: the mask a shade deeper over the power planes, a silkscreen outline ----
  const zone = mix(P.board, '#000000', 0.22);
  box(g, geo.vrm.x, geo.vrm.y, geo.vrm.w, geo.vrm.h, 28, { fill: zone, stroke: P.silk, lw: 5, sa: 0.3 });
  box(g, geo.dvrm.x, geo.dvrm.y, geo.dvrm.w, geo.dvrm.h, 22, { fill: zone, stroke: P.silk, lw: 5, sa: 0.3 });

  // ---- buses: base strokes (the live layer lights the active ones) and the pads they end on ----
  const buses = buildBuses();
  const padLanes: { l: Lane; w: number }[] = [], allLanes: Lane[] = [];
  const drill = mix(P.board, '#000000', 0.5), round = { cap: 'round', join: 'round' } as const;
  for (const b of buses) {
    const power = b.id === 'pwr12' || b.id === 'pwrcpu' || b.id === 'vdimm' || b.id === 'vcore';
    const all = b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : []);
    allLanes.push(...all);
    if (b.id === 'pwrpcie') continue; // (the slots' 12 V rail runs on an inner layer: nothing on the surface, the power lens still shows it)
    if (!power) for (const l of all) padLanes.push({ l, w: b.pad ?? Math.min(b.w * 1.9, 20) });
    if (far && !power) {
      for (const l of all) strokeLane(g, l);
      g.stroke({ width: b.w * 1.2, color: P.trace, alpha: 0.5, ...round });
      continue;
    }
    // copper under the mask: each trace in a clear moat through the plane, thin (a pair: two strands, tight), a shade off the mask
    const pr = power || !b.pair ? 0 : b.w * 0.3, sw = power ? b.w : b.pair ? 2.8 : 4;
    for (const l of all) strokeLane(g, l, pr);
    g.stroke({ width: sw + (power ? 14 : 7), color: P.board, ...round });
    for (const l of all) strokeLane(g, l, pr);
    g.stroke({ width: sw, color: power ? P.pour : P.trace, ...round });
  }
  // a via at each end of every hop (the lane dives under what it crosses), the mask over it; the ground stitching through the free plane
  for (const b of buses) if (b.id !== 'pwrpcie') for (const l of b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : [])) for (const [a, z] of l.hops ?? []) for (const s of [a, z]) {
    const [x, y] = pointAt(l, s);
    g.circle(x, y, 8).fill({ color: P.tent });
    g.circle(x, y, 3.4).fill({ color: drill });
  }
  if (!far) {
    const vias = stitchVias(geo, allLanes);
    for (const [x, y] of vias) g.circle(x, y, 6);
    g.fill({ color: P.tent, alpha: 0.5 });
    for (const [x, y] of vias) g.circle(x, y, 2.4);
    g.fill({ color: drill });
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
  geo.dimm.forEach((d, i) => dimmSocket(c, d.rect, i));

  // ---- PCIe slots ----
  geo.pcie.forEach((r, i) => pcieSlot(c, r, `PCIe ${pcieLabel(BOARD_TIERS[geo.tier]!.pcieWidths[i]!)}${i === 0 ? ' · GPU' : ''}`, slotArmour(geo.tier, i), i === 0));
  // the send pairs' coupling capacitors: a row of tiny pairs of parts across their traces, just short of the slot (the CPU's slots only)
  geo.pcie.forEach((r, i) => {
    if (!geo.pcieLinks[i]!.cpu) return;
    for (const q of slotLanding(r, geo.pcieLinks[i]!.pairs, 'n')) if (!q.far) for (const dx of [-3.2, 3.2]) {
      g.rect(q.x + dx - 2.6, r.y - 84, 5.2, 16).fill({ color: '#a98f6c' });
      g.rect(q.x + dx - 2.6, r.y - 84, 5.2, 3.5).rect(q.x + dx - 2.6, r.y - 71.5, 5.2, 3.5).fill({ color: '#d6d9dc' });
    }
  });
  // every other slot's supply ties into the board's plane: a tab at its latch end, a stub to a patch of copper stitched with vias
  geo.pcie.forEach((r, i) => {
    if (i === 0) return; // the x16 slot's supply arrives on the rail `pwrpcie` from the 24-pin
    const f = pcieFeed(r), t = slotTie(r, i), down = i === 0, tx = t.x + t.w / 2;
    // the tab: at the latch end, or (the x16 slot, whose east side is the lanes') on its bottom edge above the patch
    const tab = down ? { x: tx - 16, y: r.y + r.h - 14, w: 32, h: 28 } : { x: f[0] - 22, y: f[1] - 14, w: 32, h: 28 };
    if (down) g.moveTo(tx, r.y + r.h).lineTo(tx, t.y + 10); else g.moveTo(f[0] - 10, f[1]).lineTo(t.x, f[1]);
    g.stroke({ width: 18, color: P.pour, cap: 'butt' });
    box(g, t.x, t.y, t.w, t.h, 8, { fill: P.pour });
    for (let k = 0; k < 6; k++) g.circle(t.x + 20 + (k % 3) * 35, t.y + 14 + Math.floor(k / 3) * 22, 5);
    g.fill({ color: P.tent });
    box(g, tab.x, tab.y, tab.w, tab.h, 6, { fill: P.copper, fa: 0.9, stroke: P.edge, lw: 3, sa: 0.8 });
  });
  // the x16 slot's 12 V tab at its latch end, where the rail from the 24-pin arrives
  if (geo.pcie[0]) { const f = pcieFeed(geo.pcie[0]); box(g, f[0] - 22, f[1] - 18, 44, 36, 8, { fill: P.copper, fa: 0.9, stroke: P.edge, lw: 4, sa: 0.8 }); }
  geo.pcie.forEach((r) => pcieRelease(c, r)); // after the power tabs: the button stands above them

  // ---- M.2 2280: the 3.3 V tie, the socket at the west end (its mouth keyed for an M-key stick), the stick's outline printed on the board
  // with its name (a fitted stick covers them), threaded holes for 42 and 60 mm sticks, the standoff for an 80 mm one ----
  geo.m2.forEach((m, mi) => {
    shadow(c, m.x, m.y, m.w, m.h, 12, 8, 0.2);
    box(g, m.x, m.y, m.w, m.h, 12, { fill: P.sub, stroke: P.edge, lw: 5 });
    const so = m2Socket(m), st = m2Stick(m);
    box(g, so.x, so.y, so.w, so.h, 8, { fill: P.dark, stroke: P.edge, lw: 4 });
    box(g, so.x + 56, so.y + 22, 16, so.h - 44, 4, { fill: '#000000', fa: 0.55 }); // the mouth
    g.rect(so.x + 54, st.y + st.h * 0.74, 20, 30).fill({ color: P.edge }); // the M key's ridge
    for (const [cx, cy] of m2Contacts(m)) g.rect(cx - 20, cy - 5, 70, 10);
    g.fill({ color: P.via, alpha: 0.6 });
    box(g, st.x + 70, st.y, st.w - 70, st.h, 10, { stroke: P.silk, lw: 4, sa: 0.3 });
    labels.addChild(label(`M2_${mi + 1} · PCIe x4`, st.x + 160, m.y + m.h / 2, 38, P.silk, { anchor: [0, 0.5], a: 0.6 }));
    m2Standoffs(m).forEach(([sx, sy], k) => {
      if (k < 2) { disc(g, sx, sy, 24, { fill: P.dark, stroke: P.pour, lw: 6 }); disc(g, sx, sy, 10, { fill: '#000000', fa: 0.6 }); }
      else { disc(g, sx, sy, 36, { fill: P.panel, stroke: P.edge, lw: 6 }); disc(g, sx, sy, 14, { fill: P.dark }); }
      labels.addChild(label(['2242', '2260', '2280'][k]!, sx, sy + (k < 2 ? 56 : 64), 22, P.silk, { anchor: [0.5, 0.5], a: 0.6 }));
    });
    const mt = m2Tie(m); // the 3.3 V tie into the plane, west of the housing's north end
    box(g, mt.x, mt.y, mt.w, mt.h, 6, { fill: P.pour });
    for (let k = 0; k < 4; k++) g.circle(mt.x + mt.w / 2, mt.y + 16 + k * 23, 5);
    g.fill({ color: P.tent });
    labels.addChild(label('3V3', mt.x + mt.w / 2, mt.y + mt.h + 20, 20, P.silk, { anchor: [0.5, 0.5], a: 0.7 }));
  });

  // ---- chipset (south-east of the CPU, on its SATA ports' rows): QFP legs; the better boards cover the package with a low heat sink ----
  // (the 3D builds the sink's body over these drawings: parts3d.ts `chipset`, whose plateau wears `pchPlateau`)
  {
    const q = geo.chip, cx = q.x + q.w / 2, cy = q.y + q.h / 2;
    shadow(c, q.x, q.y, q.w, q.h, 26, 12, 0.3);
    legRects(c, q, 0);
    g.fill({ color: P.silkHi, alpha: 0.5 });
    if (tier === 0) {
      // the bare package: a black moulded body, the pin-1 dimple and the ejector marks, the type laser-etched in pale grey
      box(g, q.x, q.y, q.w, q.h, 14, { fill: mix(P.dark, '#000000', 0.35), stroke: P.edge, lw: 4, sa: 0.8 });
      disc(g, q.x + 50, q.y + 50, 16, { fill: '#000000', fa: 0.45 });
      for (const [ex, ey] of [[q.x + q.w - 70, q.y + q.h - 70], [q.x + 70, q.y + q.h - 70]] as const) disc(g, ex, ey, 26, { fill: '#ffffff', fa: T.dark ? 0.03 : 0.08 });
      labels.addChild(label('PCH-S1', cx, cy - 34, 52, P.silk, { anchor: [0.5, 0.5], a: 0.42 }), label('2026  K7', cx, cy + 34, 34, P.silk, { anchor: [0.5, 0.5], a: 0.32 }));
    } else {
      // the heat sink: its plate covers the package (the 3D plate runs on over the legs, as a real one does); a flat black plate with
      // machined grooves and two push pins (Basic), a faceted block with a raised brushed plateau and two spring screws (Mainstream, Enthusiast)
      const pl = pchPlateau(q, tier), facet = tier >= 2;
      const plate = skin.sink;
      if (facet) {
        const k = 70;
        g.poly([q.x + k, q.y, q.x + q.w - k, q.y, q.x + q.w, q.y + k, q.x + q.w, q.y + q.h - k, q.x + q.w - k, q.y + q.h, q.x + k, q.y + q.h, q.x, q.y + q.h - k, q.x, q.y + k])
          .fill({ color: plate }).stroke({ width: 5, color: '#000000', alpha: 0.4, join: 'round' });
      } else box(g, q.x, q.y, q.w, q.h, 22, { fill: plate, stroke: '#000000', lw: 4, sa: 0.4 });
      // the plateau (the 3D raises it): machined grooves on the plain plate, brushed streaks and a printed mark on the faceted ones
      const top = skin.insert ?? mix(skin.sink, '#ffffff', 0.04);
      box(g, pl.x, pl.y, pl.w, pl.h, facet ? 16 : 10, { fill: top, stroke: '#000000', lw: 3, sa: 0.35 });
      if (facet) {
        const r = rng(BOARD_SEED + 31);
        for (let y = pl.y + 10; y < pl.y + pl.h - 8; y += 7) g.moveTo(pl.x + 14 + r() * 30, y).lineTo(pl.x + pl.w - 14 - r() * 30, y);
        g.stroke({ width: 2, color: '#ffffff', alpha: 0.07 });
        g.rect(pl.x + 30, pl.y + pl.h - 52, pl.w - 60, 6).fill({ color: '#000000', alpha: 0.35 });
      } else {
        for (let y = pl.y + 40; y < pl.y + pl.h - 30; y += 34) g.moveTo(pl.x + 30, y).lineTo(pl.x + pl.w - 30, y);
        g.stroke({ width: 6, color: '#000000', alpha: 0.5 });
      }
      for (const [sx, sy] of pchFixings(q, tier)) {
        if (facet) {
          disc(g, sx, sy, 20, { fill: '#9aa3ae', stroke: '#2a2e36', lw: 3 });
          g.moveTo(sx - 11, sy).lineTo(sx + 11, sy).moveTo(sx, sy - 11).lineTo(sx, sy + 11).stroke({ width: 4, color: '#2a2e36', alpha: 0.9 });
        } else {
          disc(g, sx, sy, 18, { fill: '#d9d4c7', stroke: '#8f8a7e', lw: 3 });
          g.moveTo(sx - 10, sy).lineTo(sx + 10, sy).stroke({ width: 4, color: '#8f8a7e' });
        }
      }
      if (tier === 3) {
        // the top board's lit edge round the facets and the accent bar under the plateau
        const k = 76;
        g.poly([q.x + k, q.y + 6, q.x + q.w - k, q.y + 6, q.x + q.w - 6, q.y + k, q.x + q.w - 6, q.y + q.h - k, q.x + q.w - k, q.y + q.h - 6, q.x + k, q.y + q.h - 6, q.x + 6, q.y + q.h - k, q.x + 6, q.y + k])
          .stroke({ width: 5, color: T.mul, alpha: 0.5, join: 'round' });
        g.rect(pl.x + 30, pl.y + pl.h + 18, pl.w - 60, 8).fill({ color: T.br, alpha: 0.6 });
      }
    }
    pchLedHousing(g, q); // (the activity LED lights in live.ts)
    if (tier >= 1) {
      const pl = pchPlateau(q, tier);
      labels.addChild(label('PCH', pl.x + pl.w / 2, pl.y + pl.h / 2 - (tier >= 2 ? 16 : 0), tier >= 2 ? 84 : 70, tier >= 2 ? '#e8ebf0' : P.silk, { head: true, anchor: [0.5, 0.5], a: tier >= 2 ? 0.55 : 0.4 }));
    }
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

  // ---- battery ----
  {
    const b = geo.bat, cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = b.w / 2;
    disc(g, cx + 8, cy + 12, r, { fill: '#000000', fa: 0.25 });
    disc(g, cx, cy, r, { fill: P.panel, stroke: P.edge, lw: 8 }); disc(g, cx, cy, r * 0.62, { stroke: P.edge, lw: 6 });
    labels.addChild(label('CR2032', cx, cy, r < 130 ? 34 : 44, P.silk, { anchor: [0.5, 0.5], weight: '700' }));
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
      for (const lx of [eth.x + 50, eth.x + 112]) disc(g, lx, eth.y + eth.h / 2 + 30, 11, { fill: P.dark, stroke: P.edge, lw: 3 }); // link / activity wells, lit live (net.ts)
      labels.addChild(label(feat.ethernetMbps >= 1000 ? 'ETH 1G' : `ETH ${feat.ethernetMbps}M`, eth.x + 150, eth.y + eth.h / 2 + 30, 28, P.silkHi, { anchor: [0, 0.5] }));
    } else labels.addChild(label('ETH · none', eth.x + 40, eth.y, 30, P.silk, { anchor: [0, 0.5], a: 0.6 }));
    lbl('REAR I/O', q.x + 6, q.y - 36);
  }
  // ---- audio codec (seven legs: the jacks' lanes leave from the 1st, 4th and 7th), the USB hub and the PHY, all with their legs on the lanes ----
  chip(c, geo.codec, { legs: 7, pitch: 26, text: 'CODEC', size: 36, accent: T.mul });
  for (let k = 0; k < 3; k++) cap(c, geo.codec.x + 50 + k * 66, geo.codec.y - 90, 26, T.ld); // the audio capacitors above the codec
  chip(c, geo.hub, { legs: 8, pitch: 26, text: 'I/O HUB', size: 34, accent: T.mul });
  if (geo.phy) chip(c, geo.phy, { legs: 8, pitch: 26, text: 'PHY', size: 40, accent: T.mul });

  // ---- CPU socket frame (empty-socket look; the package covers it when a CPU is installed) ----
  {
    const k = PKG, e = SOCKET_E;
    box(g, k.x - e, k.y - e, k.w + 2 * e, k.h + 2 * e, 90, { fill: P.dark, stroke: T.pin, lw: 10, fa: 0.8, sa: 0.55 });
    for (const [x, y] of [[k.x - e + 30, k.y - e + 30], [k.x + k.w + e - 30, k.y - e + 30], [k.x - e + 30, k.y + k.h + e - 30], [k.x + k.w + e - 30, k.y + k.h + e - 30]] as const) {
      disc(g, x, y, 28, { fill: P.panel });
      g.moveTo(x - 15, y).lineTo(x + 15, y).moveTo(x, y - 15).lineTo(x, y + 15).stroke({ width: 5, color: T.pin, alpha: 0.7 });
    }
    for (let x = k.x + 90; x < k.x + k.w - 80; x += 36) for (let y = k.y + 90; y < k.y + k.h - 80; y += 36) { g.rect(x, y, 14, 14); c.solid?.({ kind: 'lga', x: x + 7, y: y + 7, s: 12 }); }
    g.fill({ color: T.pin, alpha: 0.25 });
    // the socket's contact rows round the edge, where the package's pins land (and the lanes leave from: `pkgPads`)
    for (let r = 0; r < 3; r++) {
      const o = PKG_ROW + r * PKG_PIN;
      for (let x = k.x + 70; x <= k.x + k.w - 70; x += PKG_PIN) { g.rect(x - 5, k.y + o - 5, 10, 10); g.rect(x - 5, k.y + k.h - o - 5, 10, 10); }
      for (let y = k.y + 70; y <= k.y + k.h - 70; y += PKG_PIN) { g.rect(k.x + o - 5, y - 5, 10, 10); g.rect(k.x + k.w - o - 5, y - 5, 10, 10); }
    }
    g.fill({ color: T.pin, alpha: 0.4 });
    // silkscreen corner brackets round the socket's keep-out, as a real board prints it (the arms stop short of the crystal under the south-west corner)
    const kx0 = k.x - e - SOCKET_KEEP, ky0 = k.y - e - SOCKET_KEEP, kx1 = k.x + k.w + e + SOCKET_KEEP, ky1 = k.y + k.h + e + SOCKET_KEEP, bl = 100;
    for (const [bx, by, sx, sy] of [[kx0, ky0, 1, 1], [kx1, ky0, -1, 1], [kx0, ky1, 1, -1], [kx1, ky1, -1, -1]] as const) g.moveTo(bx + sx * bl, by).lineTo(bx, by).lineTo(bx, by + sy * bl);
    g.stroke({ width: 7, color: P.silkHi, alpha: 0.45, join: 'round', cap: 'round' });
    lbl('CPU_SOCKET · LGA-1337', k.x - e, k.y - e - 36, 38);
  }

  // ---- the small stuff that makes it a real board: decoupling by the socket and the chipset, the BIOS chip, the header corner with its controller ----
  {
    for (const p of geo.passives) smd(c, p.x, p.y, p.n, p.dx, p.dy, p.w, p.h, 0.85);
    // the BIOS flash west of the chipset (its SPI lanes are the `spi` bus), the I/O controller and every header (the `hdr` bus), the regulators' controllers
    chip(c, geo.bios, { legs: 4, pitch: 26, text: 'BIOS', size: 30, accent: T.mul });
    chip(c, geo.sio, { legs: 4, pitch: 26, text: 'SIO', size: 40, accent: T.mul });
    chip(c, geo.dpwm, { legs: 6, pitch: 26, text: 'PWM', size: 46, accent: T.mul });
    for (const h of geo.hdrs) header(c, h.x, h.y, h.cols, h.rows, h.name, h.key);
    // the reference crystals (24 MHz for the CPU, 25 MHz for the chipset): a metal can with two pads, the clock lanes land on them
    for (const [r, edge, half, txt] of [[geo.xtalCpu, 'n', 10, '24M'], [geo.xtalPch, 's', 13, '25M']] as const) {
      shadow(c, r.x, r.y, r.w, r.h, 10, 8, 0.3);
      box(g, r.x, r.y, r.w, r.h, 12, { fill: mix(P.panel, T.alu, 0.18), stroke: T.alu, lw: 4, sa: 0.55 });
      g.rect(r.x + 8, r.y + 6, r.w - 16, 5).fill({ color: '#ffffff', alpha: T.dark ? 0.1 : 0.35 });
      padsAt(c, xtalPads(r, edge, half), 14, 12);
      labels.addChild(label(txt, r.x + r.w / 2, r.y + r.h / 2 + (edge === 'n' ? 6 : -6), 24, P.silk, { anchor: [0.5, 0.5], a: 0.8 }));
    }
    // the top board: a two-digit debug display under the chipset (its four lanes come from the chipset's south legs) and an RGB strip along the bottom edge
    if (geo.rgb) {
      const r = geo.rgb, n = 44;
      for (let k = 0; k < n; k++) {
        const x = r.x + (k * r.w) / (n - 1), col = mix(T.alu, T.br, k / (n - 1)), y = r.y + r.h / 2;
        g.circle(x, y, 22).fill({ color: col, alpha: 0.12 });
        g.circle(x, y, 9).fill({ color: col, alpha: 0.85 });
      }
    }
    if (geo.dbg) {
      const d = geo.dbg;
      box(g, d.x, d.y, d.w, d.h, 10, { fill: '#05070b', stroke: P.edge, lw: 5 });
      for (let k = 0; k < 2; k++) {
        const ox = d.x + 24 + k * 134;
        for (const [a, b2, w, h] of [[10, 10, 70, 10], [10, 70, 70, 10], [10, 130, 70, 10], [4, 18, 10, 50], [74, 18, 10, 50], [4, 78, 10, 50], [74, 78, 10, 50]] as const) g.rect(ox + a, d.y + 14 + b2 * 0.82, w, h);
      }
      g.fill({ color: T.ld, alpha: 0.4 });
      labels.addChild(label('DEBUG', d.x + d.w / 2, d.y + d.h + 30, 28, P.silk, { anchor: [0.5, 0.5] }));
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
  if (skin.trim >= 2) lbl('OVERCLOCK READY', -800, south - 195, 36, 0.6);
  lbl(`MB-${tier + 1}000 · ${(tierSpec?.name ?? 'BOARD').toUpperCase()} · ${geo.form.toUpperCase()} · REV A`, Math.min(1300, BD.x + BD.w - 1150), south - 215, 40, 0.8);

  // ---- the pads every signal lane ends on, over the parts, so each trace visibly meets its pin ----
  drawPads(g, padLanes, P.via);

  // ---- the mounting holes, last: each has a clear ring, so no trim or silkscreen line runs through a screw ----
  for (const [x, y] of geo.holes) hole(c, x, y, 66);
  for (const [x, y] of COOLER_HOLES) coolerHole(c, x, y, COOLER_HOLE.r, COOLER_HOLE.ring);

  root.addChild(labels);
  return { root, labels, buses, pal: P };
}
