import { ShaderChunk } from 'three';
import { describe, expect, it } from 'vitest';
import './arealoop';

describe('the area lights\' loop', () => {
  const chunk = ShaderChunk.lights_fragment_begin, at = chunk.indexOf('NUM_RECT_AREA_LIGHTS; i ++');

  it('keeps the loop, and no longer unrolls it', () => {
    expect(at).toBeGreaterThan(0);
    expect(chunk.slice(at - 60, at)).not.toContain('unroll_loop_start');
    expect(chunk.slice(at, at + 300)).toContain('RE_Direct_RectArea(');
    expect(chunk.slice(at, at + 300)).not.toContain('unroll_loop_end');
  });

  it('leaves the other lights unrolled: their shadow maps need a constant index', () => {
    for (const n of ['NUM_POINT_LIGHTS', 'NUM_SPOT_LIGHTS', 'NUM_DIR_LIGHTS']) expect(chunk).toMatch(new RegExp(`#pragma unroll_loop_start\\s+for \\( int i = 0; i < ${n}`));
    expect(chunk.split('unroll_loop_start').length).toBe(chunk.split('unroll_loop_end').length);
  });
});
