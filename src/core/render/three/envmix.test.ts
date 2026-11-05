import { describe, expect, it } from 'vitest';
import { CubeTexture, Scene, type WebGLRenderer } from 'three';
import { EnvMix } from './envmix';

/** A PMREM's shape: a cube of 256 and its six mips. */
const pmrem = () => {
  const t = new CubeTexture(Array.from({ length: 6 }, () => ({ width: 256, height: 256 })) as never);
  for (let lod = 0; lod < 6; lod++) (t.mipmaps as unknown[]).push({ width: 256 >> lod, height: 256 >> lod });
  return t;
};

describe('the blend of the studio\'s and the room\'s light', () => {
  it('takes the studio\'s layout, so a material keeps its program', () => {
    const studio = pmrem(), mix = new EnvMix({} as WebGLRenderer, studio, 0.35, 1);
    const out = (mix as unknown as { out: { width: number; texture: CubeTexture & { isPMREMTexture?: boolean } } }).out;
    expect(out.width).toBe(256);
    expect(out.texture.mipmaps.map((m: { width: number }) => m.width)).toEqual([256, 128, 64, 32, 16, 8]);
    expect(out.texture.isPMREMTexture).toBe(true);
  });

  it('lights with the studio alone, at its strength, until the room has a capture', () => {
    const studio = pmrem(), mix = new EnvMix({} as WebGLRenderer, studio, 0.35, 1), scene = new Scene();
    for (const t of [0, 0.5, 1]) {
      mix.apply(scene, t);
      expect(scene.environment).toBe(studio);
      expect(scene.environmentIntensity).toBe(0.35);
    }
    expect(mix.room).toBeNull();
  });
});
