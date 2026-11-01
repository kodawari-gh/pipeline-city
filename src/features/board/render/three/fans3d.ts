// The fans of the 3D machine (docs/GRAPHICS_3D_OVERHAUL.md "Solids"): each is built round its own z axis (a frame or a shroud, the motor on its
// struts, a rotor of curved blades), then turned into place. The live frame spins the rotor round its z and drives the light (`Spin`).
import { BoxGeometry, Color, CylinderGeometry, DoubleSide, Group, Mesh, TorusGeometry, type MeshStandardMaterial, type Object3D } from 'three';
import { fanFrame, fanRotor, place, type RectLike } from '@/core/render/three/geometry';
import { PALETTE, mat } from '@/core/render/three/materials';
import { seeThrough } from '@/core/render/three/pick';

/** What the live frame drives: a rotor it spins round its local z, a light that follows the fans, the cable the fan needs to run. `fixed`: the light keeps this colour instead of cycling. */
export interface Spin { rotor: Object3D; ring: MeshStandardMaterial | null; needs: string | null; fixed?: number }

/** A light alone (a strip, a ring): it follows the fans but has nothing to spin. */
export const light = (ring: MeshStandardMaterial, fixed?: number): Spin => ({ rotor: new Group(), ring, needs: null, ...(fixed === undefined ? {} : { fixed }) });

/** An emissive part that is dark until the machine runs. `base`: the colour it shows switched off. */
export const glowMat = (color: number, base = 0x111111): MeshStandardMaterial => mat(base, { emissive: new Color(color), emissiveIntensity: 0, roughness: 0.4 });

const blades = () => mat(0x2c2e34, { roughness: 0.45, side: DoubleSide });
const hubM = () => mat(0x24262c, { roughness: 0.4 });

/** A fan's motor mount behind its rotor (round z, `depth` deep): a hub plate on three struts to the frame. */
export function motor(holder: Group, r: number, depth: number): void {
  const m = mat(0x1a1b1f, { roughness: 0.55 }), z = -depth * 0.42;
  const hub = place(new Mesh(new CylinderGeometry(r * 0.32, r * 0.32, depth * 0.16, 24).rotateX(Math.PI / 2), m));
  hub.position.z = z;
  holder.add(hub);
  for (let k = 0; k < 3; k++) {
    const s = place(new Mesh(new BoxGeometry(r * 0.72, r * 0.05, depth * 0.1), m)), a = (k / 3) * Math.PI * 2 + 0.5;
    s.position.set(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66, z);
    s.rotation.z = a;
    holder.add(s);
  }
}

/**
 * A square fan round its own z, `d` wide and `depth` deep: the frame with its throat and screw holes, the motor, the rotor and, with `ring`,
 * a light round the throat on the face `ringSide` (+1 the +z face). `frame` is the frame's colour.
 */
export function squareFan(d: number, depth: number, o: { blades?: number; ring?: number; ringSide?: 1 | -1; frame?: number } = {}): { root: Group; spin: Spin } {
  const root = new Group();
  root.add(place(new Mesh(fanFrame(d, depth), mat(o.frame ?? 0x1d1e22, { roughness: 0.6 }))));
  motor(root, d * 0.47, depth);
  const rotor = fanRotor(d * 0.46, o.blades ?? 9, blades(), hubM());
  root.add(rotor);
  let ring: MeshStandardMaterial | null = null;
  if (o.ring !== undefined) {
    ring = glowMat(o.ring);
    const t = new Mesh(new TorusGeometry(d * 0.47, d * 0.022, 8, 48), ring);
    t.position.z = (o.ringSide ?? 1) * depth * 0.5;
    root.add(seeThrough(t));
  }
  return { root, spin: { rotor, ring, needs: null } };
}

/** A case fan on its mount (`side`, its rect seen from the glass), centred `zc` deep, its RGB ring on the face toward the inside of the case. */
export function caseFan(id: string, side: 'front' | 'top' | 'rear', r: RectLike, zc: number, maxD: number): { root: Group; spin: Spin } {
  const axis: 'x' | 'y' = side === 'top' ? 'y' : 'x';
  const d = Math.min(axis === 'x' ? r.h : r.w, maxD) * 0.92, depth = axis === 'x' ? r.w : r.h;
  // built round z, then turned: z to world x (front, rear) or world y (top); after the turn the ring's face looks into the case
  const f = squareFan(d, depth, { ring: PALETTE.rgb, ringSide: side === 'rear' ? 1 : -1 });
  f.root.position.set(r.x + r.w / 2, -(r.y + r.h / 2), zc);
  if (axis === 'x') f.root.rotation.y = Math.PI / 2; else f.root.rotation.x = -Math.PI / 2;
  return { root: f.root, spin: { ...f.spin, needs: 'fan:' + id } };
}

/** A part's own round fan facing the glass (a card's, the stock cooler's): a round shroud with a lip, the motor on its struts and a curved-blade rotor, its face at depth `z`. */
export function partFan(x: number, y: number, z: number, r: number, frame = 0x1d1e22): { root: Group; spin: Spin } {
  const root = new Group(), depth = Math.min(160, r * 0.4);
  root.position.set(x, -y, z - depth / 2);
  const shroud = place(new Mesh(new CylinderGeometry(r * 1.04, r * 1.04, depth, 48, 1, true).rotateX(Math.PI / 2), mat(frame, { roughness: 0.55, side: DoubleSide })));
  const lip = place(new Mesh(new TorusGeometry(r * 1.04, depth * 0.08, 8, 48), mat(0x2a2c31, { roughness: 0.4, metalness: 0.3 })));
  lip.position.z = depth / 2;
  root.add(shroud, lip);
  motor(root, r, depth);
  const rotor = fanRotor(r * 0.98, r > 300 ? 9 : 7, blades(), hubM());
  root.add(rotor);
  return { root, spin: { rotor, ring: null, needs: null } };
}
