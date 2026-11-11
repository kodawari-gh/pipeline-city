import { ACESFilmicToneMapping, LinearSRGBColorSpace, NoToneMapping, SRGBColorSpace, Texture, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { BINS, HIGH_C, LocalEye, MAX_DOWN, MAX_UP, MID, SHADOW_C, gridSize, lift, outputDefines } from './localeye';

/** A renderer that only records where each full-screen step writes. */
function fakeRenderer(toneMapping = ACESFilmicToneMapping, outputColorSpace = SRGBColorSpace) {
  const writes: (WebGLRenderTarget | null)[] = [];
  let to: WebGLRenderTarget | null = null;
  const r = {
    toneMapping, outputColorSpace, toneMappingExposure: 1,
    setRenderTarget: (t: WebGLRenderTarget | null) => { to = t; },
    render: () => { writes.push(to); },
  };
  return { r: r as unknown as WebGLRenderer, writes };
}

describe("the eye's local adaptation", () => {
  it('cuts the picture in cells, the last one cut short', () => {
    expect(gridSize(1920, 1080)).toEqual([60, 34]);
    expect(gridSize(1, 1)).toEqual([1, 1]);
  });

  it('keeps middle grey, lifts the dark and holds back the bright, within the caps', () => {
    const mid = Math.log2(MID / 2.2);
    expect(lift(mid, 2.2)).toBeCloseTo(0);
    expect(lift(mid - 4, 2.2)).toBeCloseTo(4 * (1 - SHADOW_C));
    expect(lift(mid + 2, 2.2)).toBeCloseTo(-2 * (1 - HIGH_C));
    expect(lift(mid - 40, 2.2)).toBe(MAX_UP);
    expect(lift(mid + 40, 2.2)).toBe(-MAX_DOWN);
  });

  it('follows the exposure and the key: a brighter exposure or a lower key lowers the grey it adapts to', () => {
    expect(lift(Math.log2(MID / 4), 4)).toBeCloseTo(0);
    expect(lift(Math.log2(MID / 2), 4)).toBeLessThan(0);
    // a night key four times lower: the same dark wall is lifted two stops' worth less
    const wall = Math.log2(MID / 2.2) - 8;
    expect(lift(wall, 2.2) - lift(wall, 2.2, MID / 4)).toBeCloseTo(2 * (1 - SHADOW_C));
  });

  it('keeps more of the bright with a higher share (the night), and the dark as it was', () => {
    const mid = Math.log2(MID / 2.2);
    expect(lift(mid + 3, 2.2, MID, 0.8)).toBeCloseTo(-3 * 0.2);
    expect(lift(mid + 3, 2.2, MID, 0.8)).toBeGreaterThan(lift(mid + 3, 2.2));
    expect(lift(mid - 3, 2.2, MID, 0.8)).toBeCloseTo(lift(mid - 3, 2.2));
  });

  it('sizes its grid to the picture, a bin a stop in each cell', () => {
    const eye = new LocalEye(1920, 1080);
    const grid = (eye as unknown as { grid: { width: number; height: number } }).grid;
    expect([grid.width, grid.height]).toEqual([60 * BINS, 34]);
    eye.setSize(640, 360);
    expect([grid.width, grid.height]).toEqual([20 * BINS, 12]);
    eye.dispose();
  });

  it("takes the renderer's tone mapping and colour space, as the output pass did", () => {
    expect(outputDefines(ACESFilmicToneMapping, SRGBColorSpace)).toEqual({ SRGB_TRANSFER: '', ACES_FILMIC_TONE_MAPPING: '' });
    expect(outputDefines(NoToneMapping, LinearSRGBColorSpace)).toEqual({});
  });

  it('is the last pass: it writes the picture once to the screen, and reads the scene directly when told to', () => {
    const eye = new LocalEye(640, 360);
    eye.renderToScreen = true;
    const { r, writes } = fakeRenderer();
    const read = new WebGLRenderTarget(640, 360);
    eye.render(r, new WebGLRenderTarget(640, 360), read);
    // the three small steps of the grid, then one full-size write to the screen
    expect(writes.length).toBe(4);
    expect(writes.slice(0, 3)).not.toContain(null);
    expect(writes[3]).toBeNull();
    const apply = (eye as unknown as { apply: { uniforms: { tDiffuse: { value: Texture } }; defines: object } }).apply;
    expect(apply.uniforms.tDiffuse.value).toBe(read.texture);
    expect(apply.defines).toEqual({ SRGB_TRANSFER: '', ACES_FILMIC_TONE_MAPPING: '' });
    const scene = new Texture();
    eye.source = scene;
    eye.render(r, new WebGLRenderTarget(640, 360), read);
    expect(apply.uniforms.tDiffuse.value).toBe(scene);
    eye.dispose();
  });

  it('skips the grid when its strength is 0, and still writes the picture', () => {
    const eye = new LocalEye(640, 360);
    eye.renderToScreen = true;
    eye.strength = 0;
    const { r, writes } = fakeRenderer();
    eye.render(r, new WebGLRenderTarget(640, 360), new WebGLRenderTarget(640, 360));
    expect(writes).toEqual([null]);
    eye.dispose();
  });

  it('rebuilds its program only when the tone mapping or colour space change', () => {
    const eye = new LocalEye(64, 64);
    const apply = (eye as unknown as { apply: { version: number } }).apply;
    const { r } = fakeRenderer();
    eye.setOutput(r);
    const v = apply.version;
    eye.setOutput(r);
    expect(apply.version).toBe(v);
    (r as { toneMapping: number }).toneMapping = NoToneMapping;
    eye.setOutput(r);
    expect(apply.version).toBe(v + 1);
    eye.dispose();
  });
});
