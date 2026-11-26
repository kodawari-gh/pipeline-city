// A network card's own parts as real ones (docs/PC_PARTS.md), in card3d's lying pose (gpu3d.ts's frame), face up. A card as the photos of real ones show it, with its parts on the PCB's top face
// (standing in its slot, that face looks north, toward the camera and the glass: the mirror of a tower's card, whose parts face down). The RJ45 jacks with their magnetics stand on that face at
// the bracket, so the PCB is below the ports: a tin-plated steel shield with its ground springs against the bracket's inside, the mouth with its latch slot, the eight gold contacts inside
// at their 1.02 mm pitch, the link and activity lights either side of the latch slot. The 40G card has two QSFP+ cages in their place (qsfp3d.ts: the cage, the 38 contacts, a light block on top). The controller east of them: a QFN on the gigabit card, a
// lidded BGA under a low finned sink with its push pins on the faster cards (the fins run along the card, in the case's front-to-back air). Its 25 MHz
// crystal, the SPI flash on its gull-wing legs, the core rail's regulator with its inductors and polymer capacitors, the passives, the MAC
// label, and the solder mask with its traces and silkscreen. East of the jacks nothing on this face stands over `NIC_TOP`: the card in the next slot north has its cooler 5 mm from it, and
// its cooler starts east of the jacks (`COOLER_FROM`, `fit.test.ts`).
// Close up the card folds down flat (card3d.ts) and shows these parts up; the ones a pointer can
// meet are groups tagged `<slot>.nic-<part>` (`jack ctl xtal nvm vreg label`, with their footprints in `NicOut.bodies`); the controller's die wears the floorplan (nicchip3d.ts).
// The underside (`nicBack`) is the solder side: its mask, the serial label, the jacks' pegs and the tails of their pins in solder, and the sink's pins' tips.
import { BoxGeometry, CatmullRomCurve3, Group, LatheGeometry, Mesh, TubeGeometry, Vector2, Vector3 } from 'three';
import type * as threeTypes from 'three';
import { drawLockup } from '@/core/render/brands';
import { macOf } from '@/features/network/render/nic/nicmac';
import { drum, instanced, rectBox, SEG, tube, withLow } from '@/core/render/three/geometry';
import type * as geometryTypes from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { tag } from '@/core/render/three/pick';
import { decal, outlinePts, tex, wallPt, wallX } from './casekit3d';
import type * as casekit3dTypes from './casekit3d';
import { prismX } from './gpu3d';
import type * as gpu3dTypes from './gpu3d';
import { mirror, nicChip } from './nicchip3d';
import type * as nicchip3dTypes from './nicchip3d';
import { CAGE, CU, JACK, JACK_X, jackOf, jacksOf } from './niccopper';
import type * as niccopperTypes from './niccopper';
import { crystal, decalMat, inductor, maskTop, MM, passives, pkg } from './pcbkit3d';
import type * as pcbkit3dTypes from './pcbkit3d';
import { KEY, TAB } from './pcie';
import { QSFP, qsfpFace, qsfpLamps, qsfpLook } from './qsfp3d';
import type * as qsfp3dTypes from './qsfp3d';
import { jackLamp, springGold, unshadowed } from './rj45jack3d';
import type * as rj45jack3dTypes from './rj45jack3d';

export { CAGE, JACK, JACK_X, jackOf, jacksOf };
/** The mouth (mm): 11.68 across, its opening 6.6 tall from 2.3 up off the PCB's top face, then the latch slot, 6.2 wide, 1.9 on away from the PCB. */
export const MOUTH = { w: 11.68 * MM, base: 2.3 * MM, main: 6.6 * MM, slotW: 6.2 * MM, slot: 1.9 * MM };
/**
 * The middle of a port's opening, lying: across it (y) and off the PCB (z, `Z` the PCB's top face the port stands on), for the port whose edge is at `y`. The RJ45 jack's mouth stands 2.3 mm
 * up; the 40G card's QSFP+ cage (`visual` `nic-40g`) has its mouth in the middle of its 10 mm.
 */
export const mouthAt = (y: number, Z: number, visual = '') =>
  visual === 'nic-40g'
    ? { y: y + CAGE.w / 2, z: Z + (QSFP.cage.h * MM) / 2 }
    : { y: y + JACK.w / 2, z: Z + MOUTH.base + MOUTH.main / 2 };

/** Each card's controller (its package's side, mm), its sink (0: none, as on a real gigabit card), the sink's and the push pins' finish, its marking. */
const CTRL: Record<string, { chip: number; sink: number; sinkHex: number; pinHex: number; mark: string[] }> = {
  'nic-gbe': { chip: 9, sink: 0, sinkHex: 0, pinHex: 0, mark: ['RL-N210', 'GBE Q9A2', '2241'] },
  'nic-10g': { chip: 25, sink: 40, sinkHex: 0xb9_c0_c8, pinHex: 0xe6_e4_dc, mark: ['RL-N510', '10GBASE-T', 'A1 2244'] },
  'nic-40g': { chip: 25, sink: 45, sinkHex: 0x24_27_2d, pinHex: 0x1a_1c_20, mark: ['RL-N740', '40GBASE-R', 'B0 2251'] },
};
/** How far the tallest part on the top face stands off the PCB (the sink's top): the card in the next slot north has its cooler this close (`card3d.ts` `cardReach`). */
export const NIC_TOP = 4.3 * MM;
/** The sink's height off the PCB: a lid's 2.4 mm, a plate on it, the fins on that. */
const SINK_H = NIC_TOP;
/** The polymer capacitors' height: the low-profile cans of a regulator. */
const CAN_H = 4 * MM;

/**
 * A solder joint: the fillet from the pad up to the tail's rounded tip (tpm3d's), lathed on `SEG.joint` sides. Its profile is sampled to
 * `SEG.jointRings` bands (the base and the tip kept), so the outer size stays the same. Its lower level (LOD-05): one band, the same base
 * and tip, so the same outer size.
 */
export function solderFillet(): LatheGeometry {
  const P: [number, number][] = [
    [15, 0],
    [13, 1],
    [10.6, 2.6],
    [9, 4.6],
    [8, 7.2],
    [7.4, 10.5],
    [7.2, 15],
    [6.6, 18],
    [5, 20],
    [2.6, 21],
    [0, 21.3],
  ];
  const last = P.length - 1;
  const lathe = (rings: number) =>
    new LatheGeometry(
      Array.from({ length: rings + 1 }, (_, k) => P[Math.round((k * last) / rings)]!).map(
        ([r, z]) => new Vector2(r, z),
      ),
      SEG.joint,
    ).rotateX(Math.PI / 2);
  return withLow(lathe(SEG.jointRings), () => lathe(SEG.jointRingsLow));
}

/** A span of a wall across x as its outline (`wallPt` points). */
const spanPts = (s: casekit3dTypes.Span): Vector2[] =>
  outlinePts({ x: s.z0, y: s.y0, w: s.z1 - s.z0, h: s.y1 - s.y0 }, s.r ?? 0);

/** The mouth's outline (`wallPt` points), grown by `e`: the opening, the latch slot on toward the PCB. */
function mouthPts(yc: number, zt: number, e: number): Vector2[] {
  const { w, main, slotW, slot } = MOUTH,
    zm = zt + main,
    zs = zm + slot;
  return [
    wallPt(yc - w / 2 - e, zt - e),
    wallPt(yc + w / 2 + e, zt - e),
    wallPt(yc + w / 2 + e, zm + e),
    wallPt(yc + slotW / 2 + e, zm + e),
    wallPt(yc + slotW / 2 + e, zs + e),
    wallPt(yc - slotW / 2 - e, zs + e),
    wallPt(yc - slotW / 2 - e, zm + e),
    wallPt(yc - w / 2 - e, zm + e),
  ];
}

interface JackMats {
  steel: threeTypes.Material;
  plastic: threeTypes.Material;
  back: threeTypes.Material;
  gold: threeTypes.Material;
  green: threeTypes.MeshStandardMaterial;
  amber: threeTypes.MeshStandardMaterial;
}

/**
 * One RJ45 jack on the PCB (its edge at lying `y`, its base on the top face `Z`, tab up), its front at `JACK_X`: the shield (its front plate with
 * the mouth's and the lights' windows, its walls, its back), the plastic body round the mouth, the insulator at the mouth's end, the contacts, the
 * lights, and the ground springs just inside the bracket (`inX`, its inner face).
 */
function jack(g: Group, y: number, Z: number, M: JackMats, inX: number): void {
  const { w, h, d } = JACK,
    x0 = JACK_X,
    x1 = x0 + d,
    z0 = Z,
    z1 = Z + h,
    t = 0.3 * MM,
    yc = y + w / 2,
    zt = z0 + MOUTH.base,
    zm = zt + MOUTH.main;
  const outer = spanPts({ y0: y, y1: y + w, z0, z1, r: 0.5 * MM }),
    inner = spanPts({ y0: y + t, y1: y + w - t, z0: z0 + t, z1: z1 - t });
  // the lights' windows either side of the latch slot, clear of the mouth's opening (cut holes that touch break the plate's faces)
  const lz0 = zm + 1.1 * MM,
    lz1 = zm + 2.9 * MM;
  const leds = [y + 0.9 * MM, y + w - 3.3 * MM],
    led = (ly: number, e: number) =>
      spanPts({ y0: ly - e, y1: ly + 2.4 * MM + e, z0: lz0 - e, z1: lz1 + e, r: 0.3 * MM });
  g.add(prismX(x0, x0 + t, outer, [mouthPts(yc, zt, 0.5 * MM), ...leds.map((l) => led(l, 0.25 * MM))], M.steel));
  g.add(prismX(x0 + t, x1, outer, [inner], M.steel));
  g.add(rectBox({ x: x1 - t, y: y + t, w: t, h: w - 2 * t }, z0 + t, z1 - t, M.steel));
  // (the mouth's inside takes no shadow: deep in it the shadow map would only hide the contacts in its acne, as rj45jack3d's)
  const deep = x0 + 15 * MM;
  g.add(unshadowed(prismX(x0 + t, deep, inner, [mouthPts(yc, zt, 0)], M.plastic)));
  g.add(unshadowed(rectBox({ x: deep, y: y + t, w: x1 - t - deep, h: w - 2 * t }, z0 + t, z1 - t, M.back)));
  // the contacts: spring wires from the mouth's outer edge, sloping in toward the PCB side as they run back
  const ax = x0 + 2.5 * MM,
    bx = x0 + 13 * MM,
    az = zt + 0.45 * MM,
    bz = zt + 2.6 * MM,
    len = Math.hypot(bx - ax, bz - az);
  const wire = new BoxGeometry(len, 0.4 * MM, 0.25 * MM).rotateY(-Math.asin((bz - az) / len));
  g.add(
    unshadowed(
      instanced(
        wire,
        M.gold,
        Array.from({ length: 8 }, (_, k) => ({ x: (ax + bx) / 2, y: -(yc + (k - 3.5) * 1.02 * MM), z: (az + bz) / 2 })),
      ),
    ),
  );
  // the lights' pipes, just proud of the body's face
  leds.forEach((l, k) =>
    g.add(rectBox({ x: x0 + t - 0.15 * MM, y: l, w: MM, h: 2.4 * MM }, lz0, lz1, k ? M.amber : M.green)),
  );
  // the ground springs, bent out of the shield's sides and its outer face, pressing on the bracket's inside round its opening
  const sx = inX + 0.3 * MM,
    sw = 2 * MM;
  for (const zz of [z0 + h * 0.3, z0 + h * 0.72]) {
    for (const [ya, yb] of [
      [y - 0.5 * MM, y],
      [y + w, y + w + 0.5 * MM],
    ] as const) {
      g.add(rectBox({ x: sx, y: ya, w: sw, h: yb - ya }, zz - 1.2 * MM, zz + 1.2 * MM, M.steel));
    }
  }
  for (const yy of [y + w * 0.3, y + w * 0.7]) {
    g.add(rectBox({ x: sx, y: yy - 1.2 * MM, w: sw, h: 2.4 * MM }, z1, z1 + 0.5 * MM, M.steel));
  }
  // the shield's stamping: two ribs pressed along its outer face, the folded seam down its back, a latch tab on each side
  for (const ry of [y + 3 * MM, y + w - 4.2 * MM]) {
    g.add(rectBox({ x: x0 + 5 * MM, y: ry, w: d - 9 * MM, h: 1.2 * MM }, z1, z1 + 0.18 * MM, M.steel));
  }
  g.add(rectBox({ x: x1, y: yc - 0.4 * MM, w: 0.15 * MM, h: 0.8 * MM }, z0 + 0.6 * MM, z1 - 0.6 * MM, M.back));
  for (const [ya, yb] of [
    [y - 0.2 * MM, y],
    [y + w, y + w + 0.2 * MM],
  ] as const) {
    g.add(rectBox({ x: x0 + 9 * MM, y: ya, w: 5 * MM, h: yb - ya }, z0 + 3 * MM, z0 + 6.5 * MM, M.steel));
  }
}

/**
 * One QSFP+ cage on the PCB (its edge at lying `y`, its base on the top face `Z`), its front at `JACK_X`: the cage (qsfp3d.ts `qsfpFace`: the face plate with its mouth, the walls, the connector at the
 * back), the light pipe's block on it with the port's two lights (`lamps`), and the ground springs bent out of its sides, pressing on the bracket's inside (`inX`, its inner face).
 */
function cage(
  g: Group,
  y: number,
  Z: number,
  Q: qsfp3dTypes.QsfpLook,
  steel: threeTypes.Material,
  lamps: rj45jack3dTypes.JackLamps,
  inX: number,
): void {
  const { w } = CAGE,
    h = QSFP.cage.h * MM,
    span: casekit3dTypes.Span = { y0: y, y1: y + w, z0: Z, z1: Z + h };
  qsfpFace(g, JACK_X, span, CAGE.d, Q);
  qsfpLamps(g, JACK_X, span, 'z', lamps, Q, true);
  const sx = inX + 0.3 * MM,
    sw = 2 * MM;
  for (const zz of [Z + h * 0.3, Z + h * 0.72]) {
    for (const [ya, yb] of [
      [y - 0.5 * MM, y],
      [y + w, y + w + 0.5 * MM],
    ] as const) {
      g.add(rectBox({ x: sx, y: ya, w: sw, h: yb - ya }, zz - 1.2 * MM, zz + 1.2 * MM, steel));
    }
  }
}

/** The MAC label: a white sticker with its barcode and address. */
function macLabel(visual: string): ReturnType<typeof tex> {
  return tex(`nic-mac:${visual}`, 512, 160, (c, w, h) => {
    c.fillStyle = '#f2f2ee';
    c.fillRect(0, 0, w, h);
    let s = visual.length * 7919;
    const rnd = () => (s = (s * 16_807) % 2_147_483_647) / 2_147_483_647;
    c.fillStyle = '#16181c';
    for (let x = 24; x < w - 24;) {
      const bw = 2 + Math.floor(rnd() * 3) * 2;
      if (rnd() > 0.45) {
        c.fillRect(x, 16, bw, h * 0.5);
      }
      x += bw + 2 + Math.floor(rnd() * 3) * 2;
    }
    c.font = '600 34px "Consolas", "DejaVu Sans Mono", monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(`MAC ${macOf(visual)}`, w / 2, h * 0.8);
  });
}

/**
 * A SOIC-8 (the SPI flash) on the PCB's face at `z`: its body over the layout rect `r` (pin 1 at its north-west), four gull-wing
 * legs down each of its west and east sides onto their pads.
 */
function soic8(g: Group, r: geometryTypes.RectLike, z: number, lines: string[], tin: threeTypes.Material): void {
  pkg(g, r, z + 0.12 * MM, 1.33 * MM, lines);
  const legs: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  for (let k = 0; k < 4; k++) {
    const ly = -(r.y + r.h / 2 + (k - 1.5) * 1.27 * MM);
    for (const s of [-1, 1]) {
      const edge = s < 0 ? r.x : r.x + r.w;
      // out of the body at half height, down, and the foot on its pad
      legs.push({ x: edge + s * 0.35 * MM, y: ly, z: z + 0.75 * MM, sx: 0.7 * MM, sy: 0.42 * MM, sz: 0.2 * MM });
      legs.push({ x: edge + s * 0.7 * MM, y: ly, z: z + 0.45 * MM, sx: 0.2 * MM, sy: 0.42 * MM, sz: 0.62 * MM });
      legs.push({ x: edge + s * MM, y: ly, z: z + 0.1 * MM, sx: 0.7 * MM, sy: 0.42 * MM, sz: 0.2 * MM });
    }
  }
  g.add(instanced(new BoxGeometry(1, 1, 1), tin, legs));
}

/** The card's mask and the copper under it (the face's own colour, its traces a shade lighter). */
const MASK = { mask: '#0f3a49', trace: '#185067' };
/** One face's copper (`nicCopper`) for its mask: the runs on it, every via and hole, the ground pour round the rest. */
const copperOf = (cu: niccopperTypes.NicCopper, face: niccopperTypes.Face): pcbkit3dTypes.MaskCopper => ({
  traces: cu.traces.filter((t) => t.layer === face).map((t) => ({ pts: t.pts, w: t.w, gnd: t.net === 'GND' })),
  vias: cu.vias.map((v) => ({ x: v.x, y: v.y, gnd: v.net === 'GND' })),
  holes: cu.holes.map((h) => ({ x: h.x, y: h.y, square: h.square, gnd: h.net === 'GND', ring: h.ring, hole: h.drill })),
  npth: cu.npth,
  keep: cu.pads.filter((p) => p.face === face && p.net !== 'GND' && !p.edge).map((p) => p.r),
  fiducials: face === 'top' ? cu.fiducials.map(([x, y]) => ({ x, y, r: CU.fid })) : [],
  via: CU.via,
  drill: CU.drill,
  ring: CU.via,
  hole: CU.drill,
  pour: { clear: CU.pour, edge: CU.edge, round: 0 },
});

/**
 * The finger tab's face (`face` of it at depth z: the tab stands 1 unit thinner on the top than the PCB, so the fingers stand proud of it):
 * the gold fingers' lands, the runs from them up into the board, the key cut out. No pour: the fingers' strip is bare of ground.
 */
function tabMask(
  cu: niccopperTypes.NicCopper,
  f: gpu3dTypes.CardFrame,
  face: niccopperTypes.Face,
  z: number,
): ReturnType<typeof maskTop> {
  const r = { x: cu.tab.x, y: f.y0 - TAB, w: cu.tab.w, h: TAB };
  return maskTop(
    `nic-tab-${face}:${cu.key}`,
    r,
    z,
    {
      ...MASK,
      seed: 0,
      pads: cu.pads.filter((p) => p.edge && p.face === face).map((p) => p.r),
      cuts: [{ rect: { x: cu.tab.x + KEY.at, y: r.y, w: KEY.w, h: TAB } }],
      copper: {
        traces: cu.traces.filter((t) => t.layer === face).map((t) => ({ pts: t.pts, w: t.w })),
        vias: [],
        via: CU.via,
        drill: CU.drill,
        ring: CU.via,
        hole: CU.drill,
      },
    },
    { under: face === 'bottom', px: 24 },
  );
}

/** A polymer capacitor: an aluminium can in its sleeve on a black seat, the vent's cross pressed in its top; at layout (x, y), on the PCB's face at `z`. */
function polyCap(
  g: Group,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  M: { seat: threeTypes.Material; sleeve: threeTypes.Material; can: threeTypes.Material; vent: threeTypes.Material },
): void {
  g.add(
    rectBox(
      { x: x - r - 0.2 * MM, y: y - r - 0.2 * MM, w: 2 * r + 0.4 * MM, h: 2 * r + 0.4 * MM },
      z,
      z + 0.5 * MM,
      M.seat,
    ),
  );
  g.add(
    drum(x, y, z + 0.5 * MM, z + h - 0.5 * MM, r, M.sleeve, SEG.canister),
    drum(x, y, z + h - 0.5 * MM, z + h, r * 0.94, M.can, SEG.canister),
  );
  g.add(
    instanced(
      new BoxGeometry(1, 1, 1),
      M.vent,
      [0, Math.PI / 2].map((rz) => ({ x, y: -y, z: z + h + 0.02 * MM, sx: r * 1.3, sy: 0.22 * MM, sz: 0.06 * MM, rz })),
    ),
  );
}

/** A pin's spring coil: four turns of wire round the pin at (px, py), from height `b1` up `rise` (3.2 mm). Its lower level: fewer steps and sides (LOD-05). */
export function pinCoil(px: number, py: number, b1: number, m: threeTypes.Material, rise = 3.2 * MM): Mesh {
  const coil: [number, number, number][] = [];
  for (let k = 0; k <= 72; k++) {
    const a = (k / 72) * Math.PI * 2 * 4;
    coil.push([px + Math.cos(a) * 1.6 * MM, py + Math.sin(a) * 1.6 * MM, b1 + 0.2 * MM + (k / 72) * rise]);
  }
  const o = tube(coil, 0.18 * MM, m, SEG.cord),
    curve = new CatmullRomCurve3(
      coil.map((p) => new Vector3(p[0], p[1], p[2])),
      false,
      'centripetal',
    );
  withLow(o.geometry, () => new TubeGeometry(curve, SEG.coilStepsLow, 0.18 * MM, SEG.coilSidesLow));
  return o;
}

/** A body of the card the player can point at (`NicOut.bodies`): its id (`pcie2.nic-xtal`), its footprint (layout, as the card is built and lies flat) and how tall it stands off the PCB's top face. */
interface NicBody {
  id: string;
  rect: geometryTypes.RectLike;
  h: number;
}

export interface NicOut {
  /** The first jack's two lights (the network's: `network/render/jackleds.ts`). */
  lamps: rj45jack3dTypes.JackLamps;
  /** The controller's chip: its lid's fade, its die's face (its rectangle in layout, as the card is built). */
  chip: nicchip3dTypes.NicChip;
  bodies: NicBody[];
  /** The top face's group (the card's own frame: layout y as the negative of its y, depth up off the PCB, the mask's face at `Z`): the card's lit copper goes in a frame in it (card3d.ts). */
  top: Group;
}

/** What a card's parts need to be told: its slot (the ids of its parts), the rectangle its die's plan covers in the die's frame, and how to put the floorplan on the die (none: a plain chip). */
export interface NicBuild {
  slot: string;
  plan: geometryTypes.RectLike;
  floor?: nicchip3dTypes.DieFloor;
}

/** The rectangle round some rectangles. */
const hull = (rs: readonly geometryTypes.RectLike[]): geometryTypes.RectLike => {
  const x0 = Math.min(...rs.map((r) => r.x)),
    y0 = Math.min(...rs.map((r) => r.y)),
    x1 = Math.max(...rs.map((r) => r.x + r.w)),
    y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/**
 * Every part of the NIC but its solder side (`nicBack`): on the PCB's top face (`Z`) the jacks, the controller (with its sink), the crystal, the flash, the regulator and its inductors and
 * capacitors, the passives, the MAC label and the mask. `inX`: the bracket's inner face. The jacks, the controller, the crystal, the flash, the regulator and the label are each a group
 * tagged with its part's id (`<slot>.nic-<part>`), so a pick finds it; the controller's cap or lid, and the sink on it, fade away (`NicOut.chip.lod`) as the die under them shows its floorplan.
 */
export function nicParts(
  g: Group,
  visual: string,
  f: gpu3dTypes.CardFrame,
  Z: number,
  inX: number,
  cu: niccopperTypes.NicCopper,
  b: NicBuild,
): NicOut {
  const steel = mat(0x95_9a_a3, { metalness: 0.8, roughness: 0.44 }),
    tin = mat(0xb9_ba_bf, { metalness: 0.9, roughness: 0.32 });
  const M: JackMats = {
    steel,
    plastic: mat(0x13_15_18, { roughness: 0.62 }),
    back: mat(0x2a_2d_32, { roughness: 0.6 }),
    gold: springGold(),
    green: jackLamp(0x5c_ff_9a),
    amber: jackLamp(0xff_c2_47),
  };
  const id = (part: string) => `${b.slot}.nic-${part}`;
  // (the lights are the network's: out until it lights them. The cable goes into the first port, so a second one (the 40G card's) has dark lenses and no lamp)
  const dark = mat(0x13_15_18, { roughness: 0.3 }),
    ys = jacksOf(visual, f.y0),
    spare: JackMats = { ...M, green: dark, amber: dark },
    P = jackOf(visual);
  const jacks = tag(new Group(), id('jack'));
  if (visual === 'nic-40g') {
    // (the 40G card's ports are QSFP+ cages: the plug is the end of a 40GBASE-CR4 lead, not an RJ45)
    const Q = qsfpLook(steel),
      off: rj45jack3dTypes.JackLamps = { link: dark, act: dark };
    ys.forEach((y, k) => cage(jacks, y, Z, Q, steel, k ? off : { link: M.green, act: M.amber }, inX));
  } else {
    ys.forEach((y, k) => jack(jacks, y, Z, k ? spare : M, inX));
  }
  g.add(jacks);
  // the rest stands on the top face too: a group in the card's own frame (layout y as the negative of its y, depth up off the PCB's top, `Z`)
  const top = new Group(),
    zu = Z;
  g.add(top);
  const C = CTRL[visual] ?? CTRL['nic-gbe']!,
    a = cu.at,
    { chip } = a,
    cs = chip.w;
  const parts: { r: geometryTypes.RectLike; ref?: string }[] = [{ r: chip, ref: 'U1' }];
  // the controller: its die and its lid (nicchip3d.ts); a QFN's terminals along its four edges at a 0.5 mm pitch, each over its pad, or a BGA's sink with its fins and push pins
  const ctl = tag(new Group(), id('ctl')),
    made = nicChip(ctl, mirror(chip), a.qfn, zu, C.mark, mirror, b.plan, b.floor),
    core: nicchip3dTypes.NicChip = { ...made, rect: mirror(made.rect) };
  top.add(ctl);
  if (a.qfn) {
    const pads = [];
    for (let k = 0; k < 16; k++) {
      const o = (k - 7.5) * 0.5 * MM;
      pads.push(
        {
          x: chip.x + cs / 2 + o,
          y: -(chip.y - 0.12 * MM),
          z: zu + 0.1 * MM,
          sx: 0.25 * MM,
          sy: 0.3 * MM,
          sz: 0.2 * MM,
        },
        {
          x: chip.x + cs / 2 + o,
          y: -(chip.y + cs + 0.12 * MM),
          z: zu + 0.1 * MM,
          sx: 0.25 * MM,
          sy: 0.3 * MM,
          sz: 0.2 * MM,
        },
      );
      pads.push(
        {
          x: chip.x - 0.12 * MM,
          y: -(chip.y + cs / 2 + o),
          z: zu + 0.1 * MM,
          sx: 0.3 * MM,
          sy: 0.25 * MM,
          sz: 0.2 * MM,
        },
        {
          x: chip.x + cs + 0.12 * MM,
          y: -(chip.y + cs / 2 + o),
          z: zu + 0.1 * MM,
          sx: 0.3 * MM,
          sy: 0.25 * MM,
          sz: 0.2 * MM,
        },
      );
    }
    ctl.add(instanced(new BoxGeometry(1, 1, 1), tin, pads));
  } else {
    // (a low sink on a thermal pad: a plate, fins along the card on it, the push pins through two opposite corners: all of it goes with the lid)
    const { x: sx, y: sy, w: ss } = a.sink!,
      { lid } = made;
    const sinkM = mat(C.sinkHex, { metalness: C.sinkHex > 0x80_80_80 ? 0.75 : 0.45, roughness: 0.4 }),
      b0 = zu + 2.5 * MM,
      b1 = b0 + 0.7 * MM;
    lid.add(rectBox({ x: sx, y: sy, w: ss, h: ss }, b0, b1, sinkM));
    const pins = [
        [sx + 3 * MM, sy + 3 * MM],
        [sx + ss - 3 * MM, sy + ss - 3 * MM],
      ] as const,
      fins = [];
    for (let y = sy + 1.2 * MM; y < sy + ss - 0.8 * MM; y += 2.6 * MM) {
      let a = sx,
        b = sx + ss;
      if (Math.abs(y - pins[0][1]) < 3 * MM) {
        a = sx + 6.2 * MM;
      }
      if (Math.abs(y - pins[1][1]) < 3 * MM) {
        b = sx + ss - 6.2 * MM;
      }
      fins.push({ x: (a + b) / 2, y: -y, z: (b1 + zu + SINK_H) / 2, sx: b - a, sy: 0.9 * MM, sz: zu + SINK_H - b1 });
    }
    lid.add(instanced(new BoxGeometry(1, 1, 1), sinkM, fins));
    // (a push pin's post, its spring pressed nearly flat, its head: the sink is too low for the tall pin of a high one)
    const pinM = mat(C.pinHex, { roughness: 0.55 }),
      spring = mat(0xb9_ba_bf, { metalness: 0.85, roughness: 0.3 });
    for (const [px, py] of pins) {
      lid.add(
        drum(px, py, b1, b1 + 0.8 * MM, 1.1 * MM, pinM, SEG.post),
        drum(px, py, b1 + 0.8 * MM, b1 + 1.1 * MM, 2.3 * MM, pinM, SEG.drum),
      );
      lid.add(pinCoil(px, -py, b1, spring, 0.6 * MM));
    }
  }
  // the crystal between the jacks and the controller, the flash east of it, the regulator (a dual buck) with its two inductors and the polymer
  // capacitors past them, each on its lands (`nicCopper`)
  const xtal = tag(new Group(), id('xtal')),
    nvm = tag(new Group(), id('nvm')),
    vreg = tag(new Group(), id('vreg'));
  crystal(xtal, a.crystal, zu, 0.8 * MM, '25.000');
  soic8(nvm, a.flash, zu, ['25Q32JV', 'SIQ 2240'], tin);
  pkg(vreg, a.reg, zu, 0.85 * MM, ['PL3A']);
  a.inductors.forEach((r, k) => inductor(vreg, r, zu, 2 * MM, k ? '1R0' : 'R47'));
  const capMs = {
    seat: mat(0x13_15_18, { roughness: 0.6 }),
    sleeve: mat(0x16_29_4d, { roughness: 0.45, metalness: 0.2 }),
    can: mat(0xb9_ba_bf, { metalness: 0.85, roughness: 0.3 }),
    vent: mat(0x4e_53_60, { metalness: 0.6, roughness: 0.5 }),
  };
  for (const c of a.cans) {
    polyCap(vreg, c.x, c.y, zu, c.r, CAN_H, capMs);
  }
  top.add(xtal, nvm, vreg);
  parts.push(
    { r: a.crystal, ref: 'Y1' },
    { r: a.flash, ref: 'U2' },
    { r: a.reg, ref: 'U3' },
    ...a.inductors.map((r, k) => ({ r, ref: `L${k + 1}` })),
    ...a.cans.map((c) => ({ r: { x: c.x - c.r, y: c.y - c.r, w: 2 * c.r, h: 2 * c.r }, ref: c.ref })),
  );
  // the passives on this face: the crystal's load capacitors, the lights' resistors, the flash's and the regulator's capacitors, a BGA's row by
  // its sink
  passives(
    top,
    cu.parts
      .filter((p) => p.face === 'top')
      .map((p): pcbkit3dTypes.Passive => ({ x: p.x, y: p.y, pkg: p.pkg, kind: p.kind, turn: p.turn })),
    zu,
  );
  // the MAC label, and the mask over the copper with its silkscreen
  const lt = macLabel(visual),
    label = tag(new Group(), id('label'));
  if (lt) {
    label.add(decal(a.label, zu + 0.15 * MM, decalMat(lt, { rough: 0.7 })));
  }
  top.add(label);
  // (the lights' names, behind each jack)
  const text = [
    { x: f.x1 - 26 * MM, y: f.y0 + 6 * MM, s: `RELAY NIC ${SPEED[visual] ?? '1G'} REV A2`, mm: 1.6 },
    ...ys.map((y, k) => ({
      x: JACK_X + P.d + MM,
      y: y + P.w / 2,
      s: visual === 'nic-40g' ? `QSFP+ ${k + 1}` : `LAN${k + 1}  LNK ACT`,
      mm: 1.1,
    })),
  ];
  const f1 = cu.pads.find((p) => p.id === 'U2.1')!,
    dots = [{ x: f1.r.x - 0.5 * MM, y: f1.r.y - 0.4 * MM, r: 0.25 * MM }];
  if (a.qfn) {
    dots.push({ x: chip.x - 0.9 * MM, y: chip.y - 0.9 * MM, r: 0.25 * MM });
  }
  const board = { x: f.x0, y: f.y0, w: f.x1 - f.x0, h: f.end - f.y0 };
  top.add(
    maskTop(
      `nic-top:${cu.key}`,
      board,
      Z,
      {
        ...MASK,
        parts,
        text,
        seed: 0,
        copper: { ...copperOf(cu, 'top'), dots },
        pads: cu.pads.filter((p) => p.face === 'top' && !p.edge).map((p) => p.r),
      },
      { px: 24 },
    ),
  );
  top.add(tabMask(cu, f, 'top', Z - 1));
  const bodies: NicBody[] = [
    { id: id('jack'), rect: { x: JACK_X, y: ys[0]!, w: P.d, h: ys.at(-1)! + P.w - ys[0]! }, h: P.h },
    { id: id('ctl'), rect: a.sink ?? chip, h: a.sink ? SINK_H : core.top },
    { id: id('xtal'), rect: a.crystal, h: 0.8 * MM },
    { id: id('nvm'), rect: a.flash, h: 1.4 * MM },
    {
      id: id('vreg'),
      rect: hull([
        a.reg,
        ...a.inductors,
        ...a.cans.map((c) => ({ x: c.x - c.r, y: c.y - c.r, w: 2 * c.r, h: 2 * c.r })),
      ]),
      h: CAN_H,
    },
    { id: id('label'), rect: a.label, h: 0 },
  ];
  return { lamps: { link: M.green, act: M.amber }, chip: core, bodies, top };
}

/** Each card's speed, on its silkscreen. */
const SPEED: Record<string, string> = { 'nic-gbe': '1G', 'nic-10g': '10G', 'nic-40g': '40G' };

/** The serial label on the back: a white sticker with its barcode, the serial number and the part number. */
function serialLabel(visual: string): ReturnType<typeof tex> {
  return tex(`nic-sn:${visual}`, 640, 220, (c, w, h) => {
    c.fillStyle = '#efefea';
    c.fillRect(0, 0, w, h);
    let s = visual.length * 104_729;
    const rnd = () => (s = (s * 16_807) % 2_147_483_647) / 2_147_483_647;
    c.fillStyle = '#16181c';
    for (let x = 28; x < w - 28;) {
      const bw = 2 + Math.floor(rnd() * 3) * 2;
      if (rnd() > 0.45) {
        c.fillRect(x, 70, bw, h * 0.36);
      }
      x += bw + 2 + Math.floor(rnd() * 3) * 2;
    }
    const lw = drawLockup(c, 'relay', 28, 36, 40, '#16181c', { acc: null });
    c.fillStyle = '#16181c';
    c.font = '600 30px "Consolas", "DejaVu Sans Mono", monospace';
    c.textBaseline = 'middle';
    c.fillText(`RL-NIC-${SPEED[visual] ?? '1G'}  P/N 9C${visual.length}41-A2`, 28 + lw + 24, 36, w - 56 - lw - 24);
    c.fillText(`S/N RLN${(SPEED[visual] ?? '1G').padStart(3, '0')}2244A0${1700 + visual.length * 13}`, 28, h - 34);
  });
}

/**
 * The NIC's back (its solder side, the underside, `Zp` its depth): the mask over its copper (the transmit pairs' capacitors by the fingers, the jacks'
 * centre taps', a BGA's decoupling field under it, the ground pour and its stitching), the passives under it, the tails of the jacks' through-hole pins in solder and their plastic
 * pegs, the sink's push pins' tips through their holes, the serial label and the silkscreen.
 */
export function nicBack(
  g: Group,
  visual: string,
  f: gpu3dTypes.CardFrame,
  Zp: number,
  cu: niccopperTypes.NicCopper,
): void {
  const a = cu.at,
    L = f.x1 - f.x0,
    sp = SPEED[visual] ?? '1G',
    s = a.serial;
  const text = [
    { x: s.x, y: f.end - 11 * MM, s: `RELAY NIC ${sp}  REV A2`, mm: 1.8 },
    { x: s.x, y: f.end - 7.6 * MM, s: '94V-0   E224410   2244', mm: 1.1 },
    { x: s.x, y: f.end - 4.6 * MM, s: 'CE   FCC   RoHS', mm: 1.3 },
    { x: f.x0 + 2.5 * MM, y: f.end - 3.5 * MM, s: `PCB-NIC${sp}-4L`, mm: 0.9 },
  ];
  const board = { x: f.x0, y: f.y0, w: L, h: f.end - f.y0 };
  g.add(
    maskTop(
      `nic-back:${cu.key}`,
      board,
      Zp,
      {
        ...MASK,
        text,
        seed: 0,
        copper: copperOf(cu, 'bottom'),
        pads: cu.pads.filter((p) => p.face === 'bottom' && !p.edge).map((p) => p.r),
      },
      { under: true, px: 24 },
    ),
  );
  g.add(tabMask(cu, f, 'bottom', Zp));
  // the rest stands on the underside: a group turned over (layout y as its y, depth off the PCB as its z)
  const d = new Group(),
    zd = -Zp,
    U = (r: geometryTypes.RectLike): geometryTypes.RectLike => ({ x: r.x, y: -(r.y + r.h), w: r.w, h: r.h });
  d.rotation.x = Math.PI;
  g.add(d);
  passives(
    d,
    cu.parts
      .filter((p) => p.face === 'bottom')
      .map((p): pcbkit3dTypes.Passive => ({ x: p.x, y: -p.y, pkg: p.pkg, kind: p.kind, turn: p.turn })),
    zd,
  );
  // a BGA's push pins' barbed tips, split, through the sink's corners
  const C = CTRL[visual] ?? CTRL['nic-gbe']!,
    slit = mat(0x05_06_08, { roughness: 0.9 }),
    pinM = mat(C.pinHex, { roughness: 0.55 });
  for (const h of a.sink ? cu.npth.slice(-2) : []) {
    const r = h.r - 0.15 * MM,
      t = 1.2 * MM;
    d.add(
      drum(h.x, -h.y, zd, zd + t, r, pinM, SEG.disc),
      drum(h.x, -h.y, zd + t, zd + t + 0.4 * MM, r * 0.75, pinM, SEG.disc),
    );
    d.add(
      rectBox(
        U({ x: h.x - r - 0.05 * MM, y: h.y - 0.2 * MM, w: 2 * r + 0.1 * MM, h: 0.4 * MM }),
        zd + 0.2 * MM,
        zd + t + 0.45 * MM,
        slit,
      ),
    );
  }
  // the jacks stand on the other face, so the tails of their through-hole pins are cut short in solder here: a fillet over each ring climbing to its rounded tip, sized to the ring,
  // and their plastic pegs, split, just through the board
  d.add(
    instanced(
      solderFillet(),
      mat(0xb9_ba_bf, { metalness: 0.92, roughness: 0.22 }),
      cu.holes.map((h) => ({ x: h.x, y: h.y, z: zd, sx: h.ring / 16, sy: h.ring / 16 })),
    ),
  );
  const peg = mat(0x13_15_18, { roughness: 0.6 });
  for (const h of cu.npth.slice(0, cu.npth.length - (a.sink ? 2 : 0))) {
    const r = h.r - 0.15 * MM,
      t = 0.8 * MM;
    d.add(
      drum(h.x, -h.y, zd, zd + t, r, peg, SEG.disc),
      rectBox(
        U({ x: h.x - r - 0.05 * MM, y: h.y - 0.2 * MM, w: 2 * r + 0.1 * MM, h: 0.4 * MM }),
        zd + 0.2 * MM,
        zd + t + 0.05 * MM,
        slit,
      ),
    );
  }
  const st = serialLabel(visual);
  if (st) {
    d.add(decal(U(s), zd + 0.15 * MM, decalMat(st, { rough: 0.7 })));
  }
}

/**
 * The NIC's bracket, lying (`s` its plate, `Z` the PCB's top face the jacks stand on): the plate with each jack's opening, a hair larger than its shield, and vent slots past them, over
 * the PCB's top face and under its underside.
 */
export function nicBracket(
  visual: string,
  y0: number,
  Z: number,
  x0: number,
  x1: number,
  s: casekit3dTypes.Span,
  m: threeTypes.Material,
): ReturnType<typeof wallX> {
  const e = 0.4 * MM,
    ys = jacksOf(visual, y0),
    P = jackOf(visual),
    holes: (casekit3dTypes.Span | Vector2[])[] = ys.map((y) => ({
      y0: y - e,
      y1: y + P.w + e,
      z0: Z - e,
      z1: Z + P.h + e,
      r: 0.7 * MM,
    }));
  for (let y = ys.at(-1)! + P.w + 6 * MM; y < s.y1 - 120; y += 64) {
    holes.push(
      { y0: y - 16, y1: y + 16, z0: Z + 70, z1: s.z1 - 70, r: 14 },
      { y0: y - 16, y1: y + 16, z0: s.z0 + 70, z1: Z - 70, r: 14 },
    );
  }
  return wallX(x0, x1, s, holes, m);
}
