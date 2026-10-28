import { render } from 'preact';
import { mountBoard } from './render/board/board';
import { loadAutosaveOffer } from './game/store';
import { Hud } from './ui/panels/Hud';
import { openNewGame } from './ui/panels/NewGame';

// If an autosave exists the HUD offers it; otherwise the New game dialog (Campaign or Sandbox) opens. The sim only starts once the player chooses.
if (!loadAutosaveOffer()) openNewGame();
mountBoard(document.getElementById('board')!);
render(<Hud />, document.getElementById('hud')!);
