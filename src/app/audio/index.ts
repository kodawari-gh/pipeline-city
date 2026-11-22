// initAudio(): wired once from main.tsx. Unlock on the first gesture, load after `booted`, and the director follows each snapshot and the clock (`readUi`).
import { effect } from '@preact/signals';
import { booted } from '../boot';
import { snapshot } from '../store';
import { debugOn } from '../debugflag';
import { createDirector, type UiInput } from './director';
import { applyMix, engineSink, startLoading, unlockOnGesture } from './engine';
import { audioMix } from './mix';

/**
 * `search` defaults to the page's query string, read here (not at import), so a test without `location` can call it.
 * `readUi` gives the clock's speed, the hold on it and a crash. It runs in an effect, so the signals it reads are followed.
 */
export function initAudio(search?: string, readUi?: () => UiInput): void {
  unlockOnGesture();
  effect(() => { applyMix(audioMix.value); });
  const query = search ?? (typeof location === 'undefined' ? '' : location.search);
  let loading = false;
  effect(() => {
    if (booted.value && !loading) {
      loading = true;
      startLoading();
      if (debugOn(query)) void import('./cueBoard').then((m) => m.mountCueBoard());
    }
  });
  const director = createDirector(engineSink);
  effect(() => {
    const s = snapshot.value;
    if (s) director.onSnapshot(s);
    else director.reset();
  });
  if (readUi) effect(() => { director.onUi(readUi()); });
}
