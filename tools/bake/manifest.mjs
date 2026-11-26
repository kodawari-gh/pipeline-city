// The bake's `manifest.json` read back with its type checked at the boundary (`BakeManifest`, `lightmapmix.ts`), for `bake.mjs` and
// `lightmaps.mjs`.
import { readFileSync } from 'node:fs';

/** @import { BakeManifest } from '@/core/render/three/lightmapmix' */

/**
 * Whether `v` has the fields of a `BakeManifest` the tools read: the atlas's size and the groups (each with its id and its file).
 * @param {unknown} v
 * @returns {v is BakeManifest}
 */
function isManifest(v) {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  if (!('width' in v) || !('height' in v) || !('groups' in v)) {
    return false;
  }
  const { width, height, groups } = v;
  return (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Array.isArray(groups) &&
    groups.every(
      (/** @type {unknown} */ g) =>
        typeof g === 'object' &&
        g !== null &&
        'id' in g &&
        typeof g.id === 'string' &&
        'file' in g &&
        typeof g.file === 'string',
    )
  );
}

/**
 * The manifest at `file`; throws when it is not one.
 * @param {string} file
 * @returns {BakeManifest}
 */
export function readManifest(file) {
  /** @type {unknown} */
  const v = JSON.parse(readFileSync(file, 'utf8'));
  if (!isManifest(v)) {
    throw new Error(`${file} is not a bake manifest`);
  }
  return v;
}
