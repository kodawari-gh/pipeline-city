// The Low city's facade bake (fail-first). At Low the buildings leave `facadeMaterial`'s per-pixel shader (`towers/facade.ts`) for a cheap
// material that samples a baked day map, with the night windows as live emissive (High's rooms, window by window), never in the albedo.
// High keeps `facadeMaterial` unchanged. The building meshes are the ones with the facade's per-vertex attributes (`fuv`).
import { DataUtils, LinearMipmapLinearFilter, type Material, type Mesh, type Scene, type Texture } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { OutsideView } from './view';
import {
  LOW_ANISO,
  LOW_DAY_GLASS,
  LOW_FAR,
  LOW_FAR_GLASS,
  LOW_FAR_MIRROR,
  LOW_FW,
  LOW_NIGHT_WALL,
  lowFacadeMaps,
} from './lowfacade';
import { facadeMaterial } from './towers/facade';

const inner = (v: OutsideView): { scene: Scene } => v as unknown as { scene: Scene };

/** The city's building meshes: those with the facade's `fuv` attribute. */
function buildings(v: OutsideView): Mesh[] {
  const out: Mesh[] = [];
  inner(v).scene.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh && m.geometry.attributes['fuv']) out.push(m);
  });
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
    fragmentShader:
      '#include <common>\n#include <lights_fragment_begin>\n#include <lights_fragment_end>\n#include <emissivemap_fragment>\n#include <aomap_fragment>\n',
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
    fragmentShader: '#include <common>\n#include <map_fragment>\n#include <color_fragment>\n',
  };
  const hook = (m as Material & { onBeforeCompile?: (s: typeof sh, r: unknown) => void }).onBeforeCompile;
  if (typeof hook === 'function') hook(sh, null);
  return sh.fragmentShader;
}

const POINT_LOOP = 'NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )';

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

  it("Low: the buildings do not run facadeMaterial's per-pixel shader (no fHash, no fNoise)", () => {
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

  it("Low: night windows are live emissive (High's rooms in the shader), with no night map and nothing baked into the albedo", () => {
    for (const m of buildings(low)) {
      const mat = m.material as Material & {
        map?: Texture | null;
        emissiveMap?: Texture | null;
        emissive?: { getHex(): number };
      };
      expect(mat.emissiveMap ?? null, 'no night atlas: the rooms are analytic').toBeNull();
      expect(mat.emissive?.getHex() ?? 0, 'emissive colour on').toBeGreaterThan(0);
      expect(compiled(mat).fragmentShader).not.toContain('emissiveMap');
    }
    expect(Object.keys(lowFacadeMaps())).toEqual(['day']);
  }, 180000);

  it('Low: the day atlas carries mips and anisotropic taps (far walls average, grazing walls keep their windows)', () => {
    const { day } = lowFacadeMaps();
    expect(day.generateMipmaps).toBe(true);
    expect(day.minFilter).toBe(LinearMipmapLinearFilter);
    expect(day.anisotropy).toBe(LOW_ANISO);
    expect(LOW_ANISO).toBeGreaterThan(1);
  }, 180000);

  it("Low: by day the room hashes do not run (one uniform branch); the atlas taps stay at the tier's 2", () => {
    expect(LOW_ANISO).toBeLessThanOrEqual(2);
    for (const m of buildings(low)) {
      const sh = compiled(m.material as Material).fragmentShader;
      const guard = sh.indexOf('if (fNight > 0.0) {');
      expect(guard, 'the guard').toBeGreaterThan(-1);
      expect(
        sh.indexOf('lowLit = lowRibLight(lowRg2, lowRfw, lowRibC, lowV, lowN) * lowGm;'),
        'the rooms are inside it',
      ).toBeGreaterThan(guard);
    }
  }, 180000);

  it("Low: every wall lights its windows as High does (no flat lit bands): the atlas pane near, High's window far, a band's ribbon at any range", () => {
    expect(LOW_FAR.far).toBeGreaterThan(LOW_FAR.near);
    for (const m of buildings(low)) {
      const sh = compiled(m.material as Material).fragmentShader;
      expect(sh).toContain(`smoothstep(${LOW_FAR.near}.0, ${LOW_FAR.far}.0, length(vViewPosition))`);
      expect(sh).toContain('float lowGm = mix(mix(lowGlassM, lowRg, lowFar), lowRg, lowRib);');
      // the old near rooms (a night texel) and far windows (one hash a bay) are gone
      expect(sh).not.toContain('lowFarWin');
      expect(sh).not.toContain('lowRooms');
      expect(sh).not.toContain('lowBands');
      // any wall's room cover at night, not a band's only
      expect(withMap(m.material as Material)).toContain(
        'if (vLowFac > 0.5 && (lowRib > 0.5 || fNight > 0.0)) lowRibC = lowRibCover(lowRg2, lowRfw);',
      );
    }
  }, 180000);

  it("Low: a window's details go to their means at High's range, not a third of it (Low's pixel is about 2.7 of High's)", () => {
    expect(LOW_FW).toBeGreaterThan(0.3);
    expect(LOW_FW).toBeLessThan(1);
    const sh = compiled(buildings(low)[0]!.material as Material).fragmentShader;
    expect(sh).toContain(`vec2 lowRibFw() { return fwidth(lowRibUv()) * ${LOW_FW} + 1e-4; }`);
    // the day mask's own fade (by day and at night alike) keeps its own pixel's width
    expect(sh).toContain('win, smoothstep(vec2(0.1), vec2(0.35), fw));');
  }, 180000);

  it("Low: the frame round a lit window catches its light, the street lamps wash the walls' foot, a head light floods the walls, as High's", () => {
    const vs = compiled(buildings(low)[0]!.material as Material).vertexShader;
    expect(vs).toContain('attribute vec3 wash;');
    expect(vs).toContain('attribute vec2 washY;');
    expect(vs).toContain('vLowWash = wash; vLowWashY = washY;');
    for (const m of buildings(low)) {
      const sh = compiled(m.material as Material).fragmentShader;
      expect(sh).toContain(
        'lowLit += vColor.rgb * lowShade * (lowRibLamp + vec3(1.0, 0.72, 0.45) * 0.45 * exp(-vLowFuv.y / 6.0)) * (1.0 - lowGm);',
      );
      expect(sh).toContain('float lowK = clamp((vLowY - vLowWashY.x) / (vLowWashY.y - vLowWashY.x), 0.0, 1.0);');
      expect(sh).toContain('lowLit += vLowWash * lowK * lowK * mix(1.0, 0.4, lowGm);');
    }
    // High's lines, the same terms
    const hs = withMap(facadeMaterial().mat);
    expect(hs).toContain('fGlow += fr * vec3(1.0, 0.72, 0.45) * 0.45 * exp(-vFuv.y / 6.0) * fNight * (1.0 - m);');
    expect(hs).toContain('fGlow += vWash * washK * washK * mix(1.0, 0.4, m) * fNight;');
  }, 180000);

  it('Low: a far block keeps its floodlights and a flat roof (a roof, not a facade: no shop strip or street wash on its top)', () => {
    let roofs = 0,
      flooded = 0;
    for (const m of buildings(low)) {
      const a = m.geometry.attributes,
        aux = a['aux'],
        wy = a['washY'];
      if (!aux || !wy) continue;
      for (let i = 0; i < aux.count; i++) {
        if (Math.round(aux.getY(i)) === 1) roofs++;
        if (wy.getY(i) > 0) flooded++;
      }
    }
    expect(roofs, 'roof vertices').toBeGreaterThan(0);
    expect(flooded, 'floodlit wall vertices').toBeGreaterThan(0);
  }, 180000);

  it("Low: the wall albedo at night far off is the map's mean too (no dark glass dots), and by day the mix is 0 (fNight)", () => {
    for (const m of buildings(low)) {
      const sh = withMap(m.material as Material);
      expect(sh).toContain(`textureLod(map, lowUv, ${Math.log2(256)}.0)`);
      expect(sh).toContain('* fNight;');
      expect(sh).toContain('vec4 lowTex = mix(lowNear, textureLod(map');
      expect(sh).toContain('length(vViewPosition)) * fNight;');
    }
  }, 180000);

  it('Low: the derivatives stay in uniform control flow (no vLowFac branch around dFdx/dFdy or textureGrad)', () => {
    for (const m of buildings(low)) {
      const sh = compiled(m.material as Material).fragmentShader;
      expect(sh).not.toContain('if (vLowFac > 0.0');
      expect(sh).not.toContain('if (vLowFac == 1.0');
      // the night branch on vLowFac holds no derivative: the pixel widths are taken before it
      const night = sh.slice(sh.indexOf('if (vLowFac > 0.5) {'), sh.indexOf('vec3 lowMir'));
      expect(night).not.toMatch(/dFd[xy]|fwidth|lowRibFw\(|lowRibGlass\(/);
      const map = withMap(m.material as Material);
      expect(map).toContain('dFdx(vLowBay) * lowScale()');
      expect(map).toContain('dFdy(vLowBay) * lowScale()');
    }
  }, 180000);

  it('Low: the Empire crown (kind 4) and the other live glows are not in the far term (they stay a solid lit cap)', () => {
    for (const m of buildings(low)) {
      const sh = compiled(m.material as Material).fragmentShader;
      // the far term multiplies only the window term (lowLit, facade kinds 0 and 6), never lowGlow
      expect(sh).toContain(
        'totalEmissiveRadiance = emissive * ((lowLit * vLowFac * vLowNight + lowGlow) * fNight + lowMir);',
      );
      expect(sh).toContain('vLowKind == 4.0) lowGlow = vColor.rgb * (1.0 + vLowLook.w) * 0.75');
    }
  }, 180000);

  it('Low: the walls go cool and dark at night (albedo tint scaled by the night only, lamps included)', () => {
    for (const m of buildings(low)) {
      const sh = withMap(m.material as Material);
      expect(sh).toContain(`mix(vec3(1.0), vec3(${LOW_NIGHT_WALL.join(', ')}), fNight * vLowFac)`);
      for (const c of LOW_NIGHT_WALL) expect(c).toBeLessThan(1);
      expect(LOW_NIGHT_WALL[2], 'cool: blue is the highest channel').toBeGreaterThan(LOW_NIGHT_WALL[0]);
    }
  }, 180000);

  it("Low: the live night glow keeps facadeMaterial's kinds (LED, flood, beacon, lantern, sign), scaled by the night, with no noise", () => {
    for (const m of buildings(low)) {
      const sh = compiled(m.material as Material);
      for (const k of ['vLowKind == 5.0', 'vLowKind == 9.0', 'vLowKind == 3.0', 'vLowKind == 4.0', 'vLowKind == 8.0'])
        expect(sh.fragmentShader).toContain(k);
      expect(sh.fragmentShader).toContain('* fNight;');
      expect(sh.fragmentShader).not.toContain('fHash');
      expect(sh.fragmentShader).not.toContain('fNoise');
      expect(sh.vertexShader).toContain('uniform float fPixel, fNight;');
      // a thin thing grows to one window pixel; a lit beacon to two, or the upscaled picture dulls its red (by day one, a dark dot)
      expect(sh.vertexShader).toContain('fPixel * (lowKind == 3 ? 1.0 + fNight : 1.0)');
    }
  }, 180000);

  it("Low: by day the LED, flood, lantern and sign kinds take High's daytime diffuse, not the vertex colour; the glow stays scaled by the night", () => {
    for (const m of buildings(low)) {
      const mat = m.material as Material;
      const sh = withMap(mat);
      // after the vertex colour is multiplied in (color_fragment), so it replaces it, as High's per-kind diffuse does
      const at = sh.indexOf('#include <color_fragment>');
      expect(at, 'the day diffuse follows color_fragment').toBeGreaterThan(-1);
      const day = sh.slice(at);
      expect(day).toContain('vLowKind == 5.0) diffuseColor.rgb = mix(vec3(0.04), vec3(0.55, 0.58, 0.6), vLowMetal);');
      expect(day).toContain('vLowKind == 9.0) diffuseColor.rgb = vec3(0.55, 0.58, 0.6);');
      expect(day).toContain('vLowKind == 4.0) diffuseColor.rgb = vec3(0.32, 0.34, 0.36);');
      expect(day).toContain('else if (vLowKind == 8.0) {');
      expect(day).toContain('if (vLowFac == 0.0)');
      // the spire's metal flag comes from the vertex's aux.z, as High's does
      expect(compiled(mat).vertexShader).toContain('vLowMetal = aux.z;');
      // the glow is still the night's: each kind's glow scaled by fNight, not by the day diffuse
      const full = compiled(mat).fragmentShader;
      expect(full).toContain(
        'totalEmissiveRadiance = emissive * ((lowLit * vLowFac * vLowNight + lowGlow) * fNight + lowMir);',
      );
      expect(full).toContain('vec3 lowGlow = vec3(0.0);');
      expect(day).not.toContain('fGlow');
    }
  }, 180000);

  it("Low: by day the solar panels (kind 7) take High's blue cells on silver lines, the same colour as High's", () => {
    // the shared colour: High's solar line in facadeMaterial, its diffuse after color_fragment
    const SOLAR = 'mix(vec3(0.012, 0.022, 0.06), vec3(0.3, 0.32, 0.34), ';
    const sh = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <begin_vertex>\n',
      fragmentShader: '#include <common>\n#include <color_fragment>\n',
    };
    (facadeMaterial().mat as unknown as { onBeforeCompile: (s: typeof sh, r: unknown) => void }).onBeforeCompile(
      sh,
      null,
    );
    expect(sh.fragmentShader, 'High: solar day colour').toContain(`${SOLAR}l * 0.6)`);
    for (const m of buildings(low)) {
      const day = withMap(m.material as Material);
      const at = day.indexOf('#include <color_fragment>');
      expect(at, 'the day diffuse follows color_fragment').toBeGreaterThan(-1);
      const after = day.slice(at);
      expect(after).toContain('vLowKind == 7.0) {');
      expect(after).toContain(`${SOLAR}sl * 0.6)`);
      expect(after).toContain('fwidth(sg)');
    }
  }, 180000);

  it("Low: the glass takes each building's own tint (the atlas alpha is the glass mask; the map step tints by it)", () => {
    const { day } = lowFacadeMaps();
    const data = day.image.data as Uint16Array;
    let glass = 0,
      other = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (DataUtils.fromHalfFloat(data[i]!) > 0.5) glass++;
      else other++;
    }
    expect(glass, 'glass texels').toBeGreaterThan(0);
    expect(other, 'frame and reveal texels').toBeGreaterThan(0);
    for (const m of buildings(low)) {
      const sh = withMap(m.material as Material);
      expect(sh).toContain('vLowTint');
      expect(sh).toContain('lowTex.a * vLowFac');
      const vs = compiled(m.material as Material).vertexShader;
      expect(vs).toContain('attribute vec3 tint;');
    }
  }, 180000);

  it("Low: by day a wall keeps its own frame colour (the tower's vertex colour, shaded by the atlas), not one dark slate from the glass", () => {
    for (const m of buildings(low)) {
      const sh = withMap(m.material as Material);
      const at = sh.indexOf('vec3 lowFrameD');
      expect(at, 'the day wall after the colour step').toBeGreaterThan(sh.indexOf('#include <color_fragment>'));
      const day = sh.slice(at);
      // the frame: the vertex colour (each tower's own frame) times the atlas shade
      expect(day).toContain('vec3 lowFrameD = vColor.rgb * lowShade;');
      // far off the pane's place is the analytic window, not the atlas's mean (a band's wall keeps its ribbon)
      expect(day).toContain('float lowGlassF = mix(lowGlassM, lowWinMask() * vLowFac, lowFarD * (1.0 - lowRibD));');
      expect(day).toContain('vec3 lowDayWall = mix(lowFrameD, lowGlassD, lowGlassF);');
      // near glass: the raw tint, lit by the constant; far off, the pane is its dark tint (the room behind), and the emissive step adds
      // the sky it mirrors (CITY-02), on the pane's share of the pixel by day only
      expect(day).toContain(`mix(vLowTint * 1.5, vLowTint * ${LOW_FAR_GLASS}, lowFarD)`);
      expect(day).toContain('lowMirM = lowGlassF * lowFarD * (1.0 - lowRibD) * vLowFac * (1.0 - fNight);');
      expect(day).not.toContain('lowTn');
      expect(sh).toContain('lowShade = mix(lowTex.rgb, vec3(0.84), lowTex.a);');
      expect(sh).toContain('lowGlassM = lowTex.a * vLowFac;');
    }
    expect(LOW_DAY_GLASS).toBeGreaterThan(1);
    expect(LOW_DAY_GLASS).toBeLessThan(3);
    expect(LOW_FAR_GLASS).toBeGreaterThan(0);
    expect(LOW_FAR_GLASS).toBeLessThan(LOW_DAY_GLASS);
  }, 180000);

  it("Low: by day a far pane mirrors the horizon through High's mirror tint (grey plain glass, the tint on a coated one, white at a grazing look)", () => {
    for (const m of buildings(low)) {
      const full = compiled(m.material as Material).fragmentShader;
      // the eye's ray: vViewPosition points from the wall to the eye, so the facing term is its dot with the normal (no minus)
      expect(full).toContain('pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 5.0)');
      expect(full).toContain('mix(mix(vec3(0.3), lowMt * 0.75, vLowMetal * 0.9), vec3(1.0), lowFr) * fHor');
      // a float literal: an int would not compile in GLSL ES
      expect(full).toContain(`vec3(1.0), lowFr) * fHor * ${LOW_FAR_MIRROR.toFixed(3)};`);
      // under the roof line across the street the pane mirrors the walls there (or the road), not the sky: High's lines
      expect(full).toContain(
        'float lowHit = 1.0 - smoothstep(-0.7, 0.7, lowRp.y - 13.0 - 32.0 * lowNoise(vec2(lowRp.x / 34.0, vLowSeed * 0.37)));',
      );
      expect(full).toContain('(fHor * 0.3 + fSunCol * max(dot(fSun, -lowN), 0.0) * 0.26) * 0.9');
      expect(full).toContain('lowMir = mix(lowSkyM, lowWallM, lowHit) * lowMirM;');
      expect(full).toContain('uniform vec3 fHor, fSun, fSunCol,');
      // the far window's mask goes to its mean where a bay or a storey is under a few pixels
      expect(full).toContain('win, smoothstep(vec2(0.1), vec2(0.35), fw));');
    }
    expect(LOW_FAR_MIRROR).toBeGreaterThan(0);
    expect(LOW_FAR_MIRROR).toBeLessThan(1);
  }, 180000);

  it("Low: a sign's case is dark, its lit face keeps the sign colour (the orange board), and far day glass does not go navy", () => {
    for (const m of buildings(low)) {
      const sh = withMap(m.material as Material);
      // the case (look.w < -0.5) stays dark; a face draws High's glyph board: dark-orange backing by day, tubes at night
      expect(sh).toContain('float lowGlyph(vec2 c, float gh) {');
      expect(sh).toContain('if (vLowLook.w > -0.5) {');
      expect(sh).toContain('d = lowGlyph(c, lowH(gid + vLowSeed * 1.31));');
      expect(sh).toContain('mix(lowCol * 0.62 + 0.1, vec3(0.03), tube), box) * mix(0.3, 1.0, rim);');
      expect(sh).toContain('lowSign = mix(neon, boxed, box) * rim;');
      const full = compiled(m.material as Material).fragmentShader;
      expect(full).toContain('else if (vLowKind == 8.0) lowGlow = lowSign;');
      expect(full).not.toContain('vColor.rgb * mix(1.8, 0.72, clamp(vLowLook.w, 0.0, 1.0))');
      expect(sh).toContain('float lowFarD = smoothstep(150.0, 300.0, length(vViewPosition));');
      expect(sh).toContain(`vLowTint * ${LOW_FAR_GLASS}, lowFarD)`);
    }
  }, 180000);

  it('Low: the day wall mixes into the night path by fNight, so at full night the diffuse is the old one (item 1 untouched)', () => {
    for (const m of buildings(low)) {
      const sh = withMap(m.material as Material);
      // at fNight 1 the mix returns the diffuse the map step left (the night wall tint and the night glass)
      expect(sh).toContain(
        'diffuseColor.rgb = mix(diffuseColor.rgb, mix(lowDayWall, diffuseColor.rgb, fNight), vLowFac);',
      );
      // the night wall tint is still in the map step, unchanged
      expect(sh).toContain('mix(vec3(1.0), vec3(0.36, 0.44, 0.58), fNight * vLowFac)');
      // the night guard is untouched
      const full = compiled(m.material as Material).fragmentShader;
      expect(full).toContain('if (fNight > 0.0) {');
    }
  }, 180000);

  it('Low: each facade maps its own window share (look.zw) onto the atlas window, so a band keeps its ribbon (not one baked rect for all)', () => {
    for (const m of buildings(low)) {
      const sh = compiled(m.material as Material).fragmentShader;
      // the facade's share, read per vertex, sets where the window sits in its bay and storey
      expect(sh, 'the facade share from look.zw').toContain('max(vLowLook.zw, vec2(0.05))');
      expect(sh).toContain('(1.0 - win.y) * 0.6');
      expect(sh).toContain('vec2 lowLocal()');
      // the atlas lookup and its mip derivatives both follow that map
      expect(sh).toContain('clamp(lowLocal(), 0.0, 1.0)');
      expect(withMap(m.material as Material)).toContain('dFdx(vLowBay) * lowScale()');
      // the old lookup, one baked window for every facade, is gone
      expect(sh).not.toContain('+ fract(vLowBay)) / 8.0');
    }
    const vs = compiled(buildings(low)[0]!.material as Material).vertexShader;
    expect(vs).toContain('attribute vec4 look;');
    expect(vs).toContain('vLowLook = look;');
  }, 180000);

  it('Low: a band wall is a continuous ribbon by day (beige frame, one glass band per storey, thin mullions), not the punched atlas window', () => {
    for (const m of buildings(low)) {
      const sh = withMap(m.material as Material);
      // only a band's window (win.y 0.5, its sill and top) takes the ribbon; the other styles keep the atlas
      expect(sh, 'the band test on the facade window').toContain('abs(vLowLook.w - 0.5)');
      expect(sh).toContain('float lowRib = 1.0 - step(0.001, abs(vLowLook.w - 0.5));');
      // the glass band on High's grid (the facade's own uv, not mirrored): the band's window (0.97 across, 0.5 up, from its sill), the
      // ground floor's shop window wider and down to the pavement, as High's
      const full = compiled(m.material as Material).fragmentShader;
      expect(full).toMatch(/float lowRibGlass\(\)/);
      expect(full).toContain('vec2 lowRibUv() { return vLowFuv / max(vLowLook.xy, vec2(0.1)); }');
      expect(full).toContain('vec2 win = mix(lowWin(), vec2(0.94, 0.66), shop);');
      // the frame is the beige tone, each storey a touch different (High's hash); the glass its dark pane
      expect(sh).toContain('vec4(mix(lowRibFr, vec3(0.09, 0.1, 0.12), lowG), lowG)');
      expect(sh).toContain('lowH(vec2(floor(lowRg2.y), vLowSeed))');
      // the ribbon's glass replaces the atlas read on a band wall, and far off the top mip still takes over
      expect(sh).toContain('vec4 lowNear = mix(textureGrad(map, lowUv, lowDx, lowDy)');
      expect(sh).toContain('vec4 lowTex = mix(lowNear, textureLod(map, lowUv, 8.0), lowFarM);');
    }
  }, 180000);

  it('Low: a band wall lights room by room as High does (its window ids, hashes, habits and shops), all inside the night guard', () => {
    // High's lines, in Low's names: so a band lights the same rooms at both tiers
    const high = (s: string) =>
      s
        .replaceAll('fHash', 'lowH')
        .replaceAll('fGather', 'lowGather')
        .replaceAll('vLook', 'vLowLook')
        .replaceAll('vFuv', 'vLowFuv');
    for (const m of buildings(low)) {
      const full = compiled(m.material as Material).fragmentShader;
      const guard = full.indexOf('if (fNight > 0.0) {');
      expect(guard, 'the guard').toBeGreaterThan(-1);
      for (const line of [
        'float zw = home > 0.5 ? 1.0 + step(0.55, fHash(vec2(seed, 8.7)))',
        'float occ = home > 0.5 ? share * gatherZ : min(1.0, share * 2.6 * rf * rf * gatherZ);',
        'float swN = floor(fTime / (70.0 + 170.0 * fHash(vec2(zone + seed, fl + 1.7))) + fHash(vec2(fl + seed, zone + 2.3)));',
        'float lit = mix(mix(zlit, occ, cz), share * gather * mix(0.86, 1.0, home), cv);',
        'lit *= mix(mix(step(h3, 0.9), 0.9, cx), 1.0, home);',
        'float sw = 1.0 + floor(3.0 * fHash(vec2(seed, 13.7))), sid = floor(id.x / sw), hs = fHash(vec2(sid + seed * 2.3, 11.3)), sOpen = step(fHash(vec2(sid + seed, 17.1)), 0.8);',
        'lit = mix(lit, mix(sOpen, 0.8, cx), shop);',
        'vec3 lamp = fLampCol(mix(0.68 * bt, 0.55 + 0.45 * bt, home) + (hc - 0.5) * 0.55 * (1.0 - cr));',
      ])
        expect(full, line).toContain(high(line).replace('fLampCol', 'lowLampCol'));
      // a window's curtain by High's hash of its id
      expect(full).toContain('float h2 = lowH(id * 1.37 + vLowSeed + 7.1);');
      // the rooms light the glass, inside the guard (a band's ribbon at any range)
      expect(full.indexOf('lowLit = lowRibLight(lowRg2, lowRfw, lowRibC, lowV, lowN) * lowGm;')).toBeGreaterThan(guard);
    }
  }, 180000);

  it('Low: the buildings take the haze in place of fog, as High does (hzApply on their fragment colour)', () => {
    for (const m of buildings(low)) {
      const sh = withMapShader(m.material as Material);
      expect(sh.fragmentShader).toContain('hzApply(gl_FragColor.rgb, vHzW)');
      expect(sh.vertexShader).toContain('vHzW = (modelMatrix * hzP).xyz;');
    }
  }, 180000);
});

/** The material's shader with the fog chunks in place, as `withHaze` finds them: its own map step and the haze's fog include. */
function withMapShader(m: Material): { vertexShader: string; fragmentShader: string } {
  const sh = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: '#include <common>\n#include <fog_pars_vertex>\n#include <begin_vertex>\n#include <fog_vertex>\n',
    fragmentShader:
      '#include <common>\n#include <map_fragment>\n#include <fog_pars_fragment>\n#include <fog_fragment>\n',
  };
  const hook = (m as Material & { onBeforeCompile?: (s: typeof sh, r: unknown) => void }).onBeforeCompile;
  if (typeof hook === 'function') hook(sh, null);
  return sh;
}
