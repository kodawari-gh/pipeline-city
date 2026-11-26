// The light bake's export (`src/features/room/light.md`, "Offline bakes"; T179). `bake.mjs` imports it into the game's page through the dev
// server and calls `exportRoom`: it reads the room as the game built it and hands back what Blender needs. The meshes (in Blender's frame:
// metres, z up), each a receiver (it gets a lightmap) or only a blocker; each light group's lights at full power (`Room3D.lightGroups`); the
// sun's directions. A receiver carries the hash the game finds it by (`meshHash`, `lightmapmix.ts`), since a merged mesh has no name of its own.
import * as THREE from 'three';
import { MIN_AREA, hasAo, meshHash, shown, solid } from '@/core/render/three/lightmapmix';
import { partsOf } from '@/core/render/three/merge';
import * as room3d from '@/features/room/render/three/room3d';
import { CEIL_Y, EAST_X, FLOOR_Y, FRONT_Z, WEST_X, sunDir } from '@/features/room/render/three/roomplan';
import * as blender from './blender';

/**
 * What the export reads of the room (`Room3D`): its root, its frame (to set the lights to full power) and light groups, and its blinds
 * (they neither receive nor block).
 */
export interface BakeRoom {
  root: THREE.Object3D;
  frame: (f: Parameters<room3d.Room3D['frame']>[0], dt: number) => void;
  lightGroups: () => { id: string; lights: THREE.Light[] }[];
  blinds: readonly THREE.Object3D[];
}

const isMesh = (o: THREE.Object3D): o is THREE.Mesh => o instanceof THREE.Mesh;

/** One mesh (or one instance of it) for the export: where it is in the world and whether it gets a lightmap. */
interface Piece {
  o: THREE.Mesh;
  mm: THREE.MeshStandardMaterial;
  world: THREE.Matrix4;
  receiver: boolean;
}

/** The export's meshes: each piece found, named and encoded for Blender. */
class MeshList {
  readonly meshes: blender.BakeMesh[] = [];
  private readonly names = new Map<string, number>();

  constructor(private readonly toRoom: THREE.Matrix4) {}

  add({ o, mm, world, receiver }: Piece): void {
    // (a mesh the game lit with the last bake has lost its index: it keeps the hash the bake found it by)
    const g = blender.geometry(o.geometry, new THREE.Matrix4().multiplyMatrices(this.toRoom, world)),
      known: unknown = o.userData['bakeHash'],
      hash = typeof known === 'string' ? known : meshHash(g.room, g.index);
    // a readable name: the material's colour and the vertex count, numbered when two match
    const base = `${o.name || 'mesh'}-${mm.color.getHexString()}${mm.map ? '-map' : ''}-${g.pos.length / 3}`,
      k = this.names.get(base) ?? 0;
    this.names.set(base, k + 1);
    this.meshes.push({
      name: k > 0 ? `${base}-${k}` : base,
      hash,
      receiver: receiver && g.area >= MIN_AREA,
      pos: blender.b64(g.pos),
      nrm: blender.b64(g.nrm),
      index: g.index ? blender.b64(g.index) : null,
      colour: blender.albedo(mm),
      roughness: mm.roughness,
      metalness: mm.metalness,
      area: g.area,
    });
  }

  /** One object's meshes: a palette mesh's sources, an instanced mesh's instances, or the mesh itself. */
  visit(o: THREE.Object3D, receivers: boolean): void {
    if (!isMesh(o) || o instanceof THREE.SkinnedMesh || !shown(o) || Array.isArray(o.material)) {
      return;
    }
    const m = o,
      mat: THREE.Material = m.material;
    if (!solid(mat)) {
      return;
    }
    const parts = partsOf(m);
    // a palette mesh (`mergePalette`, `mergeSiblings`): the meshes it was merged from, each placed by the palette mesh's own matrix, with its own colour, hash and receiver's right
    if (parts.length > 0) {
      for (const p of parts) {
        // (a palette mesh takes in only standard materials: `paletteOf` in `merge.ts`)
        const pm: THREE.Material | THREE.Material[] = p.mesh.material;
        if (pm instanceof THREE.MeshStandardMaterial) {
          this.add({
            o: p.mesh,
            mm: pm,
            world: new THREE.Matrix4().multiplyMatrices(m.matrixWorld, p.inMesh),
            receiver: receivers && !hasAo(p.mesh.geometry),
          });
        }
      }
      return;
    }
    if (m instanceof THREE.InstancedMesh) {
      const im = new THREE.Matrix4();
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, im);
        this.add({ o: m, mm: mat, world: new THREE.Matrix4().multiplyMatrices(m.matrixWorld, im), receiver: false });
      }
      return;
    }
    this.add({ o: m, mm: mat, world: m.matrixWorld, receiver: receivers && !hasAo(m.geometry) });
  }
}

/** The night the bake lights the room at: the desk lamp and the screen on, the blinds up. */
const BAKE_FRAME: Parameters<room3d.Room3D['frame']>[0] = {
  hour: 23,
  lamp: true,
  blind: false,
  screen: { installed: true, powered: true, live: false, text: '' },
  router: 1,
  isp: 0,
  ispName: '',
  mail: false,
  t: 0,
};

/**
 * The room as Blender bakes it. `room`: the game's room (`BakeRoom`: its lights are read at full power: the night with the desk lamp and the
 * screen on); `extra`: other roots that only block (the machine). Synchronous, so the game's next frame (which sets the lights back) comes after it.
 */
export function exportRoom(room: BakeRoom, extra: THREE.Object3D[] = []): blender.BakeScene {
  room.frame(BAKE_FRAME, 1);
  room.root.updateMatrixWorld(true);
  for (const e of extra) {
    e.updateMatrixWorld(true);
  }
  const toRoom = new THREE.Matrix4().copy(room.root.matrixWorld).invert(),
    blinds = new Set<THREE.Object3D>(room.blinds),
    list = new MeshList(toRoom);
  // (a LOD stand-in, `partlod.ts`, copies meshes that export already: skip it)
  const walk = (root: THREE.Object3D, receivers: boolean): void => {
    const standIn: unknown = root.userData['standIn'];
    if (standIn !== true) {
      if (!blinds.has(root)) {
        list.visit(root, receivers);
      }
      for (const c of root.children) {
        walk(c, receivers);
      }
    }
  };
  walk(room.root, true);
  for (const e of extra) {
    walk(e, false);
  }
  const groups = room
    .lightGroups()
    .map((g) => ({ id: g.id, lights: g.lights.map((l) => blender.readLight(l, toRoom)) }));
  // the sun bakes only at the hours it is up and comes in by the glass (it looks north: `sunIn` in `room3d.ts`)
  const suns = room3d.SUN_HOURS.map((hour) => ({ hour, d: sunDir(hour) }))
    .filter(({ d }) => d[1] > 0 && -d[2] > 0.02)
    .map(({ hour, d }) => ({ hour, dir: blender.dirB(new THREE.Vector3(...d)) }));
  const lo = blender.toB(WEST_X, -FLOOR_Y, FRONT_Z),
    hi = blender.toB(EAST_X, -CEIL_Y, 0);
  return {
    meshes: list.meshes,
    groups,
    suns,
    sunHours: room3d.SUN_HOURS,
    room: [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]],
  };
}
