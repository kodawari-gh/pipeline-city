// initAudio(): wired once from main.tsx. Unlock on the first gesture, load after `booted`, and the director follows each snapshot,
// the clock (`readUi`) and the screen (`readScene`). The director also drives the ambience (ambience.ts).
import { effect } from '@preact/signals';
import { booted } from '../boot';
import { snapshot } from '../store';
import { debugOn } from '../debugflag';
import * as audioDirector from './director';
import { applyMix, engineSink, setHidden, startLoading, unlockOnGesture } from './engine';
import { audioMix } from './mix';
import { studioMachine } from './studio';
import { installUiCues } from './uiListener';

/** The screen the room loop follows. Until the boot screen has gone there is no screen yet (`boot`): the room loop waits. */
export function sceneOf(s: { booted: boolean; build: boolean; gallery: boolean; game: boolean }): audioDirector.Scene {
  if (!s.booted) {
    return 'boot';
  }
  return s.build ? 'build' : s.gallery ? 'gallery' : s.game ? 'game' : 'menu';
}

/** Loads the sounds once the boot screen has gone (once), and with `?debug` in `query` the cue board too. */
function loadAfterBoot(query: string): void {
  let loading = false;
  effect(() => {
    if (booted.value && !loading) {
      loading = true;
      startLoading();
      if (debugOn(query)) {
        void import('./cueBoard').then((m) => m.mountCueBoard());
      }
    }
  });
}

/**
 * `search` defaults to the page's query string, read here (not at import), so a test without `location` can call it.
 * `readUi` gives the clock's speed, the hold on it and a crash. `readScene` says which screen shows (the room loop plays in menu and game).
 * They run in effects, so the signals they read are followed.
 */
export function initAudio(
  search?: string,
  readUi?: () => audioDirector.UiInput,
  readScene?: () => audioDirector.Scene,
): void {
  const director = audioDirector.createDirector(engineSink);
  unlockOnGesture(() => director.onUnlock());
  installUiCues();
  // The hidden tab fades the sound and suspends the context (engine.ts `setHidden`). Only visibility drives it.
  // The music follows too (ticket #63): it ignores state while hidden and sets it at once on return.
  const hide = (h: boolean) => {
    const droppedMusic = setHidden(h);
    director.onHidden(h, droppedMusic);
  };
  hide(document.visibilityState === 'hidden');
  document.addEventListener('visibilitychange', () => hide(document.visibilityState === 'hidden'));
  effect(() => {
    applyMix(audioMix.value);
  });
  loadAfterBoot(search ?? (typeof location === 'undefined' ? '' : location.search));
  effect(() => {
    const s = snapshot.value;
    if (s) {
      director.onSnapshot(s);
    } else {
      director.reset();
    }
  });
  if (readUi) {
    effect(() => {
      director.onUi(readUi());
    });
  }
  if (readScene) {
    effect(() => {
      director.onScene(readScene());
    });
  }
  // The studio's machine (Build my PC sets it while its machine shows): the hum follows it (ticket #66).
  effect(() => {
    director.onStudio(studioMachine.value);
  });
}
