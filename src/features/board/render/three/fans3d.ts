// The fans of the 3D machine (docs/render/three.md): each is built round its own z axis (a frame or a shroud, the motor on its
// struts, a rotor of curved blades), then turned into place. The live frame spins the rotor round its z and drives the light (`Spin`).
// A fan part (`fanPart`) has one model: the case, a heatsink, a radiator and the shop all show it, each at the size its spot gives. Its air goes in at
// its +z face (the rotor's hub) and out at its -z face (the motor's struts).
import { BoxGeometry, CircleGeometry, Color, CylinderGeometry, DoubleSide, Group, LatheGeometry, Mesh, TorusGeometry, Vector2, type BufferGeometry, type Material, type MeshStandardMaterial, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FAN_SCREW, FAN_THROAT, fanFlange, fanRotor, fanSides, place, type RectLike } from '@/core/render/three/geometry';
import { lowDetail } from '@/core/render/three/detail';
import { KEEP_SPEC, mat } from '@/core/render/three/materials';
import { seeThrough } from '@/core/render/three/pick';
import type { FanSpec } from '@/features/board/sim/specs';
import { badgeTex } from './casekit3d';

/**
 * What the live frame drives: a rotor it spins round its local z, a light that follows the fans, the cable the fan needs to run. `fixed`: the
 * light keeps this colour instead of cycling; `gain`: its full brightness (a wide diffuser glows softer than a thin ring).
 */
export interface Spin { rotor: Object3D; ring: MeshStandardMaterial | null; needs: string | null; fixed?: number; gain?: number }

/** A fan fitted to its host: the device's id, its spot (a case mount's id, or `<host's slot>.fan<k>`) and its spec. */
export interface FanFit { id: string; slot: string; spec: FanSpec }

/** A light alone (a strip, a ring): it follows the fans but has nothing to spin. */
export const light = (ring: MeshStandardMaterial, fixed?: number, gain?: number): Spin =>
  ({ rotor: new Group(), ring, needs: null, ...(fixed === undefined ? {} : { fixed }), ...(gain === undefined ? {} : { gain }) });

/** An emissive part that is dark until the machine runs. `base`: the colour it shows switched off. */
export const glowMat = (color: number, base = 0x111111): MeshStandardMaterial => mat(base, { emissive: new Color(color), emissiveIntensity: 0, roughness: 0.4 });

const blades = (tone = 0x2c2e34) => {
  const m = mat(tone, { roughness: 0.45, side: DoubleSide });
  // (Low: the white-blue blade highlights are the room's key, not a Lambert)
  if (lowDetail()) m.userData[KEEP_SPEC] = true;
  return m;
};
// (two-sided as the blades are: the rotor's hub, blades and label rim draw as one mesh)
const hubM = () => mat(0x24262c, { roughness: 0.4, side: DoubleSide });

/** Units per millimetre (23): a fan's size in units becomes its diameter in mm for `fanSides`. */
const UNITS_PER_MM = 23;

/** A fan's motor mount behind its rotor (round z, `depth` deep): a hub plate on `n` struts to the frame. `sides`: the hub's round count. */
export function motor(holder: Group, r: number, depth: number, n = 3, sides = 24): void {
  const m = mat(0x1a1b1f, { roughness: 0.55 }), z = -depth * 0.42;
  const hub = place(new Mesh(new CylinderGeometry(r * 0.32, r * 0.32, depth * 0.16, sides).rotateX(Math.PI / 2), m));
  hub.position.z = z;
  holder.add(hub);
  for (let k = 0; k < n; k++) {
    const s = place(new Mesh(new BoxGeometry(r * 0.72, r * 0.05, depth * 0.1), m)), a = (k / n) * Math.PI * 2 + 0.5;
    s.position.set(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66, z);
    s.rotation.z = a;
    holder.add(s);
  }
}

/** A solid of turning round the z axis from a closed outline of (radius, z) points: walk its outer wall toward +z first, so its faces look out. */
const lathe = (outline: readonly (readonly [number, number])[], seg: number): BufferGeometry => new LatheGeometry(outline.map(([r, z]) => new Vector2(r, z)), seg).rotateX(Math.PI / 2).toNonIndexed();

/** A fan's real depth: a 25 mm frame, the 40 mm fan's 10 mm (23 units a millimetre, `fanLen`). */
export const fanDepth = (size: number): number => (size > 40 ? 25 : 10) * 23;

/** The fan's four corners, in parts of its width. */
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

/**
 * The fan's housing, one geometry: a flange on each face, the round wall between them with its throat narrowing to a waist round the blades (a
 * venturi), and a screw post in each corner with a rib to the wall. The screw holes run right through.
 */
function housing(d: number, depth: number, sides: number, small: number): BufferGeometry {
  const t = Math.min(depth * 0.16, d * 0.04), half = depth / 2, inner = half - t + 1, mouth = d * FAN_THROAT, waist = d * 0.456, wall = d * 0.49;
  const venturi: [number, number][] = [[wall, -inner], [wall, -inner * 0.92], [wall, inner * 0.92], [wall, inner]];
  for (let k = 10; k >= -10; k--) { const u = k / 10; venturi.push([waist + (mouth - waist) * u * u, u * inner]); }
  venturi.push([wall, -inner]);
  const parts = [fanFlange(d, t).translate(0, 0, half - t / 2), fanFlange(d, t).translate(0, 0, -half + t / 2), lathe(venturi, sides)];
  const postR = d * 0.05, holeR = d * 0.022, at = d * FAN_SCREW, rib = wall + (Math.SQRT2 * at - postR - wall) / 2;
  for (const [x, y] of CORNERS) {
    parts.push(lathe([[postR, -inner], [postR, inner], [holeR, inner], [holeR, -inner], [postR, -inner]], small).translate(x * at, y * at, 0));
    parts.push(new BoxGeometry((Math.SQRT2 * at - postR - wall) * 1.2, d * 0.024, 2 * inner).toNonIndexed().rotateZ(Math.atan2(y, x)).translate((x * rib) / Math.SQRT2, (y * rib) / Math.SQRT2, 0));
  }
  return mergeGeometries(parts, false)!;
}

/** The soft pads round a high-airflow fan's screw holes, on both faces. */
function pads(d: number, depth: number, small: number): BufferGeometry {
  const r0 = d * 0.024, r1 = d * 0.052, g = d * 0.003, at = d * FAN_SCREW, parts: BufferGeometry[] = [];
  for (const [x, y] of CORNERS) for (const side of [1, -1]) parts.push(lathe([[r1, -g], [r1, g], [r0, g], [r0, -g], [r1, -g]], small).translate(x * at, y * at, (side * depth) / 2));
  return mergeGeometries(parts, false)!;
}

/**
 * The maker's label on the hub: its colour tells the grade. Two meshes for the rotor: the rim in the hub's material (it merges with the hub)
 * and the printed face, one draw.
 */
function hubLabel(R: number, fast: boolean, small: number, edge: Material): Mesh[] {
  const face = mat(0xffffff, { map: badgeTex(fast ? 'fan-fast' : 'fan', 128, 128, '', fast ? '#e9e6f5' : '#8a8f99', fast ? '#a68bff' : '#8a8f99', fast ? '#1d1830' : '#191a1e'), roughness: 0.55 });
  return labelDisc(R * 0.18, R * 0.03, R * 0.203, small, edge, face);
}

/** A printed disc round z, `t` thick, centred `z` high: its open rim (`edge`) and its face (`face`, the print upright as on a cylinder's cap). */
export function labelDisc(r: number, t: number, z: number, sides: number, edge: Material, face: Material): Mesh[] {
  const rim = new Mesh(new CylinderGeometry(r, r, t, sides, 1, true).rotateX(Math.PI / 2).translate(0, 0, z), edge);
  rim.geometry.deleteAttribute('uv'); // (as the hub and the blades: one mesh)
  const top = new Mesh(new CircleGeometry(r, sides).rotateZ(-Math.PI / 2).translate(0, 0, z + t / 2), face);
  return [place(rim), place(top)];
}

/**
 * A fan part round its own z, `d` wide and `depth` deep, as its spot fits it. The basic grade is all black, with seven blades. High-airflow has nine
 * wider blades at a steeper pitch, soft pads at its corners and a violet mark on its hub. A case fan has a light round its throat on the face
 * `ringSide` (+1 the +z face); the 40 mm fan has none.
 */
export function fanPart(spec: Pick<FanSpec, 'size' | 'tier'>, d: number, depth: number, ringSide: 1 | -1 = 1): { root: Group; spin: Spin } {
  const root = new Group(), fast = spec.tier > 0, R = d * 0.462;
  const sides = fanSides(d / UNITS_PER_MM), small = Math.max(8, sides / 2);
  const frame = mat(0x1d1e22, { roughness: 0.62 });
  // (Low: the frame's warm brown rim light is the room's key, not a Lambert)
  if (lowDetail()) frame.userData[KEEP_SPEC] = true;
  root.add(place(new Mesh(housing(d, depth, sides, small), frame)));
  if (fast) root.add(place(new Mesh(pads(d, depth, small), mat(0x7d68bf, { roughness: 0.85 }))));
  motor(root, d * 0.47, depth, 4, small);
  const hub = hubM();
  const rotor = fanRotor(R, fast ? 9 : 7, blades(fast ? 0x3a3c46 : 0x2c2e34), hub, fast ? { chord: 0.6, pitch: 0.85 } : { chord: 0.66 });
  rotor.add(...hubLabel(R, fast, small, hub));
  // the blades and the hub stay inside the frame's depth: a thin fan has flatter blades
  rotor.scale.z = Math.min(1, (depth * 0.42) / (R * 0.22));
  rotor.position.z = depth * 0.04;
  root.add(rotor);
  let ring: MeshStandardMaterial | null = null;
  if (spec.size > 40) {
    ring = glowMat(0xa68bff);
    const t = new Mesh(new TorusGeometry(d * (FAN_THROAT + 0.006), d * 0.011, 8, fanSides(d / UNITS_PER_MM)), ring);
    t.position.z = (ringSide * depth) / 2;
    root.add(seeThrough(t));
  }
  return { root, spin: { rotor, ring, needs: null } };
}

/**
 * A fan on a case mount (`side`, its rect seen from the glass), centred `zc` deep. It turns so its air goes in at the front and out at the rear and the
 * top; its light is on the face that looks into the case.
 */
export function caseFan(fit: Pick<FanFit, 'slot' | 'spec'>, side: 'front' | 'top' | 'rear', r: RectLike, zc: number, maxD: number): { root: Group; spin: Spin } {
  const axis: 'x' | 'y' = side === 'top' ? 'y' : 'x';
  const d = Math.min(axis === 'x' ? r.h : r.w, maxD), depth = axis === 'x' ? r.w : r.h;
  // built round z, then turned: its +z to world +x (the front's outside, the rear's inside) or to world -y (the top's inside)
  const f = fanPart(fit.spec, d, depth, side === 'front' ? -1 : 1);
  f.root.position.set(r.x + r.w / 2, -(r.y + r.h / 2), zc);
  if (axis === 'x') f.root.rotation.y = Math.PI / 2; else f.root.rotation.x = Math.PI / 2;
  return { root: f.root, spin: { ...f.spin, needs: 'fan:' + fit.slot } };
}

/** A part's own round fan facing the glass (a card's): a round shroud with a lip, the motor on its struts and a curved-blade rotor, its face at depth `z`. */
export function partFan(x: number, y: number, z: number, r: number, frame = 0x1d1e22): { root: Group; spin: Spin } {
  const root = new Group(), depth = Math.min(160, r * 0.4);
  root.position.set(x, -y, z - depth / 2);
  // (r is the radius in units: the diameter in mm is 2r / UNITS_PER_MM)
  const sides = fanSides((2 * r) / UNITS_PER_MM), small = Math.max(8, sides / 2);
  const shroud = place(new Mesh(new CylinderGeometry(r * 1.04, r * 1.04, depth, sides, 1, true).rotateX(Math.PI / 2), mat(frame, { roughness: 0.55, side: DoubleSide })));
  const lip = place(new Mesh(new TorusGeometry(r * 1.04, depth * 0.08, 8, sides), mat(0x2a2c31, { roughness: 0.4, metalness: 0.3 })));
  lip.position.z = depth / 2;
  root.add(shroud, lip);
  motor(root, r, depth, 3, small);
  const rotor = fanRotor(r * 0.98, r > 300 ? 9 : 7, blades(), hubM());
  root.add(rotor);
  return { root, spin: { rotor, ring: null, needs: null } };
}
