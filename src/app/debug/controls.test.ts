import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHOICES, DEFAULTS, debugOverride, effective, graphics, loadStart, PRESETS, resetTierSteps, setAutoTier, setGraphic, setPreset, setTier, stepTier, tierRecord } from '../graphics';
import { backToAuto, lightsNow, nextLights, overridden, postOn, SCALES, setLights, setPost, setRootHidden, setScale, setShadowsOn } from './controls';

// The overlay's toggles sit on top of the player's settings (`debugOverride`): `graphics` and the stored settings never see them.
beforeEach(() => { debugOverride.value = {}; });

describe('SCALES', () => {
  it('lists the render scales the panel offers, all within the graphics range', () => {
    expect(SCALES).toEqual([0.5, 0.6, 0.75, 0.85, 1]);
  });
});

describe('setScale', () => {
  beforeEach(() => setPreset('high'));

  it('changes the applied scale, not the setting', () => {
    const was = graphics.value.scale;
    setScale(0.6);
    expect(effective.value.scale).toBe(0.6);
    setScale(1);
    expect(effective.value.scale).toBe(1);
    expect(graphics.value.scale).toBe(was);
  });

  it('leaves the tier as it was', () => {
    setAutoTier({ tier: 'low', reason: 'test' });
    setScale(0.5);
    expect(tierRecord.value.mode).toBe('auto');
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

  it('off zeroes the applied ao, bloom and msaa', () => {
    setPost(false);
    const g = effective.value;
    expect([g.ao, g.bloom, g.msaa]).toEqual([0, 0, 0]);
    expect(postOn(g)).toBe(false);
    expect(postOn(graphics.value)).toBe(true);
  });

  it('on gives back the values the player has', () => {
    setPreset('ultra');
    setPost(false);
    setPost(true);
    const g = effective.value;
    expect([g.ao, g.bloom, g.msaa]).toEqual([PRESETS.ultra.ao, PRESETS.ultra.bloom, PRESETS.ultra.msaa]);
    expect(overridden()).toBe(false);
  });

  it('on from Low (all post off) turns on Medium\'s msaa and bloom', () => {
    setPreset('low');
    setPost(true);
    const g = effective.value;
    expect(g.msaa).toBe(PRESETS.medium.msaa);
    expect(g.bloom).toBe(PRESETS.medium.bloom);
    expect(g.msaa).toBe(2);
    expect(g.bloom).toBe(1);
    expect(postOn(graphics.value)).toBe(false);
  });

  it('a second off, then on, still gives back the values the player has', () => {
    setPreset('ultra');
    setPost(false);
    setPost(false);
    setPost(true);
    const g = effective.value;
    expect([g.ao, g.bloom, g.msaa]).toEqual([PRESETS.ultra.ao, PRESETS.ultra.bloom, PRESETS.ultra.msaa]);
  });

  it('leaves the tier as it was', () => {
    setAutoTier({ tier: 'low', reason: 'test' });
    setPost(false);
    setPost(true);
    expect(tierRecord.value.mode).toBe('auto');
  });

  it('from the real Low tier (tierGraphics, not PRESETS.low): post on gives Medium\'s ao, bloom and msaa and leaves every other setting as it was', () => {
    setAutoTier({ tier: 'low', reason: 'test' });
    const before = { ...effective.value };
    expect([before.scale, before.shadows, before.fps]).toEqual([0.75, 0, 60]);
    setPost(true);
    const after = effective.value;
    expect([after.ao, after.bloom, after.msaa]).toEqual([PRESETS.medium.ao, PRESETS.medium.bloom, PRESETS.medium.msaa]);
    const others = (g: typeof after) => ({ ...g, ao: 0, bloom: 0, msaa: 0 });
    expect(others(after)).toEqual(others(before));
  });
});

describe('backToAuto', () => {
  beforeEach(() => setAutoTier({ tier: 'low', reason: 'test' }));

  it('from auto Low: scale and post toggles are dropped, and Low and auto are back', () => {
    setScale(0.5);
    setPost(true);
    expect(overridden()).toBe(true);
    backToAuto({ tier: 'low', reason: 'test' });
    expect(effective.value.scale).toBe(0.75);
    expect(postOn(effective.value)).toBe(false);
    expect(overridden()).toBe(false);
    expect(tierRecord.value.mode).toBe('auto');
  });
});

describe('setShadowsOn', () => {
  beforeEach(() => setPreset('high'));

  it('off sets the applied sun shadow to 0, on puts the player\'s value back', () => {
    setShadowsOn(false);
    expect(effective.value.shadows).toBe(0);
    expect(graphics.value.shadows).toBe(PRESETS.high.shadows);
    setShadowsOn(true);
    expect(effective.value.shadows).toBe(PRESETS.high.shadows);
  });

  it('on restores the value the player had, not the preset', () => {
    setGraphic('shadows', 1);
    setShadowsOn(false);
    setShadowsOn(true);
    expect(effective.value.shadows).toBe(1);
  });

  it('on with the setting at 0 gives the default level', () => {
    setGraphic('shadows', 0);
    setShadowsOn(true);
    expect(effective.value.shadows).toBe(DEFAULTS.shadows);
    expect(graphics.value.shadows).toBe(0);
  });

  it('leaves the tier as it was', () => {
    setAutoTier({ tier: 'low', reason: 'test' });
    setShadowsOn(false);
    expect(tierRecord.value.mode).toBe('auto');
  });

  it("Auto puts the shadows back to the tier's value", () => {
    setShadowsOn(false);
    backToAuto({ tier: 'high', reason: 'test' });
    expect(effective.value.shadows).toBe(PRESETS.high.shadows);
    expect(tierRecord.value.mode).toBe('auto');
  });

  it('shadows off at a level of 1, Auto to Low, shadows on gives the default level, not the remembered 1', () => {
    setGraphic('shadows', 1);
    setShadowsOn(false);
    backToAuto({ tier: 'low', reason: 'test' });
    expect(effective.value.shadows).toBe(0);
    setShadowsOn(true);
    expect(effective.value.shadows).toBe(DEFAULTS.shadows);
    expect(effective.value.shadows).not.toBe(1);
    expect(graphics.value.shadows).toBe(0);
  });
});

describe('nextLights', () => {
  it('cycles 4, 1, All (0), then 4; any other value goes to 4', () => {
    expect(nextLights(4)).toBe(1);
    expect(nextLights(1)).toBe(0);
    expect(nextLights(0)).toBe(4);
    expect(nextLights(8)).toBe(4);
  });

  it('leaves the panel choices alone: 1 is not one of them', () => {
    expect(CHOICES.lights.map(([v]) => v)).toEqual([4, 8, 0]);
  });
});

describe('setLights', () => {
  beforeEach(() => setPreset('high'));

  it('4, 1 and All reach the renderers (effective) and leave the setting and the tier as they were', () => {
    const before = graphics.value, tier = tierRecord.value;
    for (const v of [4, 1, 0]) {
      setLights(v);
      expect(effective.value.lights).toBe(v);
      expect(lightsNow()).toBe(v);
    }
    expect(graphics.value).toBe(before);
    expect(tierRecord.value).toBe(tier);
  });

  it('the toggle walks 4, 1, 0, 4 from the applied value', () => {
    setLights(4);
    const seen = [lightsNow()];
    for (let i = 0; i < 3; i++) { setLights(nextLights(lightsNow())); seen.push(effective.value.lights); }
    expect(seen).toEqual([4, 1, 0, 4]);
  });

  it('Auto drops the toggle and restores the tier lamp cap', () => {
    setLights(1);
    backToAuto({ tier: 'high', reason: 'test' });
    expect(debugOverride.value).toEqual({});
    expect(effective.value.lights).toBe(PRESETS.high.lights);
    expect(tierRecord.value.mode).toBe('auto');
  });
});

describe('the toggles are never saved', () => {
  const store = new Map<string, string>();
  const writes: string[] = [];
  const stub = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { writes.push(k); store.set(k, v); } };
  const detect = () => ({ tier: 'high' as const, reason: 'test' });
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', stub);
    resetTierSteps();
    setAutoTier({ tier: 'high', reason: 'test' });
    writes.length = 0;
  });

  it('every toggle leaves storage untouched, and a load without ?debug starts as before', () => {
    const stored = new Map(store), start = loadStart(stub, '', detect);
    setScale(0.5);
    setPost(false);
    setShadowsOn(false);
    for (const v of [4, 1, 0]) setLights(v);
    expect(overridden()).toBe(true);
    expect(writes).toEqual([]);
    expect(new Map(store)).toEqual(stored);
    const after = loadStart(stub, '', detect);
    expect(after).toEqual(start);
    expect(after.g).toEqual(graphics.value);
    expect(after.g.shadows).toBe(PRESETS.high.shadows);
    expect(after.g.lights).toBe(PRESETS.high.lights);
  });

  it('a panel change made while toggles are on does not save them', () => {
    setShadowsOn(false);
    setLights(0);
    setScale(0.5);
    setGraphic('textures', 1);
    const saved = JSON.parse(store.get('pipeline-city.graphics')!);
    expect(saved).toMatchObject({ textures: 1, shadows: PRESETS.high.shadows, lights: PRESETS.high.lights, scale: PRESETS.high.scale });
  });

  it('a tier step is not read from a toggled picture', () => {
    setTier('high');
    setAutoTier({ tier: 'high', reason: 'test' });
    resetTierSteps();
    writes.length = 0;
    setLights(0);
    expect(stepTier('down', 'high')).toBe(false);
    expect(writes).toEqual([]);
    backToAuto({ tier: 'high', reason: 'test' });
    resetTierSteps();
    expect(stepTier('down', 'high')).toBe(true);
  });
});

describe('setRootHidden', () => {
  it('hides a root and shows it again', () => {
    const root = { visible: true };
    setRootHidden(root, true);
    expect(root.visible).toBe(false);
    setRootHidden(root, false);
    expect(root.visible).toBe(true);
  });

  it('touches no saved setting', () => {
    const before = graphics.value, tier = tierRecord.value;
    setRootHidden({ visible: true }, true);
    expect(graphics.value).toBe(before);
    expect(tierRecord.value).toBe(tier);
  });

  it('a missing root is a no-op', () => {
    expect(() => setRootHidden(null, true)).not.toThrow();
  });
});
