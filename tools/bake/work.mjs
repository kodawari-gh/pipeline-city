// The bake's work dir for Blender (`bake.mjs`, `bake.py`): `scene.json` (the bake's settings, the meshes, the light groups) and `scene.bin`
// (the meshes' arrays), written for a new bake and read back for `--only` and `--pack`.
import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** @import { BakeLight, BakeScene } from './blender' */
/** @import { Atlas } from './atlas' */

/**
 * A light group as Blender bakes it (`scene.json`): a lamp group's lights, the sky, the city, the sun at an hour, or a lamp group's direct
 * light (`of`: the lamp group).
 * @typedef {{ id: string; kind: 'lamp' | 'sky' | 'city' | 'sun' | 'direct'; lights?: BakeLight[]; hour?: number; dir?: [number, number, number]; of?: string }} WorkGroup
 */
/**
 * `scene.json` in the work dir, as `writeWork` wrote it (the fields read back: the bake's settings and the groups).
 * @typedef {{ samples: number; denoise: boolean; groups: WorkGroup[] } & Record<string, unknown>} WorkConfig
 */

/**
 * What `scene.json` takes from the bake's flags, and the work dir it goes in.
 * @typedef {{ work: string; samples: number; fast: boolean; padding: number }} WorkSettings
 */

const { join } = path;

/**
 * The lamp groups that stay real-time at the game's lowest lamp cap (`LIGHT_ORDER` in roomlights.ts: Low keeps the window's key, the arc
 * lamp and the case's two RGB lights). Each other lamp group also gets its direct light baked (`<id>-direct`, kind `direct`), which the game shows
 * when the cap takes its lights out of the scene.
 */
const ALWAYS_LIVE = new Set(['arc']);
/**
 * @param {WorkGroup[]} groups
 * @returns {WorkGroup[]}
 */
export const directGroups = (groups) =>
  groups
    .filter((g) => g.kind === 'lamp' && !ALWAYS_LIVE.has(g.id))
    .map((g) => ({ id: `${g.id}-direct`, kind: 'direct', of: g.id, lights: g.lights }));

/**
 * The base64 array `s` (null: none) as a typed array of `T`.
 * @template {Float32Array | Uint32Array} A
 * @param {string | null} s
 * @param {new (b: ArrayBuffer) => A} T
 * @returns {A | null}
 */
export const decode = (s, T) => {
  if (s === null || s === '') {
    return null;
  }
  const b = Buffer.from(s, 'base64');
  return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

/**
 * The meshes of `scene.json`, their arrays put in `scene.bin`'s parts (`put`: an array's offset; -1: none).
 * @param {BakeScene['meshes']} meshes
 * @param {{ atlas: Atlas; receivers: BakeScene['meshes']; put: (a: Float32Array | Uint32Array | null | undefined) => number }} by
 */
const meshEntries = (meshes, { atlas, receivers, put }) =>
  meshes.map((m) => {
    const pos = decode(m.pos, Float32Array) ?? new Float32Array(),
      index = decode(m.index, Uint32Array),
      k = receivers.indexOf(m),
      a = k === -1 ? null : atlas.meshes[k];
    return {
      name: m.name,
      receiver: k !== -1,
      colour: m.colour,
      roughness: m.roughness,
      metalness: m.metalness,
      verts: pos.length / 3,
      corners: index ? index.length : pos.length / 3,
      pos: put(pos),
      nrm: put(decode(m.nrm, Float32Array)),
      index: put(index),
      uv: put(a?.uv),
      chart: put(a?.chart),
    };
  });

/**
 * Write the room for Blender: `scene.json` and the arrays it points into, `scene.bin`, in `settings.work`.
 * @param {BakeScene} scene
 * @param {{ atlas: Atlas; receivers: BakeScene['meshes']; settings: WorkSettings }} with_
 * @returns {WorkGroup[]}
 */
export function writeWork(scene, { atlas, receivers, settings }) {
  /** @type {(Float32Array | Uint32Array)[]} */
  const parts = [];
  let size = 0;
  /** @param {Float32Array | Uint32Array | null | undefined} a */
  const put = (a) => {
    if (!a) {
      return -1;
    }
    const off = size;
    parts.push(a);
    size += a.byteLength;
    return off;
  };
  const meshes = meshEntries(scene.meshes, { atlas, receivers, put });
  /** @type {WorkGroup[]} */
  const base = [
    ...scene.groups.map((g) => ({ id: g.id, kind: /** @type {const} */ ('lamp'), lights: g.lights })),
    { id: 'sky', kind: 'sky' },
    { id: 'city', kind: 'city' },
    ...scene.suns.map((s) => ({ id: `sun-${s.hour}`, kind: /** @type {const} */ ('sun'), hour: s.hour, dir: s.dir })),
  ];
  const groups = [...base, ...directGroups(base)];
  writeFileSync(
    join(settings.work, 'scene.bin'),
    Buffer.concat(parts.map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength))),
  );
  writeFileSync(
    join(settings.work, 'scene.json'),
    JSON.stringify({
      samples: settings.samples,
      denoise: !settings.fast,
      padding: settings.padding,
      width: atlas.width,
      height: atlas.height,
      meshes,
      groups,
    }),
  );
  return groups;
}

/**
 * Whether `v` is the work dir's `scene.json` (the fields read back).
 * @param {unknown} v
 * @returns {v is WorkConfig}
 */
function isWorkConfig(v) {
  if (typeof v !== 'object' || v === null || !('samples' in v) || !('denoise' in v) || !('groups' in v)) {
    return false;
  }
  const { samples, denoise, groups } = v;
  return (
    typeof samples === 'number' &&
    typeof denoise === 'boolean' &&
    Array.isArray(groups) &&
    groups.every(
      (/** @type {unknown} */ g) =>
        typeof g === 'object' &&
        g !== null &&
        'id' in g &&
        typeof g.id === 'string' &&
        'kind' in g &&
        typeof g.kind === 'string',
    )
  );
}

/**
 * The work dir's `scene.json` at `file`; throws when it is not one.
 * @param {string} file
 * @returns {WorkConfig}
 */
export function readWork(file) {
  /** @type {unknown} */
  const v = JSON.parse(readFileSync(file, 'utf8'));
  if (!isWorkConfig(v)) {
    throw new Error(`${file} is not a bake's room`);
  }
  return v;
}

/**
 * Run Blender (`at.exe`) on the work dir (`at.work`) with `bake.py` (in `at.root`), on the groups `only` (all: none); its whole log goes to
 * `blender.log` there, the bake's own lines to the console.
 * @param {{ exe: string; root: string; work: string }} at
 * @param {string[]} only
 * @returns {Promise<void>}
 */
export async function blender({ exe, root, work }, only) {
  const log = createWriteStream(join(work, 'blender.log'));
  const b = spawn(exe, [
    '-b',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '-P',
    join(root, 'tools/bake/bake.py'),
    '--',
    work,
    ...only,
  ]);
  let tail = '';
  /** @param {Buffer} d */
  const line = (d) => {
    log.write(d);
    tail = (tail + d.toString()).slice(-4000);
    for (const l of d.toString().split(/\r?\n/u)) {
      if (l.startsWith('[bake]') || /Error|Traceback/u.test(l)) {
        console.log(l);
      }
    }
  };
  b.stdout.on('data', line);
  b.stderr.on('data', line);
  return new Promise((resolve, reject) => {
    b.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Blender stopped (${code}):\n${tail}`));
      }
    });
  });
}
