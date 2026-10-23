import { render } from 'preact';
import { mountBoard } from './render/board';
import { loadAutosaveOffer, startSim } from './game/store';
import { Hud } from './ui/Hud';

// If an autosave exists the HUD offers it; the sim only starts once the player chooses.
if (!loadAutosaveOffer()) startSim(null);
mountBoard(document.getElementById('board')!);
render(<Hud />, document.getElementById('hud')!);
