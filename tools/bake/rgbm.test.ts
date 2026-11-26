import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DIRECT_CLIP, decode, encode, packDirect, png, scaleOf, unpng } from './rgbm';

/** The item at `i` of a list the test built. */
function nth<T>(a: ArrayLike<T>, i: number): T {
  const v = a[i];
  if (v === undefined) {
    throw new Error(`no item ${i}`);
  }
  return v;
}

describe('RGBM', () => {
  it('keeps the light to within 1.5% over 12 stops, and the dark finer', () => {
    const width = 64,
      height = 4,
      rgb = new Float32Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      const v = 2 ** (-12 * ((i % width) / (width - 1))) * 3;
      rgb.set([v, v * 0.6, v * 0.25], 3 * i);
    }
    const scale = scaleOf(rgb),
      back = decode(encode({ width, height, rgb, scale }), { width, height, scale });
    expect(scale).toBe(3);
    for (const i of [...rgb.keys()].filter((k) => nth(rgb, k) > 3e-3)) {
      expect(Math.abs(nth(back, i) / nth(rgb, i) - 1)).toBeLessThan(0.015);
    }
  });

  it("turns the rows over: a PNG's first row is the top, Blender's the bottom", () => {
    const rgb = new Float32Array([0, 0, 0, 1, 1, 1]),
      out = encode({ width: 1, height: 2, rgb, scale: 1 });
    expect([...out.subarray(0, 4)]).toStrictEqual([255, 255, 255, 255]);
    expect(out[7]).toBe(1);
  });

  it('stores black as black', () => {
    const out = encode({ width: 1, height: 1, rgb: new Float32Array(3), scale: 1 });
    expect(decode(out, { width: 1, height: 1, scale: 1 })).toStrictEqual(new Float32Array(3));
  });

  it('blanks a texel nothing reads, and leaves the others as they are', () => {
    const rgb = new Float32Array([1, 1, 1, 0.5, 0.25, 0.1]),
      light = { width: 1, height: 2, rgb, scale: 1 };
    const all = encode(light),
      kept = encode(light, new Uint8Array([1, 0]));
    expect([...kept.subarray(0, 4)]).toStrictEqual([...all.subarray(0, 4)]);
    expect([...kept.subarray(4)]).toStrictEqual([0, 0, 0, 1]);
  });
});

describe('packDirect', () => {
  it('holds a group a channel, with its hue, and reads back as colour * scale * byte²', () => {
    const width = 4,
      height = 2,
      n = width * height,
      a = new Float32Array(3 * n),
      b = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      const v = (i + 1) / n;
      a.set([v, v * 0.5, v * 0.25], 3 * i);
      b.set([0, 0, 2 * v], 3 * i);
    }
    const { bytes, entries } = packDirect([a, b], { width, height });
    expect(entries).toHaveLength(2);
    const [ea, eb] = [nth(entries, 0), nth(entries, 1)];
    expect(ea.colour.map((c) => Number(c.toFixed(3)))).toStrictEqual([1, 0.5, 0.25]);
    expect(eb.colour).toStrictEqual([0, 0, 1]);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x,
          o = 4 * ((height - 1 - y) * width + x),
          e = nth(bytes, o) / 255,
          f = nth(bytes, o + 1) / 255;
        expect(Math.abs(ea.scale * e * e - nth(a, 3 * i))).toBeLessThan(0.02);
        expect(Math.abs(eb.scale * f * f * eb.colour[2] - nth(b, 3 * i + 2))).toBeLessThan(0.04);
        expect([bytes[o + 2], bytes[o + 3]]).toStrictEqual([0, 255]);
      }
    }
  });

  it('clips the few hot texels beside the lamp, so the pool keeps the range', () => {
    const n = 1000,
      rgb = new Float32Array(3 * n).fill(1);
    rgb.set([5000, 5000, 5000], 0);
    const { bytes, entries } = packDirect([rgb], { width: n, height: 1 });
    expect(nth(entries, 0).scale).toBe(DIRECT_CLIP);
    expect(bytes[0]).toBe(255);
    expect(bytes[4]).toBe(Math.round(255 * Math.sqrt(1 / DIRECT_CLIP)));
  });

  it('blanks a texel nothing reads', () => {
    const { bytes } = packDirect([new Float32Array([1, 1, 1, 1, 1, 1])], {
      width: 1,
      height: 2,
      keep: new Uint8Array([1, 0]),
    });
    expect([bytes[0], bytes[4]]).toStrictEqual([255, 0]);
  });
});

describe('png', () => {
  it('writes a valid RGBA PNG that reads back the same', () => {
    const width = 5,
      height = 3,
      rgba = new Uint8Array(width * height * 4).map((_, i) => (i * 37) & 255);
    const file = png(rgba, { width, height });
    expect([...file.subarray(0, 8)]).toStrictEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const back = unpng(file);
    expect([back.width, back.height]).toStrictEqual([width, height]);
    expect(back.rgba).toStrictEqual(rgba);
    // the stream inflates to a filter byte and a row for each line
    const idat = file.subarray(41, -12 - 4);
    expect(inflateSync(idat)).toHaveLength(height * (width * 4 + 1));
  });
});
