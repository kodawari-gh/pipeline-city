// The Low city's facade bake (fail-first). At Low the buildings leave `facadeMaterial`'s per-pixel shader (`towers.ts`) for a cheap
// material that samples baked day and night maps, with the night windows as live emissive in their own map, never in the albedo.
// High keeps `facadeMaterial` unchanged. The building meshes are the ones with the facade's per-vertex attributes (`fuv`).
import type { Material, Mesh, Scene, Texture } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { OutsideView } from './view';

const inner = (v: OutsideView): { scene: Scene } => v as unknown as { scene: Scene };

/** The city's building meshes: those with the facade's `fuv` attribute. */
function buildings(v: OutsideView): Mesh[] {
  const out: Mesh[] = [];
  inner(v).scene.traverse((o) => { const m = o as Mesh; if (m.isMesh && m.geometry.attributes.fuv) out.push(m); });
  return out;
}

/** A bare standard shader, as three hands a material's `onBeforeCompile`: what the material's own code adds to it is what it uses. */
function compiled(m: Material): { vertexShader: string; fragmentShader: string } {
  const sh = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: '#include <common>\n#include <begin_vertex>\n',
    fragmentShader: '#include <common>\n#include <emissivemap_fragment>\n#include <aomap_fragment>\n',
  };
  const hook = (m as Material & { onBeforeCompile?: (s: typeof sh, r: unknown) => void }).onBeforeCompile;
  if (typeof hook === 'function') hook(sh, null);
  return sh;
}

describe('Low city facade bake', () => {
  let high: OutsideView, low: OutsideView;
  beforeAll(() => {
    high = new OutsideView(0, 0, 10, 10, 0, 'high');
    low = new OutsideView(0, 0, 10, 10, 0, 'low');
  }, 180000);

  it('lock: High keeps facadeMaterial, its per-pixel shader with fHash and fNoise', () => {
    const hs = buildings(high);
    expect(hs.length).toBeGreaterThan(0);
    const mat = hs[0]!.material as Material;
    expect(hs.every((m) => m.material === mat)).toBe(true);
    expect(mat.type).toBe('MeshStandardMaterial');
    const sh = compiled(mat).fragmentShader;
    expect(sh).toContain('fHash');
    expect(sh).toContain('fNoise');
  }, 180000);

  it('Low: the buildings use a cheap material (Lambert or Basic), not the standard facade', () => {
    const ls = buildings(low);
    expect(ls.length).toBeGreaterThan(0);
    for (const m of ls) expect(['MeshLambertMaterial', 'MeshBasicMaterial']).toContain((m.material as Material).type);
  }, 180000);

  it('Low: the buildings do not run facadeMaterial\'s per-pixel shader (no fHash, no fNoise)', () => {
    for (const m of buildings(low)) {
      const sh = compiled(m.material as Material).fragmentShader;
      expect(sh).not.toContain('fHash');
      expect(sh).not.toContain('fNoise');
    }
  }, 180000);

  it('Low: the buildings sample a baked day map', () => {
    for (const m of buildings(low)) {
      const map = (m.material as Material & { map?: Texture | null }).map;
      expect(map?.isTexture, 'a baked day map').toBe(true);
    }
  }, 180000);

  it('Low: night windows are live emissive in their own map, not baked into the albedo', () => {
    for (const m of buildings(low)) {
      const mat = m.material as Material & { map?: Texture | null; emissiveMap?: Texture | null; emissive?: { getHex(): number } };
      expect(mat.emissiveMap?.isTexture, 'a separate emissive (night) map').toBe(true);
      expect(mat.emissiveMap).not.toBe(mat.map);
      expect(mat.emissive?.getHex() ?? 0, 'emissive colour on').toBeGreaterThan(0);
    }
  }, 180000);
});
