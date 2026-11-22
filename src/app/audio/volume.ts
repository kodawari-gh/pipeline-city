// The player's volume: four sliders (0..100) and Mute. Pure functions, no DOM, no AudioContext.
// Gain = (v / 100)^2 on top of each bus default (mixTokens.ts). busGains returns the full linear gain per bus.
// Stored per device (localStorage), never in the save. mix.ts holds the live signal.
import { MIX } from './mixTokens';

export type SliderId = 'master' | 'music' | 'sounds' | 'ambience';
export type BusName = 'master' | 'music' | 'sfx' | 'ui' | 'ambience';

export interface Volumes {
  master: number;
  music: number;
  sounds: number;
  ambience: number;
  muted: boolean;
}

/** The part of Storage that is used here. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const dB = (d: number): number => Math.pow(10, d / 20);

/** Clamp to 0..100 and snap to the slider step. A value that is not a number takes `fallback`. */
export function snapPercent(v: unknown, fallback = 100): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const step = MIX.sliders.stepPercent;
  const snapped = Math.round(Math.min(100, Math.max(0, n)) / step) * step;
  return Math.min(100, Math.max(0, snapped));
}

/** Slider percent to gain fraction: the square of the fraction. 0 % is silent. */
export function sliderGain(percent: number): number {
  const f = snapPercent(percent) / 100;
  return f * f;
}

export function defaultVolumes(): Volumes {
  return {
    master: MIX.sliders.master.default,
    music: MIX.sliders.music.default,
    sounds: MIX.sliders.sounds.default,
    ambience: MIX.sliders.ambience.default,
    muted: false,
  };
}

/** Linear gain per bus: the bus default dB times its slider's gain. Mute sets every bus to 0. `sounds` drives sfx and ui. */
export function busGains(v: Volumes): Record<BusName, number> {
  const live = v.muted ? 0 : 1;
  const bus = (name: BusName, percent: number): number => live * dB(MIX.buses[name].defaultDb) * sliderGain(percent);
  return {
    master: bus('master', v.master),
    music: bus('music', v.music),
    sfx: bus('sfx', v.sounds),
    ui: bus('ui', v.sounds),
    ambience: bus('ambience', v.ambience),
  };
}

/** Read the stored volumes. Missing, blocked (null store) or broken storage gives the defaults. */
export function readVolumes(store: KeyValueStore | null): Volumes {
  const d = defaultVolumes();
  try {
    const raw = store?.getItem(MIX.sliders.storageKey) ?? null;
    if (!raw) return d;
    const o = JSON.parse(raw) as Partial<Record<keyof Volumes, unknown>>;
    return {
      master: snapPercent(o.master, d.master),
      music: snapPercent(o.music, d.music),
      sounds: snapPercent(o.sounds, d.sounds),
      ambience: snapPercent(o.ambience, d.ambience),
      muted: o.muted === true,
    };
  } catch {
    return d;
  }
}

/** Store the volumes. Never throws: a blocked or full store keeps the mix for this visit only. */
export function writeVolumes(store: KeyValueStore | null, v: Volumes): void {
  try {
    store?.setItem(MIX.sliders.storageKey, JSON.stringify(v));
  } catch {
    /* storage blocked or full */
  }
}
