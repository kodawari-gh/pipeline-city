import { beforeEach, describe, expect, it } from 'vitest';
import {
  autoStep, AwayWatch, CHOICES, DEFAULTS, deviceDefaults, effective, FrameGate, graphics, lowered, nextStep, parseGraphics, presetOf, PRESETS, PRESET_NAMES, resetGraphics, setGraphic, setPreset, SlowWatch,
} from './graphics';

describe('presets', () => {
  it('the default is High with nothing else set', () => {
    expect(presetOf(DEFAULTS)).toBe('high');
    expect(DEFAULTS).toMatchObject({ fps: 60, brightness: 1, auto: false });
    expect(deviceDefaults(false)).toEqual(DEFAULTS);
    expect(deviceDefaults(true)).toEqual({ ...DEFAULTS, ...PRESETS.low, fps: 30 });
    expect(presetOf(deviceDefaults(true))).toBe('low');
    expect(parseGraphics({ msaa: 4 }, deviceDefaults(true))).toMatchObject({ msaa: 4, scale: PRESETS.low.scale, fps: 30 });
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
  beforeEach(() => resetGraphics());

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
