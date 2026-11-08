// The power supply as a real one (docs/PC_PARTS.md), at the basement's back corner (basement3d.ts `basementPlan`): its rear against the case's
// rear wall, its fan down over the floor's filtered opening. The two small supplies are SFX units (125 x 63.5 x 100 mm), the big ones ATX
// (150 x 86 x 140 mm, layout.ts `PSU_FORM`); an SFX unit in an ATX bay hangs on an adapter plate over the bay's opening. The housing: a
// powder-coated steel cover over its base (the seam between them, the cover's screws), the 120 or 92 mm fan behind a wire guard on its underside
// (a passive unit: punched vents on its top and its underside), the rating label on its top, the maker's badge on its glass side, the modular
// panel on its east end (the 24-pin's 18 + 10 sockets, the CPU and PCIe 8-pins, the SATA and peripheral 6-pins, their latches), and its rear:
// the honeycomb exhaust, the IEC C14 inlet with its three pins, the rocker switch, the case's four screws. The mains cord's C13 plug fits the inlet.
import { CylinderGeometry, DoubleSide, Group, Mesh, PlaneGeometry, TorusGeometry, Vector2, type Material, type MeshStandardMaterial } from 'three';
import { fanRotor, instanced, rectBox, rod, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { CASE, PSU_FORM, type PsuForm } from '../layout/layout';
import { PSU_BODY, type BasementPlan } from './basement3d';
import { badgeTex, decal, decalTop, decalX, grain, outlinePts, perfMat, plateY, screws, tex, tiled, wallX, type Span, type Spot } from './casekit3d';
import { prismX, word } from './gpu3d';
import { decalMat } from './pcbkit3d';

const MM = 23;
/** Each supply's form: the big ones are ATX units, the two small ones SFX. */
export const psuForm = (visual: string): PsuForm => (visual === 'psu-big' ? PSU_FORM.atx : PSU_FORM.sfx);
const isAtx = (F: PsuForm): boolean => F.d === PSU_FORM.atx.d;

export type PsuBox = RectLike & { z0: number; z1: number };
/** The unit's box in its bay: its rear against the rear wall, standing on the bay's floor, across the bay's middle. */
export function psuBox(u: BasementPlan['psu'], visual: string): PsuBox {
  const F = psuForm(visual), zc = (u.z0 + u.z1) / 2;
  return { x: u.x, y: u.y + u.h - F.h, w: F.d, h: F.h, z0: zc - F.w / 2, z1: zc + F.w / 2 };
}

/** The C14 inlet's middle on the unit's rear (layout y, depth z): halfway up, toward the glass side. */
export const inletOf = (b: PsuBox): { y: number; z: number } => ({ y: b.y + b.h / 2, z: b.z1 - 24 * MM });
/** The inlet's flange stands this far proud of the rear (the plug's face meets it); the C13 plug reaches this far back from the rear's face. */
const FLANGE = 2 * MM;
export const PLUG_TAIL = FLANGE + 46.4 * MM;
/** Where the mains cord plugs in: the inlet's face on the supply's rear (world point), the cord leaving west. */
export function mainsInlet(p: BasementPlan, visual: string): [number, number, number] {
  const i = inletOf(psuBox(p.psu, visual));
  return [CASE.x - FLANGE, -i.y, i.z];
}

/** A span as its outline in a wall across x (`prismX`, `wallX`), with its top corners chamfered by `cut`. */
const spanPts = (s: Span, cut = 0): Vector2[] => outlinePts({ x: s.z0, y: s.y0, w: s.z1 - s.z0, h: s.y1 - s.y0 }, s.r ?? 0, [cut, cut, 0, 0]);
/** The C13/C14 mouth (24.5 x 15.5 mm, the earth side's corners chamfered), grown by `e`, at the inlet's middle. */
const mouth = (i: { y: number; z: number }, e: number): Vector2[] =>
  spanPts({ y0: i.y - 7.75 * MM - e, y1: i.y + 7.75 * MM + e, z0: i.z - 12.25 * MM - e, z1: i.z + 12.25 * MM + e }, 4 * MM + e * 0.4);

/** The rocker switch's middle, beside the inlet toward the tray. */
const switchOf = (b: PsuBox): { y: number; z: number } => ({ y: b.y + b.h / 2, z: inletOf(b).z - 27 * MM });

/** The rating label on the top: the model, the AC input, the DC output's table, the marks, the barcode. */
function ratingLabel(visual: string, watts: number): ReturnType<typeof tex> {
  return tex(`psu-label:${visual}:${watts}`, 1024, 720, (c, w, h) => {
    c.fillStyle = '#d9dcdf'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#15161a'; c.fillRect(0, 0, w, 92);
    c.fillStyle = '#e9ebee'; c.textBaseline = 'middle'; c.font = '700 50px "Segoe UI", system-ui, sans-serif'; c.fillText('PIPELINE', 30, 48);
    c.textAlign = 'right'; c.font = '600 36px "Segoe UI", system-ui, sans-serif'; c.fillText(`PL-${watts}${visual === 'psu-big' ? (watts >= 1000 ? 'P' : 'G') : visual === 'psu-mid' ? 'B' : 'S'}`, w - 30, 48);
    c.textAlign = 'left'; c.fillStyle = '#17181c'; c.font = '600 26px "Segoe UI", system-ui, sans-serif';
    c.fillText(`${visual === 'psu-big' ? 'ATX12V' : 'SFX12V'} SWITCHING POWER SUPPLY`, 30, 130);
    c.fillText('AC INPUT: 100-240V~  50/60Hz  ' + (watts >= 500 ? '12-6A' : '4-2A'), 30, 170);
    // the DC output's table
    const cols = ['DC OUTPUT', '+3.3V', '+5V', '+12V', '-12V', '+5Vsb'], amps = ['MAX LOAD', watts >= 500 ? '20A' : '12A', watts >= 500 ? '20A' : '12A', `${Math.round((watts * 0.98) / 12 * 10) / 10}A`, '0.3A', watts >= 500 ? '3A' : '2A'];
    const x0 = 30, y0 = 200, cw = (w - 60) / cols.length, rh = 52;
    c.strokeStyle = '#17181c'; c.lineWidth = 3;
    for (let r = 0; r < 3; r++) for (let k = 0; k < cols.length; k++) c.strokeRect(x0 + k * cw, y0 + r * rh, cw, rh);
    c.font = '600 22px "Segoe UI", system-ui, sans-serif'; c.textAlign = 'center';
    cols.forEach((s, k) => c.fillText(s, x0 + (k + 0.5) * cw, y0 + rh / 2));
    amps.forEach((s, k) => c.fillText(s, x0 + (k + 0.5) * cw, y0 + rh * 1.5));
    c.fillText('MAX COMBINED', x0 + 0.5 * cw, y0 + rh * 2.5);
    c.fillText(`${watts >= 500 ? 110 : 60}W`, x0 + 2 * cw, y0 + rh * 2.5);
    c.fillText(`${Math.round(watts * 0.98)}W`, x0 + 3.5 * cw, y0 + rh * 2.5);
    c.fillText(`TOTAL ${watts}W`, x0 + 5 * cw, y0 + rh * 2.5);
    // the marks (plain outlines), the warning, the barcode and the serial
    c.textAlign = 'left'; c.lineWidth = 4;
    for (let k = 0; k < 5; k++) { const x = 30 + k * 96; if (k % 2) { c.beginPath(); c.arc(x + 38, 420, 34, 0, Math.PI * 2); c.stroke(); } else c.strokeRect(x + 4, 386, 68, 68); }
    c.font = '700 20px "Segoe UI", system-ui, sans-serif'; c.fillText('CAUTION: HAZARDOUS VOLTAGE INSIDE.', 520, 398); c.fillText('NO USER SERVICEABLE PARTS.', 520, 428);
    let s = watts * 7 + visual.length;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let x = 30; x < w - 340;) { const bw = 3 + Math.floor(rnd() * 3) * 3; if (rnd() > 0.4) c.fillRect(x, 500, bw, 130); x += bw + 3 + Math.floor(rnd() * 3) * 3; }
    c.font = '600 26px "Consolas", "DejaVu Sans Mono", monospace'; c.fillText(`S/N PL${watts}2245A${(watts * 13) % 9973}`, 30, 670);
    c.fillText('MADE IN PIPELINE CITY', w - 330, 670);
  });
}

/** The efficiency rating each supply carries (none on the plain 40 W unit), its name and its colour. */
const RATING: Record<string, (watts: number) => [string, string] | null> = {
  'psu-basic': () => null,
  'psu-mid': () => ['BRONZE', '#b07a48'],
  'psu-big': (w) => (w >= 1000 ? ['PLATINUM', '#c9ced6'] : ['GOLD', '#c9a14a']),
};

/** The maker's badge on the glass side: the mark and the name, the wattage, the efficiency medallion (cut out of a clear ground). */
function sideBadge(visual: string, watts: number, wpx: number, hpx: number): ReturnType<typeof tex> {
  return tex(`psu-side:${visual}:${watts}`, wpx, hpx, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    const mark = badgeTex('psu-mark', 512, 128, 'PIPELINE', '#e6e8ec', '#e6e8ec', null);
    const img = mark?.image as CanvasImageSource | undefined;
    if (img) c.drawImage(img, w * 0.06, h * 0.2, w * 0.5, w * 0.125);
    c.fillStyle = '#e6e8ec'; c.textBaseline = 'middle'; c.font = `700 ${Math.round(h * 0.2)}px "Segoe UI", system-ui, sans-serif`;
    c.fillText(`${watts}W`, w * 0.09, h * 0.62);
    c.font = `600 ${Math.round(h * 0.075)}px "Segoe UI", system-ui, sans-serif`; c.fillStyle = '#8d939c';
    c.fillText(visual === 'psu-big' ? 'FULLY MODULAR  ·  ATX 3.0' : 'FULLY MODULAR  ·  SFX', w * 0.09, h * 0.8);
    const r = RATING[visual]?.(watts);
    if (!r) return;
    const cx = w * 0.8, cy = h * 0.5, R = h * 0.3;
    c.fillStyle = '#0b0c0f'; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    c.strokeStyle = r[1]; c.lineWidth = R * 0.12; c.beginPath(); c.arc(cx, cy, R * 0.9, 0, Math.PI * 2); c.stroke();
    c.fillStyle = r[1]; c.textAlign = 'center'; c.font = `800 ${Math.round(R * 0.42)}px "Segoe UI", system-ui, sans-serif`; c.fillText('80', cx, cy - R * 0.28);
    c.font = `700 ${Math.round(R * 0.22)}px "Segoe UI", system-ui, sans-serif`; c.fillText('PLUS', cx, cy + R * 0.08); c.fillText(r[0], cx, cy + R * 0.42);
  });
}

/** A Mini-Fit socket's face: two rows of cavities at the 4.2 mm pitch, square and rounded in turn (the keying). */
function socketFace(cols: number): ReturnType<typeof tex> {
  return tex(`psu-sock:${cols}`, cols * 64 + 26, 2 * 64 + 26, (c, w, h) => {
    c.fillStyle = '#17181c'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#030304';
    for (let r = 0; r < 2; r++) for (let k = 0; k < cols; k++) {
      const x = 13 + k * 64 + 9, y = 13 + r * 64 + 9, s = 46;
      c.beginPath();
      if ((k + r) % 2) c.roundRect(x, y, s, s, [s * 0.45, s * 0.45, 4, 4]);
      else { c.moveTo(x + 10, y); c.lineTo(x + s - 10, y); c.lineTo(x + s, y + 10); c.lineTo(x + s, y + s); c.lineTo(x, y + s); c.lineTo(x, y + 10); c.closePath(); }
      c.fill();
    }
  });
}

/** One modular socket on the east face at `x` (the face), its top edge at layout `y`, from depth `z` across `cols` columns: the housing, its cavities, its latch's ramp. */
function socket(g: Group, x: number, y: number, z: number, cols: number, M: { plastic: Material }): number {
  const P = 4.2 * MM, w = cols * P + 1.6 * MM, h = 2 * P + 1.6 * MM, d = 2.4 * MM;
  g.add(rectBox({ x, y, w: d, h }, z, z + w, M.plastic));
  g.add(decalX(x + d + 1, { y0: y, y1: y + h, z0: z, z1: z + w }, 1, decalMat(socketFace(cols), { rough: 0.6 })));
  g.add(rectBox({ x, y: y - 1.4 * MM, w: d + 0.8 * MM, h: 1.4 * MM }, z + w / 2 - 1.8 * MM, z + w / 2 + 1.8 * MM, M.plastic));
  return w;
}

/** The modular panel's sockets, by row, as [label, column counts]: what each supply's leads plug into. */
function panelRows(F: PsuForm, visual: string): [string, number[]][][] {
  if (isAtx(F)) return [[['MB', [9, 5]], ['CPU / PCI-E', [4, 4, 4]]], [['CPU / PCI-E', [4, 4, 4]], ['SATA / PERIF.', [3, 3, 3, 3]]]];
  return visual === 'psu-mid' ? [[['MB', [9, 5]], ['CPU', [4]]], [['SATA / PERIF.', [3, 3, 3]]]] : [[['MB', [9, 5]], ['CPU', [4]]], [['SATA / PERIF.', [3, 3]]]];
}

/**
 * The east end: the modular panel's bezel, its sockets in two rows from the glass side, each group's name under it, the warning sticker; the block
 * stands in the middle of the face over the fan's skirt (`cav`).
 */
function modularPanel(g: Group, b: PsuBox, F: PsuForm, visual: string, cav: number, M: { plastic: Material; bezel: Material }): void {
  const x = b.x + b.w, P = 4.2 * MM, rowH = 2 * P + 1.6 * MM, gap = 3 * MM, groupGap = 6 * MM, m = 6 * MM, pitch = rowH + 9 * MM;
  g.add(rectBox({ x, y: b.y + 4 * MM, w: 0.8 * MM, h: b.h - 4 * MM - Math.max(4 * MM, cav) }, b.z0 + 4 * MM, b.z1 - 4 * MM, M.bezel));
  const x0 = x + 0.8 * MM, block = pitch + rowH + 16 * MM, top = b.y + 4 * MM + (b.h - 4 * MM - Math.max(4 * MM, cav) - block) / 2;
  panelRows(F, visual).forEach((row, r) => {
    const y = top + r * pitch;
    let z = b.z1 - m;
    for (const [label, groups] of row) {
      const z1 = z;
      for (const cols of groups) { const w = cols * P + 1.6 * MM; z -= w; socket(g, x0, y, z, cols, M); z -= gap; }
      const z0 = z + gap, ty = y + rowH + 3.2 * MM, tw = z1 - z0, t = word(`psu-${label}`, label, 512, 64, '#d9dcdf', 600);
      g.add(decalX(x0 + 1, { y0: ty - 1.6 * MM, y1: ty + 1.6 * MM, z0: z0 + tw / 2 - 12.8 * MM, z1: z0 + tw / 2 + 12.8 * MM }, 1, decalMat(t, { cut: true })));
      z -= groupGap - gap;
    }
  });
  // the warning sticker under the sockets
  const sy = top + pitch + rowH + 9 * MM, warn = tex('psu-warn', 640, 150, (c, w, h) => {
    c.fillStyle = '#e2b93b'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#17181c'; c.textBaseline = 'middle'; c.textAlign = 'center'; c.font = '700 34px "Segoe UI", system-ui, sans-serif';
    c.fillText('USE ONLY THE MODULAR CABLES', w / 2, h * 0.32);
    c.fillText('SUPPLIED WITH THIS UNIT', w / 2, h * 0.7);
  });
  g.add(decalX(x0 + 1, { y0: sy, y1: sy + 7 * MM, z0: b.z1 - m - 30 * MM, z1: b.z1 - m }, 1, decalMat(warn, { rough: 0.6 })));
}

/** The fan on the underside: its cavity, the frame and rotor inside, the wire guard (rings, spokes, the middle disc) with its four screws. */
function underFan(g: Group, b: PsuBox, F: PsuForm, M: { body: Material; black: Material; screw: Material }): void {
  const fr = (isAtx(F) ? 60 : 46) * MM, cav = 13 * MM, t = 0.8 * MM, yb = b.y + b.h, fx = b.x + b.w / 2, fz = (b.z0 + b.z1) / 2;
  // the bottom plate with the fan's round opening, the skirt walls round the cavity, its dark ceiling
  const hole = Array.from({ length: 64 }, (_, k) => new Vector2(fx + Math.cos((k / 64) * Math.PI * 2) * fr, fz + Math.sin((k / 64) * Math.PI * 2) * fr));
  g.add(plateY(b.x, b.x + b.w, b.z0, b.z1, yb - t, t, [hole], M.body));
  g.add(rectBox({ x: b.x, y: yb - cav, w: t, h: cav - t }, b.z0, b.z1, M.body), rectBox({ x: b.x + b.w - t, y: yb - cav, w: t, h: cav - t }, b.z0, b.z1, M.body));
  g.add(rectBox({ x: b.x, y: yb - cav, w: b.w, h: cav - t }, b.z0, b.z0 + t, M.body), rectBox({ x: b.x, y: yb - cav, w: b.w, h: cav - t }, b.z1 - t, b.z1, M.body));
  const ceil = new Mesh(new PlaneGeometry(b.w - 2 * t, b.z1 - b.z0 - 2 * t), M.black);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(fx, -(yb - cav + 2), fz);
  g.add(ceil);
  // the fan: its frame's ring, the rotor (nine blades on the 120 mm fan, seven on the 92 mm), facing down
  const frame = new Mesh(new CylinderGeometry(fr * 0.98, fr * 0.98, cav - 2 * t, 48, 1, true), mat(0x101114, { roughness: 0.6, side: DoubleSide }));
  frame.position.set(fx, -(yb - cav / 2), fz);
  const rotor = fanRotor(fr * 0.93, isAtx(F) ? 9 : 7, mat(0x0d0e11, { roughness: 0.5 }), mat(0x15161a, { roughness: 0.45 }));
  // (a real one is 25 mm thick, deep inside the housing: its hub flattened here to the cavity's depth)
  rotor.rotation.x = Math.PI / 2;
  rotor.scale.z = 0.5;
  rotor.position.set(fx, -(yb - cav * 0.5), fz);
  g.add(frame, rotor);
  // the guard: rings and spokes of black wire just under the plate, a small disc at its middle
  const wire = mat(0x1d1f24, { metalness: 0.55, roughness: 0.38 }), wr = 0.55 * MM, gy = -(yb + wr);
  for (const k of [0.24, 0.43, 0.62, 0.81, 1.0]) {
    const ring = new Mesh(new TorusGeometry(fr * k, wr, 6, 72).rotateX(Math.PI / 2), wire);
    ring.position.set(fx, gy, fz);
    g.add(ring);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
    g.add(rod([fx + c * fr * 0.18, gy, fz + s * fr * 0.18], [fx + c * fr, gy, fz + s * fr], wr, wire, 6));
  }
  const disc = new Mesh(new CylinderGeometry(fr * 0.19, fr * 0.19, 1.2 * MM, 32), wire);
  disc.position.set(fx, gy, fz);
  g.add(disc);
  const sp = fr * 0.875, spots: Spot[] = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, c]) => ({ x: fx + a! * sp, y: -yb, z: fz + c! * sp }));
  g.add(screws(spots, 'y-', 2.6 * MM, M.screw));
}

/** A passive unit's punched vents: over a dark inside, on its underside and its top's east part (the label keeps the west part). */
function passiveVents(g: Group, b: PsuBox, vx: number, M: { black: Material }): void {
  const tone = 0x1c1d22, e = 6 * MM, yb = b.y + b.h, w = b.w - 2 * e, d = b.z1 - b.z0 - 2 * e;
  for (const [y, k] of [[yb + 2, 1], [yb + 5, 0]] as const) {
    const o = new Mesh(new PlaneGeometry(w, d), k ? M.black : perfMat('round', w, d, 80, tone, { metal: 0.4, rough: 0.55 }));
    o.rotation.x = Math.PI / 2;
    o.position.set(b.x + b.w / 2, -y, (b.z0 + b.z1) / 2);
    g.add(o);
  }
  const top = (y: number, m: Material) => decalTop(y, vx, b.x + b.w - e, b.z0 + e, b.z1 - e, m);
  g.add(top(b.y - 2, M.black), top(b.y - 5, perfMat('round', b.x + b.w - e - vx, d, 80, tone, { metal: 0.4, rough: 0.55 })));
}

/**
 * The rear, in the rear wall's opening: the unit's end through the wall to its face (flush with the wall's outside), the honeycomb exhaust over a
 * dark inside, the C14 inlet (its flange, the mouth's liner and floor, the three pins), the rocker switch (on: its "I" pressed in), the case's
 * screws; for an SFX unit in an ATX bay, the adapter plate over the bay's opening with the unit's opening cut in it.
 */
function rear(g: Group, u: BasementPlan['psu'], b: PsuBox, M: { body: Material; black: Material; plastic: Material; screw: Material }): void {
  const rx = CASE.x, i = inletOf(b), sw = switchOf(b), e = 32, end: Span = { y0: b.y + e, y1: b.y + b.h - e, z0: b.z0 + e, z1: b.z1 - e, r: 0.8 * MM };
  g.add(prismX(rx, b.x, spanPts(end), [mouth(i, 0.8 * MM)], M.body));
  // the honeycomb: from the tray side to the switch
  const vent: Span = { y0: b.y + 6 * MM, y1: b.y + b.h - 6 * MM, z0: b.z0 + 12 * MM, z1: sw.z - 11.5 * MM };
  g.add(decalX(rx - 2, vent, -1, M.black), decalX(rx - 5, vent, -1, perfMat('hex', vent.z1 - vent.z0, vent.y1 - vent.y0, 120, 0x1b1c21, { metal: 0.4, rough: 0.5 })));
  // the inlet: the flange proud of the face, the mouth's liner back to its floor, the pins out of the floor
  const flange: Span = { y0: i.y - 11.5 * MM, y1: i.y + 11.5 * MM, z0: i.z - 15.5 * MM, z1: i.z + 15.5 * MM, r: 2 * MM };
  g.add(prismX(rx - FLANGE, rx, spanPts(flange), [mouth(i, 0)], M.plastic, 0.4 * MM));
  const floor = rx + 7 * MM;
  g.add(prismX(rx, floor, mouth(i, 0.8 * MM), [mouth(i, 0)], M.plastic));
  g.add(prismX(floor, floor + 0.6 * MM, mouth(i, 0.4 * MM), [], M.black));
  const pin = mat(0xc9cdd3, { metalness: 0.9, roughness: 0.28 }), pins = [[i.y + 2.6 * MM, i.z - 7 * MM, 1.2], [i.y + 2.6 * MM, i.z + 7 * MM, 1.2], [i.y - 3 * MM, i.z, 0.6]] as const;
  for (const [y, z, front] of pins) g.add(rectBox({ x: rx + front * MM, y: y - 2 * MM, w: floor - rx - front * MM, h: 4 * MM }, z - 0.8 * MM, z + 0.8 * MM, pin));
  // the rocker switch: its bezel, the rocker (the "I" half pressed in), the marks
  const bezel: Span = { y0: sw.y - 10.5 * MM, y1: sw.y + 10.5 * MM, z0: sw.z - 7.5 * MM, z1: sw.z + 7.5 * MM, r: 1 * MM };
  const inner: Span = { y0: sw.y - 8.5 * MM, y1: sw.y + 8.5 * MM, z0: sw.z - 5.5 * MM, z1: sw.z + 5.5 * MM, r: 0.5 * MM };
  g.add(prismX(rx - 1.6 * MM, rx, spanPts(bezel), [spanPts(inner)], M.plastic, 0.3 * MM));
  const rock = mat(0x121316, { roughness: 0.42 }), white = mat(0xe6e8ec, { roughness: 0.5 });
  g.add(rectBox({ x: rx - 0.4 * MM, y: inner.y0, w: 0.4 * MM, h: (inner.y1 - inner.y0) / 2 }, inner.z0, inner.z1, rock));
  g.add(rectBox({ x: rx - 2.6 * MM, y: sw.y, w: 2.6 * MM, h: (inner.y1 - inner.y0) / 2 }, inner.z0, inner.z1, rock));
  g.add(rectBox({ x: rx - 0.5 * MM, y: sw.y - 6.5 * MM, w: 0.12 * MM, h: 4 * MM }, sw.z - 0.4 * MM, sw.z + 0.4 * MM, white));
  const o = new Mesh(new TorusGeometry(1.6 * MM, 0.32 * MM, 6, 24).rotateY(Math.PI / 2), white);
  o.position.set(rx - 2.65 * MM, -(sw.y + 4.3 * MM), sw.z);
  g.add(o);
  // the case's four screws through the wall into the unit's corners (an SFX unit in an ATX bay: its own four, the adapter's four in the bay's corners)
  const corners = (s: { y: number; h: number; z0: number; z1: number }, x: number): Spot[] => [[0, 0], [0, 1], [1, 0], [1, 1]].map(([a, c]) => ({ x, y: -(s.y + 6 * MM + a! * (s.h - 12 * MM)), z: c ? s.z1 - 6 * MM : s.z0 + 6 * MM }));
  g.add(screws(corners(b, rx), 'x-', 3 * MM, M.screw));
  if (b.w < u.w) {
    // (the plate is the ATX unit's outline over the bay's opening, held by the ATX holes)
    const plate: Span = { y0: u.y, y1: u.y + u.h, z0: u.z0, z1: u.z1, r: 1.5 * MM };
    g.add(wallX(rx - 1.5 * MM, rx, plate, [end], mat(0x1a1b1f, { metalness: 0.5, roughness: 0.45 })));
    g.add(screws(corners(u, rx - 1.5 * MM), 'x-', 3 * MM, M.screw));
  }
}

/**
 * The power supply at its place (`psuBox`), `fan` false for a passive unit: the housing, its fan and guard (or its vents), the cover's screws and
 * the seam, the rating label, the maker's badge, the modular panel and the rear. `watts` sets the label's and the badge's figures.
 */
export function psuUnit(p: BasementPlan, visual = 'psu-basic', fan = true, watts = 0): { root: Group; body: MeshStandardMaterial } {
  const g = new Group(), u = p.psu, b = psuBox(u, visual), F = psuForm(visual), W = watts || (isAtx(F) ? 1000 : 100);
  g.name = PSU_BODY;
  const body = mat(0x17181c, { metalness: 0.35, roughness: 0.55, bumpMap: tiled(grain(), 6, 6), bumpScale: 0.5 });
  const M = { body, black: mat(0x040405, { roughness: 0.92 }), plastic: mat(0x0f1013, { roughness: 0.58 }), bezel: mat(0x0b0c0e, { roughness: 0.66 }), screw: mat(0x26282d, { metalness: 0.75, roughness: 0.32 }) };
  // the cover over the base: with a fan, the cover stops over the fan's cavity (`underFan` builds the rest)
  const cav = fan ? 13 * MM : 0, lw = Math.min(b.w * 0.5, 72 * MM), ld = Math.min(b.z1 - b.z0 - 16 * MM, lw * 0.7);
  g.add(softBox({ x: b.x, y: b.y, w: b.w, h: b.h - cav }, b.z0, b.z1, body, 1.4 * MM));
  if (fan) underFan(g, b, F, M);
  else passiveVents(g, b, b.x + 11 * MM + lw, M);
  // the seam between the cover and the base along both sides, the cover's two screws each side
  for (const [z0, z1, f] of [[b.z1, b.z1 + 3, 'z+'], [b.z0 - 3, b.z0, 'z-']] as const) {
    g.add(rectBox({ x: b.x + 1.5 * MM, y: b.y + b.h - 7 * MM, w: b.w - 3 * MM, h: 0.35 * MM }, z0, z1, M.black));
    g.add(screws([b.x + 9 * MM, b.x + b.w - 9 * MM].map((x) => ({ x, y: -(b.y + 5 * MM), z: f === 'z+' ? b.z1 : b.z0 })), f, 2.4 * MM, M.screw));
  }
  // the rating label on the top (west part), the badge on the glass side
  g.add(decalTop(b.y - 3, b.x + 7 * MM, b.x + 7 * MM + lw, (b.z0 + b.z1) / 2 - ld / 2, (b.z0 + b.z1) / 2 + ld / 2, decalMat(ratingLabel(visual, W), { rough: 0.55 })));
  const bw = b.w - 16 * MM, bh = Math.min(b.h - 22 * MM, bw * 0.42);
  g.add(decal({ x: b.x + 8 * MM, y: b.y + 6 * MM, w: bw, h: bh }, b.z1 + 4, decalMat(sideBadge(visual, W, 1024, Math.round((1024 * bh) / bw)), { cut: true, rough: 0.45 })));
  modularPanel(g, b, F, visual, cav, M);
  rear(g, u, b, M);
  return { root: g, body };
}

/**
 * The mains cord's C13 plug in the inlet: its nose in the mouth, the grip with its ribs, the strain relief tapering to the cord (it leaves west,
 * `PLUG_TAIL` from the rear's face).
 */
export function mainsPlug(p: BasementPlan, visual: string): Group {
  const g = new Group(), i = inletOf(psuBox(p.psu, visual)), rx = CASE.x, face = rx - FLANGE, m = mat(0x18191c, { roughness: 0.55 });
  g.add(prismX(face - 0.4 * MM, rx + 6 * MM, mouth(i, -0.25 * MM), [], m));
  const grip: Span = { y0: i.y - 11 * MM, y1: i.y + 11 * MM, z0: i.z - 15 * MM, z1: i.z + 15 * MM, r: 3.5 * MM }, gx = face - 0.4 * MM - 30 * MM;
  g.add(prismX(gx, face - 0.4 * MM, spanPts(grip), [], m, 1.2 * MM));
  for (let k = 0; k < 5; k++) {
    const x = gx + 2.5 * MM + k * 3 * MM, rib: Span = { y0: grip.y0 - 0.5 * MM, y1: grip.y1 + 0.5 * MM, z0: grip.z0 - 0.5 * MM, z1: grip.z1 + 0.5 * MM, r: 3.8 * MM };
    g.add(prismX(x, x + 1.2 * MM, spanPts(rib), [], m));
  }
  const relief = new Mesh(new CylinderGeometry(5.8 * MM, 3.7 * MM, 16 * MM, 24).rotateZ(-Math.PI / 2), m);
  relief.position.set(gx - 8 * MM, -i.y, i.z);
  g.add(relief);
  g.add(instanced(new CylinderGeometry(1, 1, 1, 20).rotateZ(Math.PI / 2), m, [0, 1, 2, 3].map((k) => ({ x: gx - 3 * MM - k * 3.4 * MM, y: -i.y, z: i.z, sx: 1.2 * MM, sy: (5.6 - k * 0.5) * MM, sz: (5.6 - k * 0.5) * MM }))));
  return g;
}
