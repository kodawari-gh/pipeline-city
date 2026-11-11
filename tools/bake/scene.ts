// The light bake's export (`src/features/room/light.md`, "Offline bakes"; T179). `bake.mjs` imports it into the game's page through the dev
// server and calls `exportRoom`: it reads the room as the game built it and hands back what Blender needs. The meshes (in Blender's frame:
// metres, z up), each a receiver (it gets a lightmap) or only a blocker; each light group's lights at full power (`Room3D.lightGroups`); the
// sun's directions. A receiver carries the hash the game finds it by (`meshHash`, `lightmapmix.ts`), since a merged mesh has no name of its own.
import { Matrix3, Matrix4, Vector3, type BufferGeometry, type InstancedMesh, type Light, type Material, type Mesh, type MeshStandardMaterial, type Object3D, type PointLight, type RectAreaLight, type SpotLight, type Texture } from 'three';
import { MIN_AREA, hasAo, meshHash, shown, solid } from '@/core/render/three/lightmapmix';
import { partsOf } from '@/core/render/three/merge';
import { SUN_HOURS, type Room3D } from '@/features/room/render/three/room3d';
import { M } from '@/features/room/render/three/outside/plan';
import { CEIL_Y, EAST_X, FLOOR_Y, FRONT_Z, WEST_X, sunDir } from '@/features/room/render/three/roomplan';

/** The game's frame (y up, units) to Blender's (z up, metres). */
const toB = (x: number, y: number, z: number): [number, number, number] => [x / M, -z / M, y / M];
const dirB = (v: Vector3): [number, number, number] => [v.x, -v.z, v.y];

/** A texture's mean colour, linear (a painted canvas or a loaded image); null if it cannot be read. */
function meanColour(t: Texture): [number, number, number] | null {
  const img = t.image as CanvasImageSource | undefined;
  if (!img || typeof document === 'undefined') return null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(img, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data, lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += lin(d[i]!); g += lin(d[i + 1]!); b += lin(d[i + 2]!); }
    return [r / 256, g / 256, b / 256];
  } catch { return null; }
}

/** The surface's diffuse colour, linear: its colour times its texture's mean. */
function albedo(m: MeshStandardMaterial): [number, number, number] {
  const t = m.map ? meanColour(m.map) : null;
  return [m.color.r * (t?.[0] ?? 1), m.color.g * (t?.[1] ?? 1), m.color.b * (t?.[2] ?? 1)];
}

const b64 = (a: Float32Array | Uint32Array): string => {
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

export interface BakeMesh { name: string; hash: string; receiver: boolean; pos: string; nrm: string; index: string | null; colour: [number, number, number]; roughness: number; metalness: number; area: number }
export interface BakeLight { kind: 'point' | 'spot' | 'area'; pos: [number, number, number]; dir: [number, number, number]; x: [number, number, number]; y: [number, number, number]; w: number; h: number; angle: number; penumbra: number; colour: [number, number, number]; power: number; intensity: number }
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
function readLight(l: Light, toRoom: Matrix4): BakeLight {
  const p = new Vector3().setFromMatrixPosition(l.matrixWorld).applyMatrix4(toRoom), basis = new Matrix3().setFromMatrix4(new Matrix4().multiplyMatrices(toRoom, l.matrixWorld));
  const ax = (x: number, y: number, z: number) => new Vector3(x, y, z).applyMatrix3(basis).normalize();
  const c: [number, number, number] = [l.color.r, l.color.g, l.color.b];
  const base = { pos: toB(p.x, p.y, p.z), x: dirB(ax(1, 0, 0)), y: dirB(ax(0, 1, 0)), colour: c, intensity: l.intensity, angle: 0, penumbra: 0, w: 0, h: 0 };
  if ((l as RectAreaLight).isRectAreaLight) {
    const a = l as RectAreaLight;
    return { ...base, kind: 'area', dir: dirB(ax(0, 0, -1)), w: a.width / M, h: a.height / M, power: a.intensity };
  }
  if ((l as SpotLight).isSpotLight) {
    const s = l as SpotLight, t = new Vector3().setFromMatrixPosition(s.target.matrixWorld).applyMatrix4(toRoom);
    if (s.decay !== 2) throw new Error(`a spot with decay ${s.decay}: the bake takes only real (inverse square) lamps`);
    return { ...base, kind: 'spot', dir: dirB(t.sub(p).normalize()), angle: s.angle, penumbra: s.penumbra, power: s.intensity / (M * M) };
  }
  const pt = l as PointLight;
  if (pt.decay !== 2) throw new Error(`a point light with decay ${pt.decay}: the bake takes only real (inverse square) lamps`);
  return { ...base, kind: 'point', dir: [0, 0, -1], power: pt.intensity / (M * M) };
}

/** A mesh's (or one instance's) geometry in Blender's frame: positions, normals, triangles; and its positions in the room's frame for the hash. */
function geometry(g: BufferGeometry, m: Matrix4): { pos: Float32Array; nrm: Float32Array; room: Float32Array; index: Uint32Array | null; area: number } {
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position!, n = g.attributes.normal!, k = p.count, nm = new Matrix3().getNormalMatrix(m), v = new Vector3();
  const pos = new Float32Array(3 * k), nrm = new Float32Array(3 * k), room = new Float32Array(3 * k);
  for (let i = 0; i < k; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m);
    room.set([v.x, v.y, v.z], 3 * i);
    pos.set(toB(v.x, v.y, v.z), 3 * i);
    v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
    nrm.set(dirB(v), 3 * i);
  }
  const index = g.index ? Uint32Array.from(g.index.array) : null, tri = (t: number) => (index ? index[t]! : t);
  let area = 0;
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let t = 0; t < (index ? index.length : k); t += 3) {
    a.fromArray(pos, 3 * tri(t)); b.fromArray(pos, 3 * tri(t + 1)); c.fromArray(pos, 3 * tri(t + 2));
    area += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return { pos, nrm, room, index, area };
}

/**
 * The room as Blender bakes it. `room`: the game's `Room3D` (its lights are read at full power: the night with the desk lamp and the screen
 * on); `extra`: other roots that only block (the machine). Synchronous, so the game's next frame (which sets the lights back) comes after it.
 */
export function exportRoom(room: Room3D, extra: Object3D[] = []): BakeScene {
  const r = room;
  r.frame({ hour: 23, lamp: true, blind: false, screen: { installed: true, powered: true, live: false, text: '' }, router: 1, isp: 0, ispName: '', mail: false, t: 0 }, 1);
  r.root.updateMatrixWorld(true);
  for (const e of extra) e.updateMatrixWorld(true);
  const toRoom = new Matrix4().copy(r.root.matrixWorld).invert(), blinds = new Set<Object3D>((room as unknown as { blinds: Mesh[] }).blinds);
  const meshes: BakeMesh[] = [], names = new Map<string, number>();
  const add = (o: Mesh, mm: MeshStandardMaterial, world: Matrix4, receiver: boolean) => {
    // (a mesh the game lit with the last bake has lost its index: it keeps the hash the bake found it by)
    const g = geometry(o.geometry, new Matrix4().multiplyMatrices(toRoom, world)), hash = (o.userData.bakeHash as string | undefined) ?? meshHash(g.room, g.index);
    // a readable name: the material's colour and the vertex count, numbered when two match
    const base = `${o.name || 'mesh'}-${mm.color.getHexString()}${mm.map ? '-map' : ''}-${g.pos.length / 3}`, k = names.get(base) ?? 0;
    names.set(base, k + 1);
    meshes.push({
      name: k ? `${base}-${k}` : base, hash, receiver: receiver && g.area >= MIN_AREA, pos: b64(g.pos), nrm: b64(g.nrm), index: g.index ? b64(g.index) : null,
      colour: albedo(mm), roughness: mm.roughness, metalness: mm.metalness, area: g.area,
    });
  };
  const walk = (root: Object3D, receivers: boolean) => root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || (m as { isSkinnedMesh?: boolean }).isSkinnedMesh || blinds.has(o) || !shown(o) || Array.isArray(m.material) || !solid(m.material as Material)) return;
    const mm = m.material as MeshStandardMaterial, parts = partsOf(m);
    // a palette mesh (`mergePalette`, `mergeSiblings`): the meshes it was merged from, each placed by the palette mesh's own matrix, with its own colour, hash and receiver's right
    if (parts.length) {
      for (const p of parts) add(p.mesh, p.mesh.material as MeshStandardMaterial, new Matrix4().multiplyMatrices(m.matrixWorld, p.inMesh), receivers && !hasAo(p.mesh.geometry));
      return;
    }
    if ((m as InstancedMesh).isInstancedMesh) {
      const im = new Matrix4(), w = new Matrix4(), inst = m as InstancedMesh;
      for (let i = 0; i < inst.count; i++) { inst.getMatrixAt(i, im); add(m, mm, w.multiplyMatrices(m.matrixWorld, im), false); }
      return;
    }
    add(m, mm, m.matrixWorld, receivers && !hasAo(m.geometry));
  });
  walk(r.root, true);
  for (const e of extra) walk(e, false);
  const groups = r.lightGroups().map((g) => ({ id: g.id, lights: g.lights.map((l) => readLight(l, toRoom)) }));
  // the sun bakes only at the hours it is up and comes in by the glass (it looks north: `sunIn` in `room3d.ts`)
  const suns = SUN_HOURS.map((hour) => ({ hour, d: sunDir(hour) })).filter(({ d }) => d[1] > 0 && -d[2] > 0.02)
    .map(({ hour, d }) => ({ hour, dir: dirB(new Vector3(...d)) }));
  const lo = toB(WEST_X, -FLOOR_Y, FRONT_Z), hi = toB(EAST_X, -CEIL_Y, 0);
  return { meshes, groups, suns, sunHours: SUN_HOURS, room: [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]] };
}
