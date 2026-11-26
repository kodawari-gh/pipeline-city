import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Texture } from 'three';
import { applyLightmap, framed, meshHash } from '@/core/render/three/lightmapmix';
import { boxEnv } from '@/core/render/three/boxenv';
import { partsOf } from '@/core/render/three/merge';
import { mergeAfterBake } from '@/features/room/render/three/room3d';
import { RoomEnv } from '@/features/room/render/three/roomenv';
import { M } from '@/features/room/render/three/outside/plan';
import { buildMachine, maxedSnapshot, quietCanvas } from '@/features/board/render/three/testutil';
import { exportRoom } from './scene';

type Bake = Parameters<typeof applyLightmap>[1];
type BakeMesh = ReturnType<typeof exportRoom>['meshes'][number];
type BakeRoom = Parameters<typeof exportRoom>[0];

quietCanvas();

/** A room with nothing in it: the export reads the machine as an extra blocker. */
const roomOf = (root: Group = new Group()): BakeRoom => ({
  root,
  blinds: [],
  frame: () => {
    // (an empty room: no lights to set)
  },
  lightGroups: () => [],
});

const floats = (b64: string): Float32Array => {
  const u = Uint8Array.from(Buffer.from(b64, 'base64'));
  return new Float32Array(u.buffer);
};

/** The largest distance (metres) from each mesh of `got` to the mesh of `want` with the same vertices nearest to it. */
function worstOff(got: BakeMesh[], want: BakeMesh[]): number {
  const by = new Map<number, Float32Array[]>();
  for (const m of want) {
    const p = floats(m.pos);
    by.set(p.length, [...(by.get(p.length) ?? []), p]);
  }
  let worst = 0;
  for (const m of got) {
    const p = floats(m.pos);
    let best = Infinity;
    for (const q of by.get(p.length) ?? []) {
      let d = 0;
      for (let i = 0; i < p.length && d < best; i++) {
        d = Math.max(d, Math.abs((p[i] ?? 0) - (q[i] ?? 0)));
      }
      best = Math.min(best, d);
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

/** A test box: its size (w, h, d), its material and where it stands on the floor (x, z). */
interface Box {
  size: [number, number, number];
  m: MeshStandardMaterial;
  x: number;
  z?: number;
}

/** The hash the bake finds a mesh by, where it stands. */
const hash = (m: Mesh) =>
  meshHash(framed(m.geometry, new Matrix4().copy(m.matrixWorld)), m.geometry.index?.array ?? null);

/** The corners (index entries) of an indexed mesh. */
function cornersOf(m: Mesh | undefined): number {
  const index = m?.geometry.index;
  if (!index) {
    throw new Error('an indexed mesh');
  }
  return index.count;
}

/** A mesh's export, by hash and receiver's right. */
const key = (m: BakeMesh) => `${m.hash}|${m.receiver}`;

describe('exportRoom', () => {
  it(
    'exports each mesh a merged machine took in where it stood, with the machine away from the origin and turned',
    { timeout: 120_000 },
    () => {
      const s = maxedSnapshot(),
        out = (merge: boolean) => {
          const m = buildMachine(s, merge);
          m.root.position.set(12_300, 4560, 7890);
          m.root.rotation.y = 0.3;
          return exportRoom(roomOf(), [m.root]).meshes;
        };
      const was = out(false),
        now = out(true);
      expect(now).toHaveLength(was.length);
      expect(now.map((m) => m.receiver).filter(Boolean)).toStrictEqual([]);
      expect(worstOff(now, was)).toBeLessThan(1e-4);
    },
  );

  it('leaves the LOD stand-ins out: the export is the same with them as without', { timeout: 120_000 }, () => {
    const s = maxedSnapshot(),
      out = (lod: boolean) => {
        const m = buildMachine(s, true, lod);
        return { m, meshes: exportRoom(roomOf(), [m.root]).meshes };
      };
    const was = out(false),
      now = out(true);
    expect(now.m.partLod?.standIns.length).toBeGreaterThan(0);
    // (same names and hashes, so no stand-in is among them)
    expect(now.meshes).toHaveLength(was.meshes.length);
    expect(now.meshes.map((m) => m.name)).toStrictEqual(was.meshes.map((m) => m.name));
    expect(now.meshes.map((m) => m.hash)).toStrictEqual(was.meshes.map((m) => m.hash));
  });

  it('after the bake, merges the lit receivers, the AO blockers, the small blockers and the unknown receivers, and exports each as before', () => {
    const root = new Group(),
      lit = new MeshStandardMaterial({ color: 0x80_80_80 }),
      ao = new MeshStandardMaterial({ color: 0x40_60_80 });
    const plain = new MeshStandardMaterial({ color: 0x60_40_20 }),
      own = new MeshStandardMaterial({ color: 0x20_50_20, envMap: new Texture() });
    const box = ({ size, m, x, z = 0 }: Box) => {
      const b = new Mesh(new BoxGeometry(...size), m);
      b.position.set(x, 0, z);
      root.add(b);
      return b;
    };
    // (all in one cell of the merge: 2 m)
    const lits = [box({ size: [M, M, 500], m: lit, x: 0 }), box({ size: [M, M, 500], m: lit, x: 2000, z: 3000 })];
    const aos = [
      box({ size: [M / 2, M / 2, M / 2], m: ao, x: 4000 }),
      box({ size: [M / 2, M / 2, M / 2], m: ao, x: 6000 }),
    ];
    for (const b of aos) {
      const shade = new Float32Array(b.geometry.getAttribute('position').count).fill(0.5);
      b.geometry.setAttribute('_ao', new BufferAttribute(shade, 1));
    }
    const small = [
      box({ size: [M / 20, M / 20, M / 20], m: plain, x: 8000 }),
      box({ size: [M / 20, M / 20, M / 20], m: plain, x: 9000 }),
    ];
    const unknown = [
      box({ size: [M, M, 500], m: plain, x: 10_000, z: 6000 }),
      box({ size: [M, M, 500], m: plain, x: 12_000, z: 9000 }),
    ];
    const outside = [box({ size: [M, M, 500], m: own, x: 14_000 }), box({ size: [M, M, 500], m: own, x: 16_000 })];
    const envs = new RoomEnv(null, boxEnv([0, 0, 0], [1, 1, 1], [0, 0, 0]));
    envs.adopt(root);
    root.updateMatrixWorld(true);
    const corners = cornersOf(lits[0]),
      bake: Bake = {
        manifest: {
          version: 1,
          encoding: 'rgbm-sqrt',
          width: 64,
          height: 64,
          texelsPerMetre: 50,
          samples: 1,
          groups: [],
          dark: [],
          meshes: lits.map((m, i) => ({ name: `lit${i}`, hash: hash(m), corners, offset: i * corners })),
        },
        maps: new Map(),
        uvs: new Uint16Array(4 * corners),
      };
    expect(
      applyLightmap(root, bake, new Texture(), {
        metre: M,
        twin: (src, c) => {
          envs.twin(src, c);
        },
      }).meshes,
    ).toStrictEqual(lits);
    const was = exportRoom(roomOf(root)).meshes;
    expect(mergeAfterBake(root, envs, [])).toBe(8);
    const merged = new Set(root.children.flatMap((o) => partsOf(o).map((p) => p.mesh)));
    for (const m of [...lits, ...aos, ...small, ...unknown]) {
      expect(merged.has(m)).toBe(true);
    }
    for (const m of outside) {
      expect(merged.has(m)).toBe(false);
      expect(m.parent).toBe(root);
    }
    // the bake finds the same receivers and blockers where they were: the lit and the unknown big ones receive, the AO and small ones only block
    const now = exportRoom(roomOf(root)).meshes;
    expect(now.map((m) => key(m)).toSorted()).toStrictEqual(was.map((m) => key(m)).toSorted());
    expect(was.filter((m) => m.receiver)).toHaveLength(6);
    expect(worstOff(now, was)).toBeLessThan(1e-4);
  });
});
