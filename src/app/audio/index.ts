// initAudio(): wired once from main.tsx. Unlock on the first gesture, load after `booted`, and the director follows each snapshot,
// the clock (`readUi`) and the screen (`readScene`). The director also drives the ambience (ambience.ts).
import { effect } from '@preact/signals';
import { booted } from '../boot';
import { snapshot } from '../store';
import { debugOn } from '../debugflag';
import { createDirector, type Scene, type UiInput } from './director';
import { applyMix, engineSink, setHidden, startLoading, unlockOnGesture } from './engine';
import { audioMix } from './mix';
import { installUiCues } from './uiListener';

/** The screen the room loop follows. Until the boot screen has gone there is no screen yet (`boot`): the room loop waits. */
export function sceneOf(s: { booted: boolean; build: boolean; gallery: boolean; game: boolean }): Scene {
  if (!s.booted) return 'boot';
  return s.build ? 'build' : s.gallery ? 'gallery' : s.game ? 'game' : 'menu';
}

/**
 * `search` defaults to the page's query string, read here (not at import), so a test without `location` can call it.
 * `readUi` gives the clock's speed, the hold on it and a crash. `readScene` says which screen shows (the room loop plays in menu and game).
 * They run in effects, so the signals they read are followed.
 */
export function initAudio(search?: string, readUi?: () => UiInput, readScene?: () => Scene): void {
  const director = createDirector(engineSink);
  unlockOnGesture(() => director.onUnlock());
  installUiCues();
  // The hidden tab fades the sound and suspends the context (engine.ts `setHidden`). Only visibility drives it.
  setHidden(document.visibilityState === 'hidden');
  document.addEventListener('visibilitychange', () => setHidden(document.visibilityState === 'hidden'));
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
  effect(() => {
    const s = snapshot.value;
    if (s) director.onSnapshot(s);
    else director.reset();
  });
  if (readUi) effect(() => { director.onUi(readUi()); });
  if (readScene) effect(() => { director.onScene(readScene()); });
}
