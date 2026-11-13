import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS, graphics, PRESETS, setAutoTier, setPreset, tierRecord } from '../graphics';
import { backToAuto, postOn, SCALES, setPost, setScale } from './controls';

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

  it('makes the tier manual', () => {
    setAutoTier({ tier: 'low', reason: 'test' });
    setScale(0.5);
    expect(tierRecord.value.mode).toBe('manual');
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

  it('makes the tier manual', () => {
    setPost(false);
    expect(tierRecord.value.mode).toBe('manual');
    setAutoTier({ tier: 'low', reason: 'test' });
    setPost(true);
    expect(tierRecord.value.mode).toBe('manual');
  });

  describe('from the real Low tier (tierGraphics, not PRESETS.low)', () => {
    // clear any held values from earlier tests: a post-off from High, then the post-on that restores them
    beforeEach(() => {
      setPreset('high');
      setPost(false);
      setPost(true);
      setAutoTier({ tier: 'low', reason: 'test' });
    });

    it('post on gives Medium\'s ao, bloom and msaa and leaves every other setting as it was', () => {
      const before = { ...graphics.value };
      expect([before.scale, before.shadows, before.fps]).toEqual([0.75, 0, 30]);
      setPost(true);
      const after = graphics.value;
      expect([after.ao, after.bloom, after.msaa]).toEqual([PRESETS.medium.ao, PRESETS.medium.bloom, PRESETS.medium.msaa]);
      // every other setting: the same before and after (the post values blanked on both sides)
      const others = (g: typeof after) => ({ ...g, ao: 0, bloom: 0, msaa: 0 });
      expect(others(after)).toEqual(others(before));
      expect([after.scale, after.shadows, after.fps]).toEqual([0.75, 0, 30]);
    });
  });
});

describe('backToAuto', () => {
  beforeEach(() => {
    setPreset('high');
    setPost(false);
    setPost(true);
    setAutoTier({ tier: 'low', reason: 'test' });
  });

  it('from auto Low: scale and post go manual, and backToAuto restores Low and auto', () => {
    setScale(0.5);
    setPost(true);
    expect(tierRecord.value.mode).toBe('manual');
    backToAuto({ tier: 'low', reason: 'test' });
    expect(graphics.value.scale).toBe(0.75);
    expect(postOn(graphics.value)).toBe(false);
    expect(tierRecord.value.mode).toBe('auto');
  });
});
