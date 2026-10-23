import { render } from 'preact';
import { mountBoard } from './render/board';
import { startSim } from './game/store';
import { Hud } from './ui/Hud';

startSim(null);
mountBoard(document.getElementById('board')!);
render(<Hud />, document.getElementById('hud')!);
