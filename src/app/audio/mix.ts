// The player's mix as a live signal. The rules (clamp, gain, bus gains, storage) are pure, in volume.ts.
// The engine applies it (index.ts -> engine.applyMix). Per device (localStorage), never in the save.
import { signal } from '@preact/signals';
import * as volume from './volume';

export const SLIDER_IDS: readonly volume.SliderId[] = ['master', 'music', 'sounds', 'ambience'];
export const SLIDER_LABEL: Record<volume.SliderId, string> = {
  master: 'Master',
  music: 'Music',
  sounds: 'Sounds',
  ambience: 'Ambience',
};

/** localStorage, or null when the window blocks it (the accessor itself can throw). */
function store(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** The live mix. Read it with `.value`; change it only through `setSlider` and `setMuted`. */
export const audioMix = signal<volume.Volumes>(volume.readVolumes(store()));

/** Set one slider (0..100). Stored at once. */
export function setSlider(id: volume.SliderId, percent: number): void {
  const next = { ...audioMix.value, [id]: volume.snapPercent(percent, audioMix.value[id]) };
  audioMix.value = next;
  volume.writeVolumes(store(), next);
}

export function setMuted(muted: boolean): void {
  const next = { ...audioMix.value, muted };
  audioMix.value = next;
  volume.writeVolumes(store(), next);
}
