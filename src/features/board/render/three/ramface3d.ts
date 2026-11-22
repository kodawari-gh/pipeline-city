// The face of a memory stick's PCB, painted (docs/render/three.md "memory sticks"): the solder mask, the gold fingers down the bottom edge and the copper that runs from each finger up to
// the chip it feeds. A stick is a ladder of short runs, as a real one is: every finger rises, jogs at 45 degrees to close to its chip's ball columns, and goes on up to the pad under the chip. The fingers of the
// gap between the two chip groups feed the stick's own small parts (the SPD, the power chip, the ECC or register chip); a finger no chip takes ends in a via. Along the top edge the clock and command
// pairs run the stick's length and drop into the gaps between the chips. Pure geometry here (`ramRoutes`, in the PCB's own frame: u along the stick from its south end, v up from its bottom edge); the paint is `ramFace`.
import { paintLow, shareTex } from '@/core/render/three/geometry';
import { sheetCut } from '@/core/render/three/detail';
import { BRAND_FONT, drawLockup, lockupWidth } from '@/core/render/brands';
import type { Texture } from 'three';

export type Pt = readonly [number, number];
/** A part's footprint on the face (PCB frame): the chips, and the small parts of the gap. */
export interface Foot { u0: number; u1: number; v0: number; v1: number; kind: 'dram' | 'reg' | 'pmic' | 'spd' }

export interface FaceIn {
  /** The PCB's length and height (units), the key notch's place along it, how many fingers, and the depth the socket hides of the fingers. */
  L: number; H: number; notchU: number; pins: number; sink: number;
  foot: readonly Foot[];
}

export interface Routes {
  /** The runs and the pads that end them (circle centres), the vias, the fingers' centres along the stick. */
  lines: Pt[][];
  pads: Pt[];
  vias: Pt[];
  fingers: number[];
}

/** The side margin of the finger row, the gap at the key (units). */
export const FINGER_MARGIN = 54, KEY_GAP = 24;

/** The fingers' centres along the stick: `pins` of them at an even pitch, a gap where the key notch is. */
export function fingerCentres(L: number, notchU: number, pins: number): number[] {
  const pitch = (L - 2 * FINGER_MARGIN - KEY_GAP) / pins, out: number[] = [];
  for (let k = 0, u = FINGER_MARGIN; k < pins; k++, u += pitch) {
    if (Math.abs(u + pitch / 2 - notchU) < 12) u += KEY_GAP;
    out.push(u + pitch / 2);
  }
  return out;
}

/** Where the runs start (over the fingers' tops), and where the 45-degree jogs start. */
const V_START = 98, V_JOG = 140;
/** A run's pad ends this far under the part. */
const PAD_UNDER = 7;

/** How many fingers a small part takes, by kind (the rest of the gap's fingers feed the register chip, or end in vias). */
const TAKES: Record<Foot['kind'], number> = { spd: 3, pmic: 6, reg: 40, dram: 40 };

export function ramRoutes(a: FaceIn): Routes {
  const fingers = fingerCentres(a.L, a.notchU, a.pins), owner = new Array<number>(fingers.length).fill(-1);
  const mid = (f: Foot) => (f.u0 + f.u1) / 2;
  // the small parts and the register chip take the fingers nearest them first, then each chip takes the fingers nearest to it
  const order = [...a.foot.keys()].sort((p, q) => ('spd pmic reg dram'.indexOf(a.foot[p]!.kind)) - ('spd pmic reg dram'.indexOf(a.foot[q]!.kind)));
  for (const i of order) {
    const f = a.foot[i]!, reach = f.kind === 'dram' ? 140 : (f.u1 - f.u0) / 2 + 10;
    const near = fingers.map((u, k) => ({ k, d: Math.abs(u - mid(f)) })).filter((x) => owner[x.k]! < 0 && x.d <= reach).sort((p, q) => p.d - q.d).slice(0, TAKES[f.kind]);
    for (const x of near) owner[x.k] = i;
  }
  const lines: Pt[][] = [], pads: Pt[] = [], vias: Pt[] = [];
  a.foot.forEach((f, i) => {
    const mine = fingers.map((u, k) => ({ u, k })).filter((x) => owner[x.k] === i);
    const n = mine.length;
    if (!n) return;
    const w = f.u1 - f.u0, span = Math.min(w * 0.84, Math.max(0, n - 1) * 11), c = mid(f), step = n > 1 ? span / (n - 1) : 0;
    const vEnd = f.v0 - PAD_UNDER;
    mine.forEach((m, j) => {
      const t = c + (j - (n - 1) / 2) * step, d = t - m.u, ad = Math.abs(d), vk = V_JOG;
      const pts: Pt[] = ad < 0.5 ? [[m.u, V_START], [m.u, vEnd]] : [[m.u, V_START], [m.u, vk], [t, vk + ad], [t, vEnd]];
      // a length-matching serpentine on some lines of a chip (the runs are not all one length)
      if (f.kind === 'dram' && j % 5 === 2 && vEnd - 60 > vk + ad + 70) {
        const y = vk + ad + 40;
        pts.splice(pts.length - 1, 0, [t, y], [t + 4, y + 4], [t + 4, y + 16], [t - 4, y + 20], [t - 4, y + 32], [t, y + 36]);
      }
      lines.push(pts);
      pads.push([t, vEnd]);
    });
  });
  // a finger that no part took ends in a via just over its dog-leg
  fingers.forEach((u, k) => { if (owner[k]! < 0) { lines.push([[u, V_START], [u, V_START + 14]]); vias.push([u, V_START + 14]); } });
  return { lines, pads, vias, fingers };
}

/** Mix a '#rrggbb' colour toward white (`t` 0 to 1). */
function lift(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16), c = (s: number) => Math.round(((n >> s) & 255) * (1 - t) + 255 * t);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

const cache = new Map<string, Texture | null>();

/**
 * The PCB's face: `color` the solder mask, the copper of `ramRoutes` under it (a shade lighter, a dark edge under each run), the footprints' silkscreen rims, a clock and command pair along the top
 * edge that drop into the gaps between the chips, test pads, the finger row at the bottom with the key's gap, and `marks` (the stick's model and rank) printed in silk.
 */
export function ramFace(color: string, a: FaceIn, marks: readonly string[]): Texture | null {
  const W = 2048, H = Math.round((W * a.H) / a.L), py = (v: number) => H - (v / a.H) * H, px = (u: number) => (u / a.L) * W, k = W / a.L;
  const key = `${color}|${a.L}|${a.notchU}|${a.pins}|${a.foot.map((f) => `${f.kind}${f.u0 | 0},${f.v0 | 0}`).join(';')}|${marks.join('/')}|${sheetCut(W, H)}`;
  if (cache.has(key)) return cache.get(key)!;
  const r = ramRoutes(a), copper = lift(color, 0.2), shade = 'rgba(0,0,0,0.38)', silk = 'rgba(236,240,244,0.55)';
  const t = paintLow(W, H, (c) => {
    c.fillStyle = color; c.fillRect(0, 0, W, H);
    c.lineJoin = 'round'; c.lineCap = 'butt';
    const stroke = (pts: readonly Pt[], w: number, dy = 0) => {
      c.lineWidth = Math.max(1.2, w * k);
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(px(p[0]), py(p[1]) + dy) : c.moveTo(px(p[0]), py(p[1]) + dy)));
      c.stroke();
    };
    const dot = (p: Pt, rad: number, fill: string) => { c.fillStyle = fill; c.beginPath(); c.arc(px(p[0]), py(p[1]), Math.max(1.4, rad * k), 0, Math.PI * 2); c.fill(); };
    // the top edge: the clock pair and the command run along the stick, with a stub down into each gap between two chips
    const top = a.H - 22, dram = a.foot.filter((f) => f.kind === 'dram').sort((p, q) => p.u0 - q.u0);
    const bus: Pt[][] = [[[26, top], [a.L - 26, top]], [[26, top - 9], [a.L - 26, top - 9]], [[26, top - 20], [a.L - 26, top - 20]]];
    const gaps = dram.slice(1).map((f, i) => (dram[i]!.u1 + f.u0) / 2).filter((_, i) => dram[i + 1]!.u0 - dram[i]!.u1 < 80);
    const stubs: Pt[][] = gaps.flatMap((g) => [[[g - 4, top - 20], [g - 4, dram[0]!.v0 + 8]] as Pt[], [[g + 4, top - 9], [g + 4, dram[0]!.v0 + 8]] as Pt[]]);
    for (const [paint, dy] of [[shade, 1.4], [copper, 0]] as const) {
      c.strokeStyle = paint;
      for (const p of r.lines) stroke(p, 3, dy);
      for (const p of bus) stroke(p, 3.4, dy);
      for (const p of stubs) stroke(p, 2.4, dy);
    }
    // vias and the pads that end the runs: a ring of copper, a drill
    for (const p of r.vias) { dot(p, 5, copper); dot(p, 2.2, 'rgba(0,0,0,0.7)'); }
    for (const p of r.pads) dot(p, 3.2, copper);
    for (const g of gaps) { dot([g - 4, top - 20], 3.4, copper); dot([g + 4, top - 9], 3.4, copper); }
    // the silkscreen: a rim round every part, a pin-1 mark, test pads and the marks
    c.strokeStyle = silk; c.lineWidth = Math.max(1.2, 1.6 * k);
    for (const f of a.foot) {
      c.strokeRect(px(f.u0 - 5), py(f.v1 + 5), (f.u1 - f.u0 + 10) * k, (f.v1 - f.v0 + 10) * k);
      c.fillStyle = silk; c.beginPath(); c.arc(px(f.u0 - 5), py(f.v1 + 5), Math.max(1.6, 3.5 * k), 0, Math.PI * 2); c.fill();
    }
    for (let u = 140; u < a.L - 100; u += 190) dot([u, a.H - 46], 3.6, '#d4af5f');
    c.fillStyle = silk; c.font = `${Math.round(30 * k)}px monospace`; c.textBaseline = 'middle';
    marks.forEach((s, i) => c.fillText(s, px(a.L * 0.085), py(a.H - 70 - i * 16)));
    // the finger row
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, py(a.sink + 12), W, 3);
    const pitch = (a.L - 2 * FINGER_MARGIN - KEY_GAP) / a.pins;
    c.fillStyle = '#d4af5f';
    for (const u of r.fingers) c.fillRect(px(u - pitch * 0.32), py(a.sink + 3), px(pitch * 0.64), py(4) - py(a.sink + 3));
  });
  if (t) t.repeat.set(1 / a.L, 1 / a.H);
  cache.set(key, shareTex(t));
  return t;
}

export interface PlateIn {
  /** The plate's metal (a '#rrggbb'), its length along the stick and the height it reaches over the PCB's bottom edge (units). */
  color: string; L: number; top: number;
  /** The groove lines (their lower edge's height and ink), the dark band along the top edge (0 for none), and the model printed on the plate ('' for none). */
  lines: readonly { v: number; ink: string }[]; band: number; text: string; /** The model's ink. */ textInk: string;
  /** The plate that faces west reads the other way along the stick: its picture is turned over. */
  flip: boolean;
}

const plates = new Map<string, Texture | null>();

/**
 * A spreader plate's outer face as one picture: brushed metal (fine streaks along the stick), the groove lines, a dark band under the light bar, and the maker's lockup with the model.
 * Painting them instead of building a mesh for each is how a stick stays a handful of draws.
 */
export function plateFace(a: PlateIn): Texture | null {
  const W = 2048, H = Math.round((W * a.top) / a.L), k = W / a.L, py = (v: number) => H - v * k;
  const key = `${a.color}|${a.L}|${a.top}|${a.lines.map((l) => `${l.v}${l.ink}`).join(',')}|${a.band}|${a.text}|${a.textInk}|${a.flip}|${sheetCut(W, H)}`;
  if (plates.has(key)) return plates.get(key)!;
  const t = paintLow(W, H, (c) => {
    if (a.flip) { c.translate(W, 0); c.scale(-1, 1); }
    c.fillStyle = a.color; c.fillRect(0, 0, W, H);
    // the brushed streaks: a fixed sequence, so every plate of a tier is the same
    let s = 7;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 700; i++) {
      const x = rnd() * W, y = rnd() * H, w = 160 + rnd() * 700;
      c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.07)';
      c.fillRect(x, y, w, Math.max(1, rnd() * 2));
    }
    for (const l of a.lines) { c.fillStyle = l.ink; c.fillRect(0, py(l.v + 6), W, 6 * k); c.fillStyle = 'rgba(255,255,255,0.14)'; c.fillRect(0, py(l.v + 6) - 1.5, W, 1.5); }
    if (a.band > 0) { c.fillStyle = '#131518'; c.fillRect(0, 0, W, a.band * k); }
    if (a.text) {
      const mh = 70 * k, bw = 760 * k, u0 = 0.3 * a.L * k - bw / 2, x0 = a.flip ? W - u0 - bw : u0, y = py(402), lw = lockupWidth('kaiju', mh);
      c.save();
      drawLockup(c, 'kaiju', x0, y, mh, a.textInk);
      c.fillStyle = a.textInk; c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = `500 ${Math.round(mh * 0.5)}px ${BRAND_FONT}`;
      c.fillText(a.text.toUpperCase(), x0 + lw + mh * 0.5, y, Math.max(1, bw - lw - mh));
      c.restore();
    }
  });
  if (t) t.repeat.set(1 / a.L, 1 / a.top);
  plates.set(key, shareTex(t));
  return t;
}
