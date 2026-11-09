// The network cards' copper (docs/PC_PARTS.md "Network card"), routed as a real four-layer NIC is: pure geometry in layout units, painted on
// both faces' masks by nic3d.ts and checked by niccopper.test.ts as the TPM's is (every run ends on its own net's copper, runs at 0, 45 or 90
// degrees and bends by 45, every net keeps its clearance off the others, the netlist is realised).
//
// The layers: the component side ('top', the face the parts stand on, toward the floor standing), the solder side ('bottom', the back), one
// inner signal layer ('in1': the presence loop) and the inner planes (ground, +3V3, the core rail and the 1.8 V rail), which every via of their
// net reaches. Ground is poured on both faces too.
//
// The PCIe edge (pcie.ts): side B on the component side, side A on the back. The card's receive pairs (side B's PET) run on the component side
// straight to the controller; its transmit pairs (side A's PER) leave the fingers on the back through their AC-coupling capacitors, then to vias
// at the controller. The reference clock, PERST# and the 3.3 V pins are on side A; WAKE# and a third 3.3 V pin on side B; PRSNT1# loops to the
// last PRSNT2# on the inner layer (the slot reads the card's width). The jacks: twelve contacts in two rows (the four pairs and their centre
// taps, each tap to ground through a capacitor on the back), the lights' four pins at the front, the shield's legs and two plastic pegs. Their
// pairs and the lights' lines run east as one bus to the controller's west edge, closing to its pitch by 45-degree jogs; the crystal's two lines
// join it. The SPI flash east of the controller, the regulator with its two inductors and polymer capacitors past it.
import { NIC_BRACKET_X, type Rect } from '../layout/layout';
import { edgeNet, edgePins, FINGER, KEY, pinAt, TAB, tabLen } from './pcie';

const MM = 23;
export type Pt = readonly [number, number];
export type Face = 'top' | 'bottom';
export type Layer = Face | 'in1';

/** An RJ45 jack with its magnetics (mm, as layout units): across the bracket, off the PCB, and deep; the tallest part on the card. */
export const JACK = { w: 16 * MM, h: 13.5 * MM, d: 22 * MM };
/** The jacks' front: past the bracket's face, through the case's rear wall, the mouths just in from its outer face (where the LAN plug goes in). */
export const JACK_X = NIC_BRACKET_X - 150;
/** A card's jacks (two on the 40G card), as their slot-side edges, lying. */
export const jacksOf = (visual: string, y0: number): number[] => (visual === 'nic-40g' ? [0, 1] : [0]).map((k) => y0 + 120 + k * (JACK.w + 30));
/** A NIC's link width: x1, x4 or x8 (a GPU's and an AI card's are x16). */
export const NIC_LANES: Record<string, number> = { 'nic-gbe': 1, 'nic-10g': 4, 'nic-40g': 8 };

/** A copper run: its net, layer, width and polyline. */
export interface Trace { net: string; layer: Layer; w: number; pts: Pt[] }
/** A via, through every layer (a plane's net meets its plane). */
export interface Via { net: string; x: number; y: number }
/** An SMD pad on a face (`edge`: a gold finger of the PCIe edge): its part's pin (`U1.N4`, `C3.2`, `B14`), net, rect and centre. */
export interface Pad { id: string; net: string; face: Face; r: Rect; c: Pt; edge?: boolean }
/** A plated through hole (a jack's contact, light pin or shield leg): its ring's and its drill's radii, pin 1 square. */
export interface Hole { id: string; net: string; x: number; y: number; ring: number; drill: number; square?: boolean }
/** An unplated hole: a jack's plastic peg, a heatsink's push pin. */
export interface Npth { x: number; y: number; r: number }
/** A passive on a face: designator, package, kind, centre, turned along y, the nets of its two ends (west or north first). */
export interface Part { ref: string; pkg: '0402' | '0603'; kind: 'cap' | 'res'; face: Face; x: number; y: number; turn: boolean; nets: [string, string] }
/** A polymer capacitor's can: its centre and radius. */
export interface Can { ref: string; x: number; y: number; r: number }
/** Where the packages sit (layout rects): the controller (a QFN, or a BGA under its sink), the crystal, the flash, the regulator, the inductors. */
export interface NicPlaces { chip: Rect; qfn: boolean; sink: Rect | null; crystal: Rect; flash: Rect; reg: Rect; inductors: Rect[]; cans: Can[]; label: Rect; serial: Rect }
export interface NicCopper {
  traces: Trace[]; vias: Via[]; pads: Pad[]; holes: Hole[]; npth: Npth[]; parts: Part[]; fiducials: Pt[];
  /** The board's outline: the PCB with its finger tab, split by the key. */
  outline: Pt[];
  at: NicPlaces;
  /** The link width the copper is routed for (a narrower one where the slot cuts the tab short). */
  lanes: number;
}

/**
 * Sizes in layout units (23 a mm): a signal's width (0.17 mm), a power stub's and a regulator's switching run, the clearance between nets
 * (0.15 mm), a via's ring and drill, the pour's clearance and its pull-back from the board's edge, a fiducial's dot.
 */
export const CU = { sig: 4, pwr: 9, wide: 14, clear: 3.5, via: 5.5, drill: 2.6, pour: 4.5, edge: 8, fid: 6 } as const;
/** The nets every via of which meets its inner plane (ground is poured on both faces as well). */
export const PLANES = ['GND', '+3V3', 'VCORE', 'V1P8'] as const;

type P = [number, number];
const SIG = CU.sig / MM, PWR = CU.pwr / MM, WIDE = CU.wide / MM;
const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
/** The polyline without repeated or collinear points. */
function clean(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.length || !same(out[out.length - 1]!, p)) out.push(p);
  return out.filter((b, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = out[i - 1]!, d = out[i + 1]!;
    return Math.abs((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0])) > 1e-9;
  });
}
/** Each right-angle bend cut by a 45-degree run along each leg (at most a third of the shorter leg), as a router chamfers it. */
function chamfer(pts: Pt[], c = 0.22): Pt[] {
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!, b = pts[i]!, d = pts[i + 1]!;
    const u = [b[0] - a[0], b[1] - a[1]], v = [d[0] - b[0], d[1] - b[1]], lu = Math.hypot(u[0]!, u[1]!), lv = Math.hypot(v[0]!, v[1]!), k = Math.min(c, lu / 3, lv / 3);
    if (Math.abs(u[0]! * v[0]! + u[1]! * v[1]!) < 1e-9) out.push([b[0] - (u[0]! / lu) * k, b[1] - (u[1]! / lu) * k], [b[0] + (v[0]! / lv) * k, b[1] + (v[1]! / lv) * k]);
    else out.push(b);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}
/** Along y from p to `yj`, 45 degrees over to x = `t`, on along y to `y1`. */
const southJog = (p: Pt, yj: number, t: number, y1: number): Pt[] => [p, [p[0], yj], [t, yj + Math.abs(t - p[0])], [t, y1]];
/** Along x from p to `xj`, 45 degrees over to y = `t`, on along x to `x1` (east or west, as `x1` lies). */
const xJog = (p: Pt, xj: number, t: number, x1: number): Pt[] => [p, [xj, p[1]], [xj + Math.sign(x1 - xj) * Math.abs(t - p[1]), t], [x1, t]];

/** A passive's two pads (mm): west or north first, a hair past its tinned ends (the TPM's lands). */
const PKG = { '0402': [1, 0.5], '0603': [1.6, 0.8] } as const;

/** Each controller (mm): its package's side, its sink's (0: none), and where its west edge sits. */
const CTRL: Record<string, { chip: number; sink: number; x: number; y: number }> = {
  'nic-gbe': { chip: 9, sink: 0, x: 34.55, y: 11 },
  'nic-10g': { chip: 25, sink: 40, x: 33.17, y: 16.5 },
  'nic-40g': { chip: 25, sink: 45, x: 42.5, y: 16.5 },
};
/** The jack's pins (mm from the board's west edge and the jack's slot-side edge): the contacts' two rows, their pitch, the lights' column. */
const PIN = { a: 10.4, b: 12.94, y0: 2.42, step: 1.015, ring: 0.7, drill: 0.35, led: 2.5, ledRing: 0.65, leg: 0.75, legDrill: 0.45, peg: 1.6 } as const;
const CONTACTS = ['MDI0+', 'MDI0-', 'CT0', 'MDI1+', 'MDI1-', 'CT1', 'MDI2+', 'MDI2-', 'CT2', 'MDI3+', 'MDI3-', 'CT3'] as const;
/** The edge pins the copper wires (the rest, the 12 V, JTAG and SMBus pins and the reserved ones, are left bare). */
const WIRED = /^(GND|\+3V3|PERST#|WAKE#|REFCLK[+-]|PE[RT]\d[+-]|PRSNT[12]#)$/;

/**
 * The card's copper on its frame `f` (layout: the PCB's west end and east end, the slot's line, the south edge), its finger tab from `tab.x` for
 * `tab.w` (card3d's `pcieTab`).
 */
export function nicCopper(visual: string, f: { x0: number; x1: number; y0: number; end: number }, tab: { x: number; w: number }): NicCopper {
  const L = (f.x1 - f.x0) / MM, H = (f.end - f.y0) / MM, tx = (tab.x - f.x0) / MM, tl = tab.w / MM;
  const want = NIC_LANES[visual] ?? 1, lanes = [8, 4, 1].find((n) => n <= want && tabLen(n) <= tab.w + 1e-6) ?? 1, nPins = edgePins(lanes);
  const traces: Trace[] = [], vias: Via[] = [], pads: Pad[] = [], holes: Hole[] = [], npth: Npth[] = [], parts: Part[] = [];
  const run = (net: string, pts: Pt[], w = SIG, layer: Layer = 'top') => traces.push({ net, layer, w, pts: chamfer(clean(pts)) });
  const via = (net: string, x: number, y: number) => vias.push({ net, x, y });
  const pad = (id: string, net: string, face: Face, x: number, y: number, w: number, h: number): P => {
    pads.push({ id, net, face, r: { x: x - w / 2, y: y - h / 2, w, h }, c: [x, y] });
    return [x, y];
  };
  const count = { C: 0, R: 0 };
  /** A passive and its two pads (west or north first); returns the pads' centres. */
  const part = (kind: 'cap' | 'res', pkg: '0402' | '0603', face: Face, x: number, y: number, turn: boolean, nets: [string, string]): [P, P] => {
    const ref = `${kind === 'cap' ? 'C' : 'R'}${++count[kind === 'cap' ? 'C' : 'R']}`, [l, w] = PKG[pkg], e = l * 0.3, k = 2 / MM, o = l / 2 - e / 2;
    parts.push({ ref, pkg, kind, face, x, y, turn, nets });
    const end = (s: number, net: string) => (turn ? pad(`${ref}.${s < 0 ? 1 : 2}`, net, face, x, y + s * o, w + 2 * k, e + 2 * k) : pad(`${ref}.${s < 0 ? 1 : 2}`, net, face, x + s * o, y, e + 2 * k, w + 2 * k));
    return [end(-1, nets[0]), end(1, nets[1])];
  };

  // ---- the controller and its neighbours' places (mm from the board's west end and the slot's line)
  const C = CTRL[visual] ?? CTRL['nic-gbe']!, qfn = !C.sink, chip = { x: C.x, y: C.y, w: C.chip, h: C.chip };
  const sink = qfn ? null : { x: chip.x + chip.w / 2 - C.sink / 2, y: chip.y + chip.h / 2 - C.sink / 2, w: C.sink, h: C.sink };
  const east = sink ? sink.x + sink.w : chip.x + chip.w + 3.5;
  const xF = east + 5.5, yF = qfn ? chip.y + chip.h / 2 : 23, xR = xF, yR = qfn ? 27 : 35, pcx = xR + 11;
  const jys = jacksOf(visual, 0).map((y) => y / MM), xJ = 17, cyX = jys.length > 1 ? 42.3 : 25;

  // ---- the PCIe edge: a gold finger per pin on each face, each wired pin's stub into the board
  const fx = (p: number) => tx + pinAt(p) / MM, fy0 = (FINGER.from - TAB) / MM, fy1 = fy0 + FINGER.len / MM, fs = fy1 - 0.3;
  const fingers: { side: 'A' | 'B'; net: string; x: number }[] = [];
  for (const side of ['A', 'B'] as const) for (let p = 1; p <= nPins; p++) {
    const n = edgeNet(side, p, lanes), net = !WIRED.test(n) ? `NC ${side}${p}` : n.startsWith('PRSNT') ? 'PRSNT#' : n, x = fx(p);
    pads.push({ id: `${side}${p}`, net, face: side === 'B' ? 'top' : 'bottom', r: { x: x - 0.35, y: fy0, w: 0.7, h: fy1 - fy0 }, c: [x, (fy0 + fy1) / 2], edge: true });
    fingers.push({ side, net, x });
  }
  const face = (s: 'A' | 'B'): Face => (s === 'B' ? 'top' : 'bottom');
  type Line = { net: string; x: number; y: number };
  const top: Line[] = [], bot: Line[] = [];
  for (const g of fingers) {
    const L0: P = [g.x, fs];
    if (g.net === 'GND') run('GND', [L0, [g.x, 1]], PWR, face(g.side));
    else if (g.net === '+3V3') { run('+3V3', [L0, [g.x, 4]], PWR, face(g.side)); via('+3V3', g.x, 4); }
    else if (g.net === 'PRSNT#' && g.side === 'A') { run('PRSNT#', [L0, [g.x, 2.3]], SIG, 'bottom'); via('PRSNT#', g.x, 2.3); }
    else if (g.net === 'PRSNT#') {
      const a = fingers.find((q) => q.side === 'A' && q.net === 'PRSNT#')!;
      run('PRSNT#', [L0, [g.x, 1.8], [g.x + 0.5, 2.3]]);
      via('PRSNT#', g.x + 0.5, 2.3);
      run('PRSNT#', [[a.x, 2.3], [g.x + 0.5, 2.3]], SIG, 'in1');
    } else if (/^PER\d/.test(g.net)) {
      // the card's transmit pair: through its AC-coupling capacitor on the back by the fingers
      const tx = g.net.replace('PER', 'TX'), [a, b] = part('cap', '0402', 'bottom', g.x, 3.4, true, [g.net, tx]);
      run(g.net, [L0, a], SIG, 'bottom');
      bot.push({ net: tx, x: g.x, y: b[1] });
    } else if (!g.net.startsWith('NC')) (g.side === 'B' ? top : bot).push({ net: g.net, ...{ x: g.x, y: fs } });
  }

  // ---- the controller's north edge: the receive pairs and WAKE# on the component side, the rest from vias
  if (!qfn) {
    // a BGA: the lines close to the balls' span (a 45-degree jog each, the same for both faces); the component side's end on the first row's
    // balls, the back's in vias on the second row (staggered to a third where they close tighter than a via's pitch)
    const lo = chip.x + 2, hi = chip.x + chip.w - 1, xs = [...top, ...bot].map((l) => l.x), mn = Math.min(...xs), mx = Math.max(...xs);
    const s = Math.min(1, (hi - lo) / (mx - mn)), d = mn < lo ? lo - mn : mx > hi ? hi - mx : 0;
    const map = (x: number) => (s < 1 ? lo + (x - mn) * s : x + d);
    for (const l of top) {
      const t = map(l.x);
      run(l.net, southJog([l.x, l.y], 5, t, chip.y + 1));
      pad(`U1.${l.net}`, l.net, 'top', t, chip.y + 1, 0.4, 0.4);
    }
    const bs = [...bot].sort((a, b) => a.x - b.x), pitch = Math.min(...bs.slice(1).map((l, i) => map(l.x) - map(bs[i]!.x)));
    bs.forEach((l, i) => {
      const t = map(l.x), yv = chip.y + 2 + (pitch < 0.85 && i % 2 ? 1 : 0);
      run(l.net, southJog([l.x, l.y], 5, t, yv), SIG, 'bottom');
      via(l.net, t, yv);
    });
  } else {
    // a QFN: the back's lines drop through vias half a pitch west, short of it; on the component side the whole bus closes to its pads' pitch
    const all: Line[] = [...top];
    for (const l of bot) {
      run(l.net, [[l.x, l.y], [l.x, 5], [l.x - 0.5, 5.5], [l.x - 0.5, 6]], SIG, 'bottom');
      via(l.net, l.x - 0.5, 6);
      all.push({ net: l.net, x: l.x - 0.5, y: 6 });
    }
    all.sort((a, b) => a.x - b.x);
    const k0 = 8 - all.length / 2;
    all.forEach((l, i) => run(l.net, southJog([l.x, l.y], 7, chip.x + 0.75 + 0.5 * (k0 + i), chip.y + 0.05)));
    qfnSide('N', all.map((l, i) => [k0 + i, l.net]));
  }

  // ---- the jacks: the contacts and the lights' pins, the shield's legs and the pegs; the pairs and the lights' lines into one bus west
  const west: Line[] = [];
  jys.forEach((jy, j) => {
    const J = `J${j + 1}`;
    CONTACTS.forEach((c, i) => {
      const x = i % 2 ? PIN.b : PIN.a, y = jy + PIN.y0 + PIN.step * i, net = `${J}${c}`;
      holes.push({ id: `${J}.${i + 1}`, net, x, y, ring: PIN.ring, drill: PIN.drill, square: i === 0 });
      if (c.startsWith('CT')) {
        // the centre tap: on the back to its capacitor, the other end in the ground pour
        const [, e] = part('cap', '0402', 'bottom', 8.4, y, false, ['GND', net]);
        run(net, [[x, y], e], SIG, 'bottom');
      } else west.push({ net, x, y });
    });
    // the lights: each anode on the 3.3 V plane, each cathode through its resistor east of the jack into the bus
    for (const [col, ya, yk, k] of [['G', 3.33, 1.3, 13], ['Y', 12.67, 14.7, 15]] as const) {
      holes.push({ id: `${J}.${k}`, net: '+3V3', x: PIN.led, y: jy + ya, ring: PIN.ledRing, drill: PIN.drill });
      holes.push({ id: `${J}.${k + 1}`, net: `${J}L${col}K`, x: PIN.led, y: jy + yk, ring: PIN.ledRing, drill: PIN.drill });
      run('+3V3', [[PIN.led, jy + ya], [4, jy + ya]]);
      via('+3V3', 4, jy + ya);
      const [a, b] = part('res', '0402', 'top', 15.6, jy + yk, false, [`${J}L${col}K`, `${J}L${col}`]);
      run(`${J}L${col}K`, [[PIN.led, jy + yk], a]);
      west.push({ net: `${J}L${col}`, x: b[0], y: jy + yk });
    }
    for (const [x, y] of [[6.5, jy + 0.1], [13.4, jy + 0.1], [6.5, jy + 15.9], [13.4, jy + 15.9]] as const) holes.push({ id: `${J}.S`, net: 'GND', x, y, ring: PIN.leg, drill: PIN.legDrill });
    npth.push({ x: 5.6, y: jy + 5, r: PIN.peg }, { x: 5.6, y: jy + 11, r: PIN.peg });
  });
  west.sort((a, b) => a.y - b.y);

  // ---- the crystal south of the jacks, its two lines after the bus, a load capacitor on each to ground
  const crystal = { x: 15.25, y: cyX - 1.6, w: 2.5, h: 3.2 };
  for (const [net, y] of [['XO', cyX - 1.1], ['XI', cyX + 1.1]] as const) {
    pad(`Y1.${net}`, net, 'top', 16.5, y, 1.9, 1);
    const [, e] = part('cap', '0402', 'top', 14, y, false, ['GND', net]);
    run(net, [[16.5, y], e]);
  }

  // ---- the controller's west edge: the bus jogs at one column, the crystal's lines at their own
  const nW = west.length;
  if (!qfn) {
    const t0 = chip.y + 2, xe = chip.x + 1;
    west.forEach((l, i) => {
      run(l.net, xJog([l.x, l.y], xJ, t0 + i, xe));
      pad(`U1.${l.net}`, l.net, 'top', xe, t0 + i, 0.4, 0.4);
    });
    (['XO', 'XI'] as const).forEach((net, i) => {
      const y = cyX + (i ? 1.1 : -1.1), t = t0 + nW + 1 + i;
      run(net, xJog([16.5, y], 19.5, t, xe));
      pad(`U1.${net}`, net, 'top', xe, t, 0.4, 0.4);
    });
  } else {
    const xe = chip.x + 0.05, at = (k: number) => chip.y + 0.75 + 0.5 * k;
    west.forEach((l, i) => run(l.net, xJog([l.x, l.y], xJ, at(2 + i), xe)));
    (['XO', 'XI'] as const).forEach((net, i) => run(net, xJog([16.5, cyX + (i ? 1.1 : -1.1)], 19.5, at(2 + nW + i), xe)));
    qfnSide('W', [...west.map((l, i): [number, string] => [2 + i, l.net]), [2 + nW, 'XO'], [3 + nW, 'XI']]);
  }

  // ---- the SPI flash east of the controller (turned: pin 1 at its north-west), its lines west to the controller's east edge
  const fy = (k: number) => yF + (k - 1.5) * 1.27, fw = xF - 2.7, fe = xF + 2.7;
  const FLASH = [[fw, fy(0), 'SPI_CS#'], [fw, fy(1), 'SPI_DO'], [fw, fy(2), '+3V3'], [fw, fy(3), 'GND'], [fe, fy(3), 'SPI_DI'], [fe, fy(2), 'SPI_CLK'], [fe, fy(1), '+3V3'], [fe, fy(0), '+3V3']] as const;
  FLASH.forEach(([x, y, net], i) => pad(`U2.${i + 1}`, net, 'top', x, y, 1.55, 0.6));
  // WP# down to the plane; HOLD# to VCC, VCC to the plane and its capacitor; CLK and DI under the body, out between and past the west pins
  run('+3V3', [[fw, fy(2)], [fw - 1.4, fy(2)]]); via('+3V3', fw - 1.4, fy(2));
  run('+3V3', [[fe, fy(1)], [fe, fy(0)]]); run('+3V3', [[fe, fy(0)], [fe + 1.5, fy(0)]]); via('+3V3', fe + 1.5, fy(0));
  const [vc] = part('cap', '0402', 'top', fe + 1.5, fy(0) + 1.1, true, ['+3V3', 'GND']);
  run('+3V3', [[fe + 1.5, fy(0)], vc]);
  const spi: { net: string; pts: Pt[]; y: number }[] = [
    { net: 'SPI_CS#', pts: [[fw, fy(0)]], y: fy(0) },
    { net: 'SPI_DO', pts: [[fw, fy(1)]], y: fy(1) },
    { net: 'SPI_CLK', pts: [[fe, fy(2)], [xF + 1.2, fy(2)], [xF + 0.565, fy(2) + 0.635]], y: fy(2) + 0.635 },
    { net: 'SPI_DI', pts: [[fe, fy(3)], [xF + 1.5, fy(3)], [xF + 0.75, fy(3) + 0.75]], y: fy(3) + 0.75 },
  ];
  if (!qfn) {
    const xe = chip.x + chip.w - 1;
    for (const l of spi) { run(l.net, [...l.pts, [xe, l.y]]); pad(`U1.${l.net}`, l.net, 'top', xe, l.y, 0.4, 0.4); }
  } else {
    const xe = chip.x + chip.w - 0.05, at = (k: number) => chip.y + 0.75 + 0.5 * k;
    spi.forEach((l, i) => { const p = l.pts[l.pts.length - 1]!; run(l.net, [...l.pts.slice(0, -1), ...xJog(p, fw - 2.1, at(5 + i), xe)]); });
    qfnSide('E', spi.map((l, i) => [5 + i, l.net]));
  }

  // ---- the regulator (a dual buck in a 3x3 DFN): 3.3 V in, its two switching nodes to the inductors, the core and 1.8 V rails out to the cans
  const RW = ['+3V3', '+3V3', '+3V3', 'VCORE', 'V1P8'], RE = ['SW1', 'SW1', 'NC U3.PG', 'SW2', 'SW2'], ry = (k: number) => yR - 1 + 0.5 * k, rw = xR - 1.3, re = xR + 1.3;
  RW.forEach((net, k) => pad(`U3.${k + 1}`, net, 'top', rw, ry(k), 0.7, 0.25));
  RE.forEach((net, k) => pad(`U3.${10 - k}`, net, 'top', re, ry(k), 0.7, 0.25));
  pad('U3.EP', 'GND', 'top', xR, yR, 1.4, 2.4);
  run('+3V3', [[rw, ry(0)], [rw, ry(2)]]);
  run('+3V3', [[rw, ry(0)], [xR - 2.6, ry(0)]]); via('+3V3', xR - 2.6, ry(0));
  const [, ci] = part('cap', '0603', 'top', xR - 2.6, yR - 3, true, ['GND', '+3V3']);
  run('+3V3', [[xR - 2.6, ry(0)], ci]);
  run('VCORE', [[rw, ry(3)], [xR - 2.6, ry(3)]]); via('VCORE', xR - 2.6, ry(3));
  run('V1P8', [[rw, ry(4)], [rw, yR + 2.3]]); via('V1P8', rw, yR + 2.3);
  const inductors: Rect[] = [], cans: Can[] = [];
  for (const [sw, out, s] of [['SW1', 'VCORE', -1], ['SW2', 'V1P8', 1]] as const) {
    const ly = yR + 5 * s, k = s < 0 ? 0 : 4;
    run(sw, [[re, ry(k)], [re, ry(k) - s * 0.5]]);
    run(sw, [[re, ry(k)], [xR + 2.2, ry(k)], [xR + 3.45, ry(k) + s * 1.25], [xR + 3.45, ly]], WIDE);
    pad(`L${k ? 2 : 1}.1`, sw, 'top', xR + 3.45, ly, 1.3, 3.4);
    pad(`L${k ? 2 : 1}.2`, out, 'top', xR + 6.55, ly, 1.3, 3.4);
    inductors.push({ x: xR + 3, y: ly - 2, w: 4, h: 4 });
    // out along a wide run to its can, two vias down to its plane on the way
    run(out, [[xR + 6.55, ly], [pcx - 2.2, ly]], WIDE);
    via(out, xR + 7.9, ly - 0.35); via(out, xR + 7.9, ly + 0.35);
  }
  // the cans: two on the core rail, one on 1.8 V, one on the 3.3 V input; each + pad west, its - pad east in the ground pour
  for (const [y, net] of [[yR - 11, 'VCORE'], [yR - 5, 'VCORE'], [yR + 5, 'V1P8'], [yR + 11, '+3V3']] as const) {
    const ref = `C${++count.C}`;
    pad(`${ref}.1`, net, 'top', pcx - 2.2, y, 2, 1.6);
    pad(`${ref}.2`, 'GND', 'top', pcx + 2.2, y, 2, 1.6);
    cans.push({ ref, x: pcx, y, r: 2.5 });
  }
  run('VCORE', [[pcx - 2.2, yR - 11], [pcx - 2.2, yR - 5]], WIDE);
  run('+3V3', [[pcx - 2.2, yR + 11], [pcx - 4.2, yR + 11]], PWR); via('+3V3', pcx - 4.2, yR + 11);

  // ---- the controller's power: a QFN's south pads down to vias, a capacitor on each on the back, its ground pad stitched by vias; a BGA's
  // field of plane vias under it, with capacitors between them on the back, and a row by its sink's south edge
  if (qfn) {
    const R = ['+3V3', 'VCORE', 'V1P8', 'VCORE', '+3V3', 'VCORE', 'V1P8'];
    qfnSide('S', R.map((net, i) => [1 + 2 * i, net]));
    R.forEach((net, i) => {
      const x = chip.x + 0.75 + 0.5 * (1 + 2 * i), yv = chip.y + chip.h + 0.8;
      run(net, [[x, chip.y + chip.h - 0.05], [x, yv]]); via(net, x, yv);
      const [a] = part('cap', '0402', 'bottom', x, yv + 1.05, true, [net, 'GND']);
      run(net, [[x, yv], a], SIG, 'bottom');
    });
    pad('U1.EP', 'GND', 'top', chip.x + chip.w / 2, chip.y + chip.h / 2, 5, 5);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) via('GND', chip.x + 3 + 1.5 * i, chip.y + 3 + 1.5 * j);
  } else {
    const net = (i: number, j: number) => ((i + j) % 2 === 0 ? 'GND' : Math.max(Math.abs(i - 4), Math.abs(j - 4)) <= 2 ? 'VCORE' : j < 4 ? '+3V3' : 'V1P8');
    const vx = (i: number) => chip.x + 4.5 + 2 * i, vy = (j: number) => chip.y + 4.5 + 2 * j;
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) via(net(i, j), vx(i), vy(j));
    for (let j = 1; j < 9; j += 2) for (let i = 0; i < 8; i += 2) {
      const n = net(i, j), [a, b] = part('cap', '0402', 'bottom', vx(i) + 1, vy(j), false, [n, 'GND']);
      run(n, [[vx(i), vy(j)], a], SIG, 'bottom');
      run('GND', [b, [vx(i + 1), vy(j)]], SIG, 'bottom');
    }
    const S = sink!, ys = S.y + S.h + 1.6;
    for (let k = 0; k < 12; k++) {
      const x = S.x + 4 + (k * (S.w - 8)) / 11, n = ['VCORE', 'V1P8', '+3V3'][k % 3]!, [a] = part('cap', '0402', 'top', x, ys, true, [n, 'GND']);
      run(n, [[x, ys - 1.15], a]); via(n, x, ys - 1.15);
    }
    // the sink's push pins through two opposite corners
    npth.push({ x: S.x + 3, y: S.y + 3, r: 1.4 }, { x: S.x + S.w - 3, y: S.y + S.h - 3, r: 1.4 });
  }

  /** A QFN's pads along side `s` (16 at a 0.5 mm pitch, from its north or west end): the given ones on their nets, the rest bare. */
  function qfnSide(s: 'N' | 'S' | 'W' | 'E', on: [number, string][]): void {
    const nets = new Map(on);
    for (let k = 0; k < 16; k++) {
      const o = 0.75 + 0.5 * k, net = nets.get(k) ?? `NC U1.${s}${k}`;
      if (s === 'N') pad(`U1.N${k}`, net, 'top', chip.x + o, chip.y + 0.05, 0.25, 0.8);
      else if (s === 'S') pad(`U1.S${k}`, net, 'top', chip.x + o, chip.y + chip.h - 0.05, 0.25, 0.8);
      else if (s === 'W') pad(`U1.W${k}`, net, 'top', chip.x + 0.05, chip.y + o, 0.8, 0.25);
      else pad(`U1.E${k}`, net, 'top', chip.x + chip.w - 0.05, chip.y + o, 0.8, 0.25);
    }
  }

  // ---- the ground pour's stitching: vias round the board's edge and on a grid through the open pour, wherever they clear the rest (the parts,
  // the labels, the jacks' footprints, the fiducials, every other net's copper)
  const flashR = { x: xF - 1.95, y: yF - 2.45, w: 3.9, h: 4.9 }, regR = { x: xR - 1.5, y: yR - 1.5, w: 3, h: 3 };
  const label = { x: Math.min(pcx + 9, L - 24), y: H - 14, w: 20, h: 6.2 }, serial = { x: Math.min(pcx + 6, L - 30), y: 8, w: 26, h: 9 };
  const fids: Pt[] = [[L - 3, 2.5], [3, H - 3]], jx1 = (JACK_X + JACK.d - f.x0) / MM;
  const keep: Rect[] = [
    sink ?? chip, crystal, flashR, regR, label, serial, ...inductors, ...cans.map((c) => ({ x: c.x - c.r, y: c.y - c.r, w: 2 * c.r, h: 2 * c.r })),
    ...jys.map((y) => ({ x: -1, y, w: jx1 + 1, h: JACK.w / MM })), ...fids.map(([x, y]) => ({ x: x - 1, y: y - 1, w: 2, h: 2 })),
    ...parts.map((p) => { const [l, w] = PKG[p.pkg], sx = p.turn ? w : l, sy = p.turn ? l : w; return { x: p.x - sx / 2, y: p.y - sy / 2, w: sx, h: sy }; }),
  ];
  const vr = CU.via / MM, ok = (net: string, g: number) => g >= (net === 'GND' ? vr + 0.1 : vr + CU.clear / MM + 0.15);
  const segD = (p: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const room = (x: number, y: number) =>
    !keep.some((r) => x > r.x - 0.6 && x < r.x + r.w + 0.6 && y > r.y - 0.6 && y < r.y + r.h + 0.6) &&
    traces.every((t) => t.pts.slice(1).every((b, i) => ok(t.net, segD([x, y], t.pts[i]!, b) - t.w / 2))) &&
    pads.every((q) => ok(q.net, Math.hypot(Math.max(q.r.x - x, 0, x - q.r.x - q.r.w), Math.max(q.r.y - y, 0, y - q.r.y - q.r.h)))) &&
    vias.every((v) => ok(v.net, Math.hypot(v.x - x, v.y - y) - vr)) && holes.every((h) => ok(h.net, Math.hypot(h.x - x, h.y - y) - h.ring)) &&
    npth.every((h) => Math.hypot(h.x - x, h.y - y) - h.r >= vr + 0.5);
  const spots: Pt[] = [];
  for (let x = 2; x <= L - 2; x += 4) spots.push([x, 1.2], [x, H - 1.2]);
  for (let y = 5.2; y <= H - 5; y += 4) spots.push([1.2, y], [L - 1.2, y]);
  for (let y = 8, k = 0; y <= H - 6; y += 8, k++) for (let x = 8 + (k % 2) * 5; x <= L - 6; x += 10) spots.push([x, y]);
  for (const [x, y] of spots) if (room(x, y)) via('GND', x, y);

  // ---- to layout units
  const X = (x: number) => f.x0 + x * MM, Y = (y: number) => f.y0 + y * MM, pt = (p: Pt): Pt => [X(p[0]), Y(p[1])];
  const rect = (r: Rect): Rect => ({ x: X(r.x), y: Y(r.y), w: r.w * MM, h: r.h * MM });
  const tabH = TAB / MM, ka = tx + KEY.at / MM, kb = ka + KEY.w / MM;
  const outline: Pt[] = ([[0, 0], [tx, 0], [tx, -tabH], [ka, -tabH], [ka, 0], [kb, 0], [kb, -tabH], [tx + tl, -tabH], [tx + tl, 0], [L, 0], [L, H], [0, H]] as Pt[]).map(pt);
  return {
    traces: traces.map((t) => ({ ...t, w: t.w * MM, pts: t.pts.map(pt) })),
    vias: vias.map((v) => ({ ...v, x: X(v.x), y: Y(v.y) })),
    pads: pads.map((q) => ({ ...q, r: rect(q.r), c: pt(q.c) })),
    holes: holes.map((h) => ({ ...h, x: X(h.x), y: Y(h.y), ring: h.ring * MM, drill: h.drill * MM })),
    npth: npth.map((h) => ({ x: X(h.x), y: Y(h.y), r: h.r * MM })),
    parts: parts.map((q) => ({ ...q, x: X(q.x), y: Y(q.y) })),
    fiducials: fids.map(pt),
    outline,
    at: {
      chip: rect(chip), qfn, sink: sink && rect(sink), crystal: rect(crystal), flash: rect(flashR), reg: rect(regR),
      inductors: inductors.map(rect), cans: cans.map((c) => ({ ...c, x: X(c.x), y: Y(c.y), r: c.r * MM })),
      label: rect(label), serial: rect(serial),
    },
    lanes,
  };
}
