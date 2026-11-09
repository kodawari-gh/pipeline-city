// A network card's own parts as real ones (docs/PC_PARTS.md), in card3d's lying pose (gpu3d.ts's frame). A low-profile card with every part on
// its component side, under the PCB (standing, it faces down, as a GPU's cooler does). The RJ45 jacks with their magnetics through the bracket:
// a tin-plated steel shield with its ground springs against the bracket's inside, the mouth with its latch slot, the eight gold contacts inside
// at their 1.02 mm pitch, the link and activity lights either side of the latch slot. The controller east of them: a QFN on the gigabit card, a
// lidded BGA under a finned sink with its push pins on the faster cards (the fins run along the card, in the case's front-to-back air). Its 25 MHz
// crystal, the SPI flash on its gull-wing legs, the core rail's regulator with its inductors and polymer capacitors, the passives, the MAC
// label, and the solder mask with its traces and silkscreen.
import { BoxGeometry, Group, type Material, type Vector2 } from 'three';
import { drum, instanced, rectBox, tube, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { NIC_BRACKET_X } from '../layout/layout';
import { decal, outlinePts, tex, wallPt, wallX, type Span } from './casekit3d';
import { prismX, type CardFrame } from './gpu3d';
import { crystal, decalMat, inductor, maskTop, MM, passiveRow, passives, pkg, type Passive } from './pcbkit3d';
import { springGold, unshadowed } from './rj45jack3d';

/** An RJ45 jack with its magnetics (mm, as layout units): across the bracket, off the PCB, and deep; the tallest part on the card. */
export const JACK = { w: 16 * MM, h: 13.5 * MM, d: 22 * MM };
/** The jacks' front: past the bracket's face, through the case's rear wall, the mouths just in from its outer face (where the LAN plug goes in). */
export const JACK_X = NIC_BRACKET_X - 150;
/** The mouth (mm): 11.68 across, its opening 6.6 tall from 2.3 in from the jack's outer side, then the latch slot, 6.2 wide, 1.9 on toward the PCB. */
export const MOUTH = { w: 11.68 * MM, top: 2.3 * MM, main: 6.6 * MM, slotW: 6.2 * MM, slot: 1.9 * MM };
/** A card's jacks (two on the 40G card), as their slot-side edges, lying. */
export const jacksOf = (visual: string, y0: number): number[] => (visual === 'nic-40g' ? [0, 1] : [0]).map((k) => y0 + 120 + k * (JACK.w + 30));
/** The middle of a jack's opening, lying: across it (y) and off the PCB (z), for the jack whose edge is at `y`. */
export const mouthAt = (y: number, Zp: number) => ({ y: y + JACK.w / 2, z: Zp - JACK.h + MOUTH.top + MOUTH.main / 2 });

/** Each card's controller (its package's side, mm), its sink (0: none, as on a real gigabit card), the sink's and the push pins' finish, its marking. */
const CTRL: Record<string, { chip: number; sink: number; sinkHex: number; pinHex: number; mark: string[] }> = {
  'nic-gbe': { chip: 9, sink: 0, sinkHex: 0, pinHex: 0, mark: ['PL-N210', 'GBE Q9A2', '2241'] },
  'nic-10g': { chip: 25, sink: 40, sinkHex: 0xb9c0c8, pinHex: 0xe6e4dc, mark: ['PL-N510', '10GBASE-T', 'A1 2244'] },
  'nic-40g': { chip: 25, sink: 45, sinkHex: 0x24272d, pinHex: 0x1a1c20, mark: ['PL-N740', '40GBASE-T', 'B0 2251'] },
};
/** The sink's height off the PCB, under the jacks' (`JACK.h`). */
const SINK_H = 12 * MM;

/** A span of a wall across x as its outline (`wallPt` points). */
const spanPts = (s: Span): Vector2[] => outlinePts({ x: s.z0, y: s.y0, w: s.z1 - s.z0, h: s.y1 - s.y0 }, s.r ?? 0);

/** The mouth's outline (`wallPt` points), grown by `e`: the opening, the latch slot on toward the PCB. */
function mouthPts(yc: number, zt: number, e: number): Vector2[] {
  const { w, main, slotW, slot } = MOUTH, zm = zt + main, zs = zm + slot;
  return [wallPt(yc - w / 2 - e, zt - e), wallPt(yc + w / 2 + e, zt - e), wallPt(yc + w / 2 + e, zm + e), wallPt(yc + slotW / 2 + e, zm + e), wallPt(yc + slotW / 2 + e, zs + e), wallPt(yc - slotW / 2 - e, zs + e), wallPt(yc - slotW / 2 - e, zm + e), wallPt(yc - w / 2 - e, zm + e)];
}

interface JackMats { steel: Material; plastic: Material; back: Material; gold: Material; green: Material; amber: Material }

/**
 * One RJ45 jack under the PCB (its edge at lying `y`, its top against the underside `Zp`), its front at `JACK_X`: the shield (its front plate with
 * the mouth's and the lights' windows, its walls, its back), the plastic body round the mouth, the insulator at the mouth's end, the contacts, the
 * lights, and the ground springs just inside the bracket (`inX`, its inner face).
 */
function jack(g: Group, y: number, Zp: number, M: JackMats, inX: number): void {
  const { w, h, d } = JACK, x0 = JACK_X, x1 = x0 + d, z0 = Zp - h, z1 = Zp, t = 0.3 * MM, yc = y + w / 2, zt = z0 + MOUTH.top, zm = zt + MOUTH.main;
  const outer = spanPts({ y0: y, y1: y + w, z0, z1, r: 0.5 * MM }), inner = spanPts({ y0: y + t, y1: y + w - t, z0: z0 + t, z1: z1 - t });
  // the lights' windows either side of the latch slot, clear of the mouth's opening (cut holes that touch break the plate's faces)
  const lz0 = zm + 1.1 * MM, lz1 = zm + 2.9 * MM;
  const leds = [y + 0.9 * MM, y + w - 3.3 * MM], led = (ly: number, e: number) => spanPts({ y0: ly - e, y1: ly + 2.4 * MM + e, z0: lz0 - e, z1: lz1 + e, r: 0.3 * MM });
  g.add(prismX(x0, x0 + t, outer, [mouthPts(yc, zt, 0.5 * MM), ...leds.map((l) => led(l, 0.25 * MM))], M.steel));
  g.add(prismX(x0 + t, x1, outer, [inner], M.steel));
  g.add(rectBox({ x: x1 - t, y: y + t, w: t, h: w - 2 * t }, z0 + t, z1 - t, M.steel));
  // (the mouth's inside takes no shadow: deep in it the shadow map would only hide the contacts in its acne, as rj45jack3d's)
  const deep = x0 + 15 * MM;
  g.add(unshadowed(prismX(x0 + t, deep, inner, [mouthPts(yc, zt, 0)], M.plastic)));
  g.add(unshadowed(rectBox({ x: deep, y: y + t, w: x1 - t - deep, h: w - 2 * t }, z0 + t, z1 - t, M.back)));
  // the contacts: spring wires from the mouth's outer edge, sloping in toward the PCB side as they run back
  const ax = x0 + 2.5 * MM, bx = x0 + 13 * MM, az = zt + 0.45 * MM, bz = zt + 2.6 * MM, len = Math.hypot(bx - ax, bz - az);
  const wire = new BoxGeometry(len, 0.4 * MM, 0.25 * MM).rotateY(-Math.asin((bz - az) / len));
  g.add(unshadowed(instanced(wire, M.gold, Array.from({ length: 8 }, (_, k) => ({ x: (ax + bx) / 2, y: -(yc + (k - 3.5) * 1.02 * MM), z: (az + bz) / 2 })))));
  // the lights' pipes, just proud of the body's face
  leds.forEach((l, k) => g.add(rectBox({ x: x0 + t - 0.15 * MM, y: l, w: 1 * MM, h: 2.4 * MM }, lz0, lz1, k ? M.amber : M.green)));
  // the ground springs, bent out of the shield's sides and its outer face, pressing on the bracket's inside round its opening
  const sx = inX + 0.3 * MM, sw = 2 * MM;
  for (const zz of [z0 + h * 0.3, z0 + h * 0.72]) for (const [ya, yb] of [[y - 0.5 * MM, y], [y + w, y + w + 0.5 * MM]] as const) g.add(rectBox({ x: sx, y: ya, w: sw, h: yb - ya }, zz - 1.2 * MM, zz + 1.2 * MM, M.steel));
  for (const yy of [y + w * 0.3, y + w * 0.7]) g.add(rectBox({ x: sx, y: yy - 1.2 * MM, w: sw, h: 2.4 * MM }, z0 - 0.5 * MM, z0, M.steel));
  // the shield's stamping: two ribs pressed along its outer face, the folded seam down its back, a latch tab on each side
  for (const ry of [y + 3 * MM, y + w - 4.2 * MM]) g.add(rectBox({ x: x0 + 5 * MM, y: ry, w: d - 9 * MM, h: 1.2 * MM }, z0 - 0.18 * MM, z0, M.steel));
  g.add(rectBox({ x: x1, y: yc - 0.4 * MM, w: 0.15 * MM, h: 0.8 * MM }, z0 + 0.6 * MM, z1 - 0.6 * MM, M.back));
  for (const [ya, yb] of [[y - 0.2 * MM, y], [y + w, y + w + 0.2 * MM]] as const) g.add(rectBox({ x: x0 + 9 * MM, y: ya, w: 5 * MM, h: yb - ya }, z0 + 3 * MM, z0 + 6.5 * MM, M.steel));
}

/** The MAC label: a white sticker with its barcode and address. */
function macLabel(visual: string): ReturnType<typeof tex> {
  return tex(`nic-mac:${visual}`, 512, 160, (c, w, h) => {
    c.fillStyle = '#f2f2ee'; c.fillRect(0, 0, w, h);
    let s = visual.length * 7919;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    c.fillStyle = '#16181c';
    for (let x = 24; x < w - 24;) { const bw = 2 + Math.floor(rnd() * 3) * 2; if (rnd() > 0.45) c.fillRect(x, 16, bw, h * 0.5); x += bw + 2 + Math.floor(rnd() * 3) * 2; }
    c.font = '600 34px "Consolas", "DejaVu Sans Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(`MAC 00:1B:21:${(0x3a + visual.length).toString(16).toUpperCase()}:7C:${visual === 'nic-40g' ? 'E0' : '4F'}`, w / 2, h * 0.8);
  });
}

/** A SOIC-8 (the SPI flash) under the u-group's PCB at `zu`: its body, `x` and layout `y` its corner, four gull-wing legs on each long side. */
function soic8(u: Group, x: number, y: number, zu: number, lines: string[], tin: Material): void {
  const bw = 4.9 * MM, bh = 3.9 * MM, H = 1.45 * MM;
  pkg(u, { x, y: -(y + bh), w: bw, h: bh }, zu + 0.12 * MM, H - 0.12 * MM, lines);
  const legs: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  for (let k = 0; k < 4; k++) {
    const lx = x + bw / 2 + (k - 1.5) * 1.27 * MM;
    for (const s of [-1, 1]) {
      const edge = s < 0 ? y : y + bh;
      // out of the body at half height, down, and the foot on its pad
      legs.push({ x: lx, y: edge + s * 0.35 * MM, z: zu + 0.75 * MM, sx: 0.42 * MM, sy: 0.7 * MM, sz: 0.2 * MM });
      legs.push({ x: lx, y: edge + s * 0.7 * MM, z: zu + 0.45 * MM, sx: 0.42 * MM, sy: 0.2 * MM, sz: 0.62 * MM });
      legs.push({ x: lx, y: edge + s * 1.0 * MM, z: zu + 0.1 * MM, sx: 0.42 * MM, sy: 0.7 * MM, sz: 0.2 * MM });
    }
  }
  u.add(instanced(new BoxGeometry(1, 1, 1), tin, legs));
}

/** A polymer capacitor: an aluminium can in its sleeve on a black seat, the vent's cross pressed in its top; at layout (x, y), under the u-group's PCB. */
function polyCap(u: Group, x: number, y: number, zu: number, r: number, h: number, M: { seat: Material; sleeve: Material; can: Material; vent: Material }): void {
  u.add(rectBox({ x: x - r - 0.2 * MM, y: -(y + r + 0.2 * MM), w: 2 * r + 0.4 * MM, h: 2 * r + 0.4 * MM }, zu, zu + 0.5 * MM, M.seat));
  u.add(drum(x, -y, zu + 0.5 * MM, zu + h - 0.5 * MM, r, M.sleeve, 28), drum(x, -y, zu + h - 0.5 * MM, zu + h, r * 0.94, M.can, 28));
  u.add(instanced(new BoxGeometry(1, 1, 1), M.vent, [0, Math.PI / 2].map((rz) => ({ x, y, z: zu + h + 0.02 * MM, sx: r * 1.3, sy: 0.22 * MM, sz: 0.06 * MM, rz }))));
}

/**
 * Every part on the NIC's component side, under the PCB (`Zp` its underside): the jacks, the controller (with its sink), the crystal, the flash,
 * the regulator and its inductors and capacitors, the passives, the MAC label and the mask. `inX`: the bracket's inner face.
 */
export function nicParts(g: Group, visual: string, f: CardFrame, Zp: number, inX: number): void {
  const steel = mat(0x9ea5ae, { metalness: 0.8, roughness: 0.44 }), tin = mat(0xc4c9d0, { metalness: 0.9, roughness: 0.32 });
  const M: JackMats = {
    steel, plastic: mat(0x0f1013, { roughness: 0.62 }), back: mat(0x24262b, { roughness: 0.6 }), gold: springGold(),
    green: mat(0x2f8a52, { emissive: 0x5cff9a, emissiveIntensity: 0.55, roughness: 0.3 }), amber: mat(0x8a6420, { emissive: 0xffc247, emissiveIntensity: 0.4, roughness: 0.3 }),
  };
  const ys = jacksOf(visual, f.y0);
  for (const y of ys) jack(g, y, Zp, M, inX);
  // the rest stands on the underside: a group turned over (layout y as its y, depth off the PCB as its z)
  const u = new Group(), zu = -Zp, U = (r: RectLike): RectLike => ({ x: r.x, y: -(r.y + r.h), w: r.w, h: r.h });
  u.rotation.x = Math.PI;
  g.add(u);
  const C = CTRL[visual] ?? CTRL['nic-gbe']!, cs = C.chip * MM, ss = Math.max(C.sink * MM, cs), jx1 = JACK_X + JACK.d;
  const sx = jx1 + 11 * MM, cyc = f.y0 + 29 * MM, sy = cyc - ss / 2, chip = { x: sx + (ss - cs) / 2, y: cyc - cs / 2, w: cs, h: cs };
  const caps: Passive[] = [], parts: { r: RectLike; ref?: string }[] = [];
  if (!C.sink) {
    // a QFN: its body and the pads along its four edges at a 0.5 mm pitch
    pkg(u, U(chip), zu, 0.9 * MM, C.mark);
    const pads = [];
    for (let k = 0; k < 16; k++) {
      const o = (k - 7.5) * 0.5 * MM;
      pads.push({ x: chip.x + cs / 2 + o, y: chip.y - 0.12 * MM, z: zu + 0.1 * MM, sx: 0.25 * MM, sy: 0.3 * MM, sz: 0.2 * MM }, { x: chip.x + cs / 2 + o, y: chip.y + cs + 0.12 * MM, z: zu + 0.1 * MM, sx: 0.25 * MM, sy: 0.3 * MM, sz: 0.2 * MM });
      pads.push({ x: chip.x - 0.12 * MM, y: chip.y + cs / 2 + o, z: zu + 0.1 * MM, sx: 0.3 * MM, sy: 0.25 * MM, sz: 0.2 * MM }, { x: chip.x + cs + 0.12 * MM, y: chip.y + cs / 2 + o, z: zu + 0.1 * MM, sx: 0.3 * MM, sy: 0.25 * MM, sz: 0.2 * MM });
    }
    u.add(instanced(new BoxGeometry(1, 1, 1), tin, pads));
    caps.push(...passiveRow(chip.x - 1.5 * MM, chip.y + 1 * MM, 7, 1.1 * MM, '0402', 'cap', false, true), ...passiveRow(chip.x + 1 * MM, chip.y + cs + 1.5 * MM, 7, 1.1 * MM, '0402', 'cap', true));
  } else {
    // a lidded BGA under the sink: its base on a thermal pad, fins along the card, the push pins through two opposite corners
    pkg(u, U(chip), zu, 2.4 * MM, C.mark, { lid: true });
    const sinkM = mat(C.sinkHex, { metalness: C.sinkHex > 0x808080 ? 0.75 : 0.45, roughness: 0.4 }), b0 = zu + 2.7 * MM, b1 = b0 + 2.5 * MM;
    u.add(rectBox(U({ x: sx, y: sy, w: ss, h: ss }), b0, b1, sinkM));
    const pins = [[sx + 3 * MM, sy + 3 * MM], [sx + ss - 3 * MM, sy + ss - 3 * MM]] as const, fins = [];
    for (let y = sy + 1.2 * MM; y < sy + ss - 0.8 * MM; y += 2.6 * MM) {
      let a = sx, b = sx + ss;
      if (Math.abs(y - pins[0][1]) < 3 * MM) a = sx + 6.2 * MM;
      if (Math.abs(y - pins[1][1]) < 3 * MM) b = sx + ss - 6.2 * MM;
      fins.push({ x: (a + b) / 2, y, z: (b1 + zu + SINK_H) / 2, sx: b - a, sy: 0.9 * MM, sz: zu + SINK_H - b1 });
    }
    u.add(instanced(new BoxGeometry(1, 1, 1), sinkM, fins));
    const pinM = mat(C.pinHex, { roughness: 0.55 }), spring = mat(0xa9b0b9, { metalness: 0.85, roughness: 0.3 });
    for (const [px, py] of pins) {
      u.add(drum(px, -py, b1, b1 + 3.6 * MM, 1.1 * MM, pinM, 16), drum(px, -py, b1 + 3.6 * MM, b1 + 4.6 * MM, 2.3 * MM, pinM, 24));
      const coil: [number, number, number][] = [];
      for (let k = 0; k <= 72; k++) { const a = (k / 72) * Math.PI * 2 * 4; coil.push([px + Math.cos(a) * 1.6 * MM, py + Math.sin(a) * 1.6 * MM, b1 + 0.2 * MM + (k / 72) * 3.2 * MM]); }
      u.add(tube(coil, 0.18 * MM, spring, 6));
    }
    for (const s of [-1, 1]) caps.push(...passiveRow(sx + 4 * MM, s < 0 ? sy - 1.6 * MM : sy + ss + 1.6 * MM, 12, ss / 13, '0402', 'cap', true));
  }
  parts.push({ r: { x: sx, y: sy, w: ss, h: ss }, ref: 'U1' });
  // the crystal between the jacks and the controller, its two load capacitors beside it
  const xr = { x: jx1 + 3.5 * MM, y: cyc + 5 * MM, w: 3.2 * MM, h: 2.5 * MM };
  crystal(u, U(xr), zu, 0.8 * MM, '25.000');
  caps.push({ x: xr.x + 0.8 * MM, y: xr.y + xr.h + 1.4 * MM, pkg: '0402', kind: 'cap' }, { x: xr.x + 2.6 * MM, y: xr.y + xr.h + 1.4 * MM, pkg: '0402', kind: 'cap' });
  parts.push({ r: xr, ref: 'Y1' });
  // the flash, the core rail's regulator with its two inductors, the polymer capacitors past them
  const ex = sx + ss + 4 * MM;
  soic8(u, ex, f.y0 + 7 * MM, zu, ['25Q32JV', 'SIQ 2240'], tin);
  parts.push({ r: { x: ex, y: f.y0 + 7 * MM, w: 4.9 * MM, h: 3.9 * MM }, ref: 'U2' });
  const reg = { x: ex + 0.5 * MM, y: cyc - 1.5 * MM, w: 3 * MM, h: 3 * MM };
  pkg(u, U(reg), zu, 0.85 * MM, ['PL3A']);
  parts.push({ r: reg, ref: 'U3' });
  for (const [k, iy] of [[1, cyc - 9 * MM], [2, cyc + 4 * MM]] as const) {
    const ir = { x: ex + 5.5 * MM, y: iy, w: 4 * MM, h: 4 * MM };
    inductor(u, U(ir), zu, 2 * MM, k === 1 ? 'R47' : '1R0');
    parts.push({ r: ir, ref: `L${k}` });
  }
  const capMs = { seat: mat(0x101114, { roughness: 0.6 }), sleeve: mat(0x2b2350, { roughness: 0.45, metalness: 0.2 }), can: mat(0xc9ced5, { metalness: 0.85, roughness: 0.3 }), vent: mat(0x6c727b, { metalness: 0.6, roughness: 0.5 }) };
  const pc = ex + 13 * MM, pr = 2.5 * MM;
  [cyc - 12 * MM, cyc - 5.5 * MM, cyc + 1 * MM, cyc + 7.5 * MM].forEach((py, k) => { polyCap(u, pc, py, zu, pr, 5.8 * MM, capMs); parts.push({ r: { x: pc - pr, y: py - pr, w: 2 * pr, h: 2 * pr }, ref: `C${k + 11}` }); });
  // the passives: the regulator's ring, the bulk capacitors' column, the strap resistors
  caps.push(...passiveRow(ex + 0.5 * MM, cyc + 3 * MM, 3, 1.4 * MM, '0603', 'cap'), ...passiveRow(pc + 4.5 * MM, cyc - 12 * MM, 9, 2.4 * MM, '0805', 'cap', true, true));
  caps.push(...passiveRow(ex + 6 * MM, f.y0 + 7.5 * MM, 6, 1.1 * MM, '0402', 'res', true));
  passives(u, caps.map((p) => ({ ...p, y: -p.y })), zu);
  // the MAC label past the capacitors, and the mask with its silkscreen
  const label = { x: Math.min(pc + 9 * MM, f.x1 - 24 * MM), y: f.end - 14 * MM, w: 20 * MM, h: 6.2 * MM }, lt = macLabel(visual);
  if (lt) u.add(decal(U(label), zu + 0.15 * MM, decalMat(lt, { rough: 0.7 })));
  const speed = visual === 'nic-40g' ? '40G' : visual === 'nic-10g' ? '10G' : '1G';
  const text = [{ x: f.x1 - 26 * MM, y: f.y0 + 6 * MM, s: `PL-NIC ${speed} REV A2`, mm: 1.6 }, ...ys.map((y, k) => ({ x: jx1 + 1 * MM, y: y + JACK.w / 2, s: `LAN${k + 1}  LNK ACT`, mm: 1.1 }))];
  g.add(maskTop(`nic-under:${visual}`, { x: f.x0, y: f.y0, w: f.x1 - f.x0, h: f.end - f.y0 }, Zp, { mask: '#0f3a49', trace: '#185067', parts, text, seed: 31 + ys.length }, { under: true, px: 14 }));
}

/** The NIC's bracket, lying (`s` its plate): the plate with each jack's opening, a hair larger than its shield, and vent slots past them. */
export function nicBracket(visual: string, y0: number, Zp: number, x0: number, x1: number, s: Span, m: Material): ReturnType<typeof wallX> {
  const e = 0.4 * MM, ys = jacksOf(visual, y0), holes: (Span | Vector2[])[] = ys.map((y) => ({ y0: y - e, y1: y + JACK.w + e, z0: Zp - JACK.h - e, z1: Zp + e, r: 0.7 * MM }));
  for (let y = ys[ys.length - 1]! + JACK.w + 6 * MM; y < s.y1 - 120; y += 64) holes.push({ y0: y - 16, y1: y + 16, z0: s.z0 + 70, z1: s.z1 - 110, r: 14 });
  return wallX(x0, x1, s, holes, m);
}
