import { render } from 'preact';
import { mountBoard } from '../features/board/render/board';
import { rendererKind } from './graphics';
import { loadAutosaveOffer } from './store';
import { bootDone, bootStage } from './boot';
import { Hud } from '../core/ui/Hud';
import { openNewGame } from '../core/ui/panels/NewGame';

// If an autosave exists the HUD offers it; otherwise the New game dialog (Campaign or Sandbox) opens. The sim only starts once the player chooses.
if (!loadAutosaveOffer()) openNewGame();
// The 3D renderer (docs/GRAPHICS_3D_OVERHAUL.md) is behind a flag: `VITE_3D_GRAPHICS=1` at build time, or `?3d` in the address. Its code loads only then.
// The boot screen stays until the board can be seen (docs/render/load.md): the 3D mount ends it, the 2D board at once.
const host = document.getElementById('board')!;
rendererKind.value = import.meta.env.VITE_3D_GRAPHICS === '1' || new URLSearchParams(location.search).has('3d') ? '3d' : '2d';
if (rendererKind.value === '3d') {
  bootStage('Loading the 3D world', 0.08);
  void import('../features/board/render/three/board3d').then((m) => m.mountBoard3d(host)).catch((e: unknown) => { bootDone(); throw e; });
} else {
  mountBoard(host);
  bootDone();
}
render(<Hud />, document.getElementById('hud')!);
