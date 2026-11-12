import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autoStep, AwayWatch, awayHeld, CHOICES, DEFAULTS, effective, FrameGate, graphics, lowered, nextStep, parseGraphics, parseTierRecord, pickTier, presetOf, PRESETS, PRESET_NAMES, resetTierSteps,
  resolveStart, setAutoTier, setGraphic, setPreset, setTier, SlowWatch, stepTier, tierGraphics, TierWatch, tierRecord, type DeviceInfo, type Tier,
} from './graphics';

const dev = (o: Partial<DeviceInfo>): DeviceInfo => ({ renderer: '', cores: 8, memoryGb: 8, width: 1920, height: 1080, dpr: 1, ...o });

describe('pickTier', () => {
  it('RTX 5080 4K desktop is high', () => {
    expect(pickTier(dev({ renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11 vs_5_0 ps_5_0)', cores: 24, width: 3840, height: 2160, dpr: 1.5 })).tier).toBe('high');
  });
  it('Intel UHD laptop is medium', () => {
    expect(pickTier(dev({ renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620)', cores: 8 }))).toMatchObject({ tier: 'medium', reason: 'integrated GPU' });
  });
  it('Adreno phone and iPhone are low', () => {
    expect(pickTier(dev({ renderer: 'Adreno (TM) 730', width: 412, height: 915, dpr: 2.6 })).tier).toBe('low');
    expect(pickTier(dev({ renderer: 'Apple GPU', width: 390, height: 844, dpr: 3 })).tier).toBe('low');
  });
  it('Apple M is high, an Apple GPU on a big screen is medium', () => {
    expect(pickTier(dev({ renderer: 'ANGLE (Apple, Apple M2 Pro, OpenGL 4.1)' })).tier).toBe('high');
    expect(pickTier(dev({ renderer: 'Apple GPU', width: 1440, height: 900 })).tier).toBe('medium');
  });
  it('software GL is low', () => {
    expect(pickTier(dev({ renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)' })).tier).toBe('low');
    expect(pickTier(dev({ renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' })).tier).toBe('low');
  });
  it('caps: 2 cores or 2 GB is low, 4 cores at most medium, a small screen at most medium', () => {
    const gpu = 'NVIDIA GeForce GTX 1060';
    expect(pickTier(dev({ renderer: gpu, cores: 2 })).tier).toBe('low');
    expect(pickTier(dev({ renderer: gpu, memoryGb: 2 })).tier).toBe('low');
    expect(pickTier(dev({ renderer: gpu, cores: 4 })).tier).toBe('medium');
    expect(pickTier(dev({ renderer: gpu, width: 480, height: 800 })).tier).toBe('medium');
  });
  it('an unknown renderer is medium; hidden cores and memory cap nothing', () => {
    expect(pickTier(dev({ renderer: 'Mystery', cores: 0, memoryGb: 0 }))).toMatchObject({ tier: 'medium', reason: 'unknown GPU' });
  });
});

describe('TierWatch', () => {
  const run = (w: TierWatch, frameS: number, workMs: number, fps = 60, from = 5000) => {
    w.reset(0);
    let out: 'down' | 'up' | null = null;
    for (let t = from, i = 0; i < 600 && !out; i++, t += frameS * 1000) out = w.tick(frameS, workMs, t, fps);
    return out;
  };
  it('waits out the settle time', () => {
    const w = new TierWatch();
    w.reset(0);
    for (let t = 0; t < 4900; t += 50) expect(w.tick(0.05, 40, t, 60)).toBeNull();
  });
  it('steps down on slow frames', () => expect(run(new TierWatch(), 1 / 20, 45)).toBe('down'));
  it('steps up when the limit holds and the work is small', () => expect(run(new TierWatch(), 1 / 60, 3)).toBe('up'));
  it('does not step up when the work is heavy, and stops after one window', () => {
    const w = new TierWatch();
    expect(run(w, 1 / 60, 10)).toBeNull();
    expect(w.tick(1 / 20, 45, 20000, 60)).toBeNull();
  });
  it('makes one decision and then stops', () => {
    const w = new TierWatch();
    expect(run(w, 1 / 20, 45)).toBe('down');
    for (let t = 20000; t < 40000; t += 50) expect(w.tick(0.05, 45, t, 60)).toBeNull();
  });
  it('reads a 30 fps limit against the limit, not 60', () => expect(run(new TierWatch(), 1 / 30, 3, 30)).toBe('up'));

  it('ignores frames the away limit holds down', () => {
    const w = new AwayWatch(), w2 = new TierWatch();
    w2.reset(0);
    let out: 'down' | 'up' | null = null;
    // unfocused: the limit is 30 against the player's 60; 30 fps frames must not count
    for (let t = 5000, i = 0; i < 600; i++, t += 1000 / 30) {
      const limit = w.limit(60, t, false, false);
      if (!awayHeld(limit, 60)) out = w2.tick(1 / 30, 3, t, 60) ?? out;
    }
    expect(out).toBeNull();
  });
  it('awayHeld: only a limit under the player fps holds', () => {
    expect(awayHeld(30, 60)).toBe(true);
    expect(awayHeld(30, 0)).toBe(true);
    expect(awayHeld(60, 60)).toBe(false);
    expect(awayHeld(0, 0)).toBe(false);
    expect(awayHeld(24, 24)).toBe(false);
  });
});

describe('tier persistence', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    resetTierSteps();
    setAutoTier({ tier: 'high', reason: 'test' });
    store.clear();
  });
  const detect = (tier: Tier) => () => ({ tier, reason: 'test' });

  it('a first start applies the detected tier, in auto mode', () => {
    const s = resolveStart(null, null, '', detect('low'));
    expect(s.rec).toEqual({ mode: 'auto', tier: 'low', reason: 'test' });
    expect(s.g).toMatchObject({ ...PRESETS.low, scale: 0.75, shadows: 0, fps: 30 });
  });
  it('an old save with no tier record is manual and keeps the settings', () => {
    const s = resolveStart({ ...PRESETS.high, msaa: 8, fps: 120, v: 2 }, null, '', detect('low'));
    expect(s.rec.mode).toBe('manual');
    expect(s.g).toMatchObject({ msaa: 8, fps: 120 });
  });
  it('a step saves the tier and the next start begins there (round trip)', () => {
    expect(stepTier('down', 'high')).toBe(true);
    const saved = JSON.parse(store.get('pipeline-city.graphics')!), rec = JSON.parse(store.get('pipeline-city.graphics.tier')!);
    expect(parseTierRecord(rec)).toMatchObject({ mode: 'auto' });
    const next = resolveStart(saved, rec, '', detect('high'));
    expect(next.rec.tier).toBe(tierRecord.value.tier);
    expect(next.g).toEqual(graphics.value);
  });
  it('up is capped at the detected tier + 1, and only one step is made', () => {
    setAutoTier({ tier: 'low', reason: 'test' });
    expect(stepTier('up', 'low')).toBe(true); // detected low -> medium
    expect(tierRecord.value.tier).toBe('medium');
    expect(stepTier('up', 'low')).toBe(false);
    resetTierSteps();
    expect(stepTier('up', 'low')).toBe(false); // would be high: above detected + 1
  });
  it('a step down is remembered: after a reload auto does not step back up', () => {
    setAutoTier({ tier: 'low', reason: 'test' });
    expect(stepTier('up', 'low')).toBe(true); // low -> medium
    expect(stepTier('down', 'low')).toBe(false); // once per load
    resetTierSteps();
    expect(stepTier('down', 'low')).toBe(true); // medium -> low, the next load
    expect(tierRecord.value).toMatchObject({ tier: 'low', maxUp: 'low' });
    // reload
    const saved = JSON.parse(store.get('pipeline-city.graphics')!), rec = JSON.parse(store.get('pipeline-city.graphics.tier')!);
    const s = resolveStart(saved, rec, '', detect('low'));
    expect(s.rec.tier).toBe('low');
    tierRecord.value = s.rec; // the new load's state
    resetTierSteps();
    expect(stepTier('up', 'low')).toBe(false);
    expect(tierRecord.value.tier).toBe('low');
  });
  it('a record with maxUp below its tier starts at maxUp; an old record parses', () => {
    const s = resolveStart({ ...DEFAULTS, v: 2 }, { mode: 'auto', tier: 'high', reason: '', maxUp: 'medium' }, '', detect('high'));
    expect(s.rec.tier).toBe('medium');
    expect(parseTierRecord({ mode: 'auto', tier: 'low', reason: '' })).toEqual({ mode: 'auto', tier: 'low', reason: '' });
  });
  it('a manual choice always wins over an auto step', () => {
    setTier('high');
    expect(tierRecord.value.mode).toBe('manual');
    expect(stepTier('down', 'high')).toBe(false);
    expect(graphics.value).toEqual(tierGraphics('high', graphics.value));
    setAutoTier({ tier: 'high', reason: 'test' });
    setGraphic('msaa', 2);
    expect(tierRecord.value.mode).toBe('manual');
    setAutoTier({ tier: 'high', reason: 'test' });
    setPreset('low');
    expect(tierRecord.value.mode).toBe('manual');
    expect(stepTier('up', 'high')).toBe(false);
  });
  it('?tier= overrides for the session, is manual and is not stored', () => {
    const s = resolveStart({ ...DEFAULTS, v: 2 }, { mode: 'auto', tier: 'high', reason: '' }, '?tier=low', detect('high'));
    expect(s.rec).toMatchObject({ mode: 'manual', tier: 'low' });
    expect(s.g).toMatchObject({ scale: 0.75, shadows: 0, fps: 30 });
    expect(resolveStart(null, null, '?tier=bogus', detect('medium')).rec.tier).toBe('medium');
    expect(store.size).toBe(0);
  });
});

describe('presets', () => {
  it('the default is High with nothing else set', () => {
    expect(presetOf(DEFAULTS)).toBe('high');
    expect(DEFAULTS).toMatchObject({ fps: 60, brightness: 1, auto: false });
  });

  it('the lamp options are on offer and set by every preset', () => {
    expect(CHOICES.lights.map(([v]) => v)).toEqual([4, 8, 0]);
    expect(CHOICES.lightShadows.map(([v]) => v)).toEqual([0, 1]);
    expect(PRESETS.low).toMatchObject({ lights: 4, lightShadows: 0 });
    expect(PRESETS.medium).toMatchObject({ lights: 0, lightShadows: 0 });
    expect(PRESETS.high).toMatchObject({ lights: 0, lightShadows: 1 });
    expect(parseGraphics({ lights: 8, lightShadows: 5 })).toMatchObject({ lights: 8, lightShadows: 1 });
  });

  it('an old low or medium save with no lamp keys stays low or medium', () => {
    for (const id of ['low', 'medium'] as const) {
      const { lights: _l, lightShadows: _s, ...old } = PRESETS[id];
      const g = parseGraphics({ ...old, fps: 60, v: 2 });
      expect(presetOf(g)).toBe(id);
      expect(resolveStart({ ...old, fps: 60, v: 2 }, null, '', () => ({ tier: 'high', reason: '' })).rec.tier).toBe(id);
    }
  });

  it('every preset value is on offer, and no preset is cheaper than the one before', () => {
    const rank = (k: keyof typeof CHOICES, v: number) => CHOICES[k].findIndex(([x]) => x === v);
    const ids = PRESET_NAMES.map(([id]) => id);
    for (let i = 0; i < ids.length; i++) {
      const p = PRESETS[ids[i]!];
      for (const k of ['msaa', 'ao', 'bloom', 'shadows', 'textures', 'filtering', 'live', 'particles'] as const) {
        expect(rank(k, p[k])).toBeGreaterThanOrEqual(0);
        if (i) expect(p[k]).toBeGreaterThanOrEqual(PRESETS[ids[i - 1]!][k]);
      }
    }
  });

  it('a changed picture option is Custom, the frame limit and the brightness are not', () => {
    expect(presetOf({ ...DEFAULTS, shadows: 1 })).toBeNull();
    expect(presetOf({ ...DEFAULTS, fps: 30, brightness: 1.2, auto: false })).toBe('high');
    expect(presetOf({ ...DEFAULTS, ...PRESETS.low })).toBe('low');
  });
});

describe('stored settings', () => {
  it('fall back to the default on junk', () => {
    expect(parseGraphics(null)).toEqual(DEFAULTS);
    expect(parseGraphics('x')).toEqual(DEFAULTS);
    expect(parseGraphics({ msaa: 3, shadows: 'High', scale: NaN, auto: 1 })).toEqual(DEFAULTS);
  });

  it('keep what is good, and clamp the sliders', () => {
    const g = parseGraphics({ msaa: 8, scale: 9, brightness: 0.1, auto: false, fps: 60 });
    expect(g).toMatchObject({ msaa: 8, scale: 1.5, brightness: 0.7, auto: false, fps: 60, shadows: DEFAULTS.shadows });
  });
});

describe('auto-adjust', () => {
  it('walks the same three steps as before', () => {
    expect(lowered(DEFAULTS, 0)).toBe(DEFAULTS);
    expect(lowered(DEFAULTS, 1)).toEqual({ ...DEFAULTS, ao: 0 });
    expect(lowered(DEFAULTS, 2)).toEqual({ ...DEFAULTS, ao: 0, bloom: 0, msaa: 0, live: 0 });
    expect(lowered(DEFAULTS, 3)).toEqual({ ...DEFAULTS, ao: 0, bloom: 0, msaa: 0, live: 0, scale: 0.75 });
  });

  it('keeps the resolution until the effects are gone', () => {
    expect(lowered(DEFAULTS, 2).scale).toBe(DEFAULTS.scale);
  });

  it('never raises what the player set lower', () => {
    expect(lowered({ ...DEFAULTS, scale: 0.5 }, 3).scale).toBe(0.5);
  });

  it('skips the steps that change nothing', () => {
    expect(nextStep(DEFAULTS, 0)).toBe(1);
    expect(nextStep({ ...DEFAULTS, ao: 0 }, 0)).toBe(2);
    expect(nextStep({ ...DEFAULTS, ...PRESETS.low }, 0)).toBeNull();
    expect(nextStep(DEFAULTS, 3)).toBeNull();
  });
});

describe('the settings signal', () => {
  beforeEach(() => setTier('high'));

  it('a preset keeps the frame limit, the brightness and auto-adjust', () => {
    setGraphic('auto', true);
    setGraphic('fps', 120);
    setGraphic('brightness', 1.2);
    setPreset('low');
    expect(graphics.value).toMatchObject({ ...PRESETS.low, fps: 120, brightness: 1.2, auto: true });
  });

  it('any change hands the picture back to the player', () => {
    setGraphic('auto', true);
    autoStep.value = 3;
    expect(effective.value.scale).toBe(0.75);
    setGraphic('shadows', 2);
    expect(autoStep.value).toBe(0);
    expect(effective.value.scale).toBe(1);
  });

  it('auto-adjust off ignores the step', () => {
    setGraphic('auto', false);
    autoStep.value = 3;
    expect(effective.value).toEqual(graphics.value);
  });
});

describe('FrameGate', () => {
  /** Frames a limit lets through out of a second of a screen at `hz`. */
  const drawn = (hz: number, fps: number) => {
    const g = new FrameGate();
    let n = 0;
    for (let i = 0; i < hz; i++) if (g.ready((i * 1000) / hz, fps)) n++;
    return n;
  };

  it('no limit draws every frame', () => expect(drawn(144, 0)).toBe(144));
  it('a limit at the screen rate drops nothing', () => expect(drawn(60, 60)).toBe(60));
  it('a limit over the screen rate drops nothing', () => expect(drawn(60, 120)).toBe(60));
  it('holds the limit on a faster screen', () => {
    expect(drawn(144, 60)).toBeGreaterThanOrEqual(59);
    expect(drawn(144, 60)).toBeLessThanOrEqual(61);
    expect(drawn(240, 30)).toBeLessThanOrEqual(31);
  });
});

describe('AwayWatch', () => {
  it('keeps the limit while the player is there', () => {
    const w = new AwayWatch();
    w.input(1000);
    expect(w.limit(60, 20000, true, false)).toBe(60);
    expect(w.limit(0, 20000, true, false)).toBe(0);
  });

  it('holds to 30 after a while without input, until the next', () => {
    const w = new AwayWatch();
    w.input(1000);
    expect(w.limit(60, 40000, true, false)).toBe(30);
    expect(w.limit(0, 40000, true, false)).toBe(30);
    w.input(40000);
    expect(w.limit(60, 40001, true, false)).toBe(60);
  });

  it('holds to 30 without the focus, at once', () => {
    const w = new AwayWatch();
    w.input(1000);
    expect(w.limit(120, 1001, false, false)).toBe(30);
    expect(w.limit(120, 1001, false, true)).toBe(30);
  });

  it('does not hold while something moves', () => expect(new AwayWatch().limit(60, 99000, true, true)).toBe(60));
  it('never raises a lower limit', () => expect(new AwayWatch().limit(24, 99000, false, false)).toBe(24));
});

describe('SlowWatch', () => {
  it('ignores a few long hitches (shader compiles)', () => {
    const w = new SlowWatch();
    w.reset(0);
    for (let i = 0; i < 5; i++) expect(w.tick(1, 1e4 + i * 2000, 0)).toBe(false);
  });

  it('waits for the settling time, then for 2.5 s of slow frames', () => {
    const w = new SlowWatch();
    w.reset(0);
    expect(w.tick(0.1, 1000, 0)).toBe(false);
    let t = 5000, fired = 0;
    for (let i = 0; i < 26; i++) { t += 100; if (w.tick(0.1, t, 0)) fired++; }
    expect(fired).toBe(1);
  });

  it('good frames pay the slow ones back', () => {
    const w = new SlowWatch();
    for (let i = 0; i < 500; i++) expect(w.tick(i % 2 ? 0.04 : 0.02, 1e4 + i, 0)).toBe(false);
  });

  it('a loop held to 30 is not slow', () => {
    const w = new SlowWatch();
    for (let i = 0; i < 300; i++) expect(w.tick(1 / 30 + 0.001, 1e4 + i * 34, 30)).toBe(false);
  });
});
