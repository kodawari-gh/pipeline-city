import { render } from 'preact';
import { crash, loadAutosaveOffer, speed } from './store';
import { bootFail, bootMenu, bootStage } from './boot';
import { guardPage } from './touchguard';
import { Hud } from '../core/ui/Hud';
import { gameMenuOpen, levelUp, popupPause } from '../core/ui/state';
import { initAudio } from './audio';

// A pinch is the camera's zoom, never the page's (`touchguard.ts`).
guardPage();

// The main menu (Continue when an autosave exists, New game, Load game, Settings) shows once the boot screen has gone. The sim only starts once the player chooses.
loadAutosaveOffer();
// Sound (src/app/audio/AUDIO.md): silent until the first gesture, loads after the boot screen, and plays the log notes of each snapshot.
// The clock's hold: level-up outranks the tutorial popup, which outranks the in-game menu.
initAudio(undefined, () => ({
  speed: speed.value,
  hold: levelUp.value ? 'levelUp' : popupPause.value ? 'tutorial' : gameMenuOpen.value ? 'menu' : null,
  crashed: crash.value !== null,
  levelUp: levelUp.value?.level ?? null,
}));
// The 3D renderer (docs/render/three.md) is the game's view. Its code loads here; the boot screen stays until the 3D mount ends it (docs/render/load.md).
// If the world cannot start (no WebGL), the screen stays and says why (`bootFail`): there is no game to play without it.
const host = document.getElementById('board')!;
bootStage('Loading the 3D world', 0.08);
void import('../features/board/render/three/board3d').then((m) => m.mountBoard3d(host)).catch((e: unknown) => { bootFail(e); throw e; });
render(<Hud />, document.getElementById('hud')!);
bootMenu(); // (the menu shows at once, over the boot screen: the screen keeps its picture and a progress line)

// No browser right-click menu anywhere in the game. Text fields keep theirs (copy and paste), and the dev server keeps it for Inspect.
if (!import.meta.env.DEV) {
  window.addEventListener('contextmenu', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable)) return;
    e.preventDefault();
  });
}
