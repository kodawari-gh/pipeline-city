import { render } from 'preact';
import { mountBoard } from '../features/board/render/board';
import { rendererKind } from './graphics';
import { loadAutosaveOffer } from './store';
import { bootDone, bootStage } from './boot';
import { Hud } from '../core/ui/Hud';

// The main menu (Continue when an autosave exists, New game, Load game, Settings) shows once the boot screen has gone. The sim only starts once the player chooses.
loadAutosaveOffer();
// The 3D renderer (docs/GRAPHICS_3D_OVERHAUL.md) is the game's view. The 2D board stays as a hidden fallback: `?2d` in the address, or `VITE_3D_GRAPHICS=0` at build time.
// Only the chosen renderer's code loads.
// The boot screen stays until the board can be seen (docs/render/load.md): the 3D mount ends it, the 2D board at once.
const host = document.getElementById('board')!;
const q = new URLSearchParams(location.search);
rendererKind.value = q.has('2d') || (import.meta.env.VITE_3D_GRAPHICS === '0' && !q.has('3d')) ? '2d' : '3d';
if (rendererKind.value === '3d') {
  bootStage('Loading the 3D world', 0.08);
  void import('../features/board/render/three/board3d').then((m) => m.mountBoard3d(host)).catch((e: unknown) => { bootDone(); throw e; });
} else {
  mountBoard(host);
  bootDone();
}
render(<Hud />, document.getElementById('hud')!);

// No browser right-click menu anywhere in the game. Text fields keep theirs (copy and paste), and the dev server keeps it for Inspect.
if (!import.meta.env.DEV) {
  window.addEventListener('contextmenu', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable)) return;
    e.preventDefault();
  });
}
