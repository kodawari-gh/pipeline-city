import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS, graphics, PRESETS, setPreset } from '../graphics';
import { postOn, SCALES, setPost, setScale } from './controls';

describe('SCALES', () => {
  it('lists the render scales the panel offers, all within the graphics range', () => {
    expect(SCALES).toEqual([0.5, 0.6, 0.75, 0.85, 1]);
  });
});

describe('setScale', () => {
  beforeEach(() => setPreset('high'));

  it('changes the graphics scale', () => {
    setScale(0.6);
    expect(graphics.value.scale).toBe(0.6);
    setScale(1);
    expect(graphics.value.scale).toBe(1);
  });
});

describe('postOn', () => {
  it('is on while any of ao, bloom or msaa is above 0', () => {
    expect(postOn({ ...DEFAULTS })).toBe(true);
    expect(postOn({ ...DEFAULTS, ao: 0, bloom: 0, msaa: 0 })).toBe(false);
    expect(postOn({ ...DEFAULTS, ao: 0, bloom: 0, msaa: 2 })).toBe(true);
    expect(postOn({ ...DEFAULTS, ao: 0, bloom: 1, msaa: 0 })).toBe(true);
  });
});

describe('setPost', () => {
  beforeEach(() => setPreset('high'));

  it('off zeroes ao, bloom and msaa', () => {
    setPost(false);
    const g = graphics.value;
    expect([g.ao, g.bloom, g.msaa]).toEqual([0, 0, 0]);
    expect(postOn(g)).toBe(false);
  });

  it('on restores the values that were there before off', () => {
    setPreset('ultra');
    setPost(false);
    setPost(true);
    const g = graphics.value;
    expect([g.ao, g.bloom, g.msaa]).toEqual([PRESETS.ultra.ao, PRESETS.ultra.bloom, PRESETS.ultra.msaa]);
  });

  it('on from Low (all post off) turns on Medium\'s msaa and bloom', () => {
    setPreset('low');
    setPost(true);
    const g = graphics.value;
    expect(g.msaa).toBe(PRESETS.medium.msaa);
    expect(g.bloom).toBe(PRESETS.medium.bloom);
    expect(g.msaa).toBe(2);
    expect(g.bloom).toBe(1);
  });

  it('a second off keeps the values remembered from the first', () => {
    setPreset('ultra');
    setPost(false);
    setPost(false);
    setPost(true);
    const g = graphics.value;
    expect([g.ao, g.bloom, g.msaa]).toEqual([PRESETS.ultra.ao, PRESETS.ultra.bloom, PRESETS.ultra.msaa]);
  });
});
