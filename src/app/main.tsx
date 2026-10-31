import { render } from 'preact';
import { mountBoard } from '../features/board/render/board';
import { loadAutosaveOffer } from './store';
import { Hud } from '../core/ui/Hud';
import { openNewGame } from '../core/ui/panels/NewGame';

// If an autosave exists the HUD offers it; otherwise the New game dialog (Campaign or Sandbox) opens. The sim only starts once the player chooses.
if (!loadAutosaveOffer()) openNewGame();
// The 3D renderer (docs/GRAPHICS_3D_OVERHAUL.md) is behind a flag: `VITE_3D_GRAPHICS=1` at build time, or `?3d` in the address. Its code loads only then.
const host = document.getElementById('board')!;
if (import.meta.env.VITE_3D_GRAPHICS === '1' || new URLSearchParams(location.search).has('3d')) void import('../features/board/render/three/board3d').then((m) => m.mountBoard3d(host));
else mountBoard(host);
render(<Hud />, document.getElementById('hud')!);
