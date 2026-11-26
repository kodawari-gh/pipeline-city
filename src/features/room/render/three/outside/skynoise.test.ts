import { assert, describe, expect, it } from 'vitest';
import { DataTexture, RepeatWrapping } from 'three';
import { NOISE_SIZE, bakeFbm, skyNoise } from './skynoise';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

describe('the baked sky noise', () => {
  const size = 64,
    map = bakeFbm(size);

  it('is a byte per channel, with one value in all four', () => {
    expect(map).toHaveLength(size * size * 4);
    for (let k = 0; k < map.length; k += 4) {
      expect(map[k]).toBe(must(map[k + 3]));
    }
  });

  it('is deterministic', () => {
    expect(bakeFbm(size)).toStrictEqual(map);
  });

  it("has the live fbm's spread: about half-way, with real contrast", () => {
    let sum = 0,
      sq = 0;
    const n = size * size;
    for (let k = 0; k < map.length; k += 4) {
      const v = map[k];
      assert.exists(v);
      sum += v;
      sq += v * v;
    }
    const mean = sum / n,
      sd = Math.sqrt(sq / n - mean * mean);
    expect(mean).toBeGreaterThan(90);
    expect(mean).toBeLessThan(150);
    expect(sd).toBeGreaterThan(15);
  });

  it("repeats: the seam across the map's edge is no rougher than the inside", () => {
    const at = (i: number, j: number) => {
      const mapItem = map[(j * size + i) * 4];
      assert.exists(mapItem);
      return mapItem;
    };
    let inside = 0,
      seam = 0;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size - 1; i++) {
        inside += Math.abs(at(i + 1, j) - at(i, j));
      }
      seam += Math.abs(at(0, j) - at(size - 1, j));
    }
    expect(seam / size).toBeLessThan((inside / (size * (size - 1))) * 2);
  });

  it('is baked once and shared, wrapped and mipmapped', () => {
    const t = skyNoise();
    expect(t).toBeInstanceOf(DataTexture);
    expect(skyNoise()).toBe(t);
    expect(t.image.width).toBe(NOISE_SIZE);
    expect(t.image.height).toBe(NOISE_SIZE);
    expect(t.wrapS).toBe(RepeatWrapping);
    expect(t.wrapT).toBe(RepeatWrapping);
    expect(t.generateMipmaps).toBe(true);
  });
});
