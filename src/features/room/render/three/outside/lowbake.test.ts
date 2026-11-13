// The Low city's facade bake (fail-first). At Low the buildings leave `facadeMaterial`'s per-pixel shader (`towers.ts`) for a cheap
// material that samples baked day and night maps, with the night windows as live emissive in their own map, never in the albedo.
// High keeps `facadeMaterial` unchanged. The building meshes are the ones with the facade's per-vertex attributes (`fuv`).
import { LinearMipmapLinearFilter, type Material, type Mesh, type Scene, type Texture } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { OutsideView } from './view';
import { LOW_ANISO, LOW_FAR, LOW_NIGHT_WALL, lowFacadeMaps } from './lowfacade';

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

/** A shader that carries the lights chunks, as the built-in Lambert does: the walls' lights are cut or kept in these. */
function lit(m: Material): { vertexShader: string; fragmentShader: string } {
  const sh = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: '#include <common>\n#include <begin_vertex>\n',
    fragmentShader: '#include <common>\n#include <lights_fragment_begin>\n#include <lights_fragment_end>\n#include <emissivemap_fragment>\n#include <aomap_fragment>\n',
  };
  const hook = (m as Material & { onBeforeCompile?: (s: typeof sh, r: unknown) => void }).onBeforeCompile;
  if (typeof hook === 'function') hook(sh, null);
  return sh;
}

/** The fragment shader the material's map step makes, with its own code in place of the `map_fragment` include. */
function withMap(m: Material): string {
  const sh = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: '#include <common>\n#include <begin_vertex>\n',
    fragmentShader: '#include <common>\n#include <map_fragment>\n',
  };
  const hook = (m as Material & { onBeforeCompile?: (s: typeof sh, r: unknown) => void }).onBeforeCompile;
  if (typeof hook === 'function') hook(sh, null);
  return sh.fragmentShader;
}

const POINT_LOOP ='NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )';

describe('Low city facade bake', () => {
  let high: OutsideView, low: OutsideView;
  beforeAll(() => {
    high = new OutsideView(0, 0, 10, 10, 0, 'high');
    low = new OutsideView(0, 0, 10, 10, 0, 'low');
  }, 180000);

  it('Low: the 8 PointLights skip the buildings (the point loop is cut from their lights chunk)', () => {
    for (const m of buildings(low)) {
      const sh = lit(m.material as Material).fragmentShader;
      expect(sh, 'the point-light loop cut').toContain('#if 0');
      expect(sh).not.toContain(POINT_LOOP);
    }
  }, 180000);

  it('Low: the lamps still light the buildings, as an analytic term at night (lamp count and reach)', () => {
    for (const m of buildings(low)) {
      const sh = lit(m.material as Material);
      expect(sh.fragmentShader).toContain('reflectedLight.directDiffuse += lowL');
      expect(sh.fragmentShader).toContain('fLampK > 0.0');
      expect(sh.fragmentShader).toContain('i < 8;');
      expect(sh.fragmentShader).toContain('45.0');
    }
    const lamps = (low as unknown as { lowLamps: { k: { value: number }; pos: { value: unknown[] } } }).lowLamps;
    expect(lamps.pos.value).toHaveLength(8);
    low.frame(23, 1);
    expect(lamps.k.value, 'the lamps at night').toBeGreaterThan(0);
    low.frame(12, 1);
    expect(lamps.k.value, 'the lamps by day').toBe(0);
  }, 180000);

  it('Low: the lamps stay live for the street, cars and other meshes (8 PointLights in the scene)', () => {
    const lamps = (low as unknown as { lamps: unknown[] }).lamps;
    expect(lamps).toHaveLength(8);
  }, 180000);

  it('High: the buildings keep facadeMaterial and the live PointLights (no lights chunk cut)', () => {
    const hs = buildings(high);
    for (const m of hs) {
      const sh = lit(m.material as Material);
      expect(sh.fragmentShader).toContain('#include <lights_fragment_begin>');
      expect(sh.fragmentShader).not.toContain('#if 0');
      expect(sh.fragmentShader).not.toContain('fLampK');
    }
    expect((high as unknown as { lowLamps: unknown }).lowLamps).toBeNull();
    expect((high as unknown as { lamps: unknown[] }).lamps).toHaveLength(8);
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

  it('Low: both atlases carry mips and anisotropic taps (far walls average, grazing walls keep their windows)', () => {
    const { day, night } = lowFacadeMaps();
    for (const t of [day, night]) {
      expect(t.generateMipmaps).toBe(true);
      expect(t.minFilter).toBe(LinearMipmapLinearFilter);
      expect(t.anisotropy).toBe(LOW_ANISO);
      expect(LOW_ANISO).toBeGreaterThan(1);
    }
  }, 180000);

  it('Low: far walls thin their lit rooms per room (discrete, sparser with distance), with no mean wash', () => {
    for (const m of buildings(low)) {
      const sh = compiled(m.material as Material).fragmentShader;
      expect(sh).toContain('float lowRoomHash()');
      expect(sh).toContain(`smoothstep(${LOW_FAR.near}.0, ${LOW_FAR.far}.0, length(vViewPosition))`);
      expect(sh).toContain(`lowLit *= step(lowFar * ${1 - LOW_FAR.keep}, lowRoomHash());`);
      expect(sh).not.toContain('textureLod(emissiveMap');
    }
    expect(LOW_FAR.keep).toBeGreaterThan(0);
    expect(LOW_FAR.keep).toBeLessThan(1);
    expect(LOW_FAR.far).toBeGreaterThan(LOW_FAR.near);
  }, 180000);

  it('Low: the walls go cool and dark at night (albedo tint scaled by the night only, lamps included)', () => {
    for (const m of buildings(low)) {
      const sh = withMap(m.material as Material);
      expect(sh).toContain(`mix(vec3(1.0), vec3(${LOW_NIGHT_WALL.join(', ')}), fNight * vLowFac)`);
      for (const c of LOW_NIGHT_WALL) expect(c).toBeLessThan(1);
      expect(LOW_NIGHT_WALL[2], 'cool: blue is the highest channel').toBeGreaterThan(LOW_NIGHT_WALL[0]);
    }
  }, 180000);

  it('Low: the live night glow keeps facadeMaterial\'s kinds (LED, flood, beacon, lantern, sign), scaled by the night, with no noise', () => {
    for (const m of buildings(low)) {
      const sh = compiled(m.material as Material);
      for (const k of ['vLowKind == 5.0', 'vLowKind == 9.0', 'vLowKind == 3.0', 'vLowKind == 4.0', 'vLowKind == 8.0']) expect(sh.fragmentShader).toContain(k);
      expect(sh.fragmentShader).toContain('* fNight;');
      expect(sh.fragmentShader).not.toContain('fHash');
      expect(sh.fragmentShader).not.toContain('fNoise');
      expect(sh.vertexShader).toContain('uniform float fPixel;');
    }
  }, 180000);
});
