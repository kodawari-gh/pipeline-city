// The CPU cooler and the loop's radiator in 3D, after the 2D art (`cooler.ts`, docs/render/board.md "Cooler"): the same three looks on the same
// mounting plate (`COOLER`), stood up off the board. The stock cooler is a round heatsink of radial vanes under a small fan; the tower a stack of fin
// plates with copper heat pipes arching through them and a fan on its east end that blows west along the fins; the loop a pump head (a brushed ring,
// a ring light round the impeller under a glass dome) whose two stiff braided hoses arc to the radiator's barbs (`hose`, hung round the parts in
// their way). The radiator (`radiatorModel`) is the 2D slab stood up across the case: an end tank at each end, a core of fin plates on the
// outboard side and one fan per mount it covers on the inboard side.
import { BoxGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Shape, SphereGeometry, TorusGeometry, Vector3, type Texture } from 'three';
import { drum, fanRotor, instanced, paint, place, rounded, softBox, tube, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough } from '@/core/render/three/pick';
import { hang, type Plane, type RopeEnd, type Solid, type V3 } from '@/core/render/three/rope';
import { BOARD_Z, FAN_MAX, FAN_ZC } from '@/features/room/render/three/roomplan';
import { COOLER } from '../layout/layout';
import { COOLER_FANS, STOCK_VANES_R, TANK, TUBE_W, frameOf, radiatorPorts, towerFanRect, type RadiatorFit } from '../cooler';
import { band, braidedTube } from './cables3d';
import { caseFan, glowMat, partFan, squareFan, type Spin } from './fans3d';

/** The 2D heatsinks' metal ramp (dark theme `metals`), the heat pipes' copper and each look's accent (`coolerArt`). */
const METAL = { metal: 0x3b4663, hi: 0x56628a, lo: 0x222a41 }, COPPER = 0xc0793a;
const ACCENT = { stock: 0x8a97c2, tower: 0x3be3ff, liquid: 0xa68bff, sub: 0x0d1636, die: 0x111b46 } as const;

export interface Model { root: Group; spins: Spin[]; /** The materials that follow the part's state (`PartSkin`). */ skin: MeshStandardMaterial[] }
/** The radiator the loop's tubes run to: where it is bolted and how many fans it carries. */
export interface RadiatorAt { fit: RadiatorFit; count: number }

const alu = (c: number, rough = 0.34) => mat(c, { metalness: 0.75, roughness: rough });
const corners = (r: RectLike, e: number): [number, number][] => [[r.x + e, r.y + e], [r.x + r.w - e, r.y + e], [r.x + e, r.y + r.h - e], [r.x + r.w - e, r.y + r.h - e]];

// ------------------------------------------------------------------ painted details
let screwTex: Texture | null = null, brushedTex: Texture | null = null;

/** A screw head seen from above: a lit dome and its slot. */
const screwHead = () => screwTex ??= paint(64, 64, (c, w, h) => {
  const g = c.createRadialGradient(w * 0.38, h * 0.35, 2, w / 2, h / 2, w / 2);
  g.addColorStop(0, '#9aa6c8'); g.addColorStop(1, '#2a3248');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 7; c.lineCap = 'round';
  c.beginPath(); c.moveTo(w * 0.2, h * 0.44); c.lineTo(w * 0.8, h * 0.56); c.stroke();
});

/** The pump head's top: brushed in rings, lit toward the north-west as in 2D, with the three turned grooves near its rim. */
const brushed = () => brushedTex ??= paint(512, 512, (c, w, h) => {
  const g = c.createRadialGradient(w * 0.38, h * 0.32, 10, w / 2, h / 2, w / 2);
  g.addColorStop(0, '#7f8bb3'); g.addColorStop(1, '#3a4562');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 4; r < w / 2; r += 1.5) { c.strokeStyle = rnd() < 0.5 ? `rgba(255,255,255,${rnd() * 0.08})` : `rgba(0,0,0,${rnd() * 0.12})`; c.lineWidth = 1; c.beginPath(); c.arc(w / 2, h / 2, r, 0, Math.PI * 2); c.stroke(); }
  c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 3;
  for (const f of [510, 490, 470]) { c.beginPath(); c.arc(w / 2, h / 2, (f / 548) * (w / 2), 0, Math.PI * 2); c.stroke(); }
});

// ------------------------------------------------------------------ small parts
/** Screws standing on a face at depth `z`, `r` round (the plate's corner screws, the push pins). */
function screws(g: Group, at: readonly [number, number][], z: number, r: number) {
  const geo = new CylinderGeometry(r, r * 1.08, r * 0.5, 20).rotateX(Math.PI / 2), side = alu(METAL.hi, 0.3), top = mat(0xffffff, { map: screwHead(), metalness: 0.7, roughness: 0.35 });
  for (const [x, y] of at) { const s = place(new Mesh(geo, [side, top, side])); s.position.set(x, -y, z + r * 0.25); g.add(s); }
}

/** A tube fitting at the world point `p`, pointing along `dir` (a unit vector in the board plane): a collar over the tube's end and a lip at its far end. */
function fitting(g: Group, p: Vector3, dir: Vector3, m: MeshStandardMaterial) {
  const q = new Vector3(0, 1, 0);
  for (const [r, len, at] of [[TUBE_W / 2 + 8, 64, 32], [TUBE_W / 2 + 14, 16, 58]] as const) {
    const o = place(new Mesh(new CylinderGeometry(r, r, len, 24), m));
    o.quaternion.setFromUnitVectors(q, dir);
    o.position.copy(p).addScaledVector(dir, at);
    g.add(o);
  }
}

/** The mounting plate every cooler stands on (the 2D plate, its corner radius 60). */
const plate = (g: Group) => g.add(softBox(COOLER, BOARD_Z + 260, BOARD_Z + 320, alu(0x343d57, 0.4), 60));

// ------------------------------------------------------------------ the three coolers
function stock(g: Group, spins: Spin[]): MeshStandardMaterial {
  const c = COOLER, cx = c.x + c.w / 2, cy = c.y + c.h / 2, Z = BOARD_Z, top = Z + 980, r0 = 340, r1 = STOCK_VANES_R - 14, mid = (r0 + r1) / 2;
  plate(g);
  const vane = alu(METAL.hi);
  g.add(drum(cx, cy, Z + 320, top, r0, alu(METAL.lo), 48));
  // forty radial vanes, a little swept, as the 2D ring of spokes
  g.add(instanced(new BoxGeometry(1, 1, 1), vane, Array.from({ length: 40 }, (_, k) => {
    const a = (k / 40) * Math.PI * 2;
    return { x: cx + Math.cos(a) * mid, y: -cy + Math.sin(a) * mid, z: (Z + 320 + top) / 2, sx: r1 - r0, sy: 22, sz: top - Z - 320, rz: a + 0.18 };
  })));
  // the bezel over the vanes and the small fan in it
  g.add(drum(cx, cy, top - 10, top + 20, 350, mat(ACCENT.sub, { roughness: 0.5 }), 48));
  const f = partFan(cx, cy, top + 130, COOLER_FANS.stock.r, ACCENT.sub);
  g.add(f.root);
  spins.push(f.spin);
  screws(g, corners(c, 100), Z + 320, 34); // the push pins
  return vane;
}

/** A tower fin: a plate across the stack (x, z), its top corners cut and a shallow notch in the middle, `t` thick along y. */
function finPlate(w: number, h: number, t: number) {
  const s = new Shape(), ch = Math.min(80, w * 0.08), n = w * 0.14;
  s.moveTo(-w / 2, 0).lineTo(w / 2, 0).lineTo(w / 2, h - ch).lineTo(w / 2 - ch, h).lineTo(n, h).lineTo(0, h - ch * 0.6).lineTo(-n, h).lineTo(-w / 2 + ch, h).lineTo(-w / 2, h - ch).closePath();
  return new ExtrudeGeometry(s, { depth: t, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, t / 2, 0);
}

function tower(g: Group, spins: Spin[]): MeshStandardMaterial {
  const c = COOLER, Z = BOARD_Z, base = Z + 420, top = Z + 2500;
  plate(g);
  g.add(softBox({ x: c.x + 120, y: c.y + 120, w: c.w - 240, h: c.h - 240 }, Z + 320, base, alu(METAL.metal), 30));
  const slab = towerFanRect(), fin = { x: c.x + 40, y: c.y + 50, w: slab.x - 24 - (c.x + 40), h: c.h - 160 };
  // the fin plates, as the 2D rails: one every 40 units across the stack
  const plates: { x: number; y: number; z: number }[] = [];
  for (let y = fin.y + 14; y + 22 < fin.y + fin.h - 8; y += 40) plates.push({ x: fin.x + fin.w / 2, y: -(y + 11), z: base });
  const finM = alu(0x7a84a6, 0.32);
  g.add(instanced(finPlate(fin.w - 24, top - base, 12), finM, plates));
  // three copper heat pipes: up from the base at each end of the stack, through every plate, and across its top where the 2D view sees them
  const cu = mat(COPPER, { metalness: 0.9, roughness: 0.28 }), yn = -(fin.y + 24), ys = -(fin.y + fin.h - 24);
  for (let k = 0; k < 3; k++) {
    const px = fin.x + fin.w * (0.2 + k * 0.28);
    g.add(tube(rounded([[px, yn, base - 60], [px, yn, top + 30], [px, ys, top + 30], [px, ys, base - 60]], 110, 6), 15, cu, 12));
  }
  // the bracket across the south end, and the fan on the east end, its axis along the fins
  g.add(softBox({ x: c.x + 30, y: c.y + c.h - 100, w: c.w - 60, h: 70 }, Z + 320, Z + 520, alu(METAL.metal), 20));
  const d = Math.min(slab.h, top - base), f = squareFan(d, slab.w, { ring: ACCENT.tower, ringSide: 1, frame: ACCENT.sub });
  f.root.position.set(slab.x + slab.w / 2, -(slab.y + slab.h / 2), base + (top - base) / 2);
  f.root.rotation.y = Math.PI / 2;
  g.add(f.root);
  spins.push({ ...f.spin, fixed: ACCENT.tower });
  return finM;
}

/** Where the loop's hoses start and end: out of the pump's two ports (north) and into the radiator's barbs, the nearer port to the nearer barb. */
export function hoseEnds(rad: RadiatorAt): [RopeEnd, RopeEnd][] {
  const c = COOLER, cx = c.x + c.w / 2, cy = c.y + c.h / 2, ports = radiatorPorts(rad.fit), zb = barbZ(rad), d: V3 = [ports.inward[0], -ports.inward[1], 0];
  const pump = [-120, 120].map((sx): RopeEnd => ({ at: [cx + sx, -(cy - 528) + 66, BOARD_Z + 540], dir: [0, 1, 0] }));
  const barbs = ports.base.map((b): RopeEnd => ({ at: [b[0] + d[0] * 66, -b[1] + d[1] * 66, zb], dir: d })).sort((p, q) => p.at[0] - q.at[0]);
  return [[pump[0]!, barbs[0]!], [pump[1]!, barbs[1]!]];
}

/** One of the loop's hoses: a stiff braided hose (the 2D tube's dark sleeve woven toward the loop's accent) arcing between its ends, a clamp a little in from each end. */
export function hose(a: RopeEnd, b: RopeEnd, env: { planes: Plane[]; solids: Solid[] }): Group {
  const g = new Group(), gap = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]);
  const pts = hang({ a, b, length: gap * 1.12 + 300, r: TUBE_W / 2, stiff: 0.95, n: 30, lead: 160, ...env });
  const { mesh, curve } = braidedTube(pts.map((p) => new Vector3(p[0], p[1], p[2])), TUBE_W / 2, '#0c1226', '#a68bff'), L = curve.getLength(), clamp = alu(0x6a759a, 0.3);
  g.add(mesh);
  for (const s of [130, L - 130]) g.add(band(curve, s, TUBE_W / 2 + 6, 30, clamp));
  return g;
}

function liquid(g: Group, spins: Spin[]): MeshStandardMaterial {
  const c = COOLER, cx = c.x + c.w / 2, cy = c.y + c.h / 2, Z = BOARD_Z, R = 548;
  plate(g);
  screws(g, corners(c, 100), Z + 320, 34);
  g.add(drum(cx, cy, Z + 320, Z + 370, 590, mat(0x141a2c, { metalness: 0.5, roughness: 0.5 }), 64));
  // the pump body: a brushed ring with its turned grooves, the accent edge round its top
  const side = alu(0x4a5578, 0.3), body = place(new Mesh(new CylinderGeometry(R, R, 320, 72).rotateX(Math.PI / 2), [side, mat(0xffffff, { map: brushed(), metalness: 0.8, roughness: 0.32 }), side]));
  body.position.set(cx, -cy, Z + 530);
  g.add(body);
  const edge = place(new Mesh(new TorusGeometry(R, 7, 8, 96), mat(ACCENT.liquid, { roughness: 0.4, metalness: 0.3 })));
  edge.position.set(cx, -cy, Z + 690);
  g.add(edge);
  // the face: a dark well, the ring light round it, the impeller under a glass dome
  g.add(drum(cx, cy, Z + 680, Z + 694, 450, mat(ACCENT.die, { roughness: 0.2, metalness: 0.3 }), 64));
  const ringM = glowMat(ACCENT.liquid, 0x5b4c9c), ring = new Mesh(new TorusGeometry(424, 12, 10, 96), ringM);
  ring.position.set(cx, -cy, Z + 698);
  g.add(seeThrough(ring));
  spins.push({ rotor: new Group(), ring: ringM, needs: null, fixed: ACCENT.liquid });
  // the impeller (`COOLER_FANS.liquid`: five blades), flattened under the dome, with the hub's accent dot
  const imp = new Group();
  imp.position.set(cx, -cy, Z + 745);
  imp.scale.z = 0.5;
  const rotor = fanRotor(COOLER_FANS.liquid.r, COOLER_FANS.liquid.blades, mat(0x2c2f6e, { roughness: 0.4, side: DoubleSide }), alu(METAL.hi, 0.3));
  const dot = new Mesh(new CylinderGeometry(24, 24, 8, 16).rotateX(Math.PI / 2), mat(ACCENT.liquid, { roughness: 0.4 }));
  dot.position.z = 80;
  rotor.add(dot);
  imp.add(rotor);
  g.add(imp);
  spins.push({ rotor, ring: null, needs: null });
  const dome = new Mesh(new SphereGeometry(450, 48, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.26),
    new MeshStandardMaterial({ color: 0xb8c8e8, transparent: true, opacity: 0.12, roughness: 0.04, metalness: 0, envMapIntensity: 0.7, depthWrite: false }));
  dome.position.set(cx, -cy, Z + 694);
  dome.castShadow = false;
  g.add(seeThrough(dome));
  // the two ports on the north rim (the hoses to the radiator hang from them once every part is in: `hose`, machine3d.ts)
  const steel = alu(METAL.hi, 0.3), north = new Vector3(0, 1, 0);
  for (const sx of [-120, 120]) fitting(g, new Vector3(cx + sx, -(cy - 528), Z + 540), north, steel);
  return side;
}

/** The cooler on the CPU, by its spec's `visual` (the loop's hoses are `hose`'s). */
export function coolerModel(visual: string): Model {
  const root = new Group(), spins: Spin[] = [];
  const m = visual === 'cooler-liquid' ? liquid(root, spins) : visual === 'cooler-tower' ? tower(root, spins) : stock(root, spins);
  return { root, spins, skin: [m] };
}

// ------------------------------------------------------------------ the radiator
/** How deep the radiator is: one fan's width, as the case fans on its mounts, and a little more. */
function radiatorDepth(at: RadiatorAt): number {
  const f = frameOf(at.fit.mount, at.fit.end), seg = (f.L - 2 * TANK + 20) / at.count;
  return Math.min(seg, FAN_MAX) * 0.92 + 60;
}

/** The depth of the radiator's barbs, where the tubes come to it (the half of it nearer the board). */
export const barbZ = (at: RadiatorAt): number => FAN_ZC - radiatorDepth(at) / 2 + 170;

/**
 * The radiator on its mount (`ids`: the fan mounts it covers, in order along it; their cables run its fans). `grade` sets the fin pitch and the
 * tanks' stripes, as in 2D.
 */
export function radiatorModel(fit: RadiatorFit, grade: 1 | 2 | 3, ids: readonly string[]): Model {
  const root = new Group(), spins: Spin[] = [], at = { fit, count: ids.length };
  const fr = frameOf(fit.mount, fit.end), { L, S } = fr, CORE = Math.round(S * 0.5), GAP = 10, D = radiatorDepth(at), z0 = FAN_ZC - D / 2, z1 = FAN_ZC + D / 2;
  const cu0 = TANK - 10, cuL = L - 2 * TANK + 20, side = fit.mount.side as 'front' | 'top';
  const box = new BoxGeometry(1, 1, 1), finM = alu(0x6f7a9c, 0.36), tankM = alu(METAL.hi, 0.3), dark = mat(0x0b0f1c, { roughness: 0.6 });
  const item = (r: RectLike, za: number, zb: number) => ({ x: r.x + r.w / 2, y: -(r.y + r.h / 2), z: (za + zb) / 2, sx: r.w, sy: r.h, sz: zb - za });
  // the core: thin fin plates across it (the 2D ladder), the flat coolant tubes through them and a rail along each edge
  const pitch = grade === 3 ? 11 : grade === 2 ? 16 : 22, fins = [];
  for (let u = cu0 + 14; u < cu0 + cuL - 10; u += pitch) fins.push(item(fr.rect(u, 10, 3, CORE - 20), z0, z1));
  root.add(instanced(box, finM, fins));
  const flats = [];
  for (let z = z0 + 50; z < z1 - 40; z += 110) flats.push(item(fr.rect(cu0, 14, cuL, CORE - 28), z, z + 18));
  root.add(instanced(box, dark, flats));
  root.add(instanced(box, tankM, [item(fr.rect(cu0, 0, cuL, 10), z0, z1), item(fr.rect(cu0, CORE - 10, cuL, 10), z0, z1)]));
  // the end tanks, each with its groove and the grade's stripes on the face toward the glass; the fill port on the far one
  const stripe = mat(ACCENT.liquid, { roughness: 0.4 });
  for (const first of [true, false]) {
    const u0 = first ? 0 : L - TANK;
    root.add(softBox(fr.rect(u0, 0, TANK, S), z0 - 20, z1 + 20, tankM, 26));
    const gu = first ? u0 + TANK - 24 : u0 + 24;
    root.add(instanced(box, dark, [item(fr.rect(gu - 3, 18, 6, S - 36), z1 + 20, z1 + 24)]));
    root.add(instanced(box, stripe, Array.from({ length: grade }, (_, k) => item(fr.rect(u0 + (first ? 30 : 70) + k * 30, S * 0.5, 12, S * 0.35), z1 + 20, z1 + 26))));
  }
  const fill = fr.P(L - 100, 42);
  screws(root, [fill], z1 + 20, 20);
  // one fan per mount on the inboard side
  const seg = cuL / ids.length;
  ids.forEach((id, k) => {
    const f = caseFan(id, side, fr.rect(cu0 + k * seg, CORE + GAP, seg, S - CORE - GAP), FAN_ZC, FAN_MAX);
    root.add(f.root);
    spins.push(f.spin);
  });
  // the barbs the tubes plug into, on the inboard face of the tank nearer the pump
  const ports = radiatorPorts(fit), dir = new Vector3(ports.inward[0], -ports.inward[1], 0), zb = barbZ(at);
  for (const b of ports.base) fitting(root, new Vector3(b[0], -b[1], zb), dir, alu(METAL.hi, 0.3));
  return { root, spins, skin: [tankM] };
}
