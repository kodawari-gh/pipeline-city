// The case shell's material count (docs/3D_STYLE.md "Asset standard" §2, ASR1). Materials that look the same must be one material: a
// material costs a program bind and a uniform refresh each frame. The ceiling per case is today's count; the standard's target is 16.
import { describe, expect, it } from 'vitest';
import type { MeshStandardMaterial, Mesh, Material } from 'three';

import { builtinTheme } from '@/core/render/theme';
import { CASE_KIND } from '@/features/room/render/shell/casedecor';
import { setLayoutTier } from '../layout/layout';
import { caseModel } from './case3d';

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

const isMeshStandardMaterial = (o: unknown): o is MeshStandardMaterial =>
  typeof o === 'object' && o !== null && 'isMeshStandardMaterial' in o && o.isMeshStandardMaterial === true;
function asMeshStandardMaterial(o: unknown): MeshStandardMaterial {
  if (!isMeshStandardMaterial(o)) {
    throw new Error('expected a MeshStandardMaterial');
  }
  return o;
}

const isMesh = (o: unknown): o is Mesh => typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;

/** A list of one value, or the value itself when it is already a list. */
function asList<T>(value: T | T[]): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

const T = builtinTheme();

/** What a material looks like: two materials with one key could be one material. */
const look = (m: Material): string => {
  const s = asMeshStandardMaterial(m);
  return [
    m.type,
    s.color?.getHexString(),
    s.metalness,
    s.roughness,
    or(s.map?.uuid, ''),
    s.emissive?.getHexString(),
    s.emissiveIntensity,
    m.transparent,
    m.opacity,
    m.alphaTest,
    m.side,
  ].join('|');
};

export function caseMaterials(tier: number): { objects: number; looks: number; meshes: number } {
  setLayoutTier(tier, tier);
  const m = caseModel(must(CASE_KIND[tier]), T),
    objects = new Set<Material>(),
    looks = new Set<string>();
  let meshes = 0;
  m.root.traverse((o) => {
    if (!isMesh(o)) {
      return;
    }
    const mesh = o;
    meshes++;
    for (const x of asList(mesh.material)) {
      objects.add(x);
      looks.add(look(x));
    }
  });
  // CASEMAT_DUMP=1 lists each look (to find the ones to fold)
  if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env['CASEMAT_DUMP'] === '1') {
    console.log([...looks].sort().join('\n'));
  }
  return { objects: objects.size, looks: looks.size, meshes };
}

/** The cap of distinct looks per case (Mini, Micro, Mid, Full): 16 at LOD0 (§2). A new look needs a reason. */
const CEILING = [16, 16, 16, 16];

describe("the case shell's materials", () => {
  it('stay under the ceiling of distinct looks', () => {
    for (const t of [0, 1, 2, 3]) {
      const c = caseMaterials(t);
      console.log(
        `case ${t} (${CASE_KIND[t]}): ${c.meshes} meshes, ${c.objects} material objects, ${c.looks} distinct looks`,
      );
      expect(c.looks).toBeLessThanOrEqual(must(CEILING[t]));
    }
  });
});
