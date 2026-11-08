// A graphics card's own parts as real ones (docs/PC_PARTS.md), built in card3d's lying pose: x along the card from its bracket, layout y from the
// slot's line (`y0`) to the top edge (`end`), z up off the PCB's face (the 2D art's plane, `Z`). The cooler hangs under the PCB (its underside at
// `Zp`), the backplate lies over it. Standing (card3d's hinge) the top edge faces the glass, the fans face down and the backplate up.
// The cooler: a chamfered shroud with a raised bezel round each fan, edge lips and gussets with their screws; axial fans with a sticker on each
// hub (the best card's blades tied by a rim ring); an aluminium fin stack at 2 mm pitch behind them, real 6 mm heat pipes out of a nickel base
// over the die, bent into the fins; the light bar and the maker's name on the top edge. The backplate: brushed metal with chamfered corners,
// a cut-out behind the die with its capacitor array and the X bracket's four spring screws, vents over the power stage, the maker's name, the
// long card's flow-through window. The 8-pin power sockets, keyed 2 x 4 Mini-Fit housings on the top edge; the display outputs at their real
// size through the bracket, an HDMI and three DisplayPorts in their keyed shells.
import { BoxGeometry, CylinderGeometry, DoubleSide, Group, Mesh, PlaneGeometry, SphereGeometry, Vector2, type Material, type MeshStandardMaterial } from 'three';
import { drum, extrude, fanRotor, instanced, place, rectBox, rounded, tube, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { gpuFanCount } from '@/features/gpu/render/gpulayout';
import { NIC_BRACKET_X } from '../layout/layout';
import { brushed, decal, outlinePts, screws, shapeOf, slab, tex, wallPt, type Span, type Spot } from './casekit3d';
import { glowMat, motor, type Spin } from './fans3d';
import { decalMat, maskTop, MM, passives, type Passive } from './pcbkit3d';

/** The card's frame in the lying pose (card3d's `frame`): the PCB's west end and east end, the cooler's east end, the slot's line, the top edge. */
export interface CardFrame { x0: number; x1: number; xe: number; y0: number; end: number }

/** One display output: HDMI or DisplayPort, its centre along the card's height from the slot's line, its shell's width, height and depth. */
interface Output { kind: 'hdmi' | 'dp'; c: number; w: number; h: number; d: number }
/** The outputs from the slot's line up, at their real size and pitch (mm): an HDMI, then three DisplayPorts. */
export const OUTPUTS: readonly Output[] = [
  { kind: 'hdmi', c: 14 * MM, w: 15.2 * MM, h: 6 * MM, d: 11.5 * MM },
  ...[34.5, 55, 75.5].map((c): Output => ({ kind: 'dp', c: c * MM, w: 17 * MM, h: 6.2 * MM, d: 15 * MM })),
];
/** How far the outputs' shells stand off the PCB's underside (they sit on it), and how far their mouths stand in behind the bracket's face. */
export const OUT_OFF = 2, OUT_IN = 6;
/** The middle of an output's mouth across the card's thickness, under the PCB's underside. */
export const outDepth = (o: Output): number => OUT_OFF + o.h / 2;
/** The top of the bracket's port openings over the slot's line: the vents start past it. */
export const OUT_TOP = Math.max(...OUTPUTS.map((o) => o.c + o.w / 2)) + 1.5 * MM;

/** An 8-pin power socket's housing (mm): its length along the card, its height off the PCB, its depth in from the top edge. */
const SOCKET = { w: 21.2 * MM, h: 9.8 * MM, d: 13 * MM };
/** Where a card's 8-pin sockets stand along it, from the PCB's east end in: one each on the cards that take a lead (`cardPlugs`'s count). */
const socketsAt = (visual: string, f: CardFrame): number[] => (visual === 'gpu-3' ? [f.x1 - 14 * MM, f.x1 - 38 * MM] : visual === 'gpu-2' ? [f.x1 - 14 * MM] : []);

/** Each tier's finish: the shroud, the bezels and lips, the backplate, the heat pipes (copper on the entry card), the fans' blades. */
const LOOK: Record<string, { shroud: number; bezel: number; bezelMetal: boolean; back: number; backMetal: boolean; pipe: number; blades: number; rim: boolean; lips: boolean }> = {
  'gpu-1': { shroud: 0x15171b, bezel: 0x23262c, bezelMetal: false, back: 0x15171a, backMetal: false, pipe: 0xb8774a, blades: 9, rim: false, lips: false },
  'gpu-2': { shroud: 0x262a31, bezel: 0x9aa2ad, bezelMetal: true, back: 0x2a2f37, backMetal: true, pipe: 0xc3cad2, blades: 11, rim: false, lips: true },
  'gpu-3': { shroud: 0x1a1d23, bezel: 0xb4bcc6, bezelMetal: true, back: 0x3a4049, backMetal: true, pipe: 0xc3cad2, blades: 11, rim: true, lips: true },
};
const lookOf = (visual: string) => LOOK[visual] ?? LOOK['gpu-1']!;

/** Where the die sits on the real card: under the backplate's X bracket and the cooler's base (40 % along the PCB, 50 mm over the slot's line). */
export const gpuDie = (f: CardFrame) => ({ x: f.x0 + (f.x1 - f.x0) * 0.42, y: f.y0 + 50 * MM });

/** A layout point as a shape point (y up). */
const V = (x: number, y: number) => new Vector2(x, -y);
/** A circle's outline round a layout point. */
const circle = (cx: number, cy: number, r: number, n = 64): Vector2[] => Array.from({ length: n }, (_, k) => V(cx + Math.cos((k / n) * Math.PI * 2) * r, cy - Math.sin((k / n) * Math.PI * 2) * r));
/** Scale an extruded mesh's uvs (its shape's coordinates) so a texture spans `k` layout units. */
function uvSpan<T extends Mesh>(o: T, k: number): T {
  const uv = o.geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / k, uv.getY(i) / k);
  uv.needsUpdate = true;
  return o;
}
/** A prism across x (x0 to x1) from an outline of `wallPt` points with holes: a port's shell, its mouth through it. */
function prismX(x0: number, x1: number, outline: Vector2[], holes: Vector2[][], m: Material, bevel = 0): Mesh {
  const b = Math.max(0, Math.min(bevel, (x1 - x0) / 2.2));
  const g = extrude(shapeOf(outline, holes), { depth: x1 - x0 - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, b).rotateY(-Math.PI / 2).translate(x1, 0, 0);
  return place(new Mesh(g, m));
}

/** A word painted for a decal: `ink` letters on a clear ground (cut by alpha), centred. */
function word(key: string, s: string, w: number, h: number, ink: string, weight = 700): ReturnType<typeof tex> {
  return tex(`gpu-word:${key}`, w, h, (c) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = ink; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `${weight} ${Math.round(h * 0.72)}px "Segoe UI", "DejaVu Sans", sans-serif`;
    if ('letterSpacing' in c) (c as unknown as { letterSpacing: string }).letterSpacing = `${Math.round(h * 0.08)}px`;
    c.fillText(s, w / 2, h / 2 + h * 0.03);
  });
}

/** A fan's hub sticker: a dark disc with a thin ring and the maker's mark. */
function hubSticker(): ReturnType<typeof tex> {
  return tex('gpu-hub', 256, 256, (c, w, h) => {
    const g = c.createRadialGradient(w * 0.42, h * 0.38, 8, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#30343c'); g.addColorStop(1, '#15171b');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#8a929e'; c.lineWidth = 5; c.beginPath(); c.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2); c.stroke();
    // the mark: a hexagon round a smaller solid one, the maker's sign
    const hexPath = (r: number) => {
      c.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; c.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r); }
      c.closePath();
    };
    c.strokeStyle = '#c9d0da'; c.lineWidth = 12; c.lineJoin = 'round';
    hexPath(w * 0.22); c.stroke();
    c.fillStyle = '#c9d0da'; hexPath(w * 0.09); c.fill();
  });
}

/**
 * One of the card's fans, its face at the holder's z = 0, its body back to -depth (the holder turns it to face out of the shroud): the duct, the
 * motor on its struts, the rotor with `blades` blades and the sticker on its hub, a rim ring round the tips (`rim`).
 */
function gpuFan(r: number, depth: number, blades: number, rim: boolean): { root: Group; spin: Spin } {
  const root = new Group(), body = new Group();
  body.position.z = -depth / 2;
  root.add(body);
  const duct = place(new Mesh(new CylinderGeometry(r * 1.035, r * 1.035, depth, 64, 1, true).rotateX(Math.PI / 2), mat(0x121317, { roughness: 0.6, side: DoubleSide })));
  body.add(duct);
  motor(body, r, depth, 4);
  const bladeM = mat(0x1f2126, { roughness: 0.42, metalness: 0.05, side: DoubleSide }), hubM = mat(0x1a1c20, { roughness: 0.45 });
  const rotor = fanRotor(r * 0.97, blades, bladeM, hubM, { chord: blades > 9 ? 0.5 : 0.6, pitch: 0.72 });
  // (a thin fan: the blades and the hub stay inside the duct's depth)
  rotor.scale.z = Math.min(1, (depth * 0.44) / (r * 0.22));
  const sticker = place(new Mesh(new CylinderGeometry(r * 0.27, r * 0.27, r * 0.012, 40).rotateX(Math.PI / 2), [hubM, mat(0xffffff, { map: hubSticker(), roughness: 0.5 }), hubM]));
  sticker.position.z = r * 0.212;
  rotor.add(sticker);
  if (rim) {
    // the barrier ring tying the blade tips together
    const ring = place(new Mesh(new CylinderGeometry(r * 0.972, r * 0.972, r * 0.07, 96, 1, true).rotateX(Math.PI / 2), mat(0x1f2126, { roughness: 0.42, side: DoubleSide })));
    rotor.add(ring);
  }
  body.add(rotor);
  return { root, spin: { rotor, ring: null, needs: null } };
}

/**
 * The cooler under the PCB, from its bezels at `Zp - ct` (the face 1.6 mm in) to the PCB's underside `Zp`: the shroud with its fans, the fin stack and the heat pipes,
 * the light bar and the name along the top edge. `flow`: the card's end runs past the PCB and its fins up to the backplate's window. Returns the
 * shroud's material and the light bar's (`PartSkin`).
 */
export function gpuCooler(g: Group, spins: Spin[], visual: string, f: CardFrame, Zp: number, Z: number, backT: number, ct: number, flow: boolean): MeshStandardMaterial[] {
  const { x0, x1, xe, y0, end } = f, L = lookOf(visual), zB = Zp - ct + 1.6 * MM, xa = x0 + 60, xb = xe, ya = y0 + 110, yb = end - 8, cy = (ya + yb) / 2;
  const frameM = mat(L.shroud, { metalness: 0.35, roughness: 0.5 });
  const bezelM = L.bezelMetal ? mat(L.bezel, { metalness: 0.85, roughness: 0.3, map: brushed() }) : mat(L.bezel, { roughness: 0.48 });
  const screwM = mat(0x2a2d33, { metalness: 0.7, roughness: 0.4 });
  // ---- the shroud's face: a plate chamfered at its corners (a long cut at the far top corner), a hole per fan
  const n = gpuFanCount(visual), seg = (xb - xa) / n, PLATE = 58, BEZ = 3.2 * MM;
  const plugs = socketsAt(visual, f), plugX0 = plugs.length ? Math.min(...plugs) - SOCKET.w / 2 - 4 * MM : Infinity;
  const r = Math.min((seg / 2 - 40 - BEZ) / 1.035, ((yb - ya) / 2 - 40 - BEZ) / 1.035, 47.5 * MM), rd = r * 1.035, rb = rd + BEZ;
  const cut = [2 * MM, 5 * MM, 12 * MM, 2 * MM] as [number, number, number, number], face = { x: xa, y: ya, w: xb - xa, h: yb - ya };
  const fans = Array.from({ length: n }, (_, k) => xa + seg * (k + 0.5));
  g.add(slab(shapeOf(outlinePts(face, 0, cut), fans.map((fx) => circle(fx, cy, rd))), zB, zB + PLATE, frameM, 10));
  // the rim walls round it, low on the bottom edge, higher on the top edge where the light bar runs; the ends close the cooler
  const wallLo = zB + ct * 0.3, wallHi = zB + ct * 0.62, t = 2.5 * MM;
  const inner = outlinePts({ x: xa + t, y: ya + t, w: xb - xa - 2 * t, h: yb - ya - 2 * t }, 0, cut.map((c) => Math.max(1, c - 0.41 * t)) as typeof cut);
  g.add(slab(shapeOf(outlinePts(face, 0, cut), [inner]), zB + PLATE - 2, wallLo, frameM, 4));
  g.add(slab(shapeOf(outlinePts({ x: xa + cut[3], y: yb - t, w: Math.min(xb - cut[2], plugX0) - xa - cut[3], h: t }, 0)), wallLo - 2, wallHi, frameM, 4));
  // (the bracket end stops short of the outputs on the PCB; the far end runs up to the backplate past the PCB)
  g.add(rectBox({ x: xa, y: ya + t, w: t, h: yb - ya - 2 * t }, wallLo - 2, Zp - 6.5 * MM, frameM));
  g.add(rectBox({ x: xb - t, y: ya + cut[1], w: t, h: yb - ya - cut[1] - cut[2] }, wallLo - 2, xb > x1 + 30 ? Z + 2 : Zp - 30, frameM));
  // ---- the bezels: a raised ring round each fan, and (the better cards) metal lips along the long edges and gussets between the fans
  for (const fx of fans) g.add(uvSpan(slab(shapeOf(circle(fx, cy, rb), [circle(fx, cy, rd)]), zB - 1.6 * MM, zB + 10, bezelM, 8), 600));
  const spots: Spot[] = [];
  if (L.lips) {
    for (const [y, h] of [[ya + 1 * MM, 2 * MM], [yb - 3 * MM, 2 * MM]] as const) g.add(uvSpan(slab(shapeOf(outlinePts({ x: xa + cut[0] + 3 * MM, y, w: xb - xa - cut[0] - cut[2] - 6 * MM, h }, h / 2)), zB - 1.1 * MM, zB + 10, bezelM, 6), 600));
  }
  for (let k = 1; k < n; k++) {
    const gx = xa + seg * k;
    for (const s of [1, -1]) {
      // a gusset in the gap between two bezels and the edge, a screw through it
      const edge = s > 0 ? yb - 4 * MM : ya + 4 * MM, tip = edge - s * 12 * MM;
      g.add(slab(shapeOf([V(gx - 7 * MM, edge), V(gx + 7 * MM, edge), V(gx, tip)]), zB - 1.1 * MM, zB + 10, L.lips ? bezelM : frameM, 4));
      spots.push({ x: gx, y: -(edge - s * 4.5 * MM), z: zB - 0.7 * MM });
    }
  }
  for (const [x, y] of [[xa + 4 * MM, ya + 4 * MM], [xa + 4 * MM, yb - 4 * MM], [xb - 6 * MM, ya + 6 * MM], [xb - 10 * MM, yb - 10 * MM]] as const) spots.push({ x, y: -y, z: zB });
  g.add(screws(spots, 'z-', 1.8 * MM, screwM));
  // ---- the fans, facing out of the shroud
  const fanD = Math.min(9 * MM, ct * 0.4);
  for (const fx of fans) {
    const holder = new Group(), fan = gpuFan(r, fanD, L.blades, L.rim);
    holder.position.set(fx, -cy, zB + 30);
    holder.rotation.x = Math.PI;
    holder.add(fan.root);
    g.add(holder);
    spins.push(fan.spin);
  }
  // ---- the base over the die and the heat pipes out of it, then the fin stack round them
  const die = gpuDie(f), BASE = 20 * MM, zBase = Zp - 3 * MM - 2.2 * MM, fz0 = zB + 30 + fanD + 0.6 * MM, fz1 = Zp - 1.3 * MM, zMid = (fz0 + fz1) / 2, PR = 3 * MM;
  const nickel = mat(0xc4cbd3, { metalness: 0.9, roughness: 0.24 });
  g.add(rectBox({ x: die.x - BASE, y: die.y - BASE, w: 2 * BASE, h: 2 * BASE }, Zp - 3 * MM, Zp - 0.2 * MM, nickel));
  const pipeM = mat(L.pipe, { metalness: 0.9, roughness: 0.26 }), np = 2 + n, pitch = 7.5 * MM;
  const finX0 = x0 + 15 * MM, finX1 = xb - 3 * MM;
  const trench = { x0: die.x - ((np - 1) / 2) * pitch - 6 * MM, x1: die.x + ((np - 1) / 2) * pitch + 6 * MM };
  const rows = { west: 0, east: 0 };
  const order = Array.from({ length: np }, (_, k) => k).sort((a, b) => Math.abs(a - (np - 1) / 2) - Math.abs(b - (np - 1) / 2));
  for (const k of order) {
    const x = die.x + (k - (np - 1) / 2) * pitch, dir = k < (np - 1) / 2 ? -1 : 1, j = dir < 0 ? rows.west++ : rows.east++;
    const yTop = yb - 30 - PR - 1.5 * MM - j * 7.6 * MM, yBot = ya + 30 + PR + 1.5 * MM + j * 7.6 * MM;
    const topEnd = dir < 0 ? finX0 + 5 * MM : Math.min(finX1 - 5 * MM, yTop > end - SOCKET.d - 2 * MM - PR ? plugX0 - 3 * MM : Infinity), botEnd = dir < 0 ? finX0 + 5 * MM : finX1 - 5 * MM;
    const pts: [number, number, number][] = [[topEnd, -yTop, zMid], [x, -yTop, zMid], [x, -(die.y + BASE + 6 * MM), zBase], [x, -(die.y - BASE - 6 * MM), zBase], [x, -yBot, zMid], [botEnd, -yBot, zMid]];
    g.add(tube(rounded(pts, 9 * MM, 6), PR, pipeM, 14));
    // the sealed, crimped ends
    for (const [ex, ey] of [[topEnd, yTop], [botEnd, yBot]] as const) {
      const cap = place(new Mesh(new SphereGeometry(PR, 14, 8).scale(1.4, 1, 0.55), pipeM));
      cap.position.set(ex + dir * PR * 0.8, -ey, zMid);
      g.add(cap);
    }
  }
  // the fins: thin plates across the card, 2 mm apart; low over the trench where the pipes run up to the base, short under the power sockets,
  // and past the PCB's end up to the backplate (its window, on the long card: the air goes straight through)
  const finM = mat(0xb3bbc6, { metalness: 0.8, roughness: 0.34 }), plates = [], fy0 = ya + 30, fy1 = yb - 30;
  for (let x = finX0; x < finX1; x += 2 * MM) {
    const zt = x > x1 + 30 ? (flow ? Z + backT - 6 : Z - 4) : x > trench.x0 && x < trench.x1 ? Math.min(zMid, zBase) - PR - 0.4 * MM : fz1;
    const top = plugs.some((p) => Math.abs(x - p) < SOCKET.w / 2 + 1.5 * MM) ? end - SOCKET.d - 2 * MM : fy1;
    if (zt - fz0 > 2 * MM) plates.push({ x, y: -(fy0 + top) / 2, z: (fz0 + zt) / 2, sx: 0.4 * MM, sy: top - fy0, sz: zt - fz0 });
  }
  g.add(instanced(new BoxGeometry(1, 1, 1), finM, plates));
  // ---- the top edge (it faces the glass, standing): the light bar either side of the maker's name
  const accent = glowMat(0x3be3ff, 0x1d6f80), zl = (wallLo + wallHi) / 2, nameH = (wallHi - wallLo) * 0.7, nameW = (nameH * 1024) / 112, nameX = (xa + Math.min(xb, plugX0)) / 2;
  for (const [b0, b1] of [[xa + 8 * MM, nameX - nameW / 2 - 4 * MM], [nameX + nameW / 2 + 4 * MM, Math.min(xb - 14 * MM, plugX0 - 2 * MM)]] as const) if (b1 - b0 > 200) g.add(rectBox({ x: b0, y: yb, w: b1 - b0, h: 6 }, zl - 0.6 * MM, zl + 0.6 * MM, accent));
  spins.push({ rotor: new Group(), ring: accent, needs: null, fixed: 0x3be3ff });
  const name = word('edge', 'PIPELINE', 1024, 112, '#c8ced8');
  if (name) {
    const d = new Mesh(new PlaneGeometry(nameW, nameH).rotateX(Math.PI / 2), decalMat(name, { rough: 0.4, metal: 0.6, cut: true }));
    d.position.set(nameX, -(yb + 0.6), zl);
    g.add(d);
  }
  return [frameM, accent];
}

/**
 * The backplate over the PCB's face, from `Z + 4` to `Z + backT`: brushed metal with its corners chamfered, a cut-out behind the die (the PCB's
 * capacitor array and the X bracket with its four spring screws show in it), vents over the power stage, screws round its rim and the maker's name
 * engraved; the long card's window past the PCB, where its fins show through.
 */
export function gpuBackplate(g: Group, visual: string, f: CardFrame, Z: number, backT: number, flow: boolean): void {
  const { x0, x1, xe, y0, end } = f, L = lookOf(visual), die = gpuDie(f), HOLE = 21 * MM;
  const backM = L.backMetal ? mat(L.back, { metalness: 0.7, roughness: 0.38, map: brushed() }) : mat(L.back, { metalness: 0.3, roughness: 0.55 });
  const plate = { x: x0 + 40, y: y0 + 20, w: xe - 10 - x0 - 40, h: end - 10 - y0 - 20 }, holes: Vector2[][] = [];
  holes.push(outlinePts({ x: die.x - HOLE, y: die.y - HOLE, w: 2 * HOLE, h: 2 * HOLE }, 3 * MM));
  if (flow) holes.push(outlinePts({ x: x1 + 80, y: y0 + 240, w: xe - 130 - x1 - 80, h: end - 240 - y0 - 240 }, 60));
  // the vents: slots along the card's height over the power stage, east of the die
  const vx0 = die.x + HOLE + 5 * MM, vents: RectLike[] = [];
  for (let k = 0, x = vx0; k < 10 && x < x1 - 8 * MM; k++, x += 4 * MM) for (const dy of [-26, 0, 26]) vents.push({ x, y: die.y + dy * MM - 9 * MM, w: 2.2 * MM, h: 18 * MM });
  for (const v of vents) holes.push(outlinePts(v, 1.1 * MM));
  g.add(uvSpan(slab(shapeOf(outlinePts(plate, 30, [0, 5 * MM, 12 * MM, 0]), holes), Z + 4, Z + backT, backM, 3), 900));
  // the name engraved toward the top edge, its tops toward the slot (it reads from the glass, over the card)
  const nm = word('back', 'PIPELINE', 1024, 128, L.backMetal ? '#d4d9e0' : '#8d939c');
  if (nm) g.add(decal({ x: (x0 + x1) / 2 - 30 * MM, y: end - 21 * MM, w: 60 * MM, h: 7.5 * MM }, Z + backT + 0.3, decalMat(nm, { rough: 0.35, metal: 0.5, cut: true })));
  // the PCB in the cut-out: its mask with the traces and vias, the capacitor array behind the die, the X bracket and its spring screws
  const win = { x: die.x - HOLE, y: die.y - HOLE, w: 2 * HOLE, h: 2 * HOLE };
  g.add(maskTop(`gpu-back:${visual}`, win, Z, { mask: '#0d1016', trace: '#161b26', seed: 77, text: [{ x: die.x - HOLE + 2 * MM, y: die.y + HOLE - 2.5 * MM, s: 'GPU1', mm: 1.2 }] }));
  const caps: Passive[] = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) caps.push({ x: die.x + (i - 2.5) * 1.6 * MM, y: die.y + (j - 2.5) * 1.6 * MM, pkg: '0402', kind: 'cap', turn: (i + j) % 2 === 1 });
  for (let i = 0; i < 12; i++) for (const s of [-1, 1]) caps.push({ x: die.x + (i - 5.5) * 1.3 * MM, y: die.y + s * 7.5 * MM, pkg: '0201', kind: i % 5 === 2 ? 'res' : 'cap' });
  passives(g, caps, Z);
  const spring = mat(0x24272d, { metalness: 0.6, roughness: 0.42 }), arm = 16 * MM, at = arm / Math.SQRT2;
  g.add(instanced(new BoxGeometry(1, 1, 1), spring, [{ x: die.x, y: -die.y, z: Z + 1.4 * MM, sx: 2 * arm + 4 * MM, sy: 3.6 * MM, sz: 0.8 * MM, rz: Math.PI / 4 }, { x: die.x, y: -die.y, z: Z + 1.4 * MM, sx: 2 * arm + 4 * MM, sy: 3.6 * MM, sz: 0.8 * MM, rz: -Math.PI / 4 }]));
  g.add(drum(die.x, die.y, Z + 1 * MM, Z + 1.9 * MM, 4 * MM, spring, 24));
  const coil = mat(0x8e959f, { metalness: 0.75, roughness: 0.35 }), xs: Spot[] = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const x = die.x + sx * at, y = die.y + sy * at;
    g.add(drum(x, y, Z + 1.8 * MM, Z + 3.4 * MM, 1.9 * MM, coil, 14));
    xs.push({ x, y: -y, z: Z + 3.4 * MM });
  }
  g.add(screws(xs, 'z+', 2.6 * MM, mat(0xa9b0ba, { metalness: 0.85, roughness: 0.3 })));
  // the screws round the plate's rim
  const rim: Spot[] = [], xr = flow ? x1 - 8 * MM : xe - 14 * MM;
  for (const x of [x0 + 6 * MM, (x0 + xr) / 2, xr]) for (const y of [y0 + 5 * MM, end - 6 * MM]) rim.push({ x, y: -y, z: Z + backT });
  g.add(screws(rim, 'z+', 1.9 * MM, mat(0x1c1e22, { metalness: 0.6, roughness: 0.4 })));
}

/**
 * The 8-pin power sockets on the top edge, on the cooler's side of the PCB, their mouths toward the glass (standing): keyed 2 x 4 Mini-Fit housings,
 * the latch ridge on the outer side. Returns each mouth's middle standing (layout x and y, and the depth of the top edge where a plug goes in).
 */
export function gpuSockets(g: Group, visual: string, f: CardFrame, Zp: number, hinge: number, stand: number, pcbT: number): { x: number; y: number; z: number }[] {
  const housing = mat(0x16181c, { roughness: 0.5 }), dark = mat(0x050608, { roughness: 0.9 }), tin = mat(0x9aa2ac, { metalness: 0.8, roughness: 0.4 });
  const { w, h, d } = SOCKET, mouth = f.end + 6;
  return socketsAt(visual, f).map((sx) => {
    // (the housing in a frame of its own: x along the card, y up off the PCB (lying z, down), z out of its mouth (lying y))
    const s = new Group();
    s.rotation.x = Math.PI / 2;
    s.position.set(sx, -mouth, Zp - h / 2);
    const holes: Vector2[][] = [], sleeves = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      const cx = (i - 1.5) * 4.2 * MM, cyy = (j - 0.5) * 4.2 * MM, a = 3 * MM, k = (i + j) % 2 ? 0.9 * MM : 0;
      holes.push(outlinePts({ x: cx - a / 2, y: cyy - a / 2, w: a, h: a }, 0.3 * MM, k ? [0, 0, k, k] : [0, 0, 0, 0]));
      sleeves.push({ x: cx, y: -cyy, z: -1.6 * MM, sx: a * 0.5, sy: a * 0.5, sz: 0.4 * MM });
    }
    s.add(slab(shapeOf(outlinePts({ x: -w / 2, y: -h / 2, w, h }, 0.6 * MM), holes), -1.2 * MM, 0, housing, 0.3 * MM));
    s.add(rectBox({ x: -w / 2, y: -h / 2, w, h }, -d, -1.2 * MM, housing), rectBox({ x: -w / 2 + 0.6 * MM, y: -h / 2 + 0.6 * MM, w: w - 1.2 * MM, h: h - 1.2 * MM }, -1.3 * MM, -1.1 * MM, dark));
    s.add(instanced(new BoxGeometry(1, 1, 1), tin, sleeves));
    // the latch ridge on the outer face (away from the PCB) by the mouth
    s.add(rectBox({ x: -2.6 * MM, y: h / 2, w: 5.2 * MM, h: 1.6 * MM }, -4.5 * MM, -0.4 * MM, housing));
    g.add(s);
    // its solder tails through the PCB's top edge, behind the housing
    return { x: sx, y: f.y0 + pcbT + h / 2, z: hinge + stand + 6 };
  });
}

/**
 * The display outputs on the PCB by the bracket (`OUTPUTS`): each a tinned steel shell keyed as a real one is (HDMI's two corners cut on the side
 * away from the PCB, DP's one), its mouth dark inside with the contact tongue in it.
 */
export function gpuOutputs(g: Group, f: CardFrame, Zp: number): void {
  const shell = mat(0xb9bfc7, { metalness: 0.85, roughness: 0.33 }), dark = mat(0x08090b, { roughness: 0.85 }), tongue = mat(0x15161a, { roughness: 0.5 });
  const goldM = mat(0xd9b25e, { metalness: 0.9, roughness: 0.3 }), xm = NIC_BRACKET_X + OUT_IN;
  for (const o of OUTPUTS) {
    const yc = f.y0 + o.c, zc = Zp - outDepth(o), y0 = yc - o.w / 2, y1 = yc + o.w / 2, z0 = zc - o.h / 2, z1 = zc + o.h / 2, k = (o.kind === 'hdmi' ? 1.6 : 1.9) * MM;
    // (the cut corners are on the low side, away from the PCB: lying z0)
    const key = (a: number, b: number, c0: number, c1: number, kk: number): Vector2[] => o.kind === 'hdmi'
      ? [wallPt(a + kk, c0), wallPt(b - kk, c0), wallPt(b, c0 + kk), wallPt(b, c1), wallPt(a, c1), wallPt(a, c0 + kk)]
      : [wallPt(a + kk, c0), wallPt(b, c0), wallPt(b, c1), wallPt(a, c1), wallPt(a, c0 + kk)];
    const e = 0.45 * MM;
    g.add(prismX(xm, xm + o.d, key(y0, y1, z0, z1, k), [key(y0 + e, y1 - e, z0 + e, z1 - e, k - e * 0.4)], shell, 0.2 * MM));
    // the floor of the mouth and the tongue, its contacts on the side toward the PCB
    g.add(rectBox({ x: xm + 8 * MM, y: y0 + e, w: 1 * MM, h: o.w - 2 * e }, z0 + e, z1 - e, dark));
    const tw = o.w * 0.66, tz = zc + o.h * 0.08;
    g.add(rectBox({ x: xm + 1.4 * MM, y: yc - tw / 2, w: 7 * MM, h: tw }, tz - 0.75 * MM, tz + 0.75 * MM, tongue));
    g.add(rectBox({ x: xm + 1.6 * MM, y: yc - tw / 2 + 0.5 * MM, w: 4 * MM, h: tw - 1 * MM }, tz + 0.75 * MM, tz + 0.85 * MM, goldM));
  }
}

/** The bracket's openings for the outputs (`gpuBracket`), a hair larger than each shell. */
export const outputHoles = (y0: number, Zp: number): Span[] => OUTPUTS.map((o) => {
  const yc = y0 + o.c, zc = Zp - outDepth(o), e = 0.5 * MM;
  return { y0: yc - o.w / 2 - e, y1: yc + o.w / 2 + e, z0: zc - o.h / 2 - e, z1: zc + o.h / 2 + e, r: 0.8 * MM };
});

