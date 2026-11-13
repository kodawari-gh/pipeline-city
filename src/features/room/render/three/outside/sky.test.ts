import { describe, expect, it } from 'vitest';
import { DataTexture } from 'three';
import { moonDir, skyFragment, skyMaterial } from './sky';

describe('the moon', () => {
  it('moves with the hour: east in the evening, over the town near midnight, low in the west at dawn', () => {
    const dusk = moonDir(20), late = moonDir(23), dawn = moonDir(6.2);
    expect(dusk.x).toBeGreaterThan(late.x);
    expect(late.x).toBeGreaterThan(dawn.x);
    expect(dusk.x).toBeGreaterThan(0);
    expect(dawn.x).toBeLessThan(0);
    expect(Math.abs(late.x)).toBeLessThan(0.1);
    for (const d of [dusk, late, dawn]) {
      expect(d.z).toBeLessThan(0);
      expect(d.y).toBeGreaterThan(0);
      expect(d.length()).toBeCloseTo(1);
    }
    expect(late.y).toBeGreaterThan(dusk.y);
    expect(late.y).toBeGreaterThan(dawn.y);
  });

  it('is under the horizon by day', () => {
    for (const h of [9, 12, 15]) expect(moonDir(h).y).toBeLessThan(0);
  });
});

describe('the sky\'s clouds and moon seas: live at High, baked at Low', () => {
  const LOOP = 'for (int i = 0; i < 5; i++)';

  it('High keeps the live fbm: five octaves per call, and no baked map', () => {
    const src = skyFragment(false);
    expect(src).toContain(LOOP);
    expect(src).toContain('float fbm(vec2 p)');
    expect(src).not.toContain('tNoise');
    expect('tNoise' in skyMaterial().uniforms).toBe(false);
  });

  it('Low runs no fbm loop, reads a baked map, and keeps the rest of the sky', () => {
    const src = skyFragment(true);
    expect(src).not.toContain(LOOP);
    expect(src).toContain('texture2D(tNoise');
    for (const keep of ['sunDir', 'moonDir', 'for (int k = 0; k < 3', 'float hash3(vec3 p)', 'float noise(vec2 p)']) expect(src).toContain(keep);
    const u = skyMaterial(true).uniforms;
    expect(u.tNoise!.value).toBeInstanceOf(DataTexture);
  });

  it('Low has the same uniforms as High, plus the map', () => {
    const high = Object.keys(skyMaterial().uniforms).sort();
    const low = Object.keys(skyMaterial(true).uniforms).sort();
    expect(low).toEqual([...high, 'tNoise'].sort());
  });
});
