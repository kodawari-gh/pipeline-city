import { render } from 'preact';
import { mountBoard } from '../features/board/render/board';
import { loadAutosaveOffer } from './store';
import { Hud } from '../core/ui/Hud';
import { openNewGame } from '../core/ui/panels/NewGame';

// If an autosave exists the HUD offers it; otherwise the New game dialog (Campaign or Sandbox) opens. The sim only starts once the player chooses.
if (!loadAutosaveOffer()) openNewGame();
mountBoard(document.getElementById('board')!);
render(<Hud />, document.getElementById('hud')!);
