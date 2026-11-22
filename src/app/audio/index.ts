// initAudio(): wired once from main.tsx. Unlock on the first gesture, load after `booted`, and the director follows each snapshot.
import { effect } from '@preact/signals';
import { booted } from '../boot';
import { snapshot } from '../store';
import { debugOn } from '../debugflag';
import { createDirector } from './director';
import { engineSink, startLoading, unlockOnGesture } from './engine';

/** `search` defaults to the page's query string, read here (not at import), so a test without `location` can call it. */
export function initAudio(search?: string): void {
  unlockOnGesture();
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
}
