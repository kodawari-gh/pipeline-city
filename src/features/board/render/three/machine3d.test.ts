import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/game/types';
import { findById, idOf, ownerOf, pick, shown } from '@/core/render/three/pick';
import { LIMITS, applyView, fitRect } from '@/core/render/three/camera';
import { drawnMeshes } from '@/core/render/three/partlod';
import { BOARD_Z, CASE_FRONT } from '@/features/room/render/three/roomplan';
import { BD, CASE as CASE_RECT, DIE, DIMM_H, DIMM_W, DIMM_X, DIMM_Y, GEO, setLayoutTier } from '../layout/layout';
import type { Machine3D } from './machine3d';
// oxlint-disable-next-line import/max-dependencies -- one file covers the merge, the stand-ins and the board's Ethernet chip: each reads its own layout, camera or part module
import { LOD_CEIL } from './buildmode3d';
import { CHIP_H } from './solids3d';
import { buildMachine, quietCanvas } from './testutil';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** Returns `value` when it is present, otherwise `fallback`. */
function or<T>(value: T, fallback: NonNullable<T>): NonNullable<T> {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;
function asMesh(o: unknown): three.Mesh {
  if (!isMesh(o)) {
    throw new Error('expected a Mesh');
  }
  return o;
}

const isMeshStandardMaterial = (o: unknown): o is three.MeshStandardMaterial =>
  typeof o === 'object' && o !== null && 'isMeshStandardMaterial' in o && o.isMeshStandardMaterial === true;
function asMeshStandardMaterial(o: unknown): three.MeshStandardMaterial {
  if (!isMeshStandardMaterial(o)) {
    throw new Error('expected a MeshStandardMaterial');
  }
  return o;
}

quietCanvas();

const game = () => new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
const build = buildMachine;

/** The machine's states that change a look: the skins (power, load, throttle, heat, burnt), the LEDs, the strip, the fans' rings. */
function states(s: Snapshot): [string, Snapshot][] {
  const dev = (f: (d: Snapshot['devices'][number], i: number) => Partial<Snapshot['devices'][number]>) =>
    s.devices.map((d, i) => ({ ...d, ...f(d, i) }));
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

// a material's look, but colour, roughness and metalness (each triangle's, read apart), by value: a texture is only there or not
const SKIP = new Set([
  'uuid',
  'id',
  'name',
  'version',
  'userData',
  '_listeners',
  'onBeforeCompile',
  'customProgramCacheKey',
  'color',
  'roughness',
  'metalness',
  'emissive',
  'emissiveIntensity',
]);

// (each triangle is the same, but the merged ones were baked into their parent's frame in float32: the area differs by up to 2e-5 of itself
// and the middle by up to 0.005 units, measured on the maxed machine)
const AREA_TOL = 1e-4,
  CENTRE_TOL = 0.02;
// (a stand-in may draw a part at its lower detail level, `lowOf` in merge.ts: fewer triangles of the same look, nearly the same area and middle)
const LOW_AREA_TOL = 0.03,
  LOW_CENTRE_TOL = 12;
/** Checks that `after` looks as `before` (the pair of `look` maps); `lod` lets a part draw at its lower detail level. */
function sameLook([before, after]: [Map<string, number[]>, Map<string, number[]>], what: string, lod = false): void {
  expect([...after.keys()].toSorted()).toStrictEqual([...before.keys()].toSorted());
  for (const [k, e] of before) {
    const f = after.get(k);
    expect(f).toBeDefined();
    if (!f) {
      continue;
    }
    const low = lod ? or(f[0], 0) < or(e[0], 0) : false;
    if (!low) {
      expect(f[0], `${what}: ${k}`).toBe(e[0]);
    }
    if (e.length < 2) {
      continue;
    } // (an instanced mesh: its count only)
    const area = must(e[1]);
    const da = Math.abs(must(f[1]) - area) / Math.max(area, 1e-9);
    expect(da, `${what}: ${k} area`).toBeLessThanOrEqual(low ? LOW_AREA_TOL : AREA_TOL);
    if (area < 1e-9) {
      continue;
    }
    // the area-weighted middle of the key's triangles, in units
    for (let i = 2; i < e.length; i++) {
      const dc = Math.abs(must(f[i]) / must(f[1]) - must(e[i]) / area);
      expect(dc, `${what}: ${k} middle [${i - 2}]`).toBeLessThanOrEqual(low ? LOW_CENTRE_TOL : CENTRE_TOL);
    }
  }
}

/** The opacity of the first material in `g`, against its own (`fadeTree` keeps that in `userData.base`). */
function opacityOf(g: three.Object3D): number {
  let a = 1;
  g.traverse((o) => {
    if (!isMesh(o)) {
      return;
    }
    const m = o.material;
    if (a === 1 && !Array.isArray(m)) {
      const base: unknown = m.userData['base'];
      const own =
        typeof base === 'object' && base !== null && 'opacity' in base && typeof base.opacity === 'number'
          ? base.opacity
          : m.opacity;
      a = m.opacity / own;
    }
  });
  return a;
}

/** Where the camera looks to see a faded part: the middle of its box. A NIC's lid lies where the card folds down to, not where its box is built (the card stands): its die's rail says where. */
function aim(m: Machine3D, f: three.Object3D): three.Vector3 {
  const r = m.rails.find((x) => x.id === idOf(f) && x.id.endsWith('.nic-ctl'));
  return r
    ? new three.Vector3(r.rect.x + r.rect.w / 2, -(r.rect.y + r.rect.h / 2), r.z)
    : new three.Box3().setFromObject(f).getCenter(new three.Vector3());
}

/** The first shown thing each ray of a grid over the view meets: its id and how far. */
function picks(root: three.Object3D, cam: three.PerspectiveCamera): string[] {
  const ray = new three.Raycaster(),
    at = new three.Vector2(),
    out: string[] = [];
  root.updateMatrixWorld(true);
  for (let y = -0.9; y <= 0.9; y += 0.15) {
    for (let x = -0.9; x <= 0.9; x += 0.15) {
      ray.setFromCamera(at.set(x, y), cam);
      const h = ray.intersectObject(root, true).find((q) => shown(q.object));
      out.push(h ? `${idOf(h.object)}@${Math.round(h.distance)}` : '-');
    }
  }
  return out;
}

/** A camera `d` in front of `c`, looking at it. */
const camFrom = (c: three.Vector3, d: number) => {
  const k = new three.PerspectiveCamera(40, 16 / 9, 10, 200_000);
  k.position.set(c.x, c.y, c.z + d);
  k.lookAt(c);
  k.updateMatrixWorld();
  return k;
};
/** The middle of a layout rect, on the board's face. */
const midOf = (r: { x: number; y: number; w: number; h: number }) =>
  new three.Vector3(r.x + r.w / 2, -(r.y + r.h / 2), BOARD_Z);

/** The views the level of detail answers: the room's (the menu), the board view, the CPU's die, the RAM bank. */
function cameras(): three.PerspectiveCamera[] {
  return [
    camFrom(midOf(BD), 30_000),
    camFrom(midOf(BD), CASE_FRONT - BOARD_Z + 5000),
    camFrom(midOf(DIE), 900),
    camFrom(midOf({ x: DIMM_X(0), y: DIMM_Y(0), w: DIMM_W, h: DIMM_H }), 1600),
  ];
}

/** A number to four places, as the looks compare them. */
const f4 = (x: number) => x.toFixed(4);
const hasToArray = (o: object): o is { toArray: () => unknown[] } => 'toArray' in o && typeof o.toArray === 'function';
/** One field of a material, as text: a texture is only there, a colour or a vector is its numbers. */
function fieldText(x: unknown): string {
  if (typeof x !== 'object' || x === null) {
    return String(x);
  }
  if ('isTexture' in x && x.isTexture === true) {
    return 'T';
  }
  if (hasToArray(x)) {
    return x
      .toArray()
      .map((n) => (typeof n === 'number' ? n.toFixed(4) : String(n)))
      .join(',');
  }
  return JSON.stringify(Object.keys(x).toSorted());
}
function fields(m: three.Material | three.Material[]): string {
  const values = new Map<string, unknown>(Object.entries(m));
  return [...values.keys()]
    .toSorted()
    .filter((k) => !SKIP.has(k) && typeof values.get(k) !== 'function')
    .map((k) => `${k}=${fieldText(values.get(k))}`)
    .join(';');
}

/** A material's glow colour and strength, or null for one that cannot glow. */
function emissiveOf(m: three.Material): { color: three.Color; intensity: number } | null {
  if (!('emissive' in m) || !(m.emissive instanceof three.Color)) {
    return null;
  }
  const intensity = 'emissiveIntensity' in m && typeof m.emissiveIntensity === 'number' ? m.emissiveIntensity : 1;
  return { color: m.emissive, intensity };
}
/** A material's glow as text, `-` for none. */
function glowText(m: three.Material): string {
  const e = emissiveOf(m);
  if (e === null) {
    return '-';
  }
  const glow = e.color.clone().multiplyScalar(e.intensity);
  return glow
    .toArray()
    .map((x) => f4(x))
    .join(',');
}
/** A material's own base colour, roughness and metalness, as text (white, 0 and 0 where it has none). */
function paintText(m: three.Material): string {
  const c = 'color' in m && m.color instanceof three.Color ? [m.color.r, m.color.g, m.color.b] : [1, 1, 1];
  const rough = 'roughness' in m && typeof m.roughness === 'number' ? m.roughness : 0,
    metal = 'metalness' in m && typeof m.metalness === 'number' ? m.metalness : 0;
  return `${c.map((x) => f4(x)).join(',')}|${[rough, metal].map((x) => f4(x)).join(',')}`;
}
type Attr = three.BufferAttribute | three.InterleavedBufferAttribute;
/** A palette mesh's colour and roughness at vertex `i`, as text. */
const paletteText = (pc: Attr, prm: Attr, i: number) =>
  `${[pc.getX(i), pc.getY(i), pc.getZ(i)].map((x) => f4(x)).join(',')}|${[prm.getX(i), prm.getY(i)].map((x) => f4(x)).join(',')}`;
/** The triangle ranges of a mesh of `n` indices, each with its material. */
function rangesOf(mesh: three.Mesh, n: number): { from: number; to: number; m: three.Material }[] {
  const ms = [mesh.material].flat();
  if (!Array.isArray(mesh.material)) {
    return [{ from: 0, to: n, m: must(ms[0]) }];
  }
  return mesh.geometry.groups.map((r) => ({
    from: r.start,
    to: Math.min(n, r.start + r.count),
    m: must(ms[or(r.materialIndex, 0)]),
  }));
}

/** `look` for one drawn mesh: its triangles by look (material fields, glow, opacity, shadow flags, colour), without its id; a copy at a time if instanced. */
function drawnLook(mesh: three.Mesh, out: Map<string, number[]>): void {
  const g = mesh.geometry,
    pos = must(g.attributes['position']),
    pc = g.attributes['_pc'],
    prm = g.attributes['_prm'];
  const idx = g.index,
    n = idx ? idx.count : pos.count;
  const mats: three.Matrix4[] = [];
  if (mesh instanceof three.InstancedMesh) {
    for (let i = 0; i < mesh.count; i++) {
      const own = new three.Matrix4();
      mesh.getMatrixAt(i, own);
      mats.push(new three.Matrix4().multiplyMatrices(mesh.matrixWorld, own));
    }
  } else {
    mats.push(mesh.matrixWorld);
  }
  for (const { from, to, m } of rangesOf(mesh, n)) {
    const base = `${m.type}|${fields(m)}|${glowText(m)}|${mesh.castShadow}|${mesh.receiveShadow}`;
    // (triangle counts by look only: the stand-in's shapes are the merge's own tests)
    const add = (k: string, count: number) => {
      const e = or(out.get(k), [0, 0, 0, 0, 0]);
      e[0] = must(e[0]) + count;
      out.set(k, e);
    };
    if (pc && prm) {
      for (let t = from; t + 2 < to; t += 3) {
        const i0 = idx ? idx.getX(t) : t;
        add(`${base}|${paletteText(pc, prm, i0)}`, mats.length);
      }
    } else {
      add(`${base}|${paintText(m)}`, Math.floor((to - from) / 3) * mats.length);
    }
  }
}

// (scratch vectors of `meshLook`)
const TA = new three.Vector3(),
  TB = new three.Vector3(),
  TC = new three.Vector3(),
  TAB = new three.Vector3(),
  TAC = new three.Vector3();

/** `look` for one mesh that is not instanced: each triangle by its scope, whether shown, and its look; the count, area and middle. */
function meshLook(mesh: three.Mesh, out: Map<string, number[]>): void {
  const g = mesh.geometry,
    pos = must(g.attributes['position']),
    pc = g.attributes['_pc'],
    prm = g.attributes['_prm'];
  const idx = g.index,
    n = idx ? idx.count : pos.count;
  const [a, b, c] = [TA, TB, TC];
  for (const { from, to, m } of rangesOf(mesh, n)) {
    const base = `${idOf(mesh)}|${shown(mesh)}|${m.type}|${fields(m)}|${glowText(m)}|${mesh.castShadow}|${mesh.receiveShadow}`;
    const own = `${base}|${paintText(m)}`;
    let last = -1,
      lastK = own;
    for (let t = from; t + 2 < to; t += 3) {
      const i0 = idx ? idx.getX(t) : t;
      let k = own;
      if (pc && prm) {
        const h = pc.getX(i0) * 7 + pc.getY(i0) * 131 + pc.getZ(i0) * 1009 + prm.getX(i0) * 4507 + prm.getY(i0) * 9001;
        if (h !== last) {
          last = h;
          lastK = `${base}|${paletteText(pc, prm, i0)}`;
        }
        k = lastK;
      }
      a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(mesh.matrixWorld);
      const area = TAB.subVectors(b, a).cross(TAC.subVectors(c, a)).length() / 2,
        e = or(out.get(k), [0, 0, 0, 0, 0]);
      e[0] = must(e[0]) + 1;
      e[1] = must(e[1]) + area;
      e[2] = must(e[2]) + (area * (a.x + b.x + c.x)) / 3;
      e[3] = must(e[3]) + (area * (a.y + b.y + c.y)) / 3;
      e[4] = must(e[4]) + (area * (a.z + b.z + c.z)) / 3;
      out.set(k, e);
    }
  }
}

/**
 * What the machine shows, part by part: for each scope (the nearest id), whether shown, and each triangle's effective look (base colour, roughness
 * and metalness from the material or a palette mesh's vertices, glow, opacity and the other fields), the count, area and area-weighted middle
 * of its triangles. A merge that changes nothing on screen gives the same.
 */
function look(root: three.Object3D, drawn = false): Map<string, number[]> {
  root.updateMatrixWorld(true);
  const out = new Map<string, number[]>();
  root.traverse((o) => {
    if (!isMesh(o)) {
      return;
    }
    // `drawn`: only what a camera on layer 0 draws, by look alone (no id: a stand-in sits under another parent), copy by copy for instanced meshes
    if (drawn) {
      if (shown(o) && (o.layers.mask & 1) !== 0 && [o.material].flat().some((x) => x.visible)) {
        drawnLook(o, out);
      }
      return;
    }
    // (instanced meshes are not merged: their count and material are the look)
    const copies = o instanceof three.InstancedMesh ? o.count : -1;
    if (copies >= 0) {
      const k = `${idOf(o)}|${shown(o)}|inst|${fields(o.material)}`,
        e = or(out.get(k), [0]);
      e[0] = must(e[0]) + copies;
      out.set(k, e);
      return;
    }
    meshLook(o, out);
  });
  return out;
}

/** The parts that fade or come apart, each with a mesh in it. */
const fadeRoots = (m: Machine3D) =>
  [...m.fades, ...m.apart].filter((g) => {
    let n = 0;
    g.traverse((o) => {
      if (isMesh(o)) {
        n++;
      }
    });
    return n > 0;
  });
/** A camera far over the board's middle, where every part draws as its stand-in. */
const farCam = () => camFrom(midOf(BD), 60_000);

function assert_draws_far_fewer_meshes_with_far_fewer_materials(): void {
  for (const s of [game().snapshot(), null]) {
    const count = (m: Machine3D) => {
      let n = 0;
      const mats = new Set<three.Material>();
      m.root.traverse((o) => {
        if (isMesh(o)) {
          n++;
          for (const x of [asMesh(o).material].flat()) {
            mats.add(x);
          }
        }
      });
      return { n, mats: mats.size };
    };
    const was = count(build(s, false)),
      now = count(build(s, true));
    expect(now.n).toBeLessThan(was.n * 0.6);
    expect(now.mats).toBeLessThan(was.mats * 0.6);
  }
}

function assert_shows_every_part_as_before_in_every_state_and_vi(): void {
  const s = game().snapshot(),
    was = build(s, false),
    now = build(s, true);
  for (const [ci, cam] of cameras().entries()) {
    was.lod(cam, 1080, 1);
    now.lod(cam, 1080, 1);
    for (const [name, st] of states(s)) {
      for (let i = 0; i < 4; i++) {
        was.frame(st, { dt: 5 });
        now.frame(st, { dt: 5 });
      }
      sameLook([look(was.root), look(now.root)], `${name} from camera ${ci}`);
    }
  }
}

function assert_fades_each_lid_cooler_spreader_and_card_through_(): void {
  const s = game().snapshot(),
    was = build(s, false),
    now = build(s, true);
  // (a RAM stick of the maxed machine has no spreader: its fade holds nothing)
  const wf = fadeRoots(was),
    nf = fadeRoots(now);
  expect(nf).toHaveLength(wf.length);
  expect(nf.length).toBeGreaterThan(3);
  // the camera comes in on each faded part, from the board view to its face: on the way the level of detail fades it out
  const half = new Set<number>();
  for (const f of wf) {
    const at = aim(was, f);
    for (let d = 30_000; d > 300; d *= 0.95) {
      const cam = new three.PerspectiveCamera(40, 16 / 9, 10, 200_000);
      cam.position.set(at.x, at.y, at.z + d);
      cam.lookAt(at);
      cam.updateMatrixWorld();
      was.lod(cam, 1080, 1);
      now.lod(cam, 1080, 1);
      let mid = false;
      for (const [i, g] of wf.entries()) {
        const a = g.visible ? opacityOf(g) : 0;
        expect(must(nf[i]).visible ? opacityOf(must(nf[i])) : 0, `fade ${i} at ${Math.round(d)}`).toBeCloseTo(a, 6);
        if (a > 0.02 && a < 0.98) {
          half.add(i);
          mid = true;
        }
      }
      // (the whole look where a part is half faded: its see-through material must stay its own)
      if (mid) {
        const over = at
          .toArray()
          .map((x) => Math.round(x))
          .join(',');
        sameLook([look(was.root), look(now.root)], `fades at ${Math.round(d)} over ${over}`);
      }
    }
  }
  // each faded part was seen half faded on the way
  expect(half.size).toBe(wf.length);
}

function assert_answers_every_pick_as_before_part_by_part(): void {
  const s = game().snapshot(),
    was = build(s, false),
    now = build(s, true);
  for (const cam of cameras()) {
    was.lod(cam, 1080, 1);
    now.lod(cam, 1080, 1);
    expect(picks(now.root, cam)).toStrictEqual(picks(was.root, cam));
  }
}

function assert_keeps_every_state_look_on_materials_of_its_own_a(): void {
  const s = game().snapshot(),
    m = build(s, true),
    [, run] = must(states(s).find(([n]) => n === 'hot'));
  for (let i = 0; i < 4; i++) {
    m.frame(run, { dt: 5 });
  }
  // each glowing material is used inside one part only
  const users = new Map<three.Material, Set<string | null>>();
  m.root.traverse((o) => {
    if (!isMesh(o)) {
      return;
    }
    for (const mm of [o.material].flat()) {
      const e = emissiveOf(mm);
      if (e !== null && e.intensity > 0 && e.color.getHex() !== 0) {
        const u = or(users.get(mm), new Set());
        u.add(idOf(o));
        users.set(mm, u);
      }
    }
  });
  expect(users.size).toBeGreaterThan(0);
  for (const [, u] of users) {
    expect([...u]).toHaveLength(1);
  }
}

const both = (s: Snapshot) => ({ was: build(s, true, false), now: build(s, true, true) });

const lodOf = (m: Machine3D) => must(m.partLod);
const grid = (m: Machine3D, cam: three.PerspectiveCamera): (string | null)[] => {
  const out: (string | null)[] = [];
  for (let y = -0.9; y <= 0.9; y += 0.15) {
    for (let x = -0.9; x <= 0.9; x += 0.15) {
      const hit = idOf(pick(m.boardRoots(), cam, x, y));
      out.push(hit);
    }
  }
  return out;
};

const lids = (m: Machine3D) => m.apart.filter((g) => idOf(g) === 'board.nic-ctl');
describe('Machine3D merge and share (PERF22 part 2)', () => {
  it('draws far fewer meshes with far fewer materials', { timeout: 60_000 }, () => {
    expect.hasAssertions();
    assert_draws_far_fewer_meshes_with_far_fewer_materials();
  });

  it('shows every part as before in every state and view: colour, glow, fade, shape', { timeout: 120_000 }, () => {
    expect.hasAssertions();
    assert_shows_every_part_as_before_in_every_state_and_vi();
  });

  it('fades each lid, cooler, spreader and card through the zoom alone, as before', { timeout: 400_000 }, () => {
    expect.hasAssertions();
    assert_fades_each_lid_cooler_spreader_and_card_through_();
  });

  it('answers every pick as before, part by part', { timeout: 60_000 }, () => {
    expect.hasAssertions();
    assert_answers_every_pick_as_before_part_by_part();
  });

  it(
    'keeps every state look on materials of its own: a skin, a ring or an LED never lights another part',
    { timeout: 60_000 },
    () => {
      expect.hasAssertions();
      assert_keeps_every_state_look_on_materials_of_its_own_a();
    },
  );
});

describe('Machine3D distance stand-ins (PERF6)', () => {
  const H = 1080;

  function assert_draws_every_part_as_it_looks_in_every_state_at_e(): void {
    const s = game().snapshot(),
      { was, now } = both(s);
    const allFar: boolean[] = [];
    for (const [ci, cam] of [farCam(), ...cameras().slice(0, 2)].entries()) {
      was.lod(cam, H, 1);
      now.lod(cam, H, 1);
      allFar.push(lodOf(now).farNow.every(Boolean));
      for (const [name, st] of states(s).filter(([n]) => ['off', 'running', 'hot', 'burnt'].includes(n))) {
        for (let i = 0; i < 4; i++) {
          was.frame(st, { dt: 5 });
          now.frame(st, { dt: 5 });
        }
        sameLook([look(was.root, true), look(now.root, true)], `${name} from camera ${ci}`, true);
      }
    }
    // (from the far camera, the first, every part draws as its stand-in)
    expect(allFar[0]).toBe(true);
  }

  function assert_follows_each_fade_while_it_runs_from_the_board_v(): void {
    const s = game().snapshot(),
      { was, now } = both(s);
    const wf = fadeRoots(was),
      nf = fadeRoots(now),
      mids = new Set<number>();
    expect(nf).toHaveLength(wf.length);
    for (const f of wf) {
      const c = aim(now, f);
      let compared = 0; // (the look at the first two half-faded steps of each part's approach)
      for (let d = 30_000; d > 300; d *= 0.95) {
        const cam = camFrom(c, d);
        was.lod(cam, H, 1);
        now.lod(cam, H, 1);
        let mid = false;
        for (const [i, g] of wf.entries()) {
          const a = g.visible ? opacityOf(g) : 0;
          if (a > 0.02 && a < 0.98) {
            mid = true;
            mids.add(i);
          }
        }
        if (mid && compared++ < 2) {
          const over = c
            .toArray()
            .map((x) => Math.round(x))
            .join(',');
          sameLook([look(was.root, true), look(now.root, true)], `fade at ${Math.round(d)} over ${over}`, true);
        }
      }
    }
    expect(mids.size).toBe(wf.length);
  }

  it(
    'draws every part as it looks, in every state, at every distance: colour, glow and fade',
    { timeout: 180_000 },
    () => {
      expect.hasAssertions();
      assert_draws_every_part_as_it_looks_in_every_state_at_e();
    },
  );
  function assert_keeps_each_state_look_on_the_stand_in_it_draws_w(): void {
    // (a burn is the one state that glows: a part that runs hot has no glow of its own, the lenses show that)
    const s = game().snapshot(),
      m = build(s, true, true),
      [, burnt] = must(states(s).find(([n]) => n === 'burnt'));
    m.lod(farCam(), H, 1);
    for (let i = 0; i < 4; i++) {
      m.frame(burnt, { dt: 5 });
    }
    let glowing = 0;
    for (const si of lodOf(m).standIns) {
      const src = lodOf(m).sourcesOf(si);
      // (a palette stand-in has only still looks: no skin, no glow)
      const e = asMeshStandardMaterial(si.material);
      if (!(e.emissive.getHex() && e.emissiveIntensity > 0)) {
        continue;
      }
      // (a source with a list of materials, as a RAM stick's board and its skin edge, has it in its list: MACH-06)
      expect(src.every((x) => [x.material].flat().includes(asMeshStandardMaterial(si.material)))).toBe(true);
      glowing++;
    }
    expect(glowing).toBeGreaterThan(0);
  }

  it("keeps each state look on the stand-in: it draws with the part's own material", { timeout: 60_000 }, () => {
    expect.hasAssertions();
    assert_keeps_each_state_look_on_the_stand_in_it_draws_w();
  });

  it("follows each fade while it runs, from the board view to the part's face", { timeout: 400_000 }, () => {
    expect.hasAssertions();
    assert_follows_each_fade_while_it_runs_from_the_board_v();
  });

  function assert_draws_fewer_meshes_far_as_many_near_and_a_pick_f(): void {
    const s = game().snapshot(),
      { was, now } = both(s),
      far = farCam(),
      near = must(cameras()[2]);
    expect(lodOf(now).standIns.length).toBeGreaterThan(5);
    was.lod(near, H, 1);
    now.lod(near, H, 1);
    expect(lodOf(now).farNow.some(Boolean)).toBe(false);
    expect(drawnMeshes(now.root)).toBe(drawnMeshes(was.root));
    was.lod(far, H, 1);
    now.lod(far, H, 1);
    expect(drawnMeshes(now.root)).toBeLessThan(drawnMeshes(was.root));
    const ids = grid(now, far);
    expect(ids).toStrictEqual(grid(was, far));
    const id = must(ids.find((x) => x !== null));
    expect(findById(now.root, id)).not.toBeNull();
    for (let y = -0.9; y <= 0.9; y += 0.3) {
      for (let x = -0.9; x <= 0.9; x += 0.3) {
        expect(pick(now.boardRoots(), far, x, y)?.userData['standIn']).not.toBe(true);
      }
    }
    now.dispose();
  }

  it(
    'draws fewer meshes far, as many near, and a pick, findById and the outline still find the parts',
    { timeout: 120_000 },
    () => {
      expect.hasAssertions();
      assert_draws_fewer_meshes_far_as_many_near_and_a_pick_f();
    },
  );

  describe('Build my PC zoom', () => {
    const view = fitRect(
      { x: CASE_RECT.x, y: CASE_RECT.y, w: CASE_RECT.w, h: CASE_RECT.h },
      BOARD_Z,
      16 / 9,
      { yaw: 0.42, pitch: 0.3, fov: 30 },
      0.55,
    );
    const ceil = (LOD_CEIL * H) / view.height,
      camAt = (height: number) => {
        const c = new three.PerspectiveCamera();
        applyView(c, { ...view, height }, 16 / 9);
        c.updateMatrixWorld();
        return c;
      };

    function assert_swaps_nothing_at_the_stage_s_own_view_or_closer_(): void {
      const s = game().snapshot(),
        { was, now } = both(s);
      now.holdDetail([], ceil);
      for (const h of [view.height, view.height * 0.5, LIMITS.heightMin]) {
        const cam = camAt(h);
        was.lod(cam, H, 1);
        now.lod(cam, H, 1);
        expect(lodOf(now).farNow.some(Boolean), `height ${h}`).toBe(false);
        expect(drawnMeshes(now.root)).toBe(drawnMeshes(was.root));
      }
      const out = camAt(view.height * 6);
      was.lod(out, H, 1);
      now.lod(out, H, 1);
      expect(lodOf(now).farNow.some(Boolean)).toBe(true);
      expect(drawnMeshes(now.root)).toBeLessThan(drawnMeshes(was.root));
    }

    it("swaps nothing at the stage's own view or closer, but does zoomed out", { timeout: 60_000 }, () => {
      expect.hasAssertions();
      assert_swaps_nothing_at_the_stage_s_own_view_or_closer_();
    });

    function assert_draws_no_stand_in_at_the_wheel_limit_in_a_tall_a(): void {
      const s = game().snapshot(),
        now = build(s, true, true),
        seen: string[] = [];
      for (const aspect of [0.5, 1, 16 / 9, 2.33]) {
        const fit = fitRect(
          { x: CASE_RECT.x, y: CASE_RECT.y, w: CASE_RECT.w, h: CASE_RECT.h },
          BOARD_Z,
          aspect,
          view,
          0.55,
        );
        const cam = new three.PerspectiveCamera();
        applyView(cam, { ...fit, height: LIMITS.heightMax }, aspect);
        cam.updateMatrixWorld();
        now.holdDetail([], (LOD_CEIL * H) / fit.height);
        now.lod(cam, H, 1);
        seen.push(`${aspect.toFixed(2)}: ${lodOf(now).standIns.filter((x) => lodOf(now).draws(x)).length}`);
      }
      expect(seen.join(', ')).toBe('0.50: 0, 1.00: 0, 1.78: 0, 2.33: 0');
      now.dispose();
    }

    it(
      'draws no stand-in at the wheel limit, in a tall, a square, a 16:9 or an ultrawide view',
      { timeout: 60_000 },
      () => {
        expect.hasAssertions();
        assert_draws_no_stand_in_at_the_wheel_limit_in_a_tall_a();
      },
    );

    function assert_holds_the_part_under_the_pointer_and_the_whole_m(): void {
      const s = game().snapshot(),
        { was, now } = both(s),
        lod = lodOf(now),
        cam = camAt(view.height * 6);
      was.lod(cam, H, 1);
      now.lod(cam, H, 1);
      const far = drawnMeshes(now.root);
      const si = must(
        lod.standIns.find((x) => {
          const owner = ownerOf(must(lod.sourcesOf(x)[0]));
          return lod.draws(x) && owner !== null && owner !== now.root;
        }),
      );
      const hotSrc = must(lod.sourcesOf(si)[0]);
      const hot = must(ownerOf(hotSrc));
      now.holdDetail([hot], ceil);
      now.lod(cam, H, 1);
      expect(lod.draws(si)).toBe(false);
      for (const src of lod.sourcesOf(si)) {
        expect(src.layers.mask & 1).toBe(1);
      }
      // (an unseen click box is never drawn: `unseen`, pick.ts)
      const held: three.Mesh[] = [];
      hot.traverse((o) => {
        if (
          isMesh(o) &&
          o.userData['standIn'] !== true &&
          (Array.isArray(o.material) ? undefined : o.material.opacity) !== 0
        ) {
          held.push(o);
        }
      });
      for (const x of held) {
        expect(x.layers.mask & 1, 'held subtree').toBe(1);
      }
      expect(lod.standIns.some((x) => lod.draws(x))).toBe(true); // (the rest stays merged)
      expect(drawnMeshes(now.root)).toBeGreaterThan(far);
      // a step: the whole machine
      now.holdDetail([now.root], ceil);
      now.lod(cam, H, 1);
      expect(lod.standIns.some((x) => lod.draws(x))).toBe(false);
      expect(drawnMeshes(now.root)).toBe(drawnMeshes(was.root));
      // no hold: the stand-ins draw again
      now.holdDetail([], ceil);
      expect(drawnMeshes(now.root)).toBe(far);
    }

    it('holds the part under the pointer, and the whole machine while a step runs', { timeout: 60_000 }, () => {
      expect.hasAssertions();
      assert_holds_the_part_under_the_pointer_and_the_whole_m();
    });
  });
});

function assert_stands_as_a_chip_with_a_die_on_a_board_with_a_ja(): void {
  for (const merge of [false, true]) {
    const s = game().snapshot(),
      m = build(s, merge),
      g = must(GEO.phy);
    expect(s.board.features.ethernetMbps).toBeGreaterThan(0);
    expect(lids(m)).toHaveLength(1);
    const rails = m.rails.filter((r) => r.id === 'board.nic-ctl');
    expect(rails).toHaveLength(1);
    const r = must(rails[0]);
    expect(r.rect.x + r.rect.w / 2).toBeCloseTo(g.x + g.w / 2, 3);
    expect(r.rect.y + r.rect.h / 2).toBeCloseTo(g.y + g.h / 2, 3);
    expect(r.rect.w).toBeGreaterThan(0.97 * g.w);
    expect(r.rect.w).toBeLessThanOrEqual(g.w);
    expect(r.z).toBeGreaterThan(BOARD_Z);
    expect(r.z).toBeLessThan(BOARD_Z + CHIP_H);
    expect(r.zoom).toBeGreaterThan(0);
    for (const id of ['board.nic-ctl', 'board.nic-mac', 'board.nic-dma']) {
      expect(m.pickId(id)).toBe(id);
    }
    expect(findById(m.root, 'board.nic-ctl')).not.toBeNull();
  }
}

describe('Machine3D Ethernet chip on the motherboard', () => {
  it(
    'stands as a chip with a die on a board with a jack: its mould fades alone, and a flight rail leads to its die',
    { timeout: 60_000 },
    () => {
      expect.hasAssertions();
      assert_stands_as_a_chip_with_a_die_on_a_board_with_a_ja();
    },
  );

  it(
    "shows the mould from the board view and the floorplan from the die's: the lid fades with the camera",
    { timeout: 60_000 },
    () => {
      const s = game().snapshot(),
        m = build(s, true),
        lid = must(lids(m)[0]),
        at = aim(m, lid),
        r = must(m.rails.find((x) => x.id === 'board.nic-ctl'));
      m.lod(camFrom(at, 30_000), 1080, 1);
      expect(lid.visible).toBe(true);
      expect(opacityOf(lid)).toBeCloseTo(1, 6);
      // (twice the zoom the rail flies to: a flight ends with the mould gone)
      m.lod(camFrom(at, 1080 / (2 * Math.tan((20 * Math.PI) / 180) * r.zoom * 2)), 1080, 1);
      expect(lid.visible).toBe(false);
    },
  );

  it('has no chip on a board with no jack: no mould, no rail, no part', { timeout: 60_000 }, () => {
    // (the layout follows the board: the game's start has the first tier's board, which has no chip. The default layout of these tests is the second tier's)
    const s = new Game({ seed: 1, sandbox: true, preassembled: true }).snapshot();
    setLayoutTier(s.boardTier, s.caseTier);
    try {
      const m = build(s, true);
      expect(s.board.features.ethernetMbps).toBe(0);
      expect(GEO.phy).toBeNull();
      expect(lids(m)).toHaveLength(0);
      expect(m.rails.some((r) => r.id.startsWith('board.'))).toBe(false);
      expect(findById(m.root, 'board.nic-ctl')).toBeNull();
    } finally {
      setLayoutTier(2, 2);
    }
  });
});
