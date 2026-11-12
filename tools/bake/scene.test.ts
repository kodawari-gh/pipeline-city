import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Texture, type Object3D } from 'three';
import { applyLightmap, framed, meshHash, type Bake } from '@/core/render/three/lightmapmix';
import { boxEnv } from '@/core/render/three/boxenv';
import { partsOf } from '@/core/render/three/merge';
import { mergeAfterBake } from '@/features/room/render/three/room3d';
import { RoomEnv } from '@/features/room/render/three/roomenv';
import { M } from '@/features/room/render/three/outside/plan';
import type { Room3D } from '@/features/room/render/three/room3d';
import { buildMachine, maxedSnapshot, quietCanvas } from '@/features/board/render/three/testutil';
import { exportRoom, type BakeMesh } from './scene';

quietCanvas();

/** A room with nothing in it: the export reads the machine as an extra blocker. */
const roomOf = (root: Object3D = new Group()): Room3D => ({ root, blinds: [], frame() {}, lightGroups: () => [] }) as unknown as Room3D;

const floats = (b64: string): Float32Array => { const u = Uint8Array.from(Buffer.from(b64, 'base64')); return new Float32Array(u.buffer); };

/** The largest distance (metres) from each mesh of `got` to the mesh of `want` with the same vertices nearest to it. */
function worstOff(got: BakeMesh[], want: BakeMesh[]): number {
  const by = new Map<number, Float32Array[]>();
  for (const m of want) { const p = floats(m.pos); by.set(p.length, [...(by.get(p.length) ?? []), p]); }
  let worst = 0;
  for (const m of got) {
    const p = floats(m.pos);
    let best = Infinity;
    for (const q of by.get(p.length) ?? []) {
      let d = 0;
      for (let i = 0; i < p.length && d < best; i++) d = Math.max(d, Math.abs(p[i]! - q[i]!));
      best = Math.min(best, d);
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

describe('exportRoom', () => {
  it('exports each mesh a merged machine took in where it stood, with the machine away from the origin and turned', { timeout: 120_000 }, () => {
    const s = maxedSnapshot(), out = (merge: boolean) => {
      const m = buildMachine(s, merge);
      m.root.position.set(12300, 4560, 7890); m.root.rotation.y = 0.3;
      return exportRoom(roomOf(), [m.root]).meshes;
    };
    const was = out(false), now = out(true);
    expect(now.length).toBe(was.length);
    expect(now.map((m) => m.receiver).filter(Boolean)).toEqual([]);
    expect(worstOff(now, was)).toBeLessThan(1e-4);
  });

  it('after the bake, merges the lit receivers, the AO blockers, the small blockers and the unknown receivers, and exports each as before', () => {
    const root = new Group(), lit = new MeshStandardMaterial({ color: 0x808080 }), ao = new MeshStandardMaterial({ color: 0x406080 });
    const plain = new MeshStandardMaterial({ color: 0x604020 }), own = new MeshStandardMaterial({ color: 0x205020, envMap: new Texture() });
    const box = (w: number, h: number, d: number, m: MeshStandardMaterial, x: number, z = 0) => { const b = new Mesh(new BoxGeometry(w, h, d), m); b.position.set(x, 0, z); root.add(b); return b; };
    // (all in one cell of the merge: 2 m)
    const lits = [box(M, M, 500, lit, 0), box(M, M, 500, lit, 2000, 3000)];
    const aos = [box(M / 2, M / 2, M / 2, ao, 4000), box(M / 2, M / 2, M / 2, ao, 6000)];
    for (const b of aos) b.geometry.setAttribute('_ao', new BufferAttribute(new Float32Array(b.geometry.attributes.position!.count).fill(0.5), 1));
    const small = [box(M / 20, M / 20, M / 20, plain, 8000), box(M / 20, M / 20, M / 20, plain, 9000)];
    const unknown = [box(M, M, 500, plain, 10000, 6000), box(M, M, 500, plain, 12000, 9000)];
    const outside = [box(M, M, 500, own, 14000), box(M, M, 500, own, 16000)];
    const envs = new RoomEnv(null, boxEnv([0, 0, 0], [1, 1, 1], [0, 0, 0]));
    envs.adopt(root);
    root.updateMatrixWorld(true);
    const hash = (m: Mesh) => meshHash(framed(m.geometry, new Matrix4().copy(m.matrixWorld)), m.geometry.index?.array ?? null);
    const corners = lits[0]!.geometry.index!.count, bake: Bake = {
      manifest: { version: 1, encoding: 'rgbm-sqrt', width: 64, height: 64, texelsPerMetre: 50, samples: 1, groups: [], dark: [], meshes: lits.map((m, i) => ({ name: `lit${i}`, hash: hash(m), corners, offset: i * corners })) },
      maps: new Map(), uvs: new Uint16Array(4 * corners),
    };
    expect(applyLightmap(root, bake, new Texture(), { metre: M, twin: (src, c) => envs.twin(src, c) }).meshes).toEqual(lits);
    const key = (m: BakeMesh) => `${m.hash}|${m.receiver}`, was = exportRoom(roomOf(root)).meshes;
    expect(mergeAfterBake(root, envs, [])).toBe(8);
    const merged = new Set(root.children.flatMap((o) => partsOf(o).map((p) => p.mesh)));
    for (const m of [...lits, ...aos, ...small, ...unknown]) expect(merged.has(m), m.uuid).toBe(true);
    for (const m of outside) { expect(merged.has(m)).toBe(false); expect(m.parent).toBe(root); }
    // the bake finds the same receivers and blockers where they were: the lit and the unknown big ones receive, the AO and small ones only block
    const now = exportRoom(roomOf(root)).meshes;
    expect(now.map(key).sort()).toEqual(was.map(key).sort());
    expect(was.filter((m) => m.receiver)).toHaveLength(6);
    expect(worstOff(now, was)).toBeLessThan(1e-4);
  });
});
