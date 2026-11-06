import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decode, encode, png, scaleOf, unpng } from './rgbm';

describe('RGBM', () => {
  it('keeps the light to within 1.5% over 12 stops, and the dark finer', () => {
    const width = 64, height = 4, rgb = new Float32Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      const v = 2 ** (-12 * ((i % width) / (width - 1))) * 3;
      rgb.set([v, v * 0.6, v * 0.25], 3 * i);
    }
    const scale = scaleOf(rgb), back = decode(encode({ width, height, rgb, scale }), width, height, scale);
    expect(scale).toBe(3);
    for (let i = 0; i < rgb.length; i++) if (rgb[i]! > 3e-3) expect(Math.abs(back[i]! / rgb[i]! - 1)).toBeLessThan(0.015);
  });

  it('turns the rows over: a PNG\'s first row is the top, Blender\'s the bottom', () => {
    const rgb = new Float32Array([0, 0, 0, 1, 1, 1]), out = encode({ width: 1, height: 2, rgb, scale: 1 });
    expect([...out.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    expect(out[7]).toBe(1);
  });

  it('stores black as black', () => {
    const out = encode({ width: 1, height: 1, rgb: new Float32Array(3), scale: 1 });
    expect(decode(out, 1, 1, 1)).toEqual(new Float32Array(3));
  });

  it('blanks a texel nothing reads, and leaves the others as they are', () => {
    const rgb = new Float32Array([1, 1, 1, 0.5, 0.25, 0.1]), light = { width: 1, height: 2, rgb, scale: 1 };
    const all = encode(light), kept = encode(light, new Uint8Array([1, 0]));
    expect([...kept.subarray(0, 4)]).toEqual([...all.subarray(0, 4)]);
    expect([...kept.subarray(4)]).toEqual([0, 0, 0, 1]);
  });
});

describe('png', () => {
  it('writes a valid RGBA PNG that reads back the same', () => {
    const width = 5, height = 3, rgba = new Uint8Array(width * height * 4).map((_, i) => (i * 37) & 255);
    const file = png(rgba, width, height);
    expect([...file.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const back = unpng(file);
    expect([back.width, back.height]).toEqual([width, height]);
    expect(back.rgba).toEqual(rgba);
    // the stream inflates to a filter byte and a row for each line
    const idat = file.subarray(41, file.length - 12 - 4);
    expect(inflateSync(idat).length).toBe(height * (width * 4 + 1));
  });
});
