import { describe, expect, it } from 'vitest';
import { GLOW, HOT_FROM_C, HOT_FULL_C, PartSkin, heatColor, mat, partLook, type PartState } from './materials';

const ON: PartState = { powered: true, active: false, burnt: false, throttled: false, tempC: 30 };

describe('part looks', () => {
  it('leaves a powered idle part as it is', () => {
    expect(partLook(ON)).toEqual({ tint: 1, glow: 0, glowIntensity: 0 });
  });

  it('darkens a part with no power', () => {
    expect(partLook({ ...ON, powered: false })).toEqual({ tint: 0.5, glow: 0, glowIntensity: 0 });
  });

  it('lights an active part', () => {
    expect(partLook({ ...ON, active: true })).toEqual({ tint: 1, glow: GLOW.active, glowIntensity: 0.4 });
  });

  it('tints a throttled part amber', () => {
    expect(partLook({ ...ON, throttled: true })).toEqual({ tint: 0.8, glow: GLOW.throttled, glowIntensity: 0.2 });
  });

  it('brightens with the temperature, cyan to red', () => {
    const warm = partLook({ ...ON, tempC: HOT_FROM_C + 1 }), hot = partLook({ ...ON, tempC: HOT_FULL_C + 50 });
    expect(warm.glowIntensity).toBeLessThan(hot.glowIntensity);
    expect(hot.glowIntensity).toBeCloseTo(0.6);
    expect(heatColor(0)).toBe(GLOW.active);
    expect(heatColor(0.5)).toBe(GLOW.throttled);
    expect(heatColor(1)).toBe(GLOW.burnt);
  });

  it('a burnt part wins over everything', () => {
    expect(partLook({ ...ON, burnt: true, tempC: 200, active: true, powered: false })).toEqual({ tint: 0.3, glow: GLOW.burnt, glowIntensity: 0.8 });
  });

  it('a skin eases its material to the look, from the base colour every time', () => {
    const m = mat(0x808080), skin = new PartSkin([m]), base = m.color.r;
    skin.set({ ...ON, powered: false });
    for (let i = 0; i < 300; i++) skin.frame(1 / 60);
    expect(m.color.r).toBeCloseTo(base * 0.5, 3);
    skin.set(ON);
    for (let i = 0; i < 300; i++) skin.frame(1 / 60);
    expect(m.color.r).toBeCloseTo(base, 3);
    expect(m.emissiveIntensity).toBeCloseTo(0, 3);
  });

  it('a skin says it eases until it has reached the look', () => {
    const skin = new PartSkin([mat(0x808080)]);
    expect(skin.easing).toBe(false);
    skin.set({ ...ON, active: true });
    expect(skin.easing).toBe(true);
    for (let i = 0; i < 600; i++) skin.frame(1 / 60);
    expect(skin.easing).toBe(false);
  });
});
