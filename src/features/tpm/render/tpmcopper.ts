// The TPM module's copper (docs/PC_PARTS.md "TPM"), routed as a real two-layer LPC module is: pure geometry in board space, painted on the
// mask by the 3D model (board/render/three/tpm3d.ts) and checked by tpmcopper.test.ts as the motherboard's lanes are (docs/render/board.md
// "Routing"): every run starts and ends on its own net's copper, runs at 0, 45 or 90 degrees and bends by 45, and keeps its clearance off every
// other net, so the copper realises the netlist below.
//
// The chip lies turned half round, as on the real modules: pin 1 at the north-east, so its LPC row (pins 15 to 28) faces the header and each bus
// line drops straight to its contact or down a lane between the near row's pads to the far row. The rails and the strap pins come off the north
// row and run under the body: VDD by a strap between pins 10 and 19 and a trunk west past the caps to contact 1; PP and GPIO east to their
// resistors and the LED; VSB down a via and along the underside to contact 14. Ground is a pour on both faces, stitched by vias.
import type { Rect } from '../../board/render/layout/layout';
import { TSSOP28, tpmLed, type TpmGeo } from './tpmlayout';

export type Pt = readonly [number, number];

/**
 * The chip's pins, pin 1 first: the TCG PC Client LPC TPM in TSSOP-28, as the SLB 9635 (TPM 1.2) and 9665 (TPM 2.0) have them. CLKRUN# is tied
 * low (the module never stops the clock) and the test inputs to ground; the NC pins have no copper.
 */
export const TPM_PINS = [
  'NC', 'NC', 'NC', 'GND', 'VSB', 'GPIO', 'PP', 'TESTI', 'TESTBI', 'VDD', 'GND', 'NC', 'NC', 'NC',
  'CLKRUN#', 'LRESET#', 'LAD3', 'GND', 'VDD', 'LAD2', 'LCLK', 'LFRAME#', 'LAD1', 'VDD', 'GND', 'LAD0', 'SERIRQ', 'LPCPD#',
] as const;

const TIED: Partial<Record<string, string>> = { VDD: '+3V', VSB: '+3VSB', 'CLKRUN#': 'GND', TESTI: 'GND', TESTBI: 'GND' };
/** The net chip pin `p` (1 to 28) sits on. */
export const pinNet = (p: number): string => { const f = TPM_PINS[p - 1]!; return TIED[f] ?? f; };

/**
 * The 14-1 header's pinout, by contact (13 is the key): the LPC bus, the main and standby rails and two grounds. Odd contacts on the near
 * (north) row, even on the far, 1 at the west end.
 */
export const TPM_HEADER: Readonly<Record<number, string>> = {
  1: '+3V', 2: 'LRESET#', 3: 'GND', 4: 'GND', 5: 'LAD3', 6: 'LAD2', 7: 'LCLK', 8: 'LFRAME#', 9: 'LAD0', 10: 'LAD1', 11: 'LPCPD#', 12: 'SERIRQ', 14: '+3VSB',
};

export type Layer = 'top' | 'bottom';
/** A copper run: its net, layer, width and polyline. */
export interface Trace { net: string; layer: Layer; w: number; pts: Pt[] }
/** A via, through both layers. */
export interface Via { net: string; x: number; y: number }
/** An SMD pad on the top: its part's pin (`U1.5`, `C1.2`), net, rect and centre. */
export interface Pad { id: string; net: string; r: Rect; c: Pt }
/** A through-hole pad: one of the connector's contacts, by its number. */
export interface Hole { pin: number; net: string; x: number; y: number }
/** A passive or the LED on the top: designator, package, kind, centre, turned along y, value, the nets of its two ends (west or north first). */
export interface Part { ref: string; pkg: '0402' | '0603'; kind: 'cap' | 'res' | 'led'; x: number; y: number; turn: boolean; value: string; nets: [string, string] }
export interface TpmCopper { traces: Trace[]; vias: Via[]; pads: Pad[]; holes: Hole[]; parts: Part[]; fiducials: Pt[] }

/**
 * Sizes in board units (23 a mm): a signal's width (0.17 mm), a strap's and a rail's, the clearance between nets (0.15 mm), a via's ring and
 * drill, a contact's ring and drill, the pour's clearance and its pull-back from the board's edge, a fiducial's dot.
 */
export const CU = { sig: 4, strap: 6, rail: 7, clear: 3.5, via: 5.5, drill: 2.6, ring: 16, hole: 8, pour: 4.5, edge: 8, fid: 6 } as const;
/** A leg's land: its width, length, and how far out of the body it starts. */
export const LEG_PAD = { w: 9, h: 15, gap: 7 } as const;

const MM = 23;
/** A passive's two pads (west or north first), a hair past its tinned ends. */
export function partPads(p: Pick<Part, 'x' | 'y' | 'pkg' | 'turn'>): [Rect, Rect] {
  const [l, w] = p.pkg === '0603' ? [1.6 * MM, 0.8 * MM] : [1 * MM, 0.5 * MM], e = l * 0.3, k = 2;
  const end = (s: number): Rect => p.turn
    ? { x: p.x - w / 2 - k, y: p.y + s * (l / 2 - e / 2) - e / 2 - k, w: w + 2 * k, h: e + 2 * k }
    : { x: p.x + s * (l / 2 - e / 2) - e / 2 - k, y: p.y - w / 2 - k, w: e + 2 * k, h: w + 2 * k };
  return [end(-1), end(1)];
}
/** How far a passive's pad centre lies from its own centre. */
const padOff = (pkg: Part['pkg']): number => (pkg === '0603' ? 1.6 : 1) * MM * 0.35;

const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
/** The polyline without repeated or collinear points. */
function clean(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.length || !same(out[out.length - 1]!, p)) out.push(p);
  return out.filter((b, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = out[i - 1]!, d = out[i + 1]!;
    return Math.abs((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0])) > 1e-6;
  });
}
/** Each right-angle bend cut by a 45-degree run `c` along each leg, as a router chamfers it. */
function chamfer(pts: Pt[], c = 5): Pt[] {
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!, b = pts[i]!, d = pts[i + 1]!;
    const u = [b[0] - a[0], b[1] - a[1]], v = [d[0] - b[0], d[1] - b[1]], lu = Math.hypot(u[0]!, u[1]!), lv = Math.hypot(v[0]!, v[1]!);
    if (Math.abs(u[0]! * v[0]! + u[1]! * v[1]!) < 1e-6) out.push([b[0] - (u[0]! / lu) * c, b[1] - (u[1]! / lu) * c], [b[0] + (v[0]! / lv) * c, b[1] + (v[1]! / lv) * c]);
    else out.push(b);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}
/** From p straight along y, then 45 degrees into q. */
const drop = (p: Pt, q: Pt): Pt[] => [p, [p[0], q[1] - Math.abs(q[0] - p[0])], q];
/** From p down to y0, 45 degrees over to the lane at x, down the lane between the near row's pads, then 45 degrees into q on the far row. */
const lane = (p: Pt, y0: number, x: number, q: Pt): Pt[] => [p, [p[0], y0], [x, y0 + Math.abs(x - p[0])], [x, q[1] - Math.abs(q[0] - x)], q];

/** The module's copper on the header whose rectangle is `hdr` (board space; `headerRect` of the TPM header). */
export function tpmCopper(geo: TpmGeo, hdr: Rect): TpmCopper {
  const { pcb, chip } = geo, at = (x: number, y: number): Pt => [pcb.x + x, pcb.y + y], n = TSSOP28.legs;
  const legX = (k: number) => chip.x + chip.w / 2 + (k - (n - 1) / 2) * TSSOP28.pitch;
  const yN = chip.y - LEG_PAD.gap - LEG_PAD.h / 2, yS = chip.y + chip.h + LEG_PAD.gap + LEG_PAD.h / 2;
  // pin p of the chip turned half round: 1 to 14 west along the north row from its east end, 15 to 28 east along the south row
  const leg = (p: number): Pt => (p <= 14 ? [legX(14 - p), yN] : [legX(p - 15), yS]);
  const pin = (p: number): Pt => [hdr.x + 36 + 52 * Math.floor((p - 1) / 2), hdr.y + 36 + 52 * ((p - 1) % 2)];

  const pads: Pad[] = [];
  for (let p = 1; p <= 28; p++) {
    const [x, y] = leg(p);
    pads.push({ id: `U1.${p}`, net: pinNet(p), r: { x: x - LEG_PAD.w / 2, y: y - LEG_PAD.h / 2, w: LEG_PAD.w, h: LEG_PAD.h }, c: [x, y] });
  }
  // the bulk cap on the trunk by contact 1, a 100 nF cap each side of it at the chip's west end, the standby rail's by contact 14, the PP
  // pull-down and the LED's resistor by the chip's east end, the LED by the east edge
  const L = tpmLed(geo), [p1x] = pin(1), [p14x, p14y] = pin(14), yPP = pcb.y + 90, yGPIO = pcb.y + 70, yTrunk = pcb.y + 95;
  const parts: Part[] = [
    { ref: 'C1', pkg: '0603', kind: 'cap', x: p1x - padOff('0603'), y: pcb.y + 150, turn: false, value: '1u', nets: ['GND', '+3V'] },
    { ref: 'C2', pkg: '0402', kind: 'cap', x: pcb.x + 75, y: pcb.y + 72, turn: true, value: '100n', nets: ['GND', '+3V'] },
    { ref: 'C3', pkg: '0402', kind: 'cap', x: pcb.x + 75, y: pcb.y + 118, turn: true, value: '100n', nets: ['+3V', 'GND'] },
    { ref: 'C4', pkg: '0402', kind: 'cap', x: p14x + 36, y: p14y + padOff('0402'), turn: true, value: '100n', nets: ['+3VSB', 'GND'] },
    { ref: 'R1', pkg: '0402', kind: 'res', x: pcb.x + 340, y: yPP, turn: false, value: '10k', nets: ['PP', 'GND'] },
    { ref: 'R2', pkg: '0402', kind: 'res', x: pcb.x + 366, y: yGPIO, turn: false, value: '330', nets: ['GPIO', 'LED'] },
    { ref: 'D1', pkg: '0603', kind: 'led', x: L.x, y: L.y, turn: true, value: 'red', nets: ['LED', 'GND'] },
  ];
  for (const q of parts) partPads(q).forEach((r, i) => pads.push({ id: `${q.ref}.${i + 1}`, net: q.nets[i]!, r, c: [r.x + r.w / 2, r.y + r.h / 2] }));
  const pc = (id: string): Pt => pads.find((q) => q.id === id)!.c;

  const traces: Trace[] = [], vias: Via[] = [];
  const run = (net: string, pts: Pt[], w: number = CU.sig, layer: Layer = 'top') => traces.push({ net, layer, w, pts: chamfer(clean(pts)) });
  const via = (net: string, p: Pt) => vias.push({ net, x: p[0], y: p[1] });
  /** A pad straight along y to its via: a ground pin or a part's ground end down to the plane. */
  const toVia = (net: string, p: Pt, y: number) => { run(net, [p, [p[0], y]]); via(net, [p[0], y]); };

  // the LPC bus: each line drops to its contact on the near row, or down a lane between that row's pads to the far row; CLKRUN# to ground
  const jog = yS + LEG_PAD.h / 2 + 2, yC = (pin(1)[1] + pin(2)[1]) / 2, gap = (a: number, b: number) => (pin(a)[0] + pin(b)[0]) / 2;
  run('GND', drop(leg(15), pin(3)));
  run('LRESET#', [leg(16), [leg(16)[0], yC - 4], [leg(16)[0] - 4, yC], [pin(2)[0] + (pin(2)[1] - yC), yC], pin(2)]);
  run('LAD3', drop(leg(17), pin(5)));
  run('LAD2', lane(leg(20), jog, gap(5, 7), pin(6)));
  run('LCLK', drop(leg(21), pin(7)));
  run('LFRAME#', lane(leg(22), jog, gap(7, 9) - 4, pin(8)));
  run('LAD1', lane(leg(23), jog, gap(7, 9) + 4, pin(10)));
  run('LAD0', drop(leg(26), pin(9)));
  run('SERIRQ', lane(leg(27), jog + 2.5, gap(9, 11), pin(12)));
  run('LPCPD#', drop(leg(28), pin(11)));

  // the main rail: the strap under the body from pin 10 to pin 19, pin 24 across to it, and the trunk west past the caps to contact 1
  run('+3V', [leg(10), leg(19)], CU.strap);
  run('+3V', [leg(24), [leg(24)[0], pcb.y + 125], [leg(10)[0], pcb.y + 125]], CU.strap);
  run('+3V', [[leg(10)[0], yTrunk], [p1x, yTrunk], pin(1)], CU.rail);
  run('+3V', [pc('C2.2'), [pc('C2.2')[0], yTrunk]]);
  run('+3V', [pc('C3.1'), [pc('C3.1')[0], yTrunk]]);

  // the strap pins: PP through its pull-down, GPIO through its resistor to the LED; the test inputs, the ground pins and every part's ground end
  // down a via to the plane
  run('PP', [leg(7), [leg(7)[0], yPP], pc('R1.1')]);
  run('GPIO', [leg(6), [leg(6)[0], yGPIO], pc('R2.1')]);
  run('LED', [pc('R2.2'), [pc('D1.1')[0] - (pc('D1.1')[1] - yGPIO), yGPIO], pc('D1.1')]);
  toVia('GND', leg(11), pcb.y + 62);
  toVia('GND', leg(9), pcb.y + 56);
  toVia('GND', leg(8), pcb.y + 70);
  toVia('GND', leg(4), pcb.y + 56);
  toVia('GND', leg(18), pcb.y + 135);
  toVia('GND', leg(25), pcb.y + 135);
  toVia('GND', pc('C1.1'), pcb.y + 172);
  toVia('GND', pc('C2.1'), pcb.y + 44);
  toVia('GND', pc('C3.2'), pcb.y + 146);
  toVia('GND', pc('C4.2'), pcb.y + 280);
  toVia('GND', pc('R1.2'), pcb.y + 112);
  toVia('GND', pc('D1.2'), pcb.y + 128);

  // the standby rail: pin 5 down a via, along the underside round the contacts to contact 14, and on the top to its cap
  const v5: Pt = [leg(5)[0], pcb.y + 56], y1 = pcb.y + 100, x2 = pcb.x + 300, y2 = y1 + (x2 - v5[0]);
  toVia('+3VSB', leg(5), v5[1]);
  run('+3VSB', [v5, [v5[0], y1], [x2, y2], [p14x - 24, y2], [p14x, y2 + 24], pin(14)], CU.strap, 'bottom');
  run('+3VSB', [pin(14), pc('C4.1')]);

  // the pours' stitching vias, and two fiducials for the pick-and-place
  for (const [x, y] of [[20, 60], [20, 104], [404, 165], [290, 280], [350, 280]] as const) via('GND', at(x, y));
  const holes: Hole[] = Object.entries(TPM_HEADER).map(([k, net]) => { const p = Number(k), [x, y] = pin(p); return { pin: p, net, x, y }; });
  return { traces, vias, pads, holes, parts, fiducials: [at(400, 22), at(20, 280)] };
}
