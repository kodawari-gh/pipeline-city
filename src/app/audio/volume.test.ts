// Ticket #52: the Settings sound sliders (volume.ts). Pure functions and a storage fake: no DOM, no AudioContext.
// Assumed seam (volume.ts, written by the coder):
//   sliderGain(percent)            -> (clamped, snapped percent / 100) squared
//   snapPercent(p)                 -> nearest 5 in 0..100
//   defaultVolumes()               -> { master, music, sounds, ambience: 100, muted: false }
//   busGains(volumes)              -> linear gain per bus (bus default dB x its slider's gain; all 0 when muted)
//   readVolumes(storage)           -> Volumes, from storage at MIX.sliders.storageKey; defaults when missing or bad
//   writeVolumes(storage, volumes) -> void; never throws
import { describe, expect, it } from 'vitest';
import { MIX } from './mixTokens';
import { busGains, defaultVolumes, readVolumes, sliderGain, snapPercent, writeVolumes, type Volumes } from './volume';

const KEYS = ['master', 'music', 'sounds', 'ambience'] as const;
type SliderKey = (typeof KEYS)[number];
const dB = (d: number): number => Math.pow(10, d / 20);

/** A Storage stand-in: a Map behind getItem / setItem / removeItem. */
class FakeStorage {
  items = new Map<string, string>();
  getItem(k: string): string | null { return this.items.get(k) ?? null; }
  setItem(k: string, v: string): void { this.items.set(k, String(v)); }
  removeItem(k: string): void { this.items.delete(k); }
}
/** A storage that throws on every call, as a blocked or private window does. */
class BlockedStorage {
  getItem(): string | null { throw new Error('blocked'); }
  setItem(): void { throw new Error('blocked'); }
  removeItem(): void { throw new Error('blocked'); }
}

const all = (v: number): Volumes => ({ master: v, music: v, sounds: v, ambience: v, muted: false });

describe('gain mapping', () => {
  it('a slider at 100 is unity gain, at 0 is silent', () => {
    expect(sliderGain(100)).toBe(1);
    expect(sliderGain(0)).toBe(0);
  });

  it('gain is the square of the fraction', () => {
    expect(sliderGain(50)).toBeCloseTo(0.25, 10);
    expect(sliderGain(75)).toBeCloseTo(0.5625, 10);
    expect(sliderGain(20)).toBeCloseTo(0.04, 10);
  });

  it.each(Array.from({ length: 21 }, (_, i) => i * 5))('step %i: gain is (v/100) squared', (v) => {
    expect(sliderGain(v)).toBeCloseTo((v / 100) ** 2, 10);
  });

  it('gain rises with the slider', () => {
    for (let v = 0; v < 100; v += 5) expect(sliderGain(v + 5)).toBeGreaterThan(sliderGain(v));
  });

  it('the slider runs in steps of 5: an off-step value snaps to the nearest step', () => {
    expect(snapPercent(0)).toBe(0);
    expect(snapPercent(2)).toBe(0);
    expect(snapPercent(3)).toBe(5);
    expect(snapPercent(37)).toBe(35);
    expect(snapPercent(38)).toBe(40);
    expect(snapPercent(98)).toBe(100);
  });

  it('values outside 0..100 clamp to the ends', () => {
    expect(snapPercent(-7)).toBe(0);
    expect(snapPercent(104)).toBe(100);
    expect(sliderGain(250)).toBe(1);
    expect(sliderGain(-10)).toBe(0);
  });

  it('every slider defaults to 100', () => {
    expect(defaultVolumes()).toEqual({ master: 100, music: 100, sounds: 100, ambience: 100, muted: false });
  });
});

describe('each slider changes only its buses', () => {
  const defaults = busGains(defaultVolumes());

  it('the default bus gains are the bus default dB (the sliders at 100 add nothing)', () => {
    for (const id of Object.keys(MIX.buses) as (keyof typeof MIX.buses)[]) {
      expect(defaults[id]).toBeCloseTo(dB(MIX.buses[id].defaultDb), 6);
    }
  });

  it.each(KEYS)('moving %s to 0 changes exactly the buses it drives', (key: SliderKey) => {
    const v = { ...defaultVolumes(), [key]: 0 };
    const got = busGains(v);
    const driven = MIX.sliders[key].buses as readonly string[];
    for (const id of Object.keys(MIX.buses)) {
      if (driven.includes(id)) expect(got[id as keyof typeof got]).toBe(0);
      else expect(got[id as keyof typeof got]).toBeCloseTo(defaults[id as keyof typeof defaults], 10);
    }
  });

  it('Sounds drives the sfx and ui buses together, and nothing else', () => {
    const got = busGains({ ...defaultVolumes(), sounds: 50 });
    expect(got.sfx).toBeCloseTo(dB(MIX.buses.sfx.defaultDb) * 0.25, 10);
    expect(got.ui).toBeCloseTo(dB(MIX.buses.ui.defaultDb) * 0.25, 10);
    expect(got.music).toBeCloseTo(defaults.music, 10);
    expect(got.ambience).toBeCloseTo(defaults.ambience, 10);
    expect(got.master).toBeCloseTo(defaults.master, 10);
  });
});

describe('0 is silent and Mute silences everything', () => {
  it('Sounds at 0 gives silent sfx and ui', () => {
    const got = busGains({ ...defaultVolumes(), sounds: 0 });
    expect(got.sfx).toBe(0);
    expect(got.ui).toBe(0);
  });

  it('Mute on gives zero on every bus, whatever the sliders say', () => {
    const got = busGains({ ...all(100), muted: true });
    for (const id of Object.keys(MIX.buses)) expect(got[id as keyof typeof got]).toBe(0);
  });

  it('Mute off gives the same gains as before the switch existed', () => {
    expect(busGains({ ...all(60), muted: false })).toEqual(busGains(all(60)));
  });
});

describe('persistence (per device, outside the save)', () => {
  it('an empty store reads as the defaults', () => {
    expect(readVolumes(new FakeStorage())).toEqual(defaultVolumes());
  });

  it('what was written is read back after a reload', () => {
    const store = new FakeStorage();
    const v: Volumes = { master: 60, music: 35, sounds: 0, ambience: 80, muted: true };
    writeVolumes(store, v);
    expect(readVolumes(store)).toEqual(v);
  });

  it('the value lives under the storage key in the mix tokens', () => {
    const store = new FakeStorage();
    writeVolumes(store, all(40));
    expect(store.getItem(MIX.sliders.storageKey)).not.toBeNull();
  });

  it('a bad stored value falls back to the defaults and does not throw', () => {
    const store = new FakeStorage();
    store.setItem(MIX.sliders.storageKey, '{not json');
    expect(() => readVolumes(store)).not.toThrow();
    expect(readVolumes(store)).toEqual(defaultVolumes());
  });

  it('a stored value off the step or out of range is read snapped and clamped', () => {
    const store = new FakeStorage();
    store.setItem(MIX.sliders.storageKey, JSON.stringify({ master: 250, music: 42, sounds: -5, ambience: 100, muted: false }));
    expect(readVolumes(store)).toEqual({ master: 100, music: 40, sounds: 0, ambience: 100, muted: false });
  });

  it('a blocked storage reads as the defaults and writes quietly', () => {
    const store = new BlockedStorage();
    expect(() => writeVolumes(store, all(20))).not.toThrow();
    expect(readVolumes(store)).toEqual(defaultVolumes());
  });
});
