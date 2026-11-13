import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autoStep, awayHeld, CHOICES, DEFAULTS, effective, FrameGate, graphics, LOW_CUTS, LOW_LIGHTS, lowered, loopLimit, nextStep, parseGraphics, parseTierRecord, pickTier, presetOf, PRESETS, PRESET_NAMES, resetTierSteps,
  isLow, loadStart, resolveStart, setAutoTier, setGraphic, setPreset, setTier, SlowWatch, stepTier, tierGraphics, TierWatch, tierRecord, type DeviceInfo, type Graphics, type Tier, watchFps,
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
    const w2 = new TierWatch();
    w2.reset(0);
    let out: 'down' | 'up' | null = null;
    // unfocused: the limit is 30 against the player's 60; 30 fps frames must not count
    for (let t = 5000, i = 0; i < 600; i++, t += 1000 / 30) {
      const limit = loopLimit(60, false);
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
    expect(s.g).toMatchObject({ ...PRESETS.low, scale: 0.75, shadows: 0, lights: 2, fps: 60 });
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
  describe('maxUp expires', () => {
    const DAY = 24 * 3600 * 1000, T0 = 1_000_000_000_000;
    const rec = (o: object = {}) => ({ mode: 'auto', tier: 'high', reason: '', maxUp: 'low', maxUpAt: T0, maxUpFp: 'gpu|1920x1080', ...o });
    const run = (r: object, now: number, fp = 'gpu|1920x1080') => resolveStart({ ...DEFAULTS, v: 2 }, r, '', detect('high'), { now, fp: () => fp }).rec;
    it('is kept inside 3 days on the same device', () => {
      expect(run(rec(), T0 + 2 * DAY)).toMatchObject({ tier: 'low', maxUp: 'low', maxUpAt: T0 });
    });
    it('expires after 3 days', () => {
      const r = run(rec(), T0 + 3 * DAY + 1);
      expect(r.maxUp).toBeUndefined();
      expect(r.tier).toBe('high');
    });
    it('is cleared on a new GPU name', () => {
      expect(run(rec(), T0 + DAY, 'other gpu|1920x1080').maxUp).toBeUndefined();
    });
    it('is cleared on a new screen size', () => {
      expect(run(rec(), T0 + DAY, 'gpu|2560x1440').maxUp).toBeUndefined();
    });
    it('an old record with no date is kept and dated now', () => {
      expect(run({ mode: 'auto', tier: 'high', reason: '', maxUp: 'low' }, T0 + 9 * DAY)).toMatchObject({ tier: 'low', maxUp: 'low', maxUpAt: T0 + 9 * DAY, maxUpFp: 'gpu|1920x1080' });
    });
  });
  describe('an undated maxUp is saved once', () => {
    const DAY = 24 * 3600 * 1000, T0 = 1_000_000_000_000, TK = 'pipeline-city.graphics.tier';
    it('is dated at the first load and expires on a later one', () => {
      const m = new Map<string, string>([
        ['pipeline-city.graphics', JSON.stringify({ ...DEFAULTS, v: 2 })],
        [TK, JSON.stringify({ mode: 'auto', tier: 'high', reason: '', maxUp: 'low' })],
      ]);
      const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
      const env = (now: number) => ({ now, fp: () => 'gpu|1920x1080' });
      loadStart(store, '', detect('high'), env(T0));
      expect(JSON.parse(m.get(TK)!)).toMatchObject({ maxUp: 'low', maxUpAt: T0, maxUpFp: 'gpu|1920x1080' });
      const later = loadStart(store, '', detect('high'), env(T0 + 4 * DAY));
      expect(later.rec.maxUp).toBeUndefined();
    });
  });
  describe('the save adds only the date and device', () => {
    it('keeps the stored tier', () => {
      const m = new Map<string, string>([
        ['pipeline-city.graphics', JSON.stringify({ ...DEFAULTS, v: 2 })],
        ['pipeline-city.graphics.tier', JSON.stringify({ mode: 'auto', tier: 'high', reason: '', maxUp: 'medium' })],
      ]);
      const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
      loadStart(store, '', detect('high'), { now: 5, fp: () => 'f' });
      expect(JSON.parse(m.get('pipeline-city.graphics.tier')!)).toEqual({ mode: 'auto', tier: 'high', reason: '', maxUp: 'medium', maxUpAt: 5, maxUpFp: 'f' });
    });
  });
  describe('the touch default from before tiers', () => {
    const old = { ...PRESETS.low, scale: 0.75, shadows: 0, fps: 30, brightness: 1, auto: true, v: 1 } as Record<string, unknown>;
    delete old.lights; delete old.lightShadows;
    it('reads as Low, auto, with 4 lamps', () => {
      const s = resolveStart(old, null, '', detect('high'));
      expect(s.rec).toMatchObject({ mode: 'auto', tier: 'low' });
      expect(s.g).toMatchObject({ lights: 2, lightShadows: 0, scale: 0.75, shadows: 0, fps: 60 });
    });
    it('a save that differs in any key stays manual', () => {
      for (const [k, v] of [['scale', 0.8], ['shadows', 1], ['fps', 60], ['msaa', 2], ['particles', 1], ['brightness', 1.1]] as const) {
        const s = resolveStart({ ...old, [k]: v }, null, '', detect('low'));
        expect(s.rec.mode, k).toBe('manual');
        expect(s.g.lights, k).toBe(0);
      }
    });
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
    expect(s.g).toMatchObject({ scale: 0.75, shadows: 0, fps: 60 });
    expect(resolveStart(null, null, '?tier=bogus', detect('medium')).rec.tier).toBe('medium');
    expect(store.size).toBe(0);
  });
  describe('Low lights two lights (save v3)', () => {
    const lowRec = { mode: 'manual', tier: 'low', reason: 'chosen' };
    it('tierGraphics: Low has 2 lights, the other tiers keep their preset', () => {
      expect(tierGraphics('low', DEFAULTS).lights).toBe(2);
      for (const t of ['medium', 'high'] as const) expect(tierGraphics(t, DEFAULTS)).toEqual({ ...DEFAULTS, ...PRESETS[t], fps: 60 });
    });
    it('an old Low save with the preset lights moves to 2', () => {
      expect(resolveStart({ ...PRESETS.low, fps: 30, v: 2 }, lowRec, '', detect('high')).g.lights).toBe(2);
    });
    it('a v3 Low save, or other lights, keep theirs', () => {
      expect(resolveStart({ ...PRESETS.low, v: 3 }, lowRec, '', detect('high')).g.lights).toBe(PRESETS.low.lights);
      expect(resolveStart({ ...PRESETS.low, lights: 8, v: 2 }, lowRec, '', detect('high')).g.lights).toBe(8);
      expect(resolveStart({ ...PRESETS.high, v: 2 }, null, '', detect('high')).g.lights).toBe(PRESETS.high.lights);
    });
  });
  describe('the Low frame limit moves from 30 to 60 (save v3)', () => {
    const lowRec = { mode: 'manual', tier: 'low', reason: 'chosen' };
    it('a manual Low v2 save at 30 fps starts at 60', () => {
      const s = resolveStart({ ...PRESETS.low, fps: 30, brightness: 1, auto: false, v: 2 }, lowRec, '', detect('high'));
      expect(s.rec.mode).toBe('manual');
      expect(s.g).toMatchObject({ ...PRESETS.low, lights: 2, fps: 60 });
    });
    it('a Low v2 save at 30 fps with no tier record starts at 60', () => {
      const s = resolveStart({ ...PRESETS.low, fps: 30, v: 2 }, null, '', detect('high'));
      expect(s.rec.mode).toBe('manual');
      expect(s.g.fps).toBe(60);
    });
    it('a v3 Low save at 30 fps stays at 30', () => {
      const s = resolveStart({ ...PRESETS.low, fps: 30, v: 3 }, lowRec, '', detect('high'));
      expect(s.g.fps).toBe(30);
    });
    it('a v2 High save at 30 fps stays at 30', () => {
      const s = resolveStart({ ...PRESETS.high, fps: 30, v: 2 }, null, '', detect('high'));
      expect(s.g.fps).toBe(30);
    });
    it('a v2 save keeps its auto flag', () => {
      const s = resolveStart({ ...PRESETS.high, fps: 60, auto: true, v: 2 }, { mode: 'manual', tier: 'high', reason: 'chosen' }, '', detect('high'));
      expect(s.g.auto).toBe(true);
    });
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

describe('the frame limit', () => {
  // frames a 120 Hz screen lets draw in `s` seconds under the limit at each frame (the frame loop: `loopLimit`, then `FrameGate`)
  const drawnIn = (s: number, limitAt: (t: number) => number) => {
    const g = new FrameGate();
    let n = 0;
    for (let i = 0; i < 120 * s; i++) { const t = (i * 1000) / 120; if (g.ready(t, limitAt(t))) n++; }
    return n;
  };

  it('Low runs at 60, not held to 30', () => {
    setTier('low');
    expect(graphics.value.fps).toBe(60);
    expect(drawnIn(1, () => loopLimit(graphics.value.fps, true))).toBeGreaterThanOrEqual(59);
    setTier('high');
  });

  it('keeps the full rate with the page focused, at any time without input', () => {
    expect(loopLimit(60, true)).toBe(60);
    expect(loopLimit(0, true)).toBe(0);
  });

  it('draws the full rate over 40 s and more with the page focused', () => {
    // no input at all: the limit does not depend on how long the player has been idle
    expect(drawnIn(40, () => loopLimit(60, true))).toBeGreaterThanOrEqual(60 * 40 - 2);
  });

  it('holds to 30 without the focus, at once', () => {
    expect(loopLimit(120, false)).toBe(30);
    expect(loopLimit(60, false)).toBe(30);
    expect(loopLimit(0, false)).toBe(30);
  });

  it('never raises a lower limit', () => expect(loopLimit(24, false)).toBe(24));
});

describe('the watches at the Low limit', () => {
  const lowSave: Graphics = { ...DEFAULTS, ...PRESETS.low, fps: 60 }; // a Low save at 60 fps
  const lowTier = tierGraphics('low', DEFAULTS); // the phone's Low tier: its scale and shadows differ from the preset
  /** Did `SlowWatch` ask for a step down in `secs` of steady `fps` frames, judged as board3d judges them? */
  const slowSteps = (fps: number, limit: number, g: Graphics, secs: number) => {
    const w = new SlowWatch();
    w.reset(0);
    let fired = 0;
    for (let t = 5000, i = 0; t < 5000 + secs * 1000; i++, t += 1000 / fps) if (w.tick(1 / fps, t, watchFps(g, limit))) fired++;
    return fired;
  };
  /** The one decision `TierWatch` makes from steady frames, judged as board3d judges them. */
  const tierDecision = (fps: number, workMs: number, limit: number, g: Graphics) => {
    const w = new TierWatch();
    w.reset(0);
    let out: 'down' | 'up' | null = null;
    for (let t = 5000, i = 0; i < 600 && !out; i++, t += 1000 / fps) out = w.tick(1 / fps, workMs, t, watchFps(g, limit));
    return out;
  };

  it('a Low save at 60 fps does not step down at a steady 27 fps', () => {
    expect(slowSteps(27, 60, lowSave, 10)).toBe(0);
    expect(slowSteps(27, 60, lowTier, 10)).toBe(0);
  });
  it('a Low save at 60 fps steps down at a steady 22 fps', () => {
    expect(slowSteps(22, 60, lowSave, 10)).toBeGreaterThan(0);
    expect(slowSteps(22, 60, lowTier, 10)).toBeGreaterThan(0);
  });
  it('a Low tier at 60 fps steps up at a steady 28 fps with light work', () => {
    expect(tierDecision(28, 5, 60, lowTier)).toBe('up');
    expect(tierDecision(28, 5, 60, lowSave)).toBe('up');
  });
  it('Medium and High at 60 fps keep their thresholds: a steady 27 fps steps down', () => {
    expect(slowSteps(27, 60, { ...DEFAULTS, ...PRESETS.medium }, 10)).toBeGreaterThan(0);
    expect(slowSteps(27, 60, DEFAULTS, 10)).toBeGreaterThan(0);
  });
});

describe('LOW_CUTS: the bench toggles', () => {
  it('lamps off: Low keeps the preset\'s lamps', () => {
    LOW_CUTS.lamps = false;
    try { expect(tierGraphics('low', DEFAULTS).lights).toBe(PRESETS.low.lights); } finally { LOW_CUTS.lamps = true; }
    expect(tierGraphics('low', DEFAULTS).lights).toBe(LOW_LIGHTS);
  });
});

describe('isLow: Low alone takes the cheap materials, probe and shadows', () => {
  it('a Low tier and a migrated old Low save are Low', () => {
    expect(isLow(tierGraphics('low', DEFAULTS))).toBe(true);
    const old = resolveStart({ ...PRESETS.low, fps: 30, v: 2 }, { mode: 'manual', tier: 'low', reason: 'chosen' }, '', () => ({ tier: 'high', reason: '' }));
    expect(isLow(old.g)).toBe(true);
  });
  it('Medium, High and the defaults are not Low', () => {
    for (const t of ['medium', 'high'] as const) expect(isLow(tierGraphics(t, DEFAULTS)), t).toBe(false);
    expect(isLow(DEFAULTS)).toBe(false);
  });
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
