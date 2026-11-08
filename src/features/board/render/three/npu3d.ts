// An AI card's own parts as real ones (docs/PC_PARTS.md), built in card3d's lying pose (gpu3d.ts's frame: x along the card from its bracket,
// layout y from the slot's line `y0` to the top edge `end`, z up off the PCB's face `Z`, the cooler under its underside `Zp`). A blower card, as an
// inference card or a workstation card is: a closed shroud with one intake near the far end, its raised plateau with the name and the intake's
// bezel; under it the centrifugal fan in its scroll, which widens round the impeller to an outlet toward the bracket; the vapour chamber's fin
// block over the die between the fan and the bracket; the air goes out through the bracket's honeycomb. Over the PCB's face, a brushed backplate
// with the die's cut-out (its capacitor array and X bracket) and vents over the power stage. The top edge carries the name and the violet line.
import { BoxGeometry, CylinderGeometry, DoubleSide, Group, Mesh, PlaneGeometry, type Material, type MeshStandardMaterial, type Vector2 } from 'three';
import { extrude, instanced, place, rectBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { brushed, decal, outlinePts, screws, shapeOf, slab, wallPt, wallX, type Span, type Spot } from './casekit3d';
import type { Spin } from './fans3d';
import { circle, dieBack, hubSticker, uvSpan, V, word, type CardFrame } from './gpu3d';
import { decalMat, MM } from './pcbkit3d';

/** Each AI card's finish: the shroud, its raised plateau (brushed), the intake's bezel, the backplate. */
const LOOK: Record<string, { shroud: number; plateau: number; bezel: number; back: number }> = {
  'npu-1': { shroud: 0x1b1d22, plateau: 0x3a3f48, bezel: 0x737a85, back: 0x1d2027 },
  'npu-2': { shroud: 0x2a2e36, plateau: 0x4a505a, bezel: 0xb4bcc6, back: 0x353b45 },
};
const lookOf = (visual: string) => LOOK[visual] ?? LOOK['npu-1']!;

/** The shroud's layers (mm in layout units): the plateau's rise over the face plate, the plate's thickness, the walls'. */
const RISE = 1.2 * MM, PLATE = 2 * MM, WALL = 1.6 * MM, SCROLL = 1.2 * MM;

/**
 * Where the shroud's parts sit on a card: the shroud's face (`xa..xb`, `ya..yb`), the blower's centre and impeller radius, the intake's radius,
 * the scroll's radius at a turn `a` (layout angle: 0 toward the far end, pi/2 toward the top edge) from its tongue `a0` to its end `a1`, the fin
 * block's span, and the die under the block's middle.
 */
export function npuPlan(f: CardFrame) {
  const xa = f.x0 + 1 * MM, xb = f.xe, ya = f.y0 + 110, yb = f.end - 8, cy = (ya + yb) / 2, half = (yb - ya) / 2 - WALL;
  // a 65 mm impeller, or as large as the card's height leaves room for its scroll
  const r = Math.min(32.5 * MM, half / 1.34), R0 = r * 1.06, R1 = Math.min(r * 1.34, half - 0.6 * MM), a0 = Math.PI + 0.35, a1 = Math.PI * 2.5 + 0.25;
  const Rs = (a: number) => R0 + (R1 - R0) * Math.min(1, Math.max(0, (a - a0) / (a1 - a0)));
  // the blower as near the far end as its scroll's widest reach lets it
  let reach = 0;
  for (let k = 0; k <= 96; k++) { const a = a0 + ((a1 - a0) * k) / 96; reach = Math.max(reach, Math.cos(a) * (Rs(a) + SCROLL)); }
  const fx = xb - WALL - 0.4 * MM - reach, rIn = r * 0.8;
  const fins = { x0: xa + 1.2 * MM, x1: fx - R0 - 1.5 * MM, y0: ya + WALL + 0.4 * MM, y1: yb - WALL - 0.4 * MM };
  return { xa, xb, ya, yb, cy, r, R0, R1, a0, a1, Rs, fx, rIn, fins, die: { x: (fins.x0 + fins.x1) / 2, y: cy } };
}

/**
 * The centrifugal impeller, its back disc at the holder's z = 0 and its intake side at `h`: 33 blades round the motor's cup with the maker's
 * sticker on it, a ring tying the blades' tops at the intake. Turns about its z.
 */
function impeller(r: number, h: number): Group {
  const rotor = new Group(), discM = mat(0x15171b, { roughness: 0.5 }), bladeM = mat(0x1c1e23, { roughness: 0.44, side: DoubleSide }), hubM = mat(0x1a1c20, { roughness: 0.42 });
  const t = 0.8 * MM;
  rotor.add(place(new Mesh(new CylinderGeometry(r * 0.99, r * 0.99, t, 72).rotateX(Math.PI / 2).translate(0, 0, t / 2), discM)));
  // the motor's cup and its sticker
  const cup = h * 0.72;
  rotor.add(place(new Mesh(new CylinderGeometry(r * 0.5, r * 0.53, cup, 56).rotateX(Math.PI / 2).translate(0, 0, cup / 2), hubM)));
  rotor.add(place(new Mesh(new CylinderGeometry(r * 0.43, r * 0.43, 0.15 * MM, 48).rotateX(Math.PI / 2).translate(0, 0, cup + 0.07 * MM), [hubM, mat(0xffffff, { map: hubSticker(), roughness: 0.5 }), hubM])));
  // the blades: straight vanes from the cup's rim to the tips, leaned back from the radius
  const n = 33, r0 = r * 0.62, r1 = r * 0.97, rm = (r0 + r1) / 2, bh = h - t - 0.5 * MM;
  rotor.add(instanced(new BoxGeometry(1, 1, 1), bladeM, Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2;
    return { x: Math.cos(a) * rm, y: Math.sin(a) * rm, z: t + bh / 2, sx: r1 - r0, sy: 0.45 * MM, sz: bh, rz: a + 0.42 };
  })));
  rotor.add(place(new Mesh(extrude(shapeOf(circle(0, 0, r * 0.99, 72), [circle(0, 0, r * 0.82, 72)]), { depth: 0.5 * MM, bevelEnabled: false }).translate(0, 0, h - 0.5 * MM), bladeM)));
  return rotor;
}

/**
 * The cooler under the PCB, from the plateau's face at `Zp - ct` to the PCB's underside `Zp`: the shroud (its face plate with the intake, the
 * raised plateau and the intake's bezel, the walls closed but at the bracket), the impeller in its scroll, the fin block on its vapour chamber, the
 * name and the violet line along the top edge. Returns the shroud's material (`PartSkin`).
 */
export function npuCooler(g: Group, spins: Spin[], visual: string, f: CardFrame, Zp: number, ct: number): MeshStandardMaterial {
  const P = npuPlan(f), L = lookOf(visual), { xa, xb, ya, yb, cy, r, fx, rIn } = P;
  const zB = Zp - ct, zF = zB + RISE, zI = zF + PLATE, zTop = Zp - 0.4 * MM;
  const shroudM = mat(L.shroud, { metalness: 0.4, roughness: 0.46 });
  const plateauM = mat(L.plateau, { metalness: 0.6, roughness: 0.36, map: brushed() }), bezelM = mat(L.bezel, { metalness: 0.85, roughness: 0.3, map: brushed() });
  // ---- the face plate, its far corners chamfered, the intake through it
  const c = 6 * MM, face = { x: xa, y: ya, w: xb - xa, h: yb - ya };
  g.add(slab(shapeOf(outlinePts(face, 0, [0, c, c, 0]), [circle(fx, cy, rIn)]), zF, zI, shroudM, 6));
  // the plateau: a raised brushed band from the bracket to the intake, its east end chamfered toward it, the name engraved on it
  const pl = { x: xa + 3 * MM, y: ya + 12 * MM, w: fx - rIn - 8 * MM - xa - 3 * MM, h: yb - ya - 24 * MM };
  g.add(uvSpan(slab(shapeOf(outlinePts(pl, 0, [2 * MM, 11 * MM, 11 * MM, 2 * MM])), zB, zF + 10, plateauM, 6), 900));
  const nameH = Math.min(9 * MM, pl.h * 0.3), nameW = nameH * (1024 / 140);
  const nm = word('npu-face', 'NEURAL', 1024, 140, '#d3d8e0');
  if (nm && nameW < pl.w - 20 * MM) {
    const d = new Mesh(new PlaneGeometry(nameW, nameH).rotateX(Math.PI), decalMat(nm, { rough: 0.35, metal: 0.5, cut: true }));
    d.position.set(pl.x + pl.w / 2 - 4 * MM, -(pl.y + pl.h / 2), zB - 0.3);
    g.add(d);
  }
  // the intake's bezel, a brushed ring standing as high as the plateau
  g.add(uvSpan(slab(shapeOf(circle(fx, cy, rIn + 3.2 * MM), [circle(fx, cy, rIn)]), zB + 0.2 * MM, zF + 10, bezelM, 6), 600));
  // its screws: through the plate either side of the plateau
  const spots: Spot[] = [];
  for (const x of [xa + 5 * MM, (xa + fx) / 2, fx + r * 0.25]) for (const y of [ya + 6 * MM, yb - 6 * MM]) spots.push({ x, y: -y, z: zF });
  g.add(screws(spots, 'z-', 1.6 * MM, mat(0x2a2d33, { metalness: 0.7, roughness: 0.4 })));
  // ---- the walls: the slot's side, the top edge and the far end (chamfered as the plate), open at the bracket for the air out
  const k = c + 0.414 * WALL, T = WALL;
  const U: [number, number][] = [[xa, ya], [xb - c, ya], [xb, ya + c], [xb, yb - c], [xb - c, yb], [xa, yb], [xa, yb - T], [xb - k, yb - T], [xb - T, yb - k], [xb - T, ya + k], [xb - k, ya + T], [xa, ya + T]];
  g.add(slab(shapeOf(U.map(([x, y]) => V(x, y))), zI - 2, zTop, shroudM, 3));
  // the scroll round the impeller, from its tongue by the outlet round to the top edge, wider as it goes
  const outer: Vector2[] = [], inner: Vector2[] = [];
  for (let s = 0; s <= 64; s++) {
    const a = P.a0 + ((P.a1 - P.a0) * s) / 64, R = P.Rs(a);
    outer.push(V(fx + Math.cos(a) * (R + SCROLL), cy + Math.sin(a) * (R + SCROLL)));
    inner.push(V(fx + Math.cos(a) * R, cy + Math.sin(a) * R));
  }
  g.add(slab(shapeOf([...outer, ...inner.reverse()]), zI - 2, zTop, shroudM, 2));
  // ---- the impeller, its back to the PCB, its intake under the plate's hole
  const holder = new Group(), h = zTop - 0.4 * MM - (zI + 0.5 * MM), rotor = impeller(r, h);
  holder.position.set(fx, -cy, zTop - 0.4 * MM);
  holder.rotation.x = Math.PI;
  holder.add(rotor);
  g.add(holder);
  spins.push({ rotor, ring: null, needs: null });
  // ---- the vapour chamber over the die and its fin block: plates along the card, 1.8 mm apart, the air runs between them to the bracket
  const F = P.fins, base = Zp - 2.8 * MM, copper = mat(0xc07a4e, { metalness: 0.9, roughness: 0.3 }), finM = mat(0xb9c1cb, { metalness: 0.8, roughness: 0.32 });
  g.add(rectBox({ x: F.x0, y: F.y0, w: F.x1 - F.x0, h: F.y1 - F.y0 }, base, zTop, copper));
  const plates = [];
  for (let y = F.y0 + 0.4 * MM; y < F.y1 - 0.2 * MM; y += 1.8 * MM) plates.push({ x: (F.x0 + F.x1) / 2, y: -y, z: (zI + 0.3 * MM + base) / 2, sx: F.x1 - F.x0, sy: 0.3 * MM, sz: base - zI - 0.3 * MM });
  g.add(instanced(new BoxGeometry(1, 1, 1), finM, plates));
  // ---- the top edge (it faces the glass, standing): the violet line either side of the name
  const violet = mat(0xa68bff, { roughness: 0.38, metalness: 0.3 }), zl = (zI + zTop) / 2, eh = (zTop - zI) * 0.55, ew = eh * (1024 / 112), ex = (xa + xb) / 2;
  for (const [b0, b1] of [[xa + 8 * MM, ex - ew / 2 - 4 * MM], [ex + ew / 2 + 4 * MM, xb - c - 4 * MM]] as const) if (b1 - b0 > 200) g.add(rectBox({ x: b0, y: yb, w: b1 - b0, h: 5 }, zl - 0.5 * MM, zl + 0.5 * MM, violet));
  const edge = word('npu-edge', 'NEURAL', 1024, 112, '#c8ced8');
  if (edge) {
    const d = new Mesh(new PlaneGeometry(ew, eh).rotateX(Math.PI / 2), decalMat(edge, { rough: 0.4, metal: 0.6, cut: true }));
    d.position.set(ex, -(yb + 0.6), zl);
    g.add(d);
  }
  return shroudM;
}

/**
 * The backplate over the PCB's face, from `Z + 4` to `Z + backT`: brushed, its far corners chamfered, a cut-out over the die (`dieBack`), vents
 * over the power stage east of it, the name engraved toward the top edge and screws round its rim.
 */
export function npuBackplate(g: Group, visual: string, f: CardFrame, Z: number, backT: number): void {
  const { x0, xe, y0, end } = f, P = npuPlan(f), L = lookOf(visual), HOLE = 15 * MM, die = P.die;
  const backM = mat(L.back, { metalness: 0.7, roughness: 0.38, map: brushed() });
  const plate = { x: x0 + 40, y: y0 + 20, w: xe - 10 - x0 - 40, h: end - 10 - y0 - 20 }, holes: Vector2[][] = [];
  holes.push(outlinePts({ x: die.x - HOLE, y: die.y - HOLE, w: 2 * HOLE, h: 2 * HOLE }, 3 * MM));
  const vents: RectLike[] = [];
  for (let k = 0, x = die.x + HOLE + 5 * MM; k < 8 && x < P.fx - P.r; k++, x += 4 * MM) for (const dy of [-20, 0, 20]) vents.push({ x, y: die.y + dy * MM - 7 * MM, w: 2.2 * MM, h: 14 * MM });
  for (const v of vents) holes.push(outlinePts(v, 1.1 * MM));
  g.add(uvSpan(slab(shapeOf(outlinePts(plate, 30, [0, 5 * MM, 12 * MM, 0]), holes), Z + 4, Z + backT, backM, 3), 900));
  const nm = word('npu-back', 'NEURAL', 1024, 128, '#d4d9e0');
  if (nm) g.add(decal({ x: P.fx - 26 * MM, y: end - 19 * MM, w: 52 * MM, h: 6.5 * MM }, Z + backT + 0.3, decalMat(nm, { rough: 0.35, metal: 0.5, cut: true })));
  dieBack(g, `npu-back:${visual}`, die, HOLE, Z, 'NPU1');
  const rim: Spot[] = [], xr = xe - 14 * MM;
  for (const x of [x0 + 6 * MM, (x0 + xr) / 2, xr]) for (const y of [y0 + 5 * MM, end - 6 * MM]) rim.push({ x, y: -y, z: Z + backT });
  g.add(screws(rim, 'z+', 1.9 * MM, mat(0x1c1e22, { metalness: 0.6, roughness: 0.4 })));
}

/** A hexagon round a wall point (layout y and depth), `R` to its corners. */
const hexAt = (y: number, z: number, R: number): Vector2[] => Array.from({ length: 6 }, (_, k) => wallPt(y + Math.sin((k * Math.PI) / 3) * R, z + Math.cos((k * Math.PI) / 3) * R));

/**
 * The AI card's bracket, lying (`s` its plate: its depth along the lying y, its height along the lying z): the plate with a honeycomb cut through
 * it over the shroud's mouth, where the blower's air leaves the case.
 */
export function npuBracket(f: CardFrame, Zp: number, ct: number, x0: number, x1: number, s: Span, m: Material): Mesh {
  const P = npuPlan(f), R = 1.75 * MM, pitch = 4 * MM, dz = pitch * 0.866, holes: Vector2[][] = [];
  const z0 = Zp - ct + RISE + PLATE + 0.6 * MM + R, z1 = Zp - 0.8 * MM - R, y0 = P.ya + 2 * MM + R, y1 = P.yb - 3 * MM - R;
  for (let j = 0, z = z0; z <= z1; j++, z += dz) for (let y = y0 + (j % 2 ? pitch / 2 : 0); y <= y1; y += pitch) holes.push(hexAt(y, z, R));
  return wallX(x0, x1, s, holes, m);
}
