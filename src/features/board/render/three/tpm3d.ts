// The secure module as a real TPM daughterboard (docs/PC_PARTS.md "TPM"), the same in the case, in Build my PC and in the gallery: an 18 x 13 mm
// board, 1 mm thick, lying flat on the 7 mm female connector that takes the board's keyed 14-1 header. The connector's 13 contacts come up through
// the board's south end, soldered on top (their tails cut short in their fillets). North of them the TPM chip: a gull-wing TSSOP, its legs on
// their pads, its decoupling caps at its ends, and the status LED with its resistor by the east edge. The TPM 2 is a black board with a tin-plated
// shield can soldered over its chip; the TPM 1 a green one, its chip bare. Up close the die fades in over the chip (or the can), as the case's view
// draws it (chips3d.ts: `TpmView` bare); the LED is lit red there while protected mode is on.
import { BoxGeometry, Group, LatheGeometry, Matrix4, Shape, Vector2, type MeshStandardMaterial } from 'three';
import { headerRect, tpmHeader, tpmRect } from '@/core/render/accelart';
import { extrude, instanced, rectBox, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { tpmGeo, tpmLed } from '@/features/tpm/render/tpmlayout';
import { GEO } from '../layout/layout';
import { decal, grow, tex } from './casekit3d';
import { arc, decalMat, maskTop, MM, passives, pcbSlab, pkg, type MaskArt, type Passive } from './pcbkit3d';

/** The module's depths: the connector's mating face (down on the header's base), the board's underside and top. */
export const TPM_Z = { mate: BOARD_Z + 120, pcb: BOARD_Z + 290, top: BOARD_Z + 312 } as const;

const tin = () => mat(0xc4c9d0, { metalness: 0.9, roughness: 0.3 });
const solder = () => mat(0xb9bec6, { metalness: 0.92, roughness: 0.22 });

/** A board's look by module: its mask, the copper under it, the chip's marking. */
const LOOK = {
  'tpm-1': { mask: 0x163e2b, art: { mask: '#163e2b', trace: '#1f5139' }, mark: ['PL 9635 TT 1.2', 'FW 3.19  B2', 'TWN 2644'], shield: false },
  'tpm-2': { mask: 0x121519, art: { mask: '#121519', trace: '#1b2027' }, mark: ['PL 9672 TT 2.0', 'FW 7.85  A3', 'TWN 2645'], shield: true },
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

/** The pads under a passive's two ends (a hair past its tinned ends), for the mask's painting. */
function padsOf(p: Passive): RectLike[] {
  const [l, w] = p.pkg === '0603' ? [1.6 * MM, 0.8 * MM] : [1 * MM, 0.5 * MM], e = l * 0.3, k = 2;
  return [-1, 1].map((s) => p.turn
    ? { x: p.x - w / 2 - k, y: p.y + s * (l / 2 - e / 2) - e / 2 - k, w: w + 2 * k, h: e + 2 * k }
    : { x: p.x + s * (l / 2 - e / 2) - e / 2 - k, y: p.y - w / 2 - k, w: e + 2 * k, h: w + 2 * k });
}

/** A 0603 LED turned along y, centred at (x, y) on a PCB top at depth z: its white base, its red lens, the tinned ends. */
function led(g: Group, x: number, y: number, z: number) {
  const L = 1.6 * MM, W = 0.8 * MM, e = 0.3 * MM;
  g.add(rectBox({ x: x - W / 2, y: y - L / 2 + e, w: W, h: L - 2 * e }, z, z + 6, mat(0xe6e2d8, { roughness: 0.6 })));
  for (const s of [-1, 1]) g.add(rectBox({ x: x - W / 2, y: s < 0 ? y - L / 2 : y + L / 2 - e, w: W, h: e }, z, z + 8, tin()));
  g.add(softBox({ x: x - W / 2 + 1.5, y: y - L / 2 + e + 1, w: W - 3, h: L - 2 * e - 2 }, z + 6, z + 14, mat(0x9a2318, { roughness: 0.16, metalness: 0 }), 2.5));
}

/** The shield can's lid: tin plate punched with rows of vent holes round a plain pick-up spot in its middle. */
function lidTex(wMm: number, hMm: number) {
  const px = 40, W = Math.round(wMm * px), H = Math.round(hMm * px);
  return tex(`tpm-can:${W}x${H}`, W, H, (c, w, h) => {
    c.fillStyle = '#c3c8cf'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < (w * h) / 40; i++) { c.fillStyle = `rgba(255,255,255,${0.02 + ((i * 7919) % 11) / 400})`; c.fillRect((i * 7907) % w, (i * 104729) % h, 2, 1); }
    const pitch = 1.3 * px, r = 0.32 * px, cx = w / 2, cy = h / 2;
    for (let row = 0, y = pitch * 0.8; y < h - pitch * 0.5; row++, y += pitch * 0.87) {
      for (let x = pitch * (row % 2 ? 1.1 : 0.6); x < w - pitch * 0.4; x += pitch) {
        if (Math.abs(x - cx) < 2.6 * px && Math.abs(y - cy) < 1.2 * px) continue;
        c.fillStyle = '#0d0f12'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, r + 1.5, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
      }
    }
    // the stamped step round the lid's edge
    c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = 3; c.strokeRect(0.45 * px, 0.45 * px, w - 0.9 * px, h - 0.9 * px);
  });
}

/**
 * The module on this tier's header (`GEO`) into `g`. `onFace`: each face the case's view draws on, under its parent, by its rect (layout) and
 * depth: the die over the chip's top (or the can's), the LED's light over its lens. Returns the board's material, or null: the board has no header.
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

  // the female connector under it: 2 x 7 cells on the header's pitch, the keyed cell plugged; its contacts' tails come up through the board
  const pins: [number, number][] = [];
  for (let i = 0; i < h.cols; i++) for (let j = 0; j < h.rows; j++) if (!(i === h.key?.[0] && j === h.key[1])) pins.push([hr.x + 36 + i * 52, hr.y + 36 + j * 52]);
  const house = { x: hr.x + 10, y: hr.y + 10, w: h.cols * 52, h: h.rows * 52 }, pbt = mat(0x1a1b1f, { roughness: 0.52 });
  g.add(softBox(house, TPM_Z.mate, z0, pbt, 5));
  const box = new BoxGeometry(1, 1, 1), dark = mat(0x050607, { roughness: 0.9 });
  // its mating face: a chamfered entry to each contact; the V notches between the cells along both long sides
  g.add(instanced(box, dark, pins.map(([x, y]) => ({ x, y: -y, z: TPM_Z.mate - 0.4, sx: 22, sy: 22, sz: 1 }))));
  g.add(instanced(box, dark, Array.from({ length: (h.cols - 1) * 2 }, (_, k) => {
    const x = house.x + 52 * (1 + (k % (h.cols - 1))), y = k < h.cols - 1 ? house.y : house.y + house.h;
    return { x, y: -y, z: TPM_Z.mate + 14, sx: 4, sy: 3, sz: 28 };
  })));

  // the chip: a TSSOP over the die's place, 28 legs a side on 0.5 mm, its legs reaching 0.85 mm out to their pads
  const d = geo.die, body = { x: d.x - 6, y: d.y - 2, w: d.w + 12, h: d.h + 4 }, legX = Array.from({ length: 28 }, (_, k) => body.x + body.w / 2 + (k - 13.5) * 0.5 * MM);
  const chipTop = z1 + 2 + 22;
  pkg(g, body, z1 + 2, 22, look.mark, { dot: true, bevel: 4 });
  const wing = gullWing(), legs = tin();
  g.add(instanced(wing, legs, [...legX.map((x) => ({ x, y: -body.y, z: z1 })), ...legX.map((x) => ({ x, y: -(body.y + body.h), z: z1, rz: Math.PI }))]));
  const legPads = legX.flatMap((x) => [{ x: x - 3.5, y: body.y - 22, w: 7, h: 15 }, { x: x - 3.5, y: body.y + body.h + 7, w: 7, h: 15 }]);

  // its decoupling at its west end, the LED, its resistor and a cap by the east edge, two more caps by the silkscreen
  const L = tpmLed(geo), mid = geo.band.y + geo.band.h / 2;
  const parts: Passive[] = [
    { x: X0 + 24, y: mid - 24, pkg: '0402', kind: 'cap', turn: true }, { x: X0 + 24, y: mid + 24, pkg: '0402', kind: 'cap', turn: true },
    { x: L.x, y: L.y - 40, pkg: '0402', kind: 'res', turn: true }, { x: L.x, y: L.y + 40, pkg: '0402', kind: 'cap', turn: true },
    { x: X1 - 76, y: Y1 - 19, pkg: '0402', kind: 'cap' }, { x: X1 - 38, y: Y1 - 19, pkg: '0402', kind: 'res' },
  ];
  passives(g, parts, z1);
  led(g, L.x, L.y, z1);

  // the contacts' tails, cut short in their solder: a concave fillet over the pad climbing the tail to its rounded tip, 0.9 mm over the board
  const joint = new LatheGeometry([[15, 0], [13, 1], [10.6, 2.6], [9, 4.6], [8, 7.2], [7.4, 10.5], [7.2, 15], [6.6, 18], [5, 20], [2.6, 21], [0, 21.3]].map(([r, z]) => new Vector2(r, z)), 20).rotateX(Math.PI / 2);
  g.add(instanced(joint, solder(), pins.map(([x, y]) => ({ x, y: -y, z: z1 }))));

  // the shield can of the TPM 2: a fence soldered round the chip and its legs, its lid punched with vents
  let faceZ = chipTop;
  const fence = { x: body.x - 10, y: Y0 + 12, w: body.w + 20, h: body.y + body.h + 26 - (Y0 + 12) };
  const fencePads = look.shield ? [{ x: fence.x - 2, y: fence.y - 2, w: fence.w + 4, h: 7.5 }, { x: fence.x - 2, y: fence.y + fence.h - 5.5, w: fence.w + 4, h: 7.5 }, { x: fence.x - 2, y: fence.y, w: 7.5, h: fence.h }, { x: fence.x + fence.w - 5.5, y: fence.y, w: 7.5, h: fence.h }] : [];
  if (look.shield) {
    const can = mat(0xc3c8cf, { metalness: 0.82, roughness: 0.34 }), t = 3.5, top = z1 + 41;
    for (const r of [{ x: fence.x, y: fence.y, w: fence.w, h: t }, { x: fence.x, y: fence.y + fence.h - t, w: fence.w, h: t }, { x: fence.x, y: fence.y, w: t, h: fence.h }, { x: fence.x + fence.w - t, y: fence.y, w: t, h: fence.h }]) g.add(rectBox(r, z1, top - t, can));
    g.add(softBox(fence, top - t, top, can, 2));
    g.add(decal({ x: fence.x + 1, y: fence.y + 1, w: fence.w - 2, h: fence.h - 2 }, top + 0.3, decalMat(lidTex(fence.w / MM, fence.h / MM), { metal: 0.82, rough: 0.34 })));
    faceZ = top;
  }

  // the mask: the traces, the legs' and the passives' pads, the silkscreen (the maker and the module south of the contacts, pin 1, the chip's dot)
  const art: MaskArt = {
    ...look.art, seed: look.shield ? 23 : 19,
    pads: [...legPads, ...parts.flatMap(padsOf), ...fencePads],
    text: [
      { x: X0 + 22, y: Y1 - 19, s: `PIPELINE  TPM ${look.shield ? '2.0' : '1.2'}  SPI`, mm: 0.72 },
      { x: X0 + 10, y: (pins[0]?.[1] ?? 0), s: '1', mm: 0.7 },
    ],
  };
  g.add(maskTop(`tpm-top:${visual}`, p, z1, art));
  g.add(maskTop(`tpm-under:${visual}`, p, z0, { ...look.art, seed: look.shield ? 29 : 31, text: [{ x: X0 + 22, y: Y0 + 24, s: `REV ${look.shield ? 'B' : 'A'}  2645`, mm: 0.7 }] }, { under: true }));

  // the faces the case's view draws on: the die over the chip (or the can), the LED's light over its lens
  onFace?.(g, grow(d, 2), faceZ);
  onFace?.(g, { x: L.x - 24, y: L.y - 32, w: 48, h: 64 }, z1 + 14);
  return (pcb.material as MeshStandardMaterial[])[0]!;
}

