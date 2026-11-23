// The player's mix as a live signal. The rules (clamp, gain, bus gains, storage) are pure, in volume.ts.
// The engine applies it (index.ts -> engine.applyMix). Per device (localStorage), never in the save.
import { signal } from '@preact/signals';
import { readVolumes, snapPercent, writeVolumes, type SliderId, type Volumes } from './volume';

export const SLIDER_IDS: readonly SliderId[] = ['master', 'music', 'sounds', 'ambience'];
export const SLIDER_LABEL: Record<SliderId, string> = {
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
export const audioMix = signal<Volumes>(readVolumes(store()));

/** Set one slider (0..100). Stored at once. */
export function setSlider(id: SliderId, percent: number): void {
  const next = { ...audioMix.value, [id]: snapPercent(percent, audioMix.value[id]) };
  audioMix.value = next;
  writeVolumes(store(), next);
}

export function setMuted(muted: boolean): void {
  const next = { ...audioMix.value, muted };
  audioMix.value = next;
  writeVolumes(store(), next);
}
