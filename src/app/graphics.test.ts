import { assert, beforeEach, describe, expect, it, vi } from 'vitest';
import * as graphicsTier from './graphics';

const dev = (o: Partial<graphicsTier.DeviceInfo>): graphicsTier.DeviceInfo => ({
  renderer: '',
  cores: 8,
  memoryGb: 8,
  width: 1920,
  height: 1080,
  dpr: 1,
  ...o,
});

describe('pickTier', () => {
  it('RTX 5080 4K desktop is high', () => {
    expect(
      graphicsTier.pickTier(
        dev({
          renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11 vs_5_0 ps_5_0)',
          cores: 24,
          width: 3840,
          height: 2160,
          dpr: 1.5,
        }),
      ).tier,
    ).toBe('high');
  });
  it('Intel UHD laptop is medium', () => {
    expect(
      graphicsTier.pickTier(dev({ renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620)', cores: 8 })),
    ).toMatchObject({
      tier: 'medium',
      reason: 'integrated GPU',
    });
  });
  it('Adreno phone and iPhone are low', () => {
    expect(graphicsTier.pickTier(dev({ renderer: 'Adreno (TM) 730', width: 412, height: 915, dpr: 2.6 })).tier).toBe(
      'low',
    );
    expect(graphicsTier.pickTier(dev({ renderer: 'Apple GPU', width: 390, height: 844, dpr: 3 })).tier).toBe('low');
  });
  it('Apple M is high, an Apple GPU on a big screen is medium', () => {
    expect(graphicsTier.pickTier(dev({ renderer: 'ANGLE (Apple, Apple M2 Pro, OpenGL 4.1)' })).tier).toBe('high');
    expect(graphicsTier.pickTier(dev({ renderer: 'Apple GPU', width: 1440, height: 900 })).tier).toBe('medium');
  });
  it('software GL is low', () => {
    expect(
      graphicsTier.pickTier(dev({ renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)' }))
        .tier,
    ).toBe('low');
    expect(graphicsTier.pickTier(dev({ renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' })).tier).toBe('low');
  });
  it('caps: 2 cores or 2 GB is low, 4 cores at most medium, a small screen at most medium', () => {
    const gpu = 'NVIDIA GeForce GTX 1060';
    expect(graphicsTier.pickTier(dev({ renderer: gpu, cores: 2 })).tier).toBe('low');
    expect(graphicsTier.pickTier(dev({ renderer: gpu, memoryGb: 2 })).tier).toBe('low');
    expect(graphicsTier.pickTier(dev({ renderer: gpu, cores: 4 })).tier).toBe('medium');
    expect(graphicsTier.pickTier(dev({ renderer: gpu, width: 480, height: 800 })).tier).toBe('medium');
  });
  it('an unknown renderer is medium; hidden cores and memory cap nothing', () => {
    expect(graphicsTier.pickTier(dev({ renderer: 'Mystery', cores: 0, memoryGb: 0 }))).toMatchObject({
      tier: 'medium',
      reason: 'unknown GPU',
    });
  });
});

describe('TierWatch', () => {
  const run = (w: graphicsTier.TierWatch, frameS: number, workMs: number, fps = 60, from = 5000) => {
    w.reset(0);
    let out: 'down' | 'up' | null = null;
    for (let t = from, i = 0; i < 600 && !out; i++, t += frameS * 1000) {
      out = w.tick(frameS, workMs, t, fps);
    }
    return out;
  };
  it('waits out the settle time', () => {
    const w = new graphicsTier.TierWatch();
    w.reset(0);
    for (let t = 0; t < 4900; t += 50) {
      expect(w.tick(0.05, 40, t, 60)).toBeNull();
    }
  });
  it('steps down on slow frames', () => {
    expect(run(new graphicsTier.TierWatch(), 1 / 20, 45)).toBe('down');
  });
  it('steps up when the limit holds and the work is small', () => {
    expect(run(new graphicsTier.TierWatch(), 1 / 60, 3)).toBe('up');
  });
  it('does not step up when the work is heavy, and stops after one window', () => {
    const w = new graphicsTier.TierWatch();
    expect(run(w, 1 / 60, 10)).toBeNull();
    expect(w.tick(0.05, 45, 20_000, 60)).toBeNull();
  });
  it('makes one decision and then stops', () => {
    const w = new graphicsTier.TierWatch();
    expect(run(w, 1 / 20, 45)).toBe('down');
    for (let t = 20_000; t < 40_000; t += 50) {
      expect(w.tick(0.05, 45, t, 60)).toBeNull();
    }
  });
  it('reads a 30 fps limit against the limit, not 60', () => {
    expect(run(new graphicsTier.TierWatch(), 1 / 30, 3, 30)).toBe('up');
  });

  /** Replay of drawn frames `gapMs` apart on the clock, each with its own `rawDtMs`. Idle ticks between them take their time in the gap. First decision. */
  const replay = (gapMs: number, rawDtMs: number, workMs: number, fps = 60) => {
    const w = new graphicsTier.TierWatch();
    w.reset(0);
    let out: 'down' | 'up' | null = null;
    for (let t = 5000, i = 0; i < 2000 && !out; i++, t += gapMs) {
      out = w.tick(rawDtMs / 1000, workMs, t, fps);
    }
    return out;
  };
  // (a) 16 ms drawn frames 100 ms apart (84 ms idle between): a device that is not slow, on a screen that draws little. Neither up nor down.
  it('16 ms drawn frames with 84 ms idle between are neither up nor down', () => {
    expect(replay(100, 16, 3)).toBeNull();
  });
  // (new) a fast device on a screen that draws only on change (the title, about every 45 ms, each frame 8 ms): no tier decision. Fails on dbb6cb1 (down).
  it('drawn frames 45 ms apart, 8 ms each, light work: no decision', () => {
    expect(replay(45, 8, 3)).toBeNull();
  });
  // (b) steady 60 fps drawn frames stay up
  it('steady 60 fps drawn frames with light work are up', () => {
    expect(replay(1000 / 60, 1000 / 60, 3)).toBe('up');
  });
  // (c) 200 ms frames are never fast
  it('200 ms frames are not up', () => {
    expect(replay(200, 200, 3)).not.toBe('up');
  });
  it('a real slow frame still steps down when idle ticks sit between them', () => {
    expect(replay(100, 50, 40)).toBe('down');
  });

  it('ignores frames the away limit holds down', () => {
    const w2 = new graphicsTier.TierWatch();
    w2.reset(0);
    let out: 'down' | 'up' | null = null;
    // unfocused: the limit is 30 against the player's 60; 30 fps frames must not count
    for (let t = 5000, i = 0; i < 600; i++, t += 1000 / 30) {
      const limit = graphicsTier.loopLimit(60, false);
      if (!graphicsTier.awayHeld(limit, 60)) {
        out = w2.tick(1 / 30, 3, t, 60) ?? out;
      }
    }
    expect(out).toBeNull();
  });
  it('awayHeld: only a limit under the player fps holds', () => {
    expect(graphicsTier.awayHeld(30, 60)).toBe(true);
    expect(graphicsTier.awayHeld(30, 0)).toBe(true);
    expect(graphicsTier.awayHeld(60, 60)).toBe(false);
    expect(graphicsTier.awayHeld(0, 0)).toBe(false);
    expect(graphicsTier.awayHeld(24, 24)).toBe(false);
  });
});

describe('tier persistence', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    graphicsTier.resetTierSteps();
    graphicsTier.setAutoTier({ tier: 'high', reason: 'test' });
    store.clear();
  });
  const detect = (tier: graphicsTier.Tier) => () => ({ tier, reason: 'test' });

  it('a first start applies the detected tier, in auto mode', () => {
    const s = graphicsTier.resolveStart(null, null, '', detect('low'));
    expect(s.rec).toStrictEqual({ mode: 'auto', tier: 'low', reason: 'test' });
    expect(s.g).toMatchObject({ ...graphicsTier.PRESETS.low, scale: 0.75, shadows: 0, fps: 60 });
  });
  it('an old save with no tier record is manual and keeps the settings', () => {
    const s = graphicsTier.resolveStart(
      { ...graphicsTier.PRESETS.high, msaa: 8, fps: 120, v: 2 },
      null,
      '',
      detect('low'),
    );
    expect(s.rec.mode).toBe('manual');
    expect(s.g).toMatchObject({ msaa: 8, fps: 120 });
  });
  it('a step saves the tier and the next start begins there (round trip)', () => {
    expect(graphicsTier.stepTier('down', 'high')).toBe(true);
    const savedText = store.get('pipeline-city.graphics');
    assert.exists(savedText);
    const recText = store.get('pipeline-city.graphics.tier');
    assert.exists(recText);
    const saved = JSON.parse(savedText),
      rec = JSON.parse(recText);
    expect(graphicsTier.parseTierRecord(rec)).toMatchObject({ mode: 'auto' });
    const next = graphicsTier.resolveStart(saved, rec, '', detect('high'));
    expect(next.rec.tier).toBe(graphicsTier.tierRecord.value.tier);
    expect(next.g).toStrictEqual(graphicsTier.graphics.value);
  });
  it('up is capped at the detected tier + 1, and only one step is made', () => {
    graphicsTier.setAutoTier({ tier: 'low', reason: 'test' });
    expect(graphicsTier.stepTier('up', 'low')).toBe(true); // detected low -> medium
    expect(graphicsTier.tierRecord.value.tier).toBe('medium');
    expect(graphicsTier.stepTier('up', 'low')).toBe(false);
    graphicsTier.resetTierSteps();
    expect(graphicsTier.stepTier('up', 'low')).toBe(false); // would be high: above detected + 1
  });
  it('a step down is remembered: after a reload auto does not step back up', () => {
    graphicsTier.setAutoTier({ tier: 'low', reason: 'test' });
    expect(graphicsTier.stepTier('up', 'low')).toBe(true); // low -> medium
    expect(graphicsTier.stepTier('down', 'low')).toBe(false); // once per load
    graphicsTier.resetTierSteps();
    expect(graphicsTier.stepTier('down', 'low')).toBe(true); // medium -> low, the next load
    expect(graphicsTier.tierRecord.value).toMatchObject({ tier: 'low', maxUp: 'low' });
    // reload
    const savedText = store.get('pipeline-city.graphics');
    assert.exists(savedText);
    const recText = store.get('pipeline-city.graphics.tier');
    assert.exists(recText);
    const saved = JSON.parse(savedText),
      rec = JSON.parse(recText);
    const s = graphicsTier.resolveStart(saved, rec, '', detect('low'));
    expect(s.rec.tier).toBe('low');
    graphicsTier.tierRecord.value = s.rec; // the new load's state
    graphicsTier.resetTierSteps();
    expect(graphicsTier.stepTier('up', 'low')).toBe(false);
    expect(graphicsTier.tierRecord.value.tier).toBe('low');
  });
  it('a record with maxUp below its tier starts at maxUp; an old record parses', () => {
    const s = graphicsTier.resolveStart(
      { ...graphicsTier.DEFAULTS, v: 2 },
      { mode: 'auto', tier: 'high', reason: '', maxUp: 'medium' },
      '',
      detect('high'),
    );
    expect(s.rec.tier).toBe('medium');
    expect(graphicsTier.parseTierRecord({ mode: 'auto', tier: 'low', reason: '' })).toStrictEqual({
      mode: 'auto',
      tier: 'low',
      reason: '',
    });
  });
  describe('maxUp expires', () => {
    const DAY = 24 * 3600 * 1000,
      T0 = 1_000_000_000_000;
    const rec = (o: object = {}) => ({
      mode: 'auto',
      tier: 'high',
      reason: '',
      maxUp: 'low',
      maxUpAt: T0,
      maxUpFp: 'gpu|1920x1080',
      ...o,
    });
    const run = (r: object, now: number, fp = 'gpu|1920x1080') =>
      graphicsTier.resolveStart({ ...graphicsTier.DEFAULTS, v: 2 }, r, '', detect('high'), { now, fp: () => fp }).rec;
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
      expect(run({ mode: 'auto', tier: 'high', reason: '', maxUp: 'low' }, T0 + 9 * DAY)).toMatchObject({
        tier: 'low',
        maxUp: 'low',
        maxUpAt: T0 + 9 * DAY,
        maxUpFp: 'gpu|1920x1080',
      });
    });
  });
  describe('an undated maxUp is saved once', () => {
    const DAY = 24 * 3600 * 1000,
      T0 = 1_000_000_000_000,
      TK = 'pipeline-city.graphics.tier';
    it('is dated at the first load and expires on a later one', () => {
      const m = new Map<string, string>([
        ['pipeline-city.graphics', JSON.stringify({ ...graphicsTier.DEFAULTS, v: 2 })],
        [TK, JSON.stringify({ mode: 'auto', tier: 'high', reason: '', maxUp: 'low' })],
      ]);
      const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
      const env = (now: number) => ({ now, fp: () => 'gpu|1920x1080' });
      graphicsTier.loadStart(store, '', detect('high'), env(T0));
      const mValue = m.get(TK);
      assert.exists(mValue);
      expect(JSON.parse(mValue)).toMatchObject({ maxUp: 'low', maxUpAt: T0, maxUpFp: 'gpu|1920x1080' });
      const later = graphicsTier.loadStart(store, '', detect('high'), env(T0 + 4 * DAY));
      expect(later.rec.maxUp).toBeUndefined();
    });
  });
  describe('the save adds only the date and device', () => {
    it('keeps the stored tier', () => {
      const m = new Map<string, string>([
        ['pipeline-city.graphics', JSON.stringify({ ...graphicsTier.DEFAULTS, v: 2 })],
        ['pipeline-city.graphics.tier', JSON.stringify({ mode: 'auto', tier: 'high', reason: '', maxUp: 'medium' })],
      ]);
      const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
      graphicsTier.loadStart(store, '', detect('high'), { now: 5, fp: () => 'f' });
      const tierValue = m.get('pipeline-city.graphics.tier');
      assert.exists(tierValue);
      expect(JSON.parse(tierValue)).toStrictEqual({
        mode: 'auto',
        tier: 'high',
        reason: '',
        maxUp: 'medium',
        maxUpAt: 5,
        maxUpFp: 'f',
      });
    });
  });
  describe('the Low picture moves from 0.6 / shadows 1 to 0.75 / shadows 0 (save v4)', () => {
    // the full old Low, hard-coded: PRESETS.low no longer holds it
    const OLD_LOW = {
      scale: 0.6,
      msaa: 0,
      ao: 0,
      bloom: 0,
      shadows: 1,
      lights: 4,
      lightShadows: 0,
      textures: 0,
      filtering: 2,
      live: 0,
      particles: 0,
    };
    const lowRec = { mode: 'manual', tier: 'low', reason: 'chosen' };
    const high = () => ({ tier: 'high' as const, reason: '' });
    it('a v3 save at the old Low parses to the new Low, which is Low', () => {
      const s = graphicsTier.resolveStart({ ...OLD_LOW, fps: 60, brightness: 1, auto: false, v: 3 }, lowRec, '', high);
      expect(s.g).toMatchObject({ scale: 0.75, shadows: 0, fps: 60, lights: 4 });
      expect(graphicsTier.presetOf(s.g)).toBe('low');
    });
    it('a v2 old Low at 30 fps moves to the new Low and to 60 fps', () => {
      const s = graphicsTier.resolveStart({ ...OLD_LOW, fps: 30, v: 2 }, null, '', high);
      expect(s.rec.mode).toBe('manual');
      expect(s.g).toMatchObject({ scale: 0.75, shadows: 0, fps: 60 });
      expect(graphicsTier.presetOf(s.g)).toBe('low');
    });
    it('a v2 old Low with no lamp keys moves to the new Low, lamps included', () => {
      const { lights: _l, lightShadows: _s, ...noLamps } = OLD_LOW;
      const s = graphicsTier.resolveStart({ ...noLamps, fps: 60, v: 2 }, null, '', high);
      expect(s.g).toMatchObject({ scale: 0.75, shadows: 0, lights: 4, lightShadows: 0 });
      expect(graphicsTier.presetOf(s.g)).toBe('low');
    });
    it("a v4 Custom at 0.6 / shadows 1 stays the player's", () => {
      const s = graphicsTier.resolveStart({ ...OLD_LOW, fps: 60, v: 4 }, lowRec, '', high);
      expect(s.g).toMatchObject({ scale: 0.6, shadows: 1 });
      expect(graphicsTier.presetOf(s.g)).toBeNull();
    });
    it("a v3 save at 0.6 with another shadow level stays the player's", () => {
      const s = graphicsTier.resolveStart({ ...OLD_LOW, shadows: 2, fps: 60, v: 3 }, lowRec, '', high);
      expect(s.g).toMatchObject({ scale: 0.6, shadows: 2 });
    });
  });
  describe('the touch default from before tiers', () => {
    const old = {
      ...graphicsTier.PRESETS.low,
      scale: 0.75,
      shadows: 0,
      fps: 30,
      brightness: 1,
      auto: true,
      v: 1,
    } as Record<string, unknown>;
    delete old['lights'];
    delete old['lightShadows'];
    it('reads as Low, auto, with 4 lamps', () => {
      const s = graphicsTier.resolveStart(old, null, '', detect('high'));
      expect(s.rec).toMatchObject({ mode: 'auto', tier: 'low' });
      expect(s.g).toMatchObject({ lights: 4, lightShadows: 0, scale: 0.75, shadows: 0, fps: 60 });
    });
    it('a save that differs in any key stays manual', () => {
      // a picture key off the touch default makes it Custom: no lamps. fps and brightness are not picture keys, so the save keeps Low's 4 lamps
      for (const [k, v] of [
        ['scale', 0.8],
        ['shadows', 1],
        ['msaa', 2],
        ['particles', 1],
        ['fps', 60],
        ['brightness', 1.1],
      ] as const) {
        const s = graphicsTier.resolveStart({ ...old, [k]: v }, null, '', detect('low'));
        expect(s.rec.mode, k).toBe('manual');
        expect(s.g.lights, k).toBe(['fps', 'brightness'].includes(k) ? 4 : 0);
      }
    });
  });
  it('a bench start (stored preset, no tier record, or ?tier) is manual: no auto step can change it', () => {
    const stored = { ...graphicsTier.PRESETS.high, fps: 0, brightness: 1, auto: false, v: 2 };
    for (const [saved, search] of [
      [stored, ''],
      [{ ...stored, ...graphicsTier.PRESETS.low }, ''],
      [null, '?tier=low'],
      [stored, '?tier=high'],
    ] as const) {
      const s = graphicsTier.resolveStart(saved, null, search, detect('high'));
      expect(s.rec.mode).toBe('manual');
    }
    graphicsTier.setTier('low');
    expect(graphicsTier.stepTier('down', 'high')).toBe(false);
    expect(graphicsTier.stepTier('up', 'low')).toBe(false);
    expect(graphicsTier.tierRecord.value.tier).toBe('low');
  });
  it('setTier("low") on a High page makes the effective graphics Low (so every Low cut applies); setTier("high") takes them off', () => {
    graphicsTier.setPreset('high');
    expect(graphicsTier.isLow(graphicsTier.effective.value)).toBe(false);
    graphicsTier.setTier('low'); // what bench-modes `--tier low` does in each page, whatever preset the page started with
    expect(graphicsTier.isLow(graphicsTier.effective.value)).toBe(true);
    graphicsTier.setTier('high');
    expect(graphicsTier.isLow(graphicsTier.effective.value)).toBe(false);
    graphicsTier.setPreset('medium');
    expect(graphicsTier.isLow(graphicsTier.effective.value)).toBe(false);
  });
  it('a manual choice always wins over an auto step', () => {
    graphicsTier.setTier('high');
    expect(graphicsTier.tierRecord.value.mode).toBe('manual');
    expect(graphicsTier.stepTier('down', 'high')).toBe(false);
    expect(graphicsTier.graphics.value).toStrictEqual(graphicsTier.tierGraphics('high', graphicsTier.graphics.value));
    graphicsTier.setAutoTier({ tier: 'high', reason: 'test' });
    graphicsTier.setGraphic('msaa', 2);
    expect(graphicsTier.tierRecord.value.mode).toBe('manual');
    graphicsTier.setAutoTier({ tier: 'high', reason: 'test' });
    graphicsTier.setPreset('low');
    expect(graphicsTier.tierRecord.value.mode).toBe('manual');
    expect(graphicsTier.stepTier('up', 'high')).toBe(false);
  });
  it('?tier= overrides for the session, is manual and is not stored', () => {
    const s = graphicsTier.resolveStart(
      { ...graphicsTier.DEFAULTS, v: 2 },
      { mode: 'auto', tier: 'high', reason: '' },
      '?tier=low',
      detect('high'),
    );
    expect(s.rec).toMatchObject({ mode: 'manual', tier: 'low' });
    expect(s.g).toMatchObject({ scale: 0.75, shadows: 0, fps: 60 });
    expect(graphicsTier.resolveStart(null, null, '?tier=bogus', detect('medium')).rec.tier).toBe('medium');
    expect(store.size).toBe(0);
  });
  describe('the Low frame limit moves from 30 to 60 (save v3)', () => {
    const lowRec = { mode: 'manual', tier: 'low', reason: 'chosen' };
    it('a manual Low v2 save at 30 fps starts at 60', () => {
      const s = graphicsTier.resolveStart(
        { ...graphicsTier.PRESETS.low, fps: 30, brightness: 1, auto: false, v: 2 },
        lowRec,
        '',
        detect('high'),
      );
      expect(s.rec.mode).toBe('manual');
      expect(s.g).toMatchObject({ ...graphicsTier.PRESETS.low, fps: 60 });
    });
    it('a Low v2 save at 30 fps with no tier record starts at 60', () => {
      const s = graphicsTier.resolveStart({ ...graphicsTier.PRESETS.low, fps: 30, v: 2 }, null, '', detect('high'));
      expect(s.rec.mode).toBe('manual');
      expect(s.g.fps).toBe(60);
    });
    it('a v3 Low save at 30 fps stays at 30', () => {
      const s = graphicsTier.resolveStart({ ...graphicsTier.PRESETS.low, fps: 30, v: 3 }, lowRec, '', detect('high'));
      expect(s.g.fps).toBe(30);
    });
    it('a v2 High save at 30 fps stays at 30', () => {
      const s = graphicsTier.resolveStart({ ...graphicsTier.PRESETS.high, fps: 30, v: 2 }, null, '', detect('high'));
      expect(s.g.fps).toBe(30);
    });
    it('a v2 save keeps its auto flag', () => {
      const s = graphicsTier.resolveStart(
        { ...graphicsTier.PRESETS.high, fps: 60, auto: true, v: 2 },
        { mode: 'manual', tier: 'high', reason: 'chosen' },
        '',
        detect('high'),
      );
      expect(s.g.auto).toBe(true);
    });
  });
});

describe('presets', () => {
  it('the default is High with nothing else set', () => {
    expect(graphicsTier.presetOf(graphicsTier.DEFAULTS)).toBe('high');
    expect(graphicsTier.DEFAULTS).toMatchObject({ fps: 60, brightness: 1, auto: false });
  });

  it('the lamp options are on offer and set by every preset', () => {
    expect(graphicsTier.CHOICES.lights.map(([v]) => v)).toStrictEqual([4, 8, 0]);
    expect(graphicsTier.CHOICES.lightShadows.map(([v]) => v)).toStrictEqual([0, 1]);
    expect(graphicsTier.PRESETS.low).toMatchObject({ lights: 4, lightShadows: 0 });
    expect(graphicsTier.PRESETS.medium).toMatchObject({ lights: 0, lightShadows: 0 });
    expect(graphicsTier.PRESETS.high).toMatchObject({ lights: 0, lightShadows: 1 });
    expect(graphicsTier.parseGraphics({ lights: 8, lightShadows: 5 })).toMatchObject({ lights: 8, lightShadows: 1 });
  });

  it('an old low or medium save with no lamp keys stays low or medium', () => {
    for (const id of ['low', 'medium'] as const) {
      const { lights: _l, lightShadows: _s, ...old } = graphicsTier.PRESETS[id];
      const g = graphicsTier.parseGraphics({ ...old, fps: 60, v: 2 });
      expect(graphicsTier.presetOf(g)).toBe(id);
      expect(
        graphicsTier.resolveStart({ ...old, fps: 60, v: 2 }, null, '', () => ({ tier: 'high', reason: '' })).rec.tier,
      ).toBe(id);
    }
  });

  it('every preset value is on offer, and no preset is cheaper than the one before', () => {
    const rank = (k: keyof typeof graphicsTier.CHOICES, v: number) =>
      graphicsTier.CHOICES[k].findIndex(([x]) => x === v);
    const ids = graphicsTier.PRESET_NAMES.map(([id]) => id);
    const keys = ['msaa', 'ao', 'bloom', 'shadows', 'textures', 'filtering', 'live', 'particles'] as const;
    for (const id of ids) {
      for (const k of keys) {
        expect(rank(k, graphicsTier.PRESETS[id][k])).toBeGreaterThanOrEqual(0);
      }
    }
    const before = ids.slice(0, -1);
    for (const [i, id] of ids.slice(1).entries()) {
      const prev = before[i];
      assert.exists(prev);
      for (const k of keys) {
        expect(graphicsTier.PRESETS[id][k]).toBeGreaterThanOrEqual(graphicsTier.PRESETS[prev][k]);
      }
    }
  });

  it('a changed picture option is Custom, the frame limit and the brightness are not', () => {
    expect(graphicsTier.presetOf({ ...graphicsTier.DEFAULTS, shadows: 1 })).toBeNull();
    expect(graphicsTier.presetOf({ ...graphicsTier.DEFAULTS, fps: 30, brightness: 1.2, auto: false })).toBe('high');
    expect(graphicsTier.presetOf({ ...graphicsTier.DEFAULTS, ...graphicsTier.PRESETS.low })).toBe('low');
  });
});

describe('stored settings', () => {
  it('fall back to the default on junk', () => {
    expect(graphicsTier.parseGraphics(null)).toStrictEqual(graphicsTier.DEFAULTS);
    expect(graphicsTier.parseGraphics('x')).toStrictEqual(graphicsTier.DEFAULTS);
    expect(graphicsTier.parseGraphics({ msaa: 3, shadows: 'High', scale: Number.NaN, auto: 1 })).toStrictEqual(
      graphicsTier.DEFAULTS,
    );
  });

  it('keep what is good, and clamp the sliders', () => {
    const g = graphicsTier.parseGraphics({ msaa: 8, scale: 9, brightness: 0.1, auto: false, fps: 60 });
    expect(g).toMatchObject({
      msaa: 8,
      scale: 1.5,
      brightness: 0.7,
      auto: false,
      fps: 60,
      shadows: graphicsTier.DEFAULTS.shadows,
    });
  });
});

describe('auto-adjust', () => {
  it('walks the GPU steps, then the CPU steps', () => {
    expect(graphicsTier.lowered(graphicsTier.DEFAULTS, 0)).toBe(graphicsTier.DEFAULTS);
    expect(graphicsTier.lowered(graphicsTier.DEFAULTS, 1)).toStrictEqual({ ...graphicsTier.DEFAULTS, ao: 0 });
    expect(graphicsTier.lowered(graphicsTier.DEFAULTS, 2)).toStrictEqual({
      ...graphicsTier.DEFAULTS,
      ao: 0,
      bloom: 0,
      msaa: 0,
      live: 0,
    });
    expect(graphicsTier.lowered(graphicsTier.DEFAULTS, 3)).toStrictEqual({
      ...graphicsTier.DEFAULTS,
      ao: 0,
      bloom: 0,
      msaa: 0,
      live: 0,
      scale: 0.75,
    });
    expect(graphicsTier.lowered(graphicsTier.DEFAULTS, 4)).toStrictEqual({
      ...graphicsTier.DEFAULTS,
      ao: 0,
      bloom: 0,
      msaa: 0,
      live: 0,
      scale: 0.75,
      shadows: 0,
      lightShadows: 0,
    });
    expect(graphicsTier.lowered(graphicsTier.DEFAULTS, 5)).toStrictEqual({
      ...graphicsTier.DEFAULTS,
      ao: 0,
      bloom: 0,
      msaa: 0,
      live: 0,
      scale: 0.75,
      shadows: 0,
      lightShadows: 0,
      fps: 30,
    });
  });

  it('step 5 caps the frame limit at 30 and never raises it', () => {
    expect(graphicsTier.lowered({ ...graphicsTier.DEFAULTS, fps: 0 }, 5).fps).toBe(30);
    expect(graphicsTier.lowered({ ...graphicsTier.DEFAULTS, fps: 120 }, 5).fps).toBe(30);
    expect(graphicsTier.lowered({ ...graphicsTier.DEFAULTS, fps: 30 }, 5).fps).toBe(30);
    expect(graphicsTier.lowered({ ...graphicsTier.DEFAULTS, fps: 20 }, 5).fps).toBe(20);
  });

  it('step 4 leaves the frame limit as it is', () => {
    expect(graphicsTier.lowered({ ...graphicsTier.DEFAULTS, fps: 120 }, 4).fps).toBe(120);
  });

  it('keeps the resolution until the effects are gone', () => {
    expect(graphicsTier.lowered(graphicsTier.DEFAULTS, 2).scale).toBe(graphicsTier.DEFAULTS.scale);
  });

  it('never raises what the player set lower', () => {
    expect(graphicsTier.lowered({ ...graphicsTier.DEFAULTS, scale: 0.5 }, 3).scale).toBe(0.5);
  });

  it('skips the steps that change nothing', () => {
    expect(graphicsTier.nextStep(graphicsTier.DEFAULTS, 0)).toBe(1);
    expect(graphicsTier.nextStep({ ...graphicsTier.DEFAULTS, ao: 0 }, 0)).toBe(2);
    expect(graphicsTier.nextStep({ ...graphicsTier.DEFAULTS, ...graphicsTier.PRESETS.low, fps: 30 }, 0)).toBeNull();
    expect(graphicsTier.nextStep({ ...graphicsTier.DEFAULTS, ...graphicsTier.PRESETS.low }, 0)).toBe(5);
    expect(graphicsTier.nextStep(graphicsTier.DEFAULTS, 3)).toBe(4);
    expect(graphicsTier.nextStep(graphicsTier.DEFAULTS, 4)).toBe(5);
    expect(graphicsTier.nextStep(graphicsTier.DEFAULTS, 5)).toBeNull();
    expect(graphicsTier.nextStep({ ...graphicsTier.DEFAULTS, shadows: 0, lightShadows: 0 }, 3)).toBe(5);
    expect(graphicsTier.nextStep({ ...graphicsTier.DEFAULTS, shadows: 0, lightShadows: 0, fps: 30 }, 3)).toBeNull();
  });
});

describe('the settings signal', () => {
  beforeEach(() => {
    graphicsTier.setTier('high');
  });

  it('a preset keeps the frame limit, the brightness and auto-adjust', () => {
    graphicsTier.setGraphic('auto', true);
    graphicsTier.setGraphic('fps', 120);
    graphicsTier.setGraphic('brightness', 1.2);
    graphicsTier.setPreset('low');
    expect(graphicsTier.graphics.value).toMatchObject({
      ...graphicsTier.PRESETS.low,
      fps: 120,
      brightness: 1.2,
      auto: true,
    });
  });

  it('any change hands the picture back to the player', () => {
    graphicsTier.setGraphic('auto', true);
    graphicsTier.autoStep.value = 3;
    expect(graphicsTier.effective.value.scale).toBe(0.75);
    graphicsTier.setGraphic('shadows', 2);
    expect(graphicsTier.autoStep.value).toBe(0);
    expect(graphicsTier.effective.value.scale).toBe(1);
  });

  it('setPreset and setTier give Low the same picture', () => {
    graphicsTier.setGraphic('auto', true);
    graphicsTier.setGraphic('brightness', 1.2);
    graphicsTier.setPreset('low');
    const byPreset = graphicsTier.graphics.value;
    graphicsTier.setTier('low');
    expect(byPreset).toStrictEqual(graphicsTier.graphics.value);
    expect(graphicsTier.graphics.value).toMatchObject({
      scale: 0.75,
      shadows: 0,
      fps: 60,
      brightness: 1.2,
      auto: true,
    });
  });

  it('setPreset gives Medium and High their own pictures, scale and shadows included', () => {
    graphicsTier.setPreset('medium');
    expect(graphicsTier.graphics.value).toMatchObject({
      scale: 0.75,
      shadows: 2,
      msaa: 2,
      ao: 1,
      bloom: 1,
      lights: 0,
      lightShadows: 0,
      textures: 1,
      filtering: 4,
      live: 1,
      particles: 1,
    });
    graphicsTier.setPreset('high');
    expect(graphicsTier.graphics.value).toMatchObject({
      scale: 1,
      shadows: 3,
      msaa: 4,
      ao: 2,
      bloom: 2,
      lights: 0,
      lightShadows: 1,
      textures: 2,
      filtering: 8,
      live: 2,
      particles: 2,
    });
  });

  it('Reset to defaults gives back the detected tier and the three options a preset leaves alone', () => {
    graphicsTier.setGraphic('auto', true);
    graphicsTier.setGraphic('fps', 120);
    graphicsTier.setGraphic('brightness', 1.2);
    graphicsTier.setGraphic('shadows', 1);
    graphicsTier.resetGraphics();
    expect(graphicsTier.tierRecord.value.mode).toBe('auto');
    expect(graphicsTier.graphics.value).toMatchObject({
      ...graphicsTier.PRESETS[graphicsTier.tierRecord.value.tier],
      fps: 60,
      brightness: 1,
      auto: false,
    });
  });

  it('auto-adjust off ignores the step', () => {
    graphicsTier.setGraphic('auto', false);
    graphicsTier.autoStep.value = 3;
    expect(graphicsTier.effective.value).toStrictEqual(graphicsTier.graphics.value);
  });
});

describe('FrameGate', () => {
  /** Frames a limit lets through out of a second of a screen at `hz`. */
  const drawn = (hz: number, fps: number) => {
    const g = new graphicsTier.FrameGate();
    let n = 0;
    for (let i = 0; i < hz; i++) {
      if (g.ready((i * 1000) / hz, fps)) {
        n++;
      }
    }
    return n;
  };

  it('no limit draws every frame', () => {
    expect(drawn(144, 0)).toBe(144);
  });
  it('a limit at the screen rate drops nothing', () => {
    expect(drawn(60, 60)).toBe(60);
  });
  it('a limit over the screen rate drops nothing', () => {
    expect(drawn(60, 120)).toBe(60);
  });
  it('holds the limit on a faster screen', () => {
    expect(drawn(144, 60)).toBeGreaterThanOrEqual(59);
    expect(drawn(144, 60)).toBeLessThanOrEqual(61);
    expect(drawn(240, 30)).toBeLessThanOrEqual(31);
  });
});

describe('the frame limit', () => {
  // frames a 120 Hz screen lets draw in `s` seconds under the limit at each frame (the frame loop: `loopLimit`, then `FrameGate`)
  const drawnIn = (s: number, limitAt: (t: number) => number) => {
    const g = new graphicsTier.FrameGate();
    let n = 0;
    for (let i = 0; i < 120 * s; i++) {
      const t = (i * 1000) / 120;
      if (g.ready(t, limitAt(t))) {
        n++;
      }
    }
    return n;
  };

  it('Low runs at 60, not held to 30', () => {
    graphicsTier.setTier('low');
    expect(graphicsTier.graphics.value.fps).toBe(60);
    expect(drawnIn(1, () => graphicsTier.loopLimit(graphicsTier.graphics.value.fps, true))).toBeGreaterThanOrEqual(59);
    graphicsTier.setTier('high');
  });

  it('keeps the full rate with the page focused, at any time without input', () => {
    expect(graphicsTier.loopLimit(60, true)).toBe(60);
    expect(graphicsTier.loopLimit(0, true)).toBe(0);
  });

  it('draws the full rate over 40 s and more with the page focused', () => {
    // no input at all: the limit does not depend on how long the player has been idle
    expect(drawnIn(40, () => graphicsTier.loopLimit(60, true))).toBeGreaterThanOrEqual(60 * 40 - 2);
  });

  it('holds to 30 without the focus, at once', () => {
    expect(graphicsTier.loopLimit(120, false)).toBe(30);
    expect(graphicsTier.loopLimit(60, false)).toBe(30);
    expect(graphicsTier.loopLimit(0, false)).toBe(30);
  });

  it('never raises a lower limit', () => {
    expect(graphicsTier.loopLimit(24, false)).toBe(24);
  });
});

describe('the watches at the Low limit', () => {
  const lowSave: graphicsTier.Graphics = { ...graphicsTier.DEFAULTS, ...graphicsTier.PRESETS.low, fps: 60 }; // a Low save at 60 fps
  const lowTier = graphicsTier.tierGraphics('low', graphicsTier.DEFAULTS); // the phone's Low tier: the Low preset's picture at 60 fps
  /** Did `SlowWatch` ask for a step down in `secs` of steady `fps` frames, judged as board3d judges them? */
  const slowSteps = (fps: number, limit: number, g: graphicsTier.Graphics, secs: number) => {
    const w = new graphicsTier.SlowWatch();
    w.reset(0);
    let fired = 0;
    for (let t = 5000, i = 0; t < 5000 + secs * 1000; i++, t += 1000 / fps) {
      if (w.tick(1 / fps, t, graphicsTier.watchFps(g, limit))) {
        fired++;
      }
    }
    return fired;
  };
  /** The one decision `TierWatch` makes from steady frames, judged as board3d judges them. */
  const tierDecision = (fps: number, workMs: number, limit: number, g: graphicsTier.Graphics) => {
    const w = new graphicsTier.TierWatch();
    w.reset(0);
    let out: 'down' | 'up' | null = null;
    for (let t = 5000, i = 0; i < 600 && !out; i++, t += 1000 / fps) {
      out = w.tick(1 / fps, workMs, t, graphicsTier.watchFps(g, limit));
    }
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
    expect(slowSteps(27, 60, { ...graphicsTier.DEFAULTS, ...graphicsTier.PRESETS.medium }, 10)).toBeGreaterThan(0);
    expect(slowSteps(27, 60, graphicsTier.DEFAULTS, 10)).toBeGreaterThan(0);
  });
});

describe('isLow: Low alone takes the cheap materials, probe and shadows', () => {
  it('a Low tier and a migrated old Low save are Low', () => {
    expect(graphicsTier.isLow(graphicsTier.tierGraphics('low', graphicsTier.DEFAULTS))).toBe(true);
    const old = graphicsTier.resolveStart(
      { ...graphicsTier.PRESETS.low, fps: 30, v: 2 },
      { mode: 'manual', tier: 'low', reason: 'chosen' },
      '',
      () => ({ tier: 'high', reason: '' }),
    );
    expect(graphicsTier.isLow(old.g)).toBe(true);
  });
  it('Medium, High and the defaults are not Low', () => {
    for (const t of ['medium', 'high'] as const) {
      expect(graphicsTier.isLow(graphicsTier.tierGraphics(t, graphicsTier.DEFAULTS)), t).toBe(false);
    }
    expect(graphicsTier.isLow(graphicsTier.DEFAULTS)).toBe(false);
  });
});

describe('SlowWatch', () => {
  it('ignores a few long hitches (shader compiles)', () => {
    const w = new graphicsTier.SlowWatch();
    w.reset(0);
    for (let i = 0; i < 5; i++) {
      expect(w.tick(1, 1e4 + i * 2000, 0)).toBe(false);
    }
  });

  it('waits for the settling time, then for 2.5 s of slow frames', () => {
    const w = new graphicsTier.SlowWatch();
    w.reset(0);
    expect(w.tick(0.1, 1000, 0)).toBe(false);
    let t = 5000,
      fired = 0;
    for (let i = 0; i < 26; i++) {
      t += 100;
      if (w.tick(0.1, t, 0)) {
        fired++;
      }
    }
    expect(fired).toBe(1);
  });

  it('good frames pay the slow ones back', () => {
    const w = new graphicsTier.SlowWatch();
    for (let i = 0; i < 500; i++) {
      expect(w.tick(i % 2 ? 0.04 : 0.02, 1e4 + i, 0)).toBe(false);
    }
  });

  it('a loop held to 30 is not slow', () => {
    const w = new graphicsTier.SlowWatch();
    for (let i = 0; i < 300; i++) {
      expect(w.tick(1 / 30 + 0.001, 1e4 + i * 34, 30)).toBe(false);
    }
  });
});
