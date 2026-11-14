// An NVMe stick as a real M.2 2280 (docs/PC_PARTS.md "Storage"), the same in the case, in Build my PC and in the gallery: an 80 x 22 mm board,
// 0.8 mm thick, on a 1.8 mm standoff. Its edge fingers (0.5 mm pitch, top and bottom, the M key cut between them) sit in the socket; the
// regulator's PMIC and inductors stand by them; then the controller (a nickel lid on its substrate, its clock crystal beside it), its DRAM, and
// two NAND packages, each with its decoupling. The notch at the east end is screwed down into the standoff, its gold ring round it. A plain stick
// wears its maker's label draped over the DRAM and the NAND; a premium one wears a black anodised heat sink on a thermal pad instead (fins,
// a raised plateau with a brushed silver insert, skirts that clip it to the board's edges). The underside carries its own mask and the serial sticker.
import { Group, type MeshStandardMaterial, type Texture } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { instanced, rectBox, type RectLike } from '@/core/render/three/geometry';
import { lowDetail } from '@/core/render/three/detail';
import { mat } from '@/core/render/three/materials';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { NVME_FINGERS } from '@/features/storage/render/drives';
import { brushed, decal, grow, outlinePts, screws, shapeOf, slab, tex, tiled } from './casekit3d';
import { arc, crystal, decalMat, drape, fingers, inductor, maskTop, MM, padRing, passiveRow, passives, pcbSlab, pkg, type Bump, type MaskArt, type Passive } from './pcbkit3d';

/** How a stick looks: its name and capacity (the label's print), and whether it wears a heat sink. */
export interface NvmeLook { name: string; capacityBytes: number; heatsink: boolean }
/** A spec's look: the top tier draws 11 W under load, past what a bare label sheds, so it wears the heat sink. */
export const nvmeLook = (s: { name: string; tier: number; capacityBytes: number }): NvmeLook => ({ name: s.name, capacityBytes: s.capacityBytes, heatsink: s.tier >= 3 });

/** The stick's depths: its board's underside and top (0.8 mm on a 1.8 mm standoff), the top of its heat sink (9 mm over the motherboard). */
export const NVME_Z = { pcb: BOARD_Z + 42, top: BOARD_Z + 60, sink: BOARD_Z + 208 } as const;

/** The mask's colours: a black board, the copper under it a shade lighter. */
const MASK = 0x121519, MASK_ART = { mask: '#121519', trace: '#1b2027' } as const;

/**
 * The stick over its body `b` (the PCB east of the fingers: `driveBody`), into `g`. Returns the material the machine lights with the
 * drive's state (the label, or the heat sink).
 */
export function nvmeStick(g: Group, b: RectLike, look: NvmeLook): MeshStandardMaterial {
  const X0 = b.x - NVME_FINGERS, X1 = b.x + b.w, Y0 = b.y, Y1 = b.y + b.h, cy = (Y0 + Y1) / 2, z0 = NVME_Z.pcb, z1 = NVME_Z.top;
  const R = (x: number, y: number, w: number, h: number): RectLike => ({ x: X0 + x * MM, y: Y0 + y * MM, w: w * MM, h: h * MM });
  // the M key: a 1.2 mm slot into the finger edge, 5 mm from the south edge, between top pads 29 and 33
  const ky = Y0 + 389, kw = 14, kd = 80;
  const outline: [number, number][] = [
    [X0, Y0 + 12], [X0 + 12, Y0],
    ...arc(X1 - 10, Y0 + 10, 10, -Math.PI / 2, 0, 4),
    ...arc(X1, cy, 40, -Math.PI / 2, -Math.PI * 1.5, 14),
    ...arc(X1 - 10, Y1 - 10, 10, 0, Math.PI / 2, 4),
    [X0 + 12, Y1], [X0, Y1 - 12],
    [X0, ky + kw], ...arc(X0 + kd - kw, ky, kw, Math.PI / 2, -Math.PI / 2, 8), [X0, ky - kw],
  ];
  const pcb = pcbSlab(outline, z0, z1, MASK);
  pcb.name = 'nvme-pcb';
  g.add(pcb);

  // the fingers: 38 pads on top (four left out at the key), 37 under, offset by half the pitch
  const top: number[] = [], under: number[] = [];
  for (let i = 0; i < 38; i++) if (i < 29 || i > 32) top.push(Y0 + 38.25 + i * 11.5);
  for (let i = 0; i < 37; i++) { const y = Y0 + 44 + i * 11.5; if (Math.abs(y - ky) > 24) under.push(y); }
  fingers(g, X0 + 3, 63, top, under, 7.5, z0, z1);

  // the parts (mm from the finger edge and the north edge)
  const pmic = R(3.7, 9.75, 2.5, 2.5), ind = [R(3.75, 1.4, 1.6, 2.0), R(3.75, 4.0, 1.6, 2.0), R(3.75, 16.0, 1.6, 2.0), R(3.75, 18.6, 1.6, 2.0)];
  const ctrl = R(7.0, 4.5, 13, 13), xtal = R(8.6, 1.3, 2.0, 1.6), dram = R(21.5, 4.5, 8.0, 13.0), nand = [R(31.0, 5.0, 18.0, 12.0), R(51.5, 5.0, 18.0, 12.0)];
  pkg(g, pmic, z1, 0.75 * MM, ['P9M', '21A']);
  ind.forEach((r, i) => inductor(g, r, z1, 1.0 * MM, ['1R0', 'R47', 'R68', '1R0'][i]));
  // (a package under the label or the heat sink keeps its marking to itself)
  pkg(g, ctrl, z1, 1.4 * MM, look.heatsink ? [] : ['PC5016-E4', '2304 TW', 'B47Q2.1'], { lid: true });
  crystal(g, xtal, z1, 0.55 * MM);
  pkg(g, dram, z1, 1.0 * MM, []);
  nand.forEach((r) => pkg(g, r, z1, 1.25 * MM, []));

  // the passives: the regulator's, the controller's (on its substrate too), the DRAM's and the NAND's decoupling
  const at = (x: number, y: number) => [X0 + x * MM, Y0 + y * MM] as const;
  const col = (x: number, y: number, n: number, step: number, pkg: Passive['pkg'], kind: Passive['kind'] = 'cap') => passiveRow(...at(x, y), n, step * MM, pkg, kind, true, true);
  const row = (x: number, y: number, n: number, step: number, pkg: Passive['pkg'], kind: Passive['kind'] = 'cap') => passiveRow(...at(x, y), n, step * MM, pkg, kind);
  const parts: Passive[] = [
    ...[6.8, 7.9, 13.3, 14.4].map((y) => ({ x: at(4.55, y)[0], y: at(4.55, y)[1], pkg: '0603' as const, kind: 'cap' as const })),
    ...col(6.15, 6.4, 10, 0.95, '0201'),
    ...row(11.9, 3.5, 8, 1.0, '0402'), ...row(7.6, 18.5, 13, 0.98, '0402'),
    { x: at(8.0, 3.5)[0], y: at(8.0, 3.5)[1], pkg: '0201', kind: 'cap' }, { x: at(11.2, 2.1)[0], y: at(11.2, 2.1)[1], pkg: '0201', kind: 'cap', turn: true },
    ...col(20.75, 5.2, 13, 0.95, '0201'),
    ...row(22.0, 3.6, 8, 0.95, '0201'), ...row(22.0, 18.4, 8, 0.95, '0201'),
    ...col(30.25, 5.6, 9, 1.35, '0402'),
    ...row(32.0, 3.9, 9, 2.0, '0402'), ...row(32.0, 18.1, 9, 2.0, '0402'), ...row(52.5, 3.9, 9, 2.0, '0402'), ...row(52.5, 18.1, 9, 2.0, '0402'),
    ...col(50.25, 6.0, 9, 1.25, '0402'),
    ...col(71.0, 6.0, 6, 2.0, '0603'), ...col(73.2, 3.0, 9, 2.0, '0402', 'res'),
    { x: at(76.7, 4.0)[0], y: at(76.7, 4.0)[1], pkg: '0402', kind: 'cap' }, { x: at(76.7, 18.0)[0], y: at(76.7, 18.0)[1], pkg: '0402', kind: 'cap' },
  ];
  passives(g, parts, z1);
  // the land-side caps on the controller's substrate, round its lid
  const sub = z1 + Math.min(1.4 * MM * 0.35, 18);
  passives(g, [
    ...[9, 13.5, 18].flatMap((x) => [{ x: at(x, 4.89)[0], y: at(x, 4.89)[1], pkg: '0201' as const, kind: 'cap' as const }, { x: at(x, 17.11)[0], y: at(x, 17.11)[1], pkg: '0201' as const, kind: 'cap' as const }]),
    ...[7, 11, 15].flatMap((y) => [{ x: at(7.39, y)[0], y: at(7.39, y)[1], pkg: '0201' as const, kind: 'cap' as const, turn: true }, { x: at(19.61, y)[0], y: at(19.61, y)[1], pkg: '0201' as const, kind: 'cap' as const, turn: true }]),
  ], sub);

  // the mask, top and under: the traces, the silkscreen round the parts, the bare laminate under the fingers, the notch and the key cut out
  const face = { x: X0, y: Y0, w: X1 - X0, h: b.h };
  const cuts: MaskArt['cuts'] = [
    { circle: [X1, cy, 40] }, { rect: { x: X0, y: ky - kw, w: kd - kw, h: 2 * kw } }, { circle: [X0 + kd - kw, ky, kw] },
    { poly: [[X0, Y0], [X0 + 12, Y0], [X0, Y0 + 12]] }, { poly: [[X0, Y1], [X0, Y1 - 12], [X0 + 12, Y1]] },
  ];
  const bare = [{ x: X0, y: Y0, w: 70, h: b.h }];
  g.add(maskTop('nvme-top', face, z1, {
    ...MASK_ART, seed: 7, bare, cuts,
    parts: [{ r: pmic, ref: 'U5' }, { r: ctrl, ref: 'U1' }, { r: xtal, ref: 'Y1' }, { r: dram, ref: 'U2' }, { r: nand[0]!, ref: 'U3' }, { r: nand[1]!, ref: 'U4' }, ...ind.map((r, i) => ({ r, ref: `L${i + 1}` }))],
    text: [{ x: X0 + 77.6 * MM, y: Y0 + 15.5 * MM, s: 'REV 1.0', mm: 0.9, rot: true }],
  }));
  const tp = Array.from({ length: 12 }, (_, i) => ({ x: X0 + (8 + (i % 6) * 1.6) * MM, y: Y0 + (i < 6 ? 6.5 : 14.5) * MM, w: 0.9 * MM, h: 0.9 * MM }));
  g.add(maskTop('nvme-under', face, z0, {
    ...MASK_ART, seed: 11, bare, cuts, pads: tp,
    text: [{ x: X0 + 70.5 * MM, y: Y0 + 3.0 * MM, s: 'M.2 2280-S2-M', mm: 1.0 }, { x: X0 + 70.5 * MM, y: Y0 + 19.2 * MM, s: 'PCIe 4.0 x4', mm: 1.0 }],
  }, { under: true }));
  const sticker = decal(R(24, 2.4, 44, 17.2), z0 - 0.6, decalMat(stickerTex(look), { rough: 0.55, metal: 0.25 }));
  sticker.rotation.x = Math.PI;
  g.add(sticker);
  g.add(padRing(X1, cy, z1, 40, 64, true), padRing(X1, cy, z0, 40, 64, true, true));

  // the screw through the notch into the standoff: an M2 pan head, 4 mm across
  g.add(screws([{ x: X1, y: -cy, z: z1 }], 'z+', 46, mat(0xaab1bb, { metalness: 0.9, roughness: 0.3 })));

  if (look.heatsink) return heatsink(g, X0, X1, Y0, Y1, z1 + 1.4 * MM, look);
  // the label, over the DRAM and the NAND to short of the notch, draped over them
  const L = R(20.8, 0.6, 54.6, 20.8);
  const bumps: Bump[] = [
    { r: dram, top: z1 + 1.0 * MM, fall: 2.2 * MM }, ...nand.map((r) => ({ r, top: z1 + 1.25 * MM, fall: 2.2 * MM })),
    ...parts.filter((p) => p.x > L.x - 20 && p.x < L.x + L.w + 20).map((p) => ({ r: { x: p.x - 10, y: p.y - 6, w: 20, h: 12 }, top: z1 + { '0201': 7, '0402': 11.5, '0603': 18, '0805': 23, '1206': 28 }[p.pkg], fall: 8 })),
  ];
  // (drawn over the mask's decal where it lies on the board)
  const label = mat(0xffffff, { map: labelTex(look), roughness: 0.46, metalness: 0.15, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  g.add(drape(L, z1, bumps, label, 7, lowDetail())); // (Low: one flat quad over the packages, its whole picture, no part through it)
  return label;
}

/**
 * The premium stick's heat sink from the packages' top `zc`: a thermal pad, a black anodised base plate with chamfered corners, skirts down the
 * board's long edges, two banks of transverse fins either side of a raised plateau, the plateau's brushed silver insert engraved with the drive.
 */
function heatsink(g: Group, X0: number, X1: number, Y0: number, Y1: number, zc: number, look: NvmeLook): MeshStandardMaterial {
  const hs = { x: X0 + 6.6 * MM, y: Y0 - 21, w: X1 - 3.8 * MM - (X0 + 6.6 * MM), h: Y1 - Y0 + 42 };
  const anod = mat(0x1c1e23, { metalness: 0.55, roughness: 0.42, map: tiled(brushed(), 5, 1) });
  const zb0 = zc + 12, zb1 = zb0 + 28, zt = NVME_Z.sink;
  g.add(rectBox({ x: hs.x + 12, y: Y0 + 14, w: hs.w - 24, h: Y1 - Y0 - 28 }, zc, zb0, mat(0x8f99a6, { roughness: 0.92 })));
  g.add(slab(shapeOf(outlinePts(hs, 0, [23, 23, 23, 23])), zb0, zb1, anod, 5));
  for (const y of [hs.y, Y1]) g.add(slab(shapeOf(outlinePts({ x: hs.x + 23, y, w: hs.w - 46, h: 21 }, 4)), NVME_Z.pcb, zb0 + 2, anod, 2));
  // the fins, 0.8 mm on a 1.9 mm pitch, either side of the plateau
  const pl = 24 * MM, px = hs.x + (hs.w - pl) / 2, pitch = 44, ft = 18, fh = zt - zb1, items: { x: number; y: number; z: number }[] = [];
  for (const [a, e] of [[hs.x + 28, px - 20], [px + pl + 20, hs.x + hs.w - 28]] as const) {
    const n = Math.floor((e - a - ft) / pitch) + 1, off = (e - a - ft - (n - 1) * pitch) / 2;
    for (let k = 0; k < n; k++) items.push({ x: a + off + ft / 2 + k * pitch, y: -(hs.y + hs.h / 2), z: zb1 + fh / 2 });
  }
  g.add(instanced(new RoundedBoxGeometry(ft, hs.h - 28, fh, 2, 4), anod, items));
  // the plateau and its insert, the insert's edges diamond-cut (bright chamfers)
  const P = { x: px, y: hs.y + 14, w: pl, h: hs.h - 28 }, I = grow(P, -23), silver = mat(0xd0d4da, { metalness: 0.9, roughness: 0.26, map: tiled(brushed(), 2, 1) });
  g.add(slab(shapeOf(outlinePts(P, 0, [30, 30, 30, 30])), zb1 - 2, zt - 20, anod, 4));
  g.add(slab(shapeOf(outlinePts(I, 0, [20, 20, 20, 20])), zt - 20, zt, silver, 7));
  g.add(decal(grow(I, -7), zt + 0.3, decalMat(insertTex(look, (I.w - 14) / MM, (I.h - 14) / MM), { metal: 0.85, rough: 0.28, cut: true })));
  return anod;
}

// ------------------------------------------------------------------ the print
const PX = 40;
const capOf = (look: NvmeLook) => `${Math.round(look.capacityBytes / 1024)}K`;
export const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif', MONO = '"Consolas", "DejaVu Sans Mono", monospace';

export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
/** A seeded random run (the barcodes and the matrix code are the same on every copy of a stick). */
export const seeded = (s: number) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
export const hash = (t: string) => [...t].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 2147483646, 7) + 1;

/** A linear barcode in `ink` over x .. x + w (its quiet zones inside), its digits under it. */
export function barcode(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, ink: string, digits: string) {
  const rnd = seeded(seed), unit = w / 110;
  c.fillStyle = ink;
  for (let u = 6; u < 104;) { const bar = 1 + Math.floor(rnd() * 3), gap = 1 + Math.floor(rnd() * 3); c.fillRect(x + u * unit, y, bar * unit, h); u += bar + gap; }
  c.font = `500 ${h * 0.28}px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(digits, x + w / 2, y + h + h * 0.06); c.textAlign = 'left';
}
/** A matrix code: its solid L finder on the west and south edges, its clock track on the north and east. */
export function matrix(c: CanvasRenderingContext2D, x: number, y: number, s: number, seed: number, ink: string) {
  const n = 16, k = s / n, rnd = seeded(seed);
  c.fillStyle = ink;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const on = i === 0 || j === n - 1 ? true : j === 0 ? i % 2 === 0 : i === n - 1 ? j % 2 === 1 : rnd() > 0.5;
    if (on) c.fillRect(x + i * k, y + j * k, k + 0.5, k + 0.5);
  }
}

/** The top label: the maker's mark, the drive's name and capacity, its interface, a barcode, a matrix code, its serial. */
function labelTex(look: NvmeLook): Texture | null {
  const cap = capOf(look), wm = 54.6, hm = 20.8;
  return tex(`nvme-label:${look.name}:${cap}`, Math.round(wm * PX), Math.round(hm * PX), (c, w, h) => {
    const u = (mm: number) => mm * PX, seed = hash(look.name + cap);
    c.clearRect(0, 0, w, h);
    roundRect(c, 0, 0, w, h, u(0.8)); c.fillStyle = '#16181c'; c.fill();
    // the satin print's grain
    const rnd = seeded(seed + 3);
    for (let i = 0; i < 9000; i++) { c.fillStyle = `rgba(255,255,255,${0.01 + rnd() * 0.025})`; c.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
    c.strokeStyle = 'rgba(170,178,190,0.35)'; c.lineWidth = u(0.12); roundRect(c, u(0.7), u(0.7), w - u(1.4), h - u(1.4), u(0.5)); c.stroke();
    // (the print keeps to the flat over the packages, 4.4 to 16.4 mm down the label: its wings slope down to the board)
    // a silver stripe along each wing
    const stripe = (y: number) => { const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(217,221,227,0.7)'); gr.addColorStop(0.6, 'rgba(217,221,227,0.25)'); gr.addColorStop(1, 'rgba(217,221,227,0)'); c.fillStyle = gr; c.fillRect(u(1.6), y, w - u(3.2), u(0.22)); };
    stripe(u(2.3)); stripe(h - u(2.5));
    // the maker's mark and the drive's kind
    c.textBaseline = 'alphabetic'; c.fillStyle = '#f2f4f7'; c.font = `800 ${u(2.1)}px ${FONT}`;
    (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${u(0.22)}px`;
    c.fillText('PIPELINE', u(1.6), u(7.0));
    const mw = c.measureText('PIPELINE').width + u(1.4);
    (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
    c.fillStyle = '#9aa1ab'; c.font = `600 ${u(0.95)}px ${FONT}`; c.fillText('SOLID STATE DRIVE', u(1.6) + mw, u(6.9));
    // the drive: its name, its capacity large, its interface beside it
    c.fillStyle = '#e8ebef'; c.font = `700 ${u(1.5)}px ${FONT}`;
    const nw = c.measureText(look.name).width, fit = Math.min(1, u(31) / nw);
    c.save(); c.translate(u(1.6), u(9.6)); c.scale(fit, 1); c.fillText(look.name, 0, 0); c.restore();
    c.font = `800 ${u(3.6)}px ${FONT}`; c.fillText(cap, u(1.5), u(14.9));
    const cw = c.measureText(cap).width;
    c.fillStyle = '#a7aeb8'; c.font = `600 ${u(0.95)}px ${FONT}`;
    ['M.2 2280 · PCIe Gen4 x4', 'NVMe 1.4 · 3D TLC NAND', 'HMB · AES-256'].forEach((t, i) => c.fillText(t, u(2.6) + cw, u(11.9 + i * 1.45)));
    c.fillStyle = 'rgba(170,178,190,0.35)'; c.fillRect(u(34.6), u(4.6), u(0.12), u(11.6));
    // the barcode and the matrix code on their white patches, the serial beside them
    c.fillStyle = '#e9ebee'; roundRect(c, u(35.6), u(4.6), u(17.4), u(5.6), u(0.35)); c.fill();
    barcode(c, u(36), u(5.0), u(16.6), u(3.4), seed, '#111317', `0 84512 ${String(seed % 100000).padStart(5, '0')} 6`);
    c.fillStyle = '#e9ebee'; c.fillRect(u(35.6), u(10.9), u(5.4), u(5.4));
    matrix(c, u(35.9), u(11.2), u(4.8), seed + 9, '#111317');
    c.fillStyle = '#c9ced6'; c.font = `600 ${u(0.9)}px ${MONO}`;
    [`S/N  PC2N${String(seed % 1e7).padStart(7, '0')}A`, `MODEL  PC-N2-${cap}`, 'FW  2B4QFXO7', '3.3V ⎓ 2.5A'].forEach((t, i) => c.fillText(t, u(41.8), u(11.8 + i * 1.4)));
  });
}

/** The heat sink's insert: brushed silver, the maker's mark and the drive engraved in it, its chamfered corners cut away. */
function insertTex(look: NvmeLook, wm: number, hm: number): Texture | null {
  const cap = capOf(look);
  return tex(`nvme-insert:${look.name}:${cap}:${wm.toFixed(1)}x${hm.toFixed(1)}`, Math.round(wm * PX), Math.round(hm * PX), (c, w, h) => {
    const u = (mm: number) => mm * PX, k = u(0.55), rnd = seeded(hash(look.name) + 5);
    c.clearRect(0, 0, w, h);
    c.beginPath(); c.moveTo(k, 0); c.lineTo(w - k, 0); c.lineTo(w, k); c.lineTo(w, h - k); c.lineTo(w - k, h); c.lineTo(k, h); c.lineTo(0, h - k); c.lineTo(0, k); c.closePath();
    c.fillStyle = '#c4c8ce'; c.fill(); c.save(); c.clip();
    for (let i = 0; i < 1600; i++) { const y = rnd() * h; c.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${0.05 + rnd() * 0.12})` : `rgba(60,64,72,${0.04 + rnd() * 0.1})`; c.fillRect(0, y, w, 0.6 + rnd() * 1.4); }
    // the engraving: dark in its cut, a bright lip on its far side
    const engrave = (t: string, x: number, y: number, font: string) => { c.font = font; c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillText(t, x, y + 2); c.fillStyle = '#4a5059'; c.fillText(t, x, y); };
    c.textAlign = 'center'; c.textBaseline = 'middle';
    (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${u(0.3)}px`;
    engrave('PIPELINE', w / 2, h * 0.24, `800 ${u(2.1)}px ${FONT}`);
    (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
    engrave(look.name.replace(/\s*\d+K$/, ''), w / 2, h * 0.52, `700 ${Math.min(u(2.0), (w * 0.9) / Math.max(6, look.name.length * 0.58))}px ${FONT}`);
    engrave(cap, w / 2, h * 0.78, `800 ${u(3.2)}px ${FONT}`);
    c.restore();
  });
}

/** The underside's sticker: the model, the serial and its barcodes, the void-if-removed strip. */
function stickerTex(look: NvmeLook): Texture | null {
  const cap = capOf(look), wm = 44, hm = 17.2;
  return tex(`nvme-sticker:${look.name}:${cap}`, Math.round(wm * PX), Math.round(hm * PX), (c, w, h) => {
    const u = (mm: number) => mm * PX, seed = hash(look.name + cap + 'u');
    c.clearRect(0, 0, w, h);
    roundRect(c, 0, 0, w, h, u(0.6)); c.fillStyle = '#c9cdd3'; c.fill();
    c.fillStyle = '#111317'; c.textBaseline = 'alphabetic'; c.font = `800 ${u(1.6)}px ${FONT}`; c.fillText('PIPELINE', u(1.6), u(2.9));
    c.font = `600 ${u(1.0)}px ${FONT}`; c.fillText(`${look.name} · M.2 2280 · PCIe 4.0 x4 NVMe`, u(1.6), u(4.7));
    barcode(c, u(1.4), u(5.8), u(20), u(3.6), seed, '#111317', `PC-N2-${cap}`);
    barcode(c, u(23), u(5.8), u(19.4), u(3.6), seed + 1, '#111317', `S/N PC2N${String(seed % 1e7).padStart(7, '0')}A`);
    matrix(c, u(1.6), u(11.2), u(4.6), seed + 2, '#111317');
    c.font = `600 ${u(0.9)}px ${MONO}`;
    ['3.3V ⎓ 2.5A', 'FW 2B4QFXO7', `MFG ${2023 + (seed % 3)}-${String(1 + (seed % 12)).padStart(2, '0')}`].forEach((t, i) => c.fillText(t, u(7.2), u(12.2 + i * 1.3)));
    c.fillStyle = '#111317'; c.fillRect(u(22.5), u(11.2), u(20), u(4.6));
    c.fillStyle = '#c9cdd3'; c.font = `700 ${u(1.0)}px ${FONT}`; c.textAlign = 'center'; c.fillText('WARRANTY VOID IF REMOVED', u(32.5), u(13.9)); c.textAlign = 'left';
  });
}
