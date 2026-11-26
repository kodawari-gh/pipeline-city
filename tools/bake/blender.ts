// The light bake's export, in Blender's terms (`scene.ts` walks the room): a light's power, a mesh's geometry in Blender's frame (metres, z up)
// and its diffuse colour, and the base64 the page hands back.
import * as THREE from 'three';
import { M } from '@/features/room/render/three/outside/plan';

/** The game's frame (y up, units) to Blender's (z up, metres). */
export const toB = (x: number, y: number, z: number): [number, number, number] => [x / M, -z / M, y / M];
export const dirB = (v: THREE.Vector3): [number, number, number] => [v.x, -v.z, v.y];

/** sRGB (0..255) to linear (0..1). */
const lin = (v: number): number => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** What `drawImage` takes: a texture's image of one of these kinds can be read. */
const drawable = (img: unknown): img is CanvasImageSource =>
  img instanceof HTMLImageElement ||
  img instanceof HTMLCanvasElement ||
  img instanceof ImageBitmap ||
  img instanceof OffscreenCanvas ||
  img instanceof HTMLVideoElement ||
  img instanceof SVGImageElement;

/** A texture's mean colour, linear (a painted canvas or a loaded image); null if it cannot be read. */
function meanColour(t: THREE.Texture): [number, number, number] | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const img: unknown = t.image;
  if (!drawable(img)) {
    return null;
  }
  try {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (x === null) {
      return null;
    }
    x.drawImage(img, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data;
    let r = 0,
      g = 0,
      b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += lin(d[i] ?? 0);
      g += lin(d[i + 1] ?? 0);
      b += lin(d[i + 2] ?? 0);
    }
    return [r / 256, g / 256, b / 256];
  } catch {
    return null;
  }
}

/** The surface's diffuse colour, linear: its colour times its texture's mean. */
export function albedo(m: THREE.MeshStandardMaterial): [number, number, number] {
  const t = m.map ? meanColour(m.map) : null;
  return [m.color.r * (t?.[0] ?? 1), m.color.g * (t?.[1] ?? 1), m.color.b * (t?.[2] ?? 1)];
}

export const b64 = (a: Float32Array | Uint32Array): string => {
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < u.length; i += 0x80_00) {
    s += String.fromCodePoint(...u.subarray(i, i + 0x80_00));
  }
  return btoa(s);
};

export interface BakeMesh {
  name: string;
  hash: string;
  receiver: boolean;
  pos: string;
  nrm: string;
  index: string | null;
  colour: [number, number, number];
  roughness: number;
  metalness: number;
  area: number;
}
export interface BakeLight {
  kind: 'point' | 'spot' | 'area';
  pos: [number, number, number];
  dir: [number, number, number];
  x: [number, number, number];
  y: [number, number, number];
  w: number;
  h: number;
  angle: number;
  penumbra: number;
  colour: [number, number, number];
  power: number;
  intensity: number;
}
export interface BakeScene {
  meshes: BakeMesh[];
  groups: { id: string; lights: BakeLight[] }[];
  /** The sun's key frames that it comes in by the glass at (`SUN_HOURS`, the others are dark), and its direction (toward it). */
  suns: { hour: number; dir: [number, number, number] }[];
  sunHours: number[];
  /** The room's inside (Blender's frame): min and max corners. */
  room: [number, number, number, number, number, number];
}

/** One light at the power it has now: a point's or a spot's intensity in Blender's metres (the game's falls off by units squared), an area's radiance. */
export function readLight(l: THREE.Light, toRoom: THREE.Matrix4): BakeLight {
  const p = new THREE.Vector3().setFromMatrixPosition(l.matrixWorld).applyMatrix4(toRoom),
    basis = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().multiplyMatrices(toRoom, l.matrixWorld));
  const ax = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix3(basis).normalize();
  const c: [number, number, number] = [l.color.r, l.color.g, l.color.b];
  const base = {
    pos: toB(p.x, p.y, p.z),
    x: dirB(ax(1, 0, 0)),
    y: dirB(ax(0, 1, 0)),
    colour: c,
    intensity: l.intensity,
    angle: 0,
    penumbra: 0,
    w: 0,
    h: 0,
  };
  if (l instanceof THREE.RectAreaLight) {
    return { ...base, kind: 'area', dir: dirB(ax(0, 0, -1)), w: l.width / M, h: l.height / M, power: l.intensity };
  }
  if (l instanceof THREE.SpotLight) {
    const t = new THREE.Vector3().setFromMatrixPosition(l.target.matrixWorld).applyMatrix4(toRoom);
    if (l.decay !== 2) {
      throw new Error(`a spot with decay ${l.decay}: the bake takes only real (inverse square) lamps`);
    }
    return {
      ...base,
      kind: 'spot',
      dir: dirB(t.sub(p).normalize()),
      angle: l.angle,
      penumbra: l.penumbra,
      power: l.intensity / (M * M),
    };
  }
  if (!(l instanceof THREE.PointLight) || l.decay !== 2) {
    const decay = l instanceof THREE.PointLight ? l.decay : 'none';
    throw new Error(`a point light with decay ${decay}: the bake takes only real (inverse square) lamps`);
  }
  return { ...base, kind: 'point', dir: [0, 0, -1], power: l.intensity / (M * M) };
}

/** A geometry's attribute by name; a mesh the bake reads has positions and normals. */
function attribute(g: THREE.BufferGeometry, name: string): THREE.BufferAttribute | THREE.InterleavedBufferAttribute {
  const a = g.attributes[name];
  if (!a) {
    throw new Error(`a mesh without ${name}s`);
  }
  return a;
}

/** A mesh's (or one instance's) geometry in Blender's frame: positions, normals, triangles; and its positions in the room's frame for the hash. */
export function geometry(
  g: THREE.BufferGeometry,
  m: THREE.Matrix4,
): { pos: Float32Array; nrm: Float32Array; room: Float32Array; index: Uint32Array | null; area: number } {
  if (!g.attributes['normal']) {
    g.computeVertexNormals();
  }
  const p = attribute(g, 'position'),
    n = attribute(g, 'normal'),
    k = p.count,
    nm = new THREE.Matrix3().getNormalMatrix(m),
    v = new THREE.Vector3();
  const pos = new Float32Array(3 * k),
    nrm = new Float32Array(3 * k),
    room = new Float32Array(3 * k);
  for (let i = 0; i < k; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m);
    room.set([v.x, v.y, v.z], 3 * i);
    pos.set(toB(v.x, v.y, v.z), 3 * i);
    v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
    nrm.set(dirB(v), 3 * i);
  }
  const index = g.index ? Uint32Array.from(g.index.array) : null,
    tri = (t: number) => (index ? (index[t] ?? 0) : t);
  let area = 0;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let t = 0; t < (index ? index.length : k); t += 3) {
    a.fromArray(pos, 3 * tri(t));
    b.fromArray(pos, 3 * tri(t + 1));
    c.fromArray(pos, 3 * tri(t + 2));
    area += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return { pos, nrm, room, index, area };
}
