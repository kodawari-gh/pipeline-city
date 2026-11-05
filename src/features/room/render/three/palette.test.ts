import { describe, expect, it } from 'vitest';
import { WHITE_K, kelvin } from './palette';

const rgb = (c: number): [number, number, number] => [c >> 16, (c >> 8) & 255, c & 255];

describe('kelvin', () => {
  it('is white at the white balance', () => {
    expect(kelvin(WHITE_K)).toBe(0xffffff);
  });
  it('is warm under it, warmer the lower, and pale blue over it', () => {
    const [r27, g27, b27] = rgb(kelvin(2700)), [, g30, b30] = rgb(kelvin(3000)), [r65, g65, b65] = rgb(kelvin(6500));
    expect(r27).toBe(255);
    expect(b27).toBeLessThan(g27);
    expect(g27).toBeLessThan(g30);
    expect(b27).toBeLessThan(b30);
    expect(b65).toBe(255);
    expect(r65).toBeLessThan(g65);
  });
});
