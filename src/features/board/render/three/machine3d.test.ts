import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DOMAdapter } from 'pixi.js';
import { Material, Mesh, PerspectiveCamera, Raycaster, Vector2, Vector3, type BufferAttribute, type MeshStandardMaterial, type Object3D } from 'three';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/game/types';
import { BakeQueue, fadeTree } from '@/core/render/three/artlod';
import { idOf, shown } from '@/core/render/three/pick';
import { roomGeo } from '@/features/room/render/shell/room';
import { BOARD_Z, CASE_FRONT } from '@/features/room/render/three/roomplan';
import { BD, DIE, DIMM_H, DIMM_W, DIMM_X, DIMM_Y } from '../layout/layout';
import { Machine3D } from './machine3d';

// The 2D art draws on Pixi canvases: in Node a canvas that draws nothing is enough (the art bakes on its queue later, and never here).
const nothing: unknown = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => nothing });
const context = () => new Proxy({}, {
  get: (_t, k) => (k === 'measureText' ? () => ({ width: 1, actualBoundingBoxAscent: 1, actualBoundingBoxDescent: 1 }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : nothing),
  set: () => true,
});
const canvas = () => ({ width: 1, height: 1, style: {}, getContext: context, addEventListener() {}, toDataURL: () => '' });
const adapter = DOMAdapter.get();
beforeAll(() => { DOMAdapter.set({ ...adapter, createCanvas: canvas } as unknown as typeof adapter); vi.spyOn(performance, 'now').mockReturnValue(100); });
afterAll(() => { DOMAdapter.set(adapter); vi.restoreAllMocks(); });

const game = () => new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
const build = (s: Snapshot | null, merge: boolean) => new Machine3D(s, roomGeo(), new BakeQueue(), null, true, merge);

/** The machine's states that change a look: the skins (power, load, throttle, heat, burnt), the LEDs, the strip, the fans' rings. */
function states(s: Snapshot): [string, Snapshot][] {
  const dev = (f: (d: Snapshot['devices'][number], i: number) => Partial<Snapshot['devices'][number]>) => s.devices.map((d, i) => ({ ...d, ...f(d, i) }));
  const on = { ...s, powered: true, power: { ...s.power, tripped: false } };
  return [
    ['off', { ...s, powered: false }],
    ['idle', { ...on, phase: 'idle-os' }],
    ['running', { ...on, phase: 'running', storage: s.storage.map((d) => ({ ...d, busy: true })) }],
    ['throttled', { ...on, phase: 'running', devices: dev(() => ({ throttle: 0.5 })) }],
    ['hot', { ...on, phase: 'running', devices: dev((_d, i) => ({ tempC: 45 + i * 3 })) }],
    ['burnt', { ...on, devices: dev((_d, i) => ({ burnt: i % 2 === 0 })) }],
    ['error', { ...on, phase: 'error' }],
    ['tripped', { ...on, power: { ...s.power, tripped: true } }],
  ];
}

/** The views the level of detail answers: the room's (the menu), the board view, the CPU's die, the RAM bank. */
function cameras(): PerspectiveCamera[] {
  const at = (x: number, y: number, z: number, d: number) => { const c = new PerspectiveCamera(40, 16 / 9, 10, 200000); c.position.set(x, y, z + d); c.lookAt(x, y, z); c.updateMatrixWorld(); return c; };
  const mid = (r: { x: number; y: number; w: number; h: number }) => [r.x + r.w / 2, -(r.y + r.h / 2)] as const;
  return [at(...mid(BD), BOARD_Z, 30000), at(...mid(BD), BOARD_Z, CASE_FRONT - BOARD_Z + 5000), at(...mid(DIE), BOARD_Z, 900), at(...mid({ x: DIMM_X(0), y: DIMM_Y(0), w: DIMM_W, h: DIMM_H }), BOARD_Z, 1600)];
}

// a material's look, but colour, roughness and metalness (each triangle's, read apart), by value: a texture is only there or not
const SKIP = new Set(['uuid', 'id', 'name', 'version', 'userData', '_listeners', 'onBeforeCompile', 'customProgramCacheKey', 'color', 'roughness', 'metalness', 'emissive', 'emissiveIntensity']);
function fields(m: Material): string {
  const v = (x: unknown): string => {
    if (x && typeof x === 'object') {
      const o = x as { isTexture?: boolean; isColor?: boolean; toArray?: () => number[] };
      if (o.isTexture) return 'T';
      if (o.toArray) return o.toArray().map((n) => (typeof n === 'number' ? n.toFixed(4) : String(n))).join(',');
      return JSON.stringify(Object.keys(x).sort());
    }
    return String(x);
  };
  return Object.keys(m).sort().filter((k) => !SKIP.has(k) && typeof (m as unknown as Record<string, unknown>)[k] !== 'function').map((k) => `${k}=${v((m as unknown as Record<string, unknown>)[k])}`).join(';');
}

/**
 * What the machine shows, part by part: for each scope (the nearest id), whether shown, and each triangle's effective look (base colour, roughness
 * and metalness from the material or a palette mesh's vertices, glow, opacity and the other fields), the count, area and area-weighted middle
 * of its triangles. A merge that changes nothing on screen gives the same.
 */
function look(root: Object3D): Map<string, number[]> {
  root.updateMatrixWorld(true);
  const out = new Map<string, number[]>(), a = new Vector3(), b = new Vector3(), c = new Vector3(), ab = new Vector3(), ac = new Vector3();
  const f4 = (n: number) => n.toFixed(4);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || (mesh as { isInstancedMesh?: boolean }).isInstancedMesh) {
      // (instanced meshes are not merged: their count and material are the look)
      if ((mesh as { isInstancedMesh?: boolean }).isInstancedMesh) {
        const k = `${idOf(o)}|${shown(o)}|inst|${fields(mesh.material as Material)}`, e = out.get(k) ?? [0];
        e[0]! += (mesh as unknown as { count: number }).count; out.set(k, e);
      }
      return;
    }
    const g = mesh.geometry, pos = g.attributes.position as BufferAttribute, pc = g.attributes._pc as BufferAttribute | undefined, prm = g.attributes._prm as BufferAttribute | undefined;
    const ms = [mesh.material].flat() as MeshStandardMaterial[], idx = g.index, n = idx ? idx.count : pos.count;
    const ranges = Array.isArray(mesh.material) ? g.groups.map((r) => ({ from: r.start, to: Math.min(n, r.start + r.count), m: ms[r.materialIndex ?? 0]! })) : [{ from: 0, to: n, m: ms[0]! }];
    for (const { from, to, m } of ranges) {
      const glow = m.emissive ? m.emissive.clone().multiplyScalar(m.emissiveIntensity) : null, base = `${idOf(o)}|${shown(o)}|${m.type}|${fields(m)}|${glow ? glow.toArray().map(f4).join(',') : '-'}|${mesh.castShadow}|${mesh.receiveShadow}`;
      const own = `${base}|${(m.color ? [m.color.r, m.color.g, m.color.b] : [1, 1, 1]).map(f4).join(',')}|${[m.roughness ?? 0, m.metalness ?? 0].map(f4).join(',')}`;
      let last = -1, lastK = own;
      for (let t = from; t + 2 < to; t += 3) {
        const i0 = idx ? idx.getX(t) : t;
        let k = own;
        if (pc && prm) {
          const h = pc.getX(i0) * 7 + pc.getY(i0) * 131 + pc.getZ(i0) * 1009 + prm.getX(i0) * 4507 + prm.getY(i0) * 9001;
          if (h !== last) { last = h; lastK = `${base}|${[pc.getX(i0), pc.getY(i0), pc.getZ(i0)].map(f4).join(',')}|${[prm.getX(i0), prm.getY(i0)].map(f4).join(',')}`; }
          k = lastK;
        }
        a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(mesh.matrixWorld);
        const area = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2, e = out.get(k) ?? [0, 0, 0, 0, 0];
        e[0]! += 1; e[1]! += area; e[2]! += area * (a.x + b.x + c.x) / 3; e[3]! += area * (a.y + b.y + c.y) / 3; e[4]! += area * (a.z + b.z + c.z) / 3;
        out.set(k, e);
      }
    }
  });
  return out;
}

function sameLook(before: Map<string, number[]>, after: Map<string, number[]>, what: string): void {
  expect([...after.keys()].sort(), what).toEqual([...before.keys()].sort());
  for (const [k, e] of before) {
    const f = after.get(k)!;
    expect(f[0], `${what}: ${k}`).toBe(e[0]);
    for (let i = 1; i < e.length; i++) expect(Math.abs(f[i]! - e[i]!), `${what}: ${k} [${i}]`).toBeLessThanOrEqual(1e-3 * Math.max(1, Math.abs(e[1]!) * 1e4, Math.abs(e[i]!)));
  }
}

/** The first shown thing each ray of a grid over the view meets: its id and how far. */
function picks(root: Object3D, cam: PerspectiveCamera): string[] {
  const ray = new Raycaster(), at = new Vector2(), out: string[] = [];
  root.updateMatrixWorld(true);
  for (let y = -0.9; y <= 0.9; y += 0.15) for (let x = -0.9; x <= 0.9; x += 0.15) {
    ray.setFromCamera(at.set(x, y), cam);
    const h = ray.intersectObject(root, true).find((q) => shown(q.object));
    out.push(h ? `${idOf(h.object)}@${Math.round(h.distance)}` : '-');
  }
  return out;
}

describe('Machine3D merge and share (PERF22 part 2)', () => {
  it('draws far fewer meshes with far fewer materials', { timeout: 60_000 }, () => {
    for (const s of [game().snapshot(), null]) {
      const count = (m: Machine3D) => { let n = 0; const mats = new Set<Material>(); m.root.traverse((o) => { if ((o as Mesh).isMesh) { n++; for (const x of [(o as Mesh).material].flat()) mats.add(x); } }); return { n, mats: mats.size }; };
      const was = count(build(s, false)), now = count(build(s, true));
      expect(now.n).toBeLessThan(was.n * 0.6);
      expect(now.mats).toBeLessThan(was.mats * 0.6);
    }
  });

  it('shows every part as before in every state and view: colour, glow, fade, shape', { timeout: 120_000 }, () => {
    const s = game().snapshot(), was = build(s, false), now = build(s, true);
    // every state in the room's view, one state in each closer view (the fades and the swung cards)
    for (const [ci, cam] of cameras().entries()) {
      was.lod(cam, 1080, 1); now.lod(cam, 1080, 1);
      for (const [name, st] of ci ? states(s).filter(([n]) => n === 'hot') : states(s)) {
        for (let i = 0; i < 4; i++) { was.frame(st, 5); now.frame(st, 5); }
        sameLook(look(was.root), look(now.root), `${name} from ${cam.position.toArray().map(Math.round).join(',')}`);
      }
    }
  });

  it('fades each lid, cooler and spreader alone, as before', { timeout: 60_000 }, () => {
    const s = game().snapshot(), was = build(s, false), now = build(s, true);
    expect(now.fades.length).toBe(was.fades.length);
    expect(now.fades.length).toBeGreaterThan(2);
    now.fades.forEach((f, i) => {
      fadeTree(was.fades[i]!, 0.5); fadeTree(f, 0.5);
      sameLook(look(was.root), look(now.root), `fade ${i}`);
      fadeTree(was.fades[i]!, 1); fadeTree(f, 1);
    });
  });

  it('answers every pick as before, part by part', { timeout: 60_000 }, () => {
    const s = game().snapshot(), was = build(s, false), now = build(s, true);
    for (const cam of cameras()) {
      was.lod(cam, 1080, 1); now.lod(cam, 1080, 1);
      expect(picks(now.root, cam)).toEqual(picks(was.root, cam));
    }
  });

  it('keeps every state look on materials of its own: a skin, a ring or an LED never lights another part', { timeout: 60_000 }, () => {
    const s = game().snapshot(), m = build(s, true), run = states(s).find(([n]) => n === 'hot')![1];
    for (let i = 0; i < 4; i++) m.frame(run, 5);
    // each glowing material is used inside one part only
    const users = new Map<Material, Set<string | null>>();
    m.root.traverse((o) => { const x = o as Mesh; if (!x.isMesh) return; for (const mm of [x.material].flat() as MeshStandardMaterial[]) if (mm.emissive && mm.emissiveIntensity > 0 && mm.emissive.getHex()) { const u = users.get(mm) ?? new Set(); u.add(idOf(o)); users.set(mm, u); } });
    expect(users.size).toBeGreaterThan(0);
    for (const [mm, u] of users) expect([...u], mm.uuid).toHaveLength(1);
  });
});
