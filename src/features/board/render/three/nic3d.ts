// A network card's own parts as real ones (docs/PC_PARTS.md), in card3d's lying pose (gpu3d.ts's frame). A low-profile card with every part on
// its component side, under the PCB (standing, it faces down, as a GPU's cooler does). The RJ45 jacks with their magnetics through the bracket:
// a tin-plated steel shield with its ground springs against the bracket's inside, the mouth with its latch slot, the eight gold contacts inside
// at their 1.02 mm pitch, the link and activity lights either side of the latch slot. The controller east of them: a QFN on the gigabit card, a
// lidded BGA under a finned sink with its push pins on the faster cards (the fins run along the card, in the case's front-to-back air). Its 25 MHz
// crystal, the SPI flash on its gull-wing legs, the core rail's regulator with its inductors and polymer capacitors, the passives, the MAC
// label, and the solder mask with its traces and silkscreen.
import { BoxGeometry, Group, LatheGeometry, Vector2, type Material } from 'three';
import { drum, instanced, rectBox, tube, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { decal, outlinePts, tex, wallPt, wallX, type Span } from './casekit3d';
import { prismX, type CardFrame } from './gpu3d';
import { CU, JACK, JACK_X, jacksOf, type Face, type NicCopper } from './niccopper';
import { crystal, decalMat, inductor, maskTop, MM, passives, pkg, type MaskCopper, type Passive } from './pcbkit3d';
import { KEY, TAB } from './pcie';
import { springGold, unshadowed } from './rj45jack3d';

export { JACK, JACK_X, jacksOf };
/** The mouth (mm): 11.68 across, its opening 6.6 tall from 2.3 in from the jack's outer side, then the latch slot, 6.2 wide, 1.9 on toward the PCB. */
export const MOUTH = { w: 11.68 * MM, top: 2.3 * MM, main: 6.6 * MM, slotW: 6.2 * MM, slot: 1.9 * MM };
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

/**
 * A SOIC-8 (the SPI flash) under the u-group's PCB at `zu`, turned: its body over the layout rect `r` (pin 1 at its north-west), four gull-wing
 * legs down each of its west and east sides onto their pads.
 */
function soic8(u: Group, r: RectLike, zu: number, lines: string[], tin: Material): void {
  pkg(u, { x: r.x, y: -(r.y + r.h), w: r.w, h: r.h }, zu + 0.12 * MM, 1.33 * MM, lines);
  const legs: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  for (let k = 0; k < 4; k++) {
    const ly = r.y + r.h / 2 + (k - 1.5) * 1.27 * MM;
    for (const s of [-1, 1]) {
      const edge = s < 0 ? r.x : r.x + r.w;
      // out of the body at half height, down, and the foot on its pad
      legs.push({ x: edge + s * 0.35 * MM, y: ly, z: zu + 0.75 * MM, sx: 0.7 * MM, sy: 0.42 * MM, sz: 0.2 * MM });
      legs.push({ x: edge + s * 0.7 * MM, y: ly, z: zu + 0.45 * MM, sx: 0.2 * MM, sy: 0.42 * MM, sz: 0.62 * MM });
      legs.push({ x: edge + s * 1.0 * MM, y: ly, z: zu + 0.1 * MM, sx: 0.7 * MM, sy: 0.42 * MM, sz: 0.2 * MM });
    }
  }
  u.add(instanced(new BoxGeometry(1, 1, 1), tin, legs));
}

/** The card's mask and the copper under it (the face's own colour, its traces a shade lighter). */
const MASK = { mask: '#0f3a49', trace: '#185067' };
/** One face's copper (`nicCopper`) for its mask: the runs on it, every via and hole, the ground pour round the rest. */
const copperOf = (cu: NicCopper, face: Face): MaskCopper => ({
  traces: cu.traces.filter((t) => t.layer === face).map((t) => ({ pts: t.pts, w: t.w, gnd: t.net === 'GND' })),
  vias: cu.vias.map((v) => ({ x: v.x, y: v.y, gnd: v.net === 'GND' })),
  holes: cu.holes.map((h) => ({ x: h.x, y: h.y, square: h.square, gnd: h.net === 'GND', ring: h.ring, hole: h.drill })),
  npth: cu.npth,
  keep: cu.pads.filter((p) => p.face === face && p.net !== 'GND' && !p.edge).map((p) => p.r),
  fiducials: face === 'top' ? cu.fiducials.map(([x, y]) => ({ x, y, r: CU.fid })) : [],
  via: CU.via, drill: CU.drill, ring: CU.via, hole: CU.drill, pour: { clear: CU.pour, edge: CU.edge, round: 0 },
});

/**
 * The finger tab's face (`face` of it at depth z: the tab stands 1 unit thinner on the back than the PCB, so the fingers stand proud of it):
 * the gold fingers' lands, the runs from them up into the board, the key cut out. No pour: the fingers' strip is bare of ground.
 */
function tabMask(cu: NicCopper, f: CardFrame, face: Face, z: number): ReturnType<typeof maskTop> {
  const r = { x: cu.tab.x, y: f.y0 - TAB, w: cu.tab.w, h: TAB };
  return maskTop(`nic-tab-${face}:${cu.key}`, r, z, {
    ...MASK, seed: 0, pads: cu.pads.filter((p) => p.edge && p.face === face).map((p) => p.r), cuts: [{ rect: { x: cu.tab.x + KEY.at, y: r.y, w: KEY.w, h: TAB } }],
    copper: { traces: cu.traces.filter((t) => t.layer === face).map((t) => ({ pts: t.pts, w: t.w })), vias: [], via: CU.via, drill: CU.drill, ring: CU.via, hole: CU.drill },
  }, { under: face === 'top', px: 24 });
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
export function nicParts(g: Group, visual: string, f: CardFrame, Zp: number, inX: number, cu: NicCopper): void {
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
  const C = CTRL[visual] ?? CTRL['nic-gbe']!, a = cu.at, chip = a.chip, cs = chip.w, jx1 = JACK_X + JACK.d;
  const parts: { r: RectLike; ref?: string }[] = [{ r: chip, ref: 'U1' }];
  if (a.qfn) {
    // a QFN: its body and its terminals along its four edges at a 0.5 mm pitch, each over its pad
    pkg(u, U(chip), zu, 0.9 * MM, C.mark);
    const pads = [];
    for (let k = 0; k < 16; k++) {
      const o = (k - 7.5) * 0.5 * MM;
      pads.push({ x: chip.x + cs / 2 + o, y: chip.y - 0.12 * MM, z: zu + 0.1 * MM, sx: 0.25 * MM, sy: 0.3 * MM, sz: 0.2 * MM }, { x: chip.x + cs / 2 + o, y: chip.y + cs + 0.12 * MM, z: zu + 0.1 * MM, sx: 0.25 * MM, sy: 0.3 * MM, sz: 0.2 * MM });
      pads.push({ x: chip.x - 0.12 * MM, y: chip.y + cs / 2 + o, z: zu + 0.1 * MM, sx: 0.3 * MM, sy: 0.25 * MM, sz: 0.2 * MM }, { x: chip.x + cs + 0.12 * MM, y: chip.y + cs / 2 + o, z: zu + 0.1 * MM, sx: 0.3 * MM, sy: 0.25 * MM, sz: 0.2 * MM });
    }
    u.add(instanced(new BoxGeometry(1, 1, 1), tin, pads));
  } else {
    // a lidded BGA under the sink: its base on a thermal pad, fins along the card, the push pins through two opposite corners
    const { x: sx, y: sy, w: ss } = a.sink!;
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
  }
  // the crystal between the jacks and the controller, the flash east of it, the regulator (a dual buck) with its two inductors and the polymer
  // capacitors past them, each on its lands (`nicCopper`)
  crystal(u, U(a.crystal), zu, 0.8 * MM, '25.000');
  soic8(u, a.flash, zu, ['25Q32JV', 'SIQ 2240'], tin);
  pkg(u, U(a.reg), zu, 0.85 * MM, ['PL3A']);
  a.inductors.forEach((r, k) => inductor(u, U(r), zu, 2 * MM, k ? '1R0' : 'R47'));
  const capMs = { seat: mat(0x101114, { roughness: 0.6 }), sleeve: mat(0x2b2350, { roughness: 0.45, metalness: 0.2 }), can: mat(0xc9ced5, { metalness: 0.85, roughness: 0.3 }), vent: mat(0x6c727b, { metalness: 0.6, roughness: 0.5 }) };
  for (const c of a.cans) polyCap(u, c.x, c.y, zu, c.r, 5.8 * MM, capMs);
  parts.push({ r: a.crystal, ref: 'Y1' }, { r: a.flash, ref: 'U2' }, { r: a.reg, ref: 'U3' }, ...a.inductors.map((r, k) => ({ r, ref: `L${k + 1}` })), ...a.cans.map((c) => ({ r: { x: c.x - c.r, y: c.y - c.r, w: 2 * c.r, h: 2 * c.r }, ref: c.ref })));
  // the passives on this face: the crystal's load capacitors, the lights' resistors, the flash's and the regulator's capacitors, a BGA's row by
  // its sink
  passives(u, cu.parts.filter((p) => p.face === 'top').map((p): Passive => ({ x: p.x, y: -p.y, pkg: p.pkg, kind: p.kind, turn: p.turn })), zu);
  // the MAC label, and the mask over the copper with its silkscreen
  const lt = macLabel(visual);
  if (lt) u.add(decal(U(a.label), zu + 0.15 * MM, decalMat(lt, { rough: 0.7 })));
  const text = [{ x: f.x1 - 26 * MM, y: f.y0 + 6 * MM, s: `PL-NIC ${SPEED[visual] ?? '1G'} REV A2`, mm: 1.6 }, ...ys.map((y, k) => ({ x: jx1 + 1 * MM, y: y + JACK.w / 2, s: `LAN${k + 1}  LNK ACT`, mm: 1.1 }))];
  const f1 = cu.pads.find((p) => p.id === 'U2.1')!, dots = [{ x: f1.r.x - 0.5 * MM, y: f1.r.y - 0.4 * MM, r: 0.25 * MM }];
  if (a.qfn) dots.push({ x: chip.x - 0.9 * MM, y: chip.y - 0.9 * MM, r: 0.25 * MM });
  const board = { x: f.x0, y: f.y0, w: f.x1 - f.x0, h: f.end - f.y0 };
  g.add(maskTop(`nic-under:${cu.key}`, board, Zp, { ...MASK, parts, text, seed: 0, copper: { ...copperOf(cu, 'top'), dots }, pads: cu.pads.filter((p) => p.face === 'top' && !p.edge).map((p) => p.r) }, { under: true, px: 24 }));
  g.add(tabMask(cu, f, 'top', Zp));
}

/** Each card's speed, on its silkscreen. */
const SPEED: Record<string, string> = { 'nic-gbe': '1G', 'nic-10g': '10G', 'nic-40g': '40G' };

/** The serial label on the back: a white sticker with its barcode, the serial number and the part number. */
function serialLabel(visual: string): ReturnType<typeof tex> {
  return tex(`nic-sn:${visual}`, 640, 220, (c, w, h) => {
    c.fillStyle = '#efefea'; c.fillRect(0, 0, w, h);
    let s = visual.length * 104729;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    c.fillStyle = '#16181c';
    for (let x = 28; x < w - 28;) { const bw = 2 + Math.floor(rnd() * 3) * 2; if (rnd() > 0.45) c.fillRect(x, 70, bw, h * 0.36); x += bw + 2 + Math.floor(rnd() * 3) * 2; }
    c.font = '600 30px "Consolas", "DejaVu Sans Mono", monospace'; c.textBaseline = 'middle';
    c.fillText(`PL-NIC-${SPEED[visual] ?? '1G'}  P/N 9C${visual.length}41-A2`, 28, 36);
    c.fillText(`S/N PLN${(SPEED[visual] ?? '1G').padStart(3, '0')}2244A0${1700 + visual.length * 13}`, 28, h - 34);
  });
}

/**
 * The NIC's back (its solder side, the top face lying, at Z): the mask over its copper (the transmit pairs' capacitors by the fingers, the jacks'
 * centre taps', a BGA's decoupling field under it, the ground pour and its stitching), the passives on it, the solder joints over every
 * through-hole pin, the jacks' plastic pegs and the sink's push pins through their holes, the serial label and the silkscreen.
 */
export function nicBack(g: Group, visual: string, f: CardFrame, Z: number, cu: NicCopper): void {
  const a = cu.at, L = f.x1 - f.x0, sp = SPEED[visual] ?? '1G', s = a.serial;
  const text = [
    { x: s.x, y: f.end - 11 * MM, s: `PL-NIC ${sp}  REV A2`, mm: 1.8 },
    { x: s.x, y: f.end - 7.6 * MM, s: '94V-0   E224410   2244', mm: 1.1 },
    { x: s.x, y: f.end - 4.6 * MM, s: 'CE   FCC   RoHS', mm: 1.3 },
    { x: f.x0 + 2.5 * MM, y: f.end - 3.5 * MM, s: `PCB-NIC${sp}-4L`, mm: 0.9 },
  ];
  const board = { x: f.x0, y: f.y0, w: L, h: f.end - f.y0 };
  g.add(maskTop(`nic-back:${cu.key}`, board, Z, { ...MASK, text, seed: 0, copper: copperOf(cu, 'bottom'), pads: cu.pads.filter((p) => p.face === 'bottom' && !p.edge).map((p) => p.r) }, { px: 24 }));
  g.add(tabMask(cu, f, 'bottom', Z - 1));
  passives(g, cu.parts.filter((p) => p.face === 'bottom').map((p): Passive => ({ x: p.x, y: p.y, pkg: p.pkg, kind: p.kind, turn: p.turn })), Z);
  // the through-hole pins' tails cut short in their solder: a fillet over each ring climbing to its rounded tip (tpm3d's), sized to the ring
  const joint = new LatheGeometry([[15, 0], [13, 1], [10.6, 2.6], [9, 4.6], [8, 7.2], [7.4, 10.5], [7.2, 15], [6.6, 18], [5, 20], [2.6, 21], [0, 21.3]].map(([r, z]) => new Vector2(r, z)), 20).rotateX(Math.PI / 2);
  g.add(instanced(joint, mat(0xb9bec6, { metalness: 0.92, roughness: 0.22 }), cu.holes.map((h) => ({ x: h.x, y: -h.y, z: Z, sx: h.ring / 16, sy: h.ring / 16 }))));
  // the jacks' plastic pegs, split, just through the board; a BGA's push pins' barbed tips, split, through the sink's corners
  const C = CTRL[visual] ?? CTRL['nic-gbe']!, peg = mat(0x121316, { roughness: 0.6 }), slit = mat(0x050506, { roughness: 0.9 });
  const sinkPins = a.sink ? cu.npth.slice(-2) : [];
  for (const h of cu.npth) {
    const pin = sinkPins.includes(h), m = pin ? mat(C.pinHex, { roughness: 0.55 }) : peg, r = h.r - 0.15 * MM, t = (pin ? 1.2 : 0.8) * MM;
    g.add(drum(h.x, h.y, Z, Z + t, r, m, 20));
    if (pin) g.add(drum(h.x, h.y, Z + t, Z + t + 0.4 * MM, r * 0.75, m, 20));
    g.add(rectBox({ x: h.x - r - 0.05 * MM, y: h.y - 0.2 * MM, w: 2 * r + 0.1 * MM, h: 0.4 * MM }, Z + 0.2 * MM, Z + t + (pin ? 0.45 : 0.05) * MM, slit));
  }
  const st = serialLabel(visual);
  if (st) g.add(decal(s, Z + 0.15 * MM, decalMat(st, { rough: 0.7 })));
}

/** The NIC's bracket, lying (`s` its plate): the plate with each jack's opening, a hair larger than its shield, and vent slots past them. */
export function nicBracket(visual: string, y0: number, Zp: number, x0: number, x1: number, s: Span, m: Material): ReturnType<typeof wallX> {
  const e = 0.4 * MM, ys = jacksOf(visual, y0), holes: (Span | Vector2[])[] = ys.map((y) => ({ y0: y - e, y1: y + JACK.w + e, z0: Zp - JACK.h - e, z1: Zp + e, r: 0.7 * MM }));
  for (let y = ys[ys.length - 1]! + JACK.w + 6 * MM; y < s.y1 - 120; y += 64) holes.push({ y0: y - 16, y1: y + 16, z0: s.z0 + 70, z1: s.z1 - 110, r: 14 });
  return wallX(x0, x1, s, holes, m);
}
