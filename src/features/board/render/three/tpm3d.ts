// The secure module as a real TPM daughterboard (docs/PC_PARTS.md "TPM"), the same in the case, in Build my PC and in the gallery: an 18 x 13 mm
// board, 1 mm thick, lying flat on the 7 mm female connector that takes the board's keyed 14-1 header. The connector's 13 contacts come up through
// the board's south end, soldered on top (their tails cut short in their fillets). North of them the TPM chip, bare as on every real module: a
// TSSOP-28 at its real size, turned half round so its LPC row faces the header, its gull-wing legs on their pads, the caps and resistors on its
// nets, and the status LED by the east edge. The copper is routed (`tpmCopper`: every leg to its contact, part or via, ground pours on both
// faces). Both modules talk LPC, as the board's TPM header does. The TPM 1.2 is a green board with tinned (HASL) pads; the TPM 2.0 a black one
// with gold (ENIG) pads and a newer chip. Up close the die fades in over the chip's top, as the case's view draws it (chips3d.ts: `TpmView`
// bare); the LED is lit red there while protected mode is on.
import { BoxGeometry, Group, LatheGeometry, Matrix4, Shape, Vector2, type MeshStandardMaterial } from 'three';
import { headerRect, tpmHeader, tpmRect } from '@/core/render/accelart';
import { extrude, instanced, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { CU, tpmCopper, type Layer } from '@/features/tpm/render/tpmcopper';
import { tpmGeo } from '@/features/tpm/render/tpmlayout';
import { GEO } from '../layout/layout';
import { grow } from './casekit3d';
import { arc, maskTop, MM, passives, pcbSlab, pkg, type MaskArt, type MaskCopper, type Passive } from './pcbkit3d';

/** The module's depths: the connector's mating face (down on the header's base), the board's underside and top. */
export const TPM_Z = { mate: BOARD_Z + 120, pcb: BOARD_Z + 290, top: BOARD_Z + 312 } as const;

const tin = () => mat(0xc4c9d0, { metalness: 0.9, roughness: 0.3 });
const solder = () => mat(0xb9bec6, { metalness: 0.92, roughness: 0.22 });

/**
 * A board's look by module: its mask, the copper under it, its pads' finish, the chip's marking, the generation on its silkscreen and its
 * revision. Both share the routing: the two chips have the same LPC pinout.
 */
const LOOK = {
  'tpm-1': { mask: 0x163e2b, art: { mask: '#163e2b', trace: '#1f5139', pad: '#b3b7bb' }, mark: ['PL 9635 TT 1.2', 'FW 3.19  B2', 'TWN 2644'], gen: '1.2', rev: 'A' },
  'tpm-2': { mask: 0x121519, art: { mask: '#121519', trace: '#1b2027', pad: '#c9a85e' }, mark: ['PL 9665 TT 2.0', 'FW 5.63  A3', 'TWN 2645'], gen: '2.0', rev: 'B' },
} as const;

/**
 * A gull-wing leg (a TSSOP's), standing on a PCB top at depth 0: out of the body's side at half its height, bent down to its foot on the pad. Its
 * profile runs out along +y (world: north), its 0.22 mm width along x.
 */
function gullWing() {
  const s = new Shape(), t = 3.5;
  s.moveTo(-3, 13 + t / 2); s.lineTo(4.7, 13 + t / 2); s.lineTo(10.7, t); s.lineTo(20, t); s.lineTo(20, 0); s.lineTo(9.3, 0); s.lineTo(3.3, 13 - t / 2); s.lineTo(-3, 13 - t / 2);
  s.closePath();
  const w = 0.22 * MM;
  return extrude(s, { depth: w, bevelEnabled: false }).applyMatrix4(new Matrix4().set(0, 0, 1, -w / 2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
}

/** A 0603 LED turned along y, centred at (x, y) on a PCB top at depth z: its white base, its red lens, the tinned ends. */
function led(g: Group, x: number, y: number, z: number) {
  const L = 1.6 * MM, W = 0.8 * MM, e = 0.3 * MM;
  g.add(rectBox({ x: x - W / 2, y: y - L / 2 + e, w: W, h: L - 2 * e }, z, z + 6, mat(0xe6e2d8, { roughness: 0.6 })));
  for (const s of [-1, 1]) g.add(rectBox({ x: x - W / 2, y: s < 0 ? y - L / 2 : y + L / 2 - e, w: W, h: e }, z, z + 8, tin()));
  g.add(softBox({ x: x - W / 2 + 1.5, y: y - L / 2 + e + 1, w: W - 3, h: L - 2 * e - 2 }, z + 6, z + 14, mat(0x9a2318, { roughness: 0.16, metalness: 0 }), 2.5));
}

/**
 * The module on this tier's header (`GEO`) into `g`. `onFace`: each face the case's view draws on, under its parent, by its rect (layout) and
 * depth: the die over the chip's top, the LED's light over its lens. Returns the board's material, or null: the board has no header.
 */
export function tpmModel(g: Group, visual: string, onFace?: (top: Group, r: RectLike, z: number) => void): MeshStandardMaterial | null {
  const p = tpmRect(GEO.tier), h = tpmHeader(GEO.tier);
  if (!p || !h) return null;
  const hr = headerRect(h), geo = tpmGeo(visual, hr), look = LOOK[visual as keyof typeof LOOK] ?? LOOK['tpm-1'];
  const z0 = TPM_Z.pcb, z1 = TPM_Z.top, X0 = p.x, Y0 = p.y, X1 = p.x + p.w, Y1 = p.y + p.h, rc = 12;

  // the board: an 18 x 13 mm rectangle, its corners rounded
  const outline: [number, number][] = [
    ...arc(X0 + rc, Y0 + rc, rc, Math.PI, Math.PI * 1.5, 4), ...arc(X1 - rc, Y0 + rc, rc, -Math.PI / 2, 0, 4),
    ...arc(X1 - rc, Y1 - rc, rc, 0, Math.PI / 2, 4), ...arc(X0 + rc, Y1 - rc, rc, Math.PI / 2, Math.PI, 4),
  ];
  const pcb = pcbSlab(outline, z0, z1, look.mask);
  pcb.name = 'tpm-pcb';
  g.add(pcb);

  // the female connector under it: 2 x 7 cells on the header's pitch, the keyed cell plugged; its contacts' tails come up through the board's
  // contacts (`tpmCopper`)
  const cu = tpmCopper(geo, hr), pins = cu.holes.map((q): [number, number] => [q.x, q.y]);
  const house = { x: hr.x + 10, y: hr.y + 10, w: h.cols * 52, h: h.rows * 52 }, pbt = mat(0x1a1b1f, { roughness: 0.52 });
  g.add(softBox(house, TPM_Z.mate, z0, pbt, 5));
  const box = new BoxGeometry(1, 1, 1), dark = mat(0x050607, { roughness: 0.9 });
  // its mating face: a chamfered entry to each contact; the V notches between the cells along both long sides
  g.add(instanced(box, dark, pins.map(([x, y]) => ({ x, y: -y, z: TPM_Z.mate - 0.4, sx: 22, sy: 22, sz: 1 }))));
  g.add(instanced(box, dark, Array.from({ length: (h.cols - 1) * 2 }, (_, k) => {
    const x = house.x + 52 * (1 + (k % (h.cols - 1))), y = k < h.cols - 1 ? house.y : house.y + house.h;
    return { x, y: -y, z: TPM_Z.mate + 14, sx: 4, sy: 3, sz: 28 };
  })));

  // the chip: a TSSOP-28 at its real size, 1 mm thick on a 0.1 mm stand-off, 14 legs a side on 0.65 mm reaching 0.85 mm out to their pads. It
  // lies turned half round, as on the real modules: its LPC row faces the header, pin 1 and its dimple at the north-east, its marking upside down
  const d = geo.die, body = geo.chip, chipTop = z1 + 2 + 22, chip = cu.pads.filter((q) => q.id.startsWith('U1.'));
  pkg(g, body, z1 + 2, 22, look.mark, { dot: true, bevel: 4, pin1: 'sw', flip: true });
  const legs = instanced(gullWing(), tin(), chip.map((q) => (q.c[1] < body.y ? { x: q.c[0], y: -body.y, z: z1 } : { x: q.c[0], y: -(body.y + body.h), z: z1, rz: Math.PI })));
  legs.name = 'tpm-legs';
  g.add(legs);

  // the parts on its nets: the main rail's bulk cap by contact 1 and a 100 nF cap each side of the trunk at the chip's west end, the standby
  // rail's cap by contact 14, the PP pull-down and the LED's resistor by the chip's east end, the LED by the east edge
  const L = cu.parts.find((q) => q.kind === 'led')!;
  passives(g, cu.parts.flatMap((q): Passive[] => (q.kind === 'led' ? [] : [{ x: q.x, y: q.y, pkg: q.pkg, kind: q.kind, turn: q.turn }])), z1);
  led(g, L.x, L.y, z1);

  // the contacts' tails, cut short in their solder: a concave fillet over the pad climbing the tail to its rounded tip, 0.9 mm over the board
  const joint = new LatheGeometry([[15, 0], [13, 1], [10.6, 2.6], [9, 4.6], [8, 7.2], [7.4, 10.5], [7.2, 15], [6.6, 18], [5, 20], [2.6, 21], [0, 21.3]].map(([r, z]) => new Vector2(r, z)), 20).rotateX(Math.PI / 2);
  g.add(instanced(joint, solder(), pins.map(([x, y]) => ({ x, y: -y, z: z1 }))));

  // the mask over the routed copper (`tpmCopper`) and its ground pours, on both faces; the pads in the board's finish; the silkscreen (the
  // maker, the module and its bus south of the contacts, contact 1, the chip's designator and its pin-1 dot, the bulk cap's designator)
  const p1 = chip.find((q) => q.id === 'U1.1')!, j1 = cu.holes.find((q) => q.pin === 1)!;
  const copper = (layer: Layer): MaskCopper => ({
    traces: cu.traces.filter((t) => t.layer === layer).map((t) => ({ pts: t.pts, w: t.w, gnd: t.net === 'GND' })),
    vias: cu.vias.map((v) => ({ x: v.x, y: v.y, gnd: v.net === 'GND' })),
    holes: cu.holes.map((q) => ({ x: q.x, y: q.y, square: q.pin === 1, gnd: q.net === 'GND' })),
    keep: layer === 'top' ? cu.pads.filter((q) => q.net !== 'GND').map((q) => q.r) : [],
    fiducials: layer === 'top' ? cu.fiducials.map(([x, y]) => ({ x, y, r: CU.fid })) : [],
    dots: layer === 'top' ? [{ x: p1.r.x + p1.r.w + 7, y: p1.r.y + 1, r: 3 }] : [],
    via: CU.via, drill: CU.drill, ring: CU.ring, hole: CU.hole, pour: { clear: CU.pour, edge: CU.edge, round: rc - CU.edge },
  });
  const art: MaskArt = {
    ...look.art, seed: 0, copper: copper('top'), pads: cu.pads.map((q) => q.r),
    text: [
      { x: X0 + 44, y: Y1 - 19, s: `PIPELINE  TPM ${look.gen}  LPC`, mm: 0.72 },
      { x: X0 + 10, y: j1.y, s: '1', mm: 0.7 },
      { x: X0 + 40, y: body.y - 6, s: 'U1', mm: 0.7 },
      { x: X0 + 12, y: Y0 + 128, s: 'C1', mm: 0.6 },
    ],
  };
  g.add(maskTop(`tpm-top:${visual}`, p, z1, art, { px: 96 }));
  g.add(maskTop(`tpm-under:${visual}`, p, z0, { ...look.art, seed: 0, copper: copper('bottom'), text: [{ x: X0 + 22, y: Y0 + 24, s: `REV ${look.rev}  2645`, mm: 0.7 }] }, { under: true, px: 48 }));

  // the faces the case's view draws on: the die over the chip, the LED's light over its lens
  onFace?.(g, grow(d, 2), chipTop);
  onFace?.(g, { x: L.x - 24, y: L.y - 32, w: 48, h: 64 }, z1 + 14);
  return (pcb.material as MeshStandardMaterial[])[0]!;
}

